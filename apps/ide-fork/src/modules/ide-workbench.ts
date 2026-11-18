import path from 'node:path';
import type { IVSCodeAPI } from '@nirman/vscode-ext';
import { ProductConfigurationManager, type ProductConfig } from './product-config.js';
import { FirstRunSetupManager, type NirmanModelSetupConfig } from './setup-flow.js';
import { OpenVsxGalleryClient } from './open-vsx-gallery.js';
import { BuiltinExtensionManager } from './builtin-loader.js';

export interface IdeWorkbenchOptions {
  vscode: IVSCodeAPI;
  dataDir: string;
  productPath?: string;
  serverUrl?: string;
  serverToken?: string;
  modelConfigOverrides?: Partial<NirmanModelSetupConfig>;
}

export class IdeWorkbench {
  public readonly productManager: ProductConfigurationManager;
  public readonly setupManager: FirstRunSetupManager;
  public readonly galleryClient: OpenVsxGalleryClient;
  public readonly builtinManager: BuiltinExtensionManager;

  private vscode: IVSCodeAPI;
  private dataDir: string;
  private serverUrl: string;
  private serverToken: string;
  private isRunning = false;
  private activeProductConfig?: ProductConfig | undefined;
  private activeModelConfig?: NirmanModelSetupConfig | undefined;

  constructor(options: IdeWorkbenchOptions) {
    this.vscode = options.vscode;
    this.dataDir = options.dataDir;
    this.serverUrl = options.serverUrl ?? 'ws://127.0.0.1:4096';
    this.serverToken = options.serverToken ?? 'nirman-session-token';

    this.productManager = new ProductConfigurationManager(options.productPath);
    this.setupManager = new FirstRunSetupManager({
      configDir: path.join(this.dataDir, '.nirman'),
    });
    this.galleryClient = new OpenVsxGalleryClient('https://open-vsx.org/vscode/gallery');
    this.builtinManager = new BuiltinExtensionManager();
  }

  /**
   * Launches the forked IDE workbench
   */
  public async launch(modelOverrides?: Partial<NirmanModelSetupConfig>): Promise<{
    product: ProductConfig;
    modelConfig: NirmanModelSetupConfig;
    isFirstRun: boolean;
  }> {
    // 1. Load rebranded product configuration
    this.activeProductConfig = await this.productManager.load();

    // 2. Perform first-run setup flow for model endpoint if not configured
    const setupResult = await this.setupManager.runSetup(modelOverrides);
    this.activeModelConfig = setupResult.config;

    // 3. Load built-in extension bundle with Agent Manager as first-class view
    await this.builtinManager.loadBuiltin(
      this.vscode,
      this.activeModelConfig,
      this.serverUrl,
      this.serverToken,
    );

    this.isRunning = true;

    return {
      product: this.activeProductConfig,
      modelConfig: this.activeModelConfig,
      isFirstRun: setupResult.isNewSetup,
    };
  }

  public isLaunched(): boolean {
    return this.isRunning;
  }

  public getProductConfig(): ProductConfig | undefined {
    return this.activeProductConfig;
  }

  public getModelConfig(): NirmanModelSetupConfig | undefined {
    return this.activeModelConfig;
  }

  public getExtensionsDir(): string {
    return path.join(this.dataDir, '.nirman', 'extensions');
  }

  /**
   * Installs an extension from Open VSX into the IDE
   */
  public async installFromOpenVsx(extensionId: string) {
    return await this.galleryClient.installExtension(
      extensionId,
      this.getExtensionsDir(),
    );
  }

  public shutdown(): void {
    this.isRunning = false;
    this.builtinManager.getController()?.deactivate();
  }
}
