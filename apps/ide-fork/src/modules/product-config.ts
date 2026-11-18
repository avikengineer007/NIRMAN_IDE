import fs from 'node:fs/promises';
import path from 'node:path';

export interface ProductConfig {
  nameShort: string;
  nameLong: string;
  applicationName: string;
  dataFolderName: string;
  version: string;
  commit?: string;
  enableTelemetry: boolean;
  telemetry: string;
  extensionsGallery: {
    serviceUrl: string;
    itemUrl: string;
    cacheUrl: string;
    controlUrl: string;
  };
  builtInExtensions?: Array<{
    name: string;
    version: string;
    package: string;
  }>;
}

export class ProductConfigurationManager {
  private config: ProductConfig | null = null;
  private productPath: string;

  constructor(productPath?: string) {
    this.productPath =
      productPath ?? path.resolve(import.meta.dirname, '..', '..', 'product.json');
  }

  public async load(): Promise<ProductConfig> {
    if (this.config) return this.config;

    try {
      const content = await fs.readFile(this.productPath, 'utf-8');
      const parsed = JSON.parse(content) as ProductConfig;
      this.config = parsed;
      return parsed;
    } catch {
      // Fallback default branded config
      this.config = {
        nameShort: 'NIRMAN',
        nameLong: 'NIRMAN Agentic Studio',
        applicationName: 'nirman',
        dataFolderName: '.nirman',
        version: '1.0.0',
        enableTelemetry: false,
        telemetry: 'off',
        extensionsGallery: {
          serviceUrl: 'https://open-vsx.org/vscode/gallery',
          itemUrl: 'https://open-vsx.org/vscode/item',
          cacheUrl: 'https://open-vsx.org/vscode/cache',
          controlUrl: 'https://open-vsx.org/vscode/control',
        },
        builtInExtensions: [
          {
            name: 'nirman-agent-core',
            version: '1.0.0',
            package: '@nirman/vscode-ext',
          },
        ],
      };
      return this.config;
    }
  }

  public isTelemetryEnabled(): boolean {
    return Boolean(this.config?.enableTelemetry);
  }

  public getGalleryServiceUrl(): string {
    return this.config?.extensionsGallery.serviceUrl ?? 'https://open-vsx.org/vscode/gallery';
  }

  public isOpenVsxGallery(): boolean {
    const url = this.getGalleryServiceUrl();
    return url.includes('open-vsx.org');
  }
}
