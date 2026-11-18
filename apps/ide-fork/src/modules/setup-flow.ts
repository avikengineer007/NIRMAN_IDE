import fs from 'node:fs/promises';
import path from 'node:path';

export interface NirmanModelSetupConfig {
  provider: 'ollama' | 'openai' | 'local';
  baseUrl: string;
  model: string;
  contextWindowLimit: number;
  apiKey?: string | undefined;
  configuredAt: string;
}

export interface SetupFlowOptions {
  configDir: string;
  defaultBaseUrl?: string;
  defaultModel?: string;
  defaultContextLimit?: number;
  healthChecker?: (url: string) => Promise<boolean>;
}

export class FirstRunSetupManager {
  private configDir: string;
  private configFilePath: string;
  private defaultBaseUrl: string;
  private defaultModel: string;
  private defaultContextLimit: number;
  private healthChecker?: ((url: string) => Promise<boolean>) | undefined;

  constructor(options: SetupFlowOptions) {
    this.configDir = options.configDir;
    this.configFilePath = path.join(this.configDir, 'config.json');
    this.defaultBaseUrl = options.defaultBaseUrl ?? 'http://127.0.0.1:11434/v1';
    this.defaultModel = options.defaultModel ?? 'qwen2.5-coder:7b';
    this.defaultContextLimit = options.defaultContextLimit ?? 32_768;
    this.healthChecker = options.healthChecker;
  }

  /**
   * Checks if the IDE has already been configured
   */
  public async isConfigured(): Promise<boolean> {
    try {
      await fs.stat(this.configFilePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Runs the first-run setup wizard or loads existing config
   */
  public async runSetup(
    overrides?: Partial<NirmanModelSetupConfig>,
  ): Promise<{ isNewSetup: boolean; config: NirmanModelSetupConfig }> {
    const alreadyConfigured = await this.isConfigured();

    if (alreadyConfigured && !overrides) {
      const raw = await fs.readFile(this.configFilePath, 'utf-8');
      const loaded = JSON.parse(raw) as NirmanModelSetupConfig;
      return { isNewSetup: false, config: loaded };
    }

    // Perform new setup
    const baseUrl = overrides?.baseUrl ?? this.defaultBaseUrl;
    const model = overrides?.model ?? this.defaultModel;
    const provider = overrides?.provider ?? 'ollama';
    const contextWindowLimit = overrides?.contextWindowLimit ?? this.defaultContextLimit;

    // Optional health check
    if (this.healthChecker) {
      await this.healthChecker(baseUrl);
    }

    const newConfig: NirmanModelSetupConfig = {
      provider,
      baseUrl,
      model,
      contextWindowLimit,
      apiKey: overrides?.apiKey,
      configuredAt: new Date().toISOString(),
    };

    await fs.mkdir(this.configDir, { recursive: true });
    await fs.writeFile(
      this.configFilePath,
      JSON.stringify(newConfig, null, 2),
      'utf-8',
    );

    return { isNewSetup: true, config: newConfig };
  }

  public getConfigPath(): string {
    return this.configFilePath;
  }
}
