import {
  ExtensionController,
  type ExtensionConfig,
  type IVSCodeAPI,
  AgentManagerViewProvider,
} from '@nirman/vscode-ext';
import type { NirmanModelSetupConfig } from './setup-flow.js';

export interface BuiltinExtensionMetadata {
  id: string;
  name: string;
  version: string;
  isFirstClassView: boolean;
  views: readonly string[];
}

export class BuiltinExtensionManager {
  private controller?: ExtensionController | undefined;
  private metadata: BuiltinExtensionMetadata = {
    id: 'nirman.nirman-agent-core',
    name: 'NIRMAN Agent Core & Studio Manager',
    version: '1.0.0',
    isFirstClassView: true,
    views: [
      'nirman.agentManagerView',
      'nirman.chatView',
      'nirman.planView',
      'nirman.tasksView',
      'nirman.artifactsView',
    ],
  };

  /**
   * Initializes and bundles the NIRMAN extension as a built-in extension
   */
  public async loadBuiltin(
    vscode: IVSCodeAPI,
    setupConfig: NirmanModelSetupConfig,
    serverUrl = 'ws://127.0.0.1:4096',
    serverToken = 'nirman-session-token',
  ): Promise<ExtensionController> {
    const config: ExtensionConfig = {
      serverUrl,
      serverToken,
      model: setupConfig.model,
      contextWindowLimit: setupConfig.contextWindowLimit,
    };

    this.controller = new ExtensionController({
      vscode,
      config,
    });

    await this.controller.activate();

    // Ensure the Agent Manager is exposed as a first-class view
    this.controller.openAgentManagerPanel();

    return this.controller;
  }

  public getMetadata(): BuiltinExtensionMetadata {
    return this.metadata;
  }

  public getController(): ExtensionController | undefined {
    return this.controller;
  }

  public getAgentManager(): AgentManagerViewProvider | undefined {
    return this.controller?.agentManager;
  }
}
