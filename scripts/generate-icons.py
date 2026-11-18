import os
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

def draw_nirman_glyph(size, simplified=False):
    """
    Draws the NIRMAN architectural 'N' glyph on a transparent canvas.
    If simplified=True, uses thicker strokes and high-contrast styling for 16px/24px legibility.
    """
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    pad = size * (0.08 if not simplified else 0.05)
    w = size - 2 * pad
    h = size - 2 * pad

    # Pillar dimensions
    stroke = max(2, int(w * (0.28 if simplified else 0.22)))

    # Coordinates
    x0 = pad
    x1 = pad + stroke
    x2 = size - pad - stroke
    x3 = size - pad

    y_top = pad
    y_bot = size - pad

    # Color palette
    cyan = (0, 220, 255, 255)
    azure = (0, 110, 255, 255)
    purple = (130, 40, 255, 255)

    if simplified:
        # High contrast, solid vibrant geometry for tiny sizes
        # Left pillar
        draw.rectangle([x0, y_top, x1, y_bot], fill=cyan)
        # Right pillar
        draw.rectangle([x2, y_top, x3, y_bot], fill=purple)
        # Diagonal connector
        poly = [
            (x0, y_top),
            (x1 + stroke * 0.2, y_top),
            (x3, y_bot),
            (x2 - stroke * 0.2, y_bot),
        ]
        draw.polygon(poly, fill=azure)
        # Center core spark
        cx, cy = size / 2, size / 2
        r = max(1.5, size * 0.1)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 255))
    else:
        # High-resolution rendering with rounded caps and gradient-like multi-pass
        # Left pillar
        draw.rounded_rectangle([x0, y_top, x1, y_bot], radius=int(size * 0.04), fill=cyan)
        # Right pillar
        draw.rounded_rectangle([x2, y_top, x3, y_bot], radius=int(size * 0.04), fill=purple)
        # Diagonal beam
        diag_poly = [
            (x0 + stroke * 0.1, y_top),
            (x1 + stroke * 0.3, y_top),
            (x3 - stroke * 0.1, y_bot),
            (x2 - stroke * 0.3, y_bot),
        ]
        draw.polygon(diag_poly, fill=azure)

        # Ambient inner core accent
        cx, cy = size / 2, size / 2
        r = size * 0.08
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 240))

    return img

def main():
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    icons_dir = os.path.join(root, "assets", "icons")
    branding_dir = os.path.join(root, "assets", "branding")
    os.makedirs(icons_dir, exist_ok=True)
    os.makedirs(branding_dir, exist_ok=True)

    # 1. Generate Masters (1024 and 512)
    master_1024 = draw_nirman_glyph(1024, simplified=False)
    master_1024.save(os.path.join(branding_dir, "logo-1024.png"), "PNG")
    master_1024.save(os.path.join(branding_dir, "logo-master.png"), "PNG")

    master_512 = draw_nirman_glyph(512, simplified=False)
    master_512.save(os.path.join(branding_dir, "logo-512.png"), "PNG")

    # 2. Generate Icon Frames: 16, 24, 32, 48, 64, 128, 256
    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = []

    for s in sizes:
        if s in (16, 24):
            # Hand-crafted simplified frame for legibility
            frame = draw_nirman_glyph(s, simplified=True)
        else:
            # Rescale high-res master with Lanczos filter
            frame = master_512.resize((s, s), Image.Resampling.LANCZOS)
        frames.append(frame)

    # 3. Save multi-frame nirman.ico
    ico_path = os.path.join(icons_dir, "nirman.ico")
    # In Pillow, to save multi-frame ICO:
    # First image is the base (usually largest or primary), with append_images containing the rest
    # Pillow save format="ICO", sizes=[(s, s) for s in sizes]
    frames[-1].save(
        ico_path,
        format="ICO",
        sizes=[(s, s) for s in sizes],
        append_images=frames[:-1],
    )
    print(f"Generated {ico_path} with sizes: {sizes}")

    # 4. Generate 1x/2x contact sheet at assets/icons/preview.png
    # Contact sheet displays each size at 1x and 2x on a dark grid
    cs_w = 600
    cs_h = 350
    sheet = Image.new('RGBA', (cs_w, cs_h), (15, 18, 25, 255))
    sdraw = ImageDraw.Draw(sheet)

    # Title
    sdraw.text((20, 15), "NIRMAN Icon Master Contact Sheet (1x & 2x)", fill=(200, 220, 255, 255))

    x_offset = 20
    y_row1 = 60
    y_row2 = 180

    sdraw.text((20, 42), "1x Sizes (16, 24, 32, 48, 64, 128):", fill=(120, 140, 170, 255))
    for f in frames[:-1]: # up to 128
        sheet.paste(f, (x_offset, y_row1), f)
        sdraw.text((x_offset, y_row1 + f.height + 4), f"{f.width}px", fill=(100, 120, 150, 255))
        x_offset += f.width + 16

    sdraw.text((20, 160), "2x Scaled Comparison (16@2x, 24@2x, 32@2x, 48@2x):", fill=(120, 140, 170, 255))
    x_offset = 20
    for f in frames[:4]: # 16, 24, 32, 48 scaled up 2x
        f2x = f.resize((f.width * 2, f.height * 2), Image.Resampling.NEAREST)
        sheet.paste(f2x, (x_offset, y_row2), f2x)
        sdraw.text((x_offset, y_row2 + f2x.height + 4), f"{f.width}x2", fill=(100, 120, 150, 255))
        x_offset += f2x.width + 24

    preview_path = os.path.join(icons_dir, "preview.png")
    sheet.save(preview_path, "PNG")
    print(f"Generated contact sheet at {preview_path}")

    # Copy to apps/ide-fork/resources and dist
    res_dir = os.path.join(root, "apps", "ide-fork", "resources")
    dist_res_dir = os.path.join(root, "apps", "ide-fork", "dist", "win32-x64", "resources")
    tools_res_dir = r"C:\Tools\nirman\resources"

    for d in [res_dir, dist_res_dir, tools_res_dir]:
        if os.path.exists(d):
            dest = os.path.join(d, "nirman.ico")
            with open(ico_path, "rb") as f_src, open(dest, "wb") as f_dst:
                f_dst.write(f_src.read())
            print(f"Synced icon to {dest}")

if __name__ == "__main__":
    main()
