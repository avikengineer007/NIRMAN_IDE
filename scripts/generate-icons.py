import base64
import io
import os
from PIL import Image, ImageDraw


def extract_transparent_n_glyph(source_img: Image.Image, target_size: int = 512) -> Image.Image:
    """
    Crops the central glowing purple 'N' and its orbit ring from the master artwork
    (y: 242..542, x: 185..825) and converts the black background into smooth alpha
    transparency so the 'N' floats cleanly in the top-left corner and workspace watermark.
    """
    rgb = source_img.convert("RGB")
    # Bounding box containing the N and orbit ring (excluding top/bottom pedestals and text)
    crop_box = (185, 240, 825, 545)
    cropped = rgb.crop(crop_box)
    cw, ch = cropped.size

    # Convert dark background to smooth alpha channel
    rgba = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    src_pixels = cropped.load()
    dst_pixels = rgba.load()

    for y in range(ch):
        # Soft vertical feather at top/bottom edges to eliminate any pedestal glow bleed
        v_fade = 1.0
        if y < 18:
            v_fade = y / 18.0
        elif y > ch - 18:
            v_fade = (ch - y) / 18.0

        for x in range(cw):
            r, g, b = src_pixels[x, y]
            lum = max(r, g, b)
            if lum <= 14:
                a = 0
            else:
                a = int(min(255, (lum - 14) * 2.1) * v_fade)
            if a > 0:
                # Boost color vibrancy slightly to compensate for alpha premultiplication
                br = min(255, int(r * 1.15))
                bg = min(255, int(g * 1.15))
                bb = min(255, int(b * 1.20))
                dst_pixels[x, y] = (br, bg, bb, a)

    # Center onto a square canvas with a tight margin so the N fills the icon nicely
    side = max(cw, ch)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    offset_x = (side - cw) // 2
    offset_y = (side - ch) // 2
    square.paste(rgba, (offset_x, offset_y), rgba)

    return square.resize((target_size, target_size), Image.Resampling.LANCZOS)


def make_embedded_svg(png_img: Image.Image, size: int = 512, opacity: float = 1.0) -> str:
    buf = io.BytesIO()
    png_img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    op_attr = f' opacity="{opacity}"' if opacity < 1.0 else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
        f'<image width="{size}" height="{size}"{op_attr} href="data:image/png;base64,{b64}"/>'
        f"</svg>"
    )


def main():
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    icons_dir = os.path.join(root, "assets", "icons")
    branding_dir = os.path.join(root, "assets", "branding")
    os.makedirs(icons_dir, exist_ok=True)
    os.makedirs(branding_dir, exist_ok=True)

    source_path = os.path.join(branding_dir, "logo-source.png")
    if not os.path.exists(source_path):
        source_path = os.path.join(branding_dir, "logo-master.png")

    source_img = Image.open(source_path).convert("RGBA")

    # 1. Save full NIRMAN logo masters (1024 and 512) from the 2nd image
    master_1024 = source_img.resize((1024, 1024), Image.Resampling.LANCZOS)
    master_1024.save(os.path.join(branding_dir, "logo-1024.png"), "PNG")
    master_1024.save(os.path.join(branding_dir, "logo-master.png"), "PNG")

    master_512 = source_img.resize((512, 512), Image.Resampling.LANCZOS)
    master_512.save(os.path.join(branding_dir, "logo-512.png"), "PNG")

    # 2. Extract the glowing purple 'N' glyph for workspace watermark & top-left corner
    n_glyph_512 = extract_transparent_n_glyph(source_img, 512)
    n_glyph_256 = n_glyph_512.resize((256, 256), Image.Resampling.LANCZOS)
    n_glyph_512.save(os.path.join(branding_dir, "n-glyph.png"), "PNG")

    # 3. Generate multi-size nirman.ico (16, 24, 32, 48, 64, 128, 256) from the 2nd image logo
    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [master_1024.resize((s, s), Image.Resampling.LANCZOS) for s in sizes]

    ico_path = os.path.join(icons_dir, "nirman.ico")
    frames[-1].save(
        ico_path,
        format="ICO",
        sizes=[(s, s) for s in sizes],
        append_images=frames[:-1],
    )
    print(f"Generated {ico_path} from 2nd image with sizes: {sizes}")

    # 4. Generate 1x/2x contact sheet at assets/icons/preview.png
    cs_w, cs_h = 620, 360
    sheet = Image.new("RGBA", (cs_w, cs_h), (12, 12, 18, 255))
    sdraw = ImageDraw.Draw(sheet)
    sdraw.text((20, 15), "NIRMAN Official Logo Contact Sheet (1x & 2x)", fill=(216, 180, 254, 255))

    x_offset = 20
    y_row1 = 60
    y_row2 = 195
    sdraw.text((20, 42), "1x App Logo Sizes (16, 24, 32, 48, 64, 128):", fill=(160, 150, 190, 255))
    for f in frames[:-1]:
        sheet.paste(f, (x_offset, y_row1), f)
        sdraw.text((x_offset, y_row1 + f.height + 4), f"{f.width}px", fill=(140, 130, 170, 255))
        x_offset += f.width + 16

    sdraw.text((20, 175), "Workspace 'N' Glyph & 2x Preview:", fill=(160, 150, 190, 255))
    x_offset = 20
    for s in [32, 64, 96, 128]:
        ng = n_glyph_512.resize((s, s), Image.Resampling.LANCZOS)
        sheet.paste(ng, (x_offset, y_row2), ng)
        sdraw.text((x_offset, y_row2 + s + 4), f"N-{s}px", fill=(140, 130, 170, 255))
        x_offset += s + 24

    preview_path = os.path.join(icons_dir, "preview.png")
    sheet.save(preview_path, "PNG")
    print(f"Generated contact sheet at {preview_path}")

    # 5. Build SVG assets for the 'N' glyph (top-left corner + workspace watermark)
    svg_full_opacity = make_embedded_svg(n_glyph_256, 256, opacity=1.0)
    svg_watermark = make_embedded_svg(n_glyph_512, 512, opacity=0.45)

    for svg_target in [
        os.path.join(root, "apps", "ide-fork", "resources", "nirman.svg"),
        os.path.join(root, "apps", "ide-fork", "dist", "win32-x64", "resources", "nirman.svg"),
    ]:
        os.makedirs(os.path.dirname(svg_target), exist_ok=True)
        with open(svg_target, "w", encoding="utf-8") as f:
            f.write(svg_full_opacity)

    # 6. Sync ICO & SVGs into C:\Tools\nirman and C:\Tools\nirman\ide
    res_dir = os.path.join(root, "apps", "ide-fork", "resources")
    dist_res_dir = os.path.join(root, "apps", "ide-fork", "dist", "win32-x64", "resources")
    tools_res_dir = r"C:\Tools\nirman\resources"
    ide_win32_res = r"C:\Tools\nirman\ide\resources\app\resources\win32"

    for d in [res_dir, dist_res_dir, tools_res_dir]:
        if os.path.exists(d):
            for fname in ["nirman.ico", "nirman-logo.ico"]:
                dest = os.path.join(d, fname)
                with open(ico_path, "rb") as f_src, open(dest, "wb") as f_dst:
                    f_dst.write(f_src.read())

    if os.path.exists(ide_win32_res):
        with open(ico_path, "rb") as f_src:
            ico_bytes = f_src.read()
        with open(os.path.join(ide_win32_res, "code.ico"), "wb") as f_dst:
            f_dst.write(ico_bytes)
        master_512.resize((150, 150), Image.Resampling.LANCZOS).save(
            os.path.join(ide_win32_res, "code_150x150.png"), "PNG"
        )
        master_512.resize((70, 70), Image.Resampling.LANCZOS).save(
            os.path.join(ide_win32_res, "code_70x70.png"), "PNG"
        )

    # Deploy 'N' glyph SVG to top-left corner (code-icon.svg) and center workspace watermark (letterpress-*.svg)
    ide_app_dir = r"C:\Tools\nirman\ide\resources\app"
    if os.path.exists(ide_app_dir):
        corner_svg_targets = [
            os.path.join(ide_app_dir, "out", "media", "code-icon.svg"),
            os.path.join(ide_app_dir, "out", "media", "vscode-icon.svg"),
            os.path.join(ide_app_dir, "out", "vs", "workbench", "browser", "media", "code-icon.svg"),
            os.path.join(ide_app_dir, "extensions", "github-authentication", "media", "code-icon.svg"),
            os.path.join(ide_app_dir, "extensions", "nirman-agent-core", "resources", "nirman-icon.svg"),
        ]
        for t in corner_svg_targets:
            if os.path.exists(os.path.dirname(t)):
                with open(t, "w", encoding="utf-8") as f:
                    f.write(svg_full_opacity)

        watermark_svg_targets = [
            os.path.join(ide_app_dir, "out", "media", "letterpress-dark.svg"),
            os.path.join(ide_app_dir, "out", "media", "letterpress-hcDark.svg"),
            os.path.join(ide_app_dir, "out", "media", "letterpress-light.svg"),
            os.path.join(ide_app_dir, "out", "media", "letterpress-hcLight.svg"),
            os.path.join(ide_app_dir, "out", "vs", "workbench", "browser", "parts", "editor", "media", "letterpress-dark.svg"),
            os.path.join(ide_app_dir, "out", "vs", "workbench", "browser", "parts", "editor", "media", "letterpress-hcDark.svg"),
            os.path.join(ide_app_dir, "out", "vs", "workbench", "browser", "parts", "editor", "media", "letterpress-light.svg"),
            os.path.join(ide_app_dir, "out", "vs", "workbench", "browser", "parts", "editor", "media", "letterpress-hcLight.svg"),
            os.path.join(ide_app_dir, "out", "vs", "sessions", "contrib", "chat", "browser", "media", "letterpress-sessions-dark.svg"),
            os.path.join(ide_app_dir, "out", "vs", "sessions", "contrib", "chat", "browser", "media", "letterpress-sessions-light.svg"),
        ]
        for t in watermark_svg_targets:
            if os.path.exists(os.path.dirname(t)):
                with open(t, "w", encoding="utf-8") as f:
                    f.write(svg_watermark)
        print("Deployed 'N' glyph to top-left corner and workspace letterpress watermarks!")

        # Enable top-left window-appicon on Windows in workbench.desktop.main.js & CSS
        wb_js_path = os.path.join(ide_app_dir, "out", "vs", "workbench", "workbench.desktop.main.js")
        if os.path.exists(wb_js_path):
            with open(wb_js_path, "r", encoding="utf-8") as f:
                wb_js = f.read()
            old_js = '(ki||Ir)&&!gT(this.configurationService,this.titleBarStyle)&&(this.appIcon=IC(this.leftContent,E("a.window-appicon")))'
            new_js = '(jt||ki||Ir)&&!gT(this.configurationService,this.titleBarStyle)&&(this.appIcon=IC(this.leftContent,E("a.window-appicon")))'
            if old_js in wb_js:
                wb_js = wb_js.replace(old_js, new_js)
                with open(wb_js_path, "w", encoding="utf-8") as f:
                    f.write(wb_js)
                print("Enabled top-left window-appicon on Windows in workbench.desktop.main.js")

        wb_css_path = os.path.join(ide_app_dir, "out", "vs", "workbench", "workbench.desktop.main.css")
        if os.path.exists(wb_css_path):
            with open(wb_css_path, "r", encoding="utf-8") as f:
                wb_css = f.read()
            old_css = '.window-appicon:not(.codicon){background-image:url("../../media/code-icon.svg");background-repeat:no-repeat;background-position:center center;background-size:16px}'
            new_css = '.window-appicon:not(.codicon){background-image:url("../../media/code-icon.svg");background-repeat:no-repeat;background-position:center center;background-size:22px}'
            if old_css in wb_css:
                wb_css = wb_css.replace(old_css, new_css)
                with open(wb_css_path, "w", encoding="utf-8") as f:
                    f.write(wb_css)
                print("Updated top-left window-appicon size to 22px in workbench.desktop.main.css")


if __name__ == "__main__":
    main()
