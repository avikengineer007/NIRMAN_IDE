import path from 'node:path';
import fs from 'node:fs/promises';
import type {
  SecurityPolicy,
  PolicyMode,
  PolicyAction,
  CommandRule,
  PolicyEvaluationRequest,
  PolicyEvaluationResult,
  RiskLevel,
} from './types.js';
import { parseYaml, stringifyYaml } from './yaml-parser.js';

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  version: '1.0.0',
  mode: 'ask_risky',
  tools: {
    read_file: 'allow',
    list_dir: 'allow',
    search: 'allow',
    write_file: 'allow',
    edit_file: 'allow',
    run_shell: 'allow', // specific shell commands are filtered by commands rules
    git_push: 'ask',
  },
  commands: [
    // 1. Strict DENY rules: dangerous system destruction or escaping workspace
    {
      pattern: 'rm\\s+(-[a-zA-Z]*r[a-zA-Z]*f*\\s+|--recursive\\s+)(/|[a-zA-Z]:[/\\\\]|~|\\.\\.)',
      action: 'deny',
      reason: 'Deny recursive deletion outside the workspace root',
    },
    {
      pattern: '(:\\(\\)\\s*\\{\\s*:\\|:&\\s*\\};:|mkfs|dd\\s+if=|fdisk|format\\s+[a-zA-Z]:)',
      action: 'deny',
      reason: 'Deny destructive disk or system crashing commands',
    },
    {
      pattern: 'chmod\\s+(-R\\s+)?(777|000)\\s+(/|[a-zA-Z]:[/\\\\]|~)',
      action: 'deny',
      reason: 'Deny dangerous root permission modifications',
    },

    // 2. ASK rules: Package installations
    {
      pattern: '^(npm|pnpm|yarn|bun)\\s+(install|add|i)(\\s+|$)',
      action: 'ask',
      reason: 'Package installations can execute lifecycle scripts; requires confirmation',
    },
    {
      pattern: '^(pip|pip3|conda|poetry)\\s+install(\\s+|$)',
      action: 'ask',
      reason: 'Python package installations require confirmation',
    },
    {
      pattern: '^(cargo\\s+add|go\\s+get|gem\\s+install)(\\s+|$)',
      action: 'ask',
      reason: 'Package management requires user confirmation',
    },

    // 3. ASK rules: External Git publishing
    {
      pattern: '^git\\s+push(\\s+|$)',
      action: 'ask',
      reason: 'Publishing commits to a remote git repository requires explicit approval',
    },

    // 4. ASK rules: Network tools & outbound connections
    {
      pattern: '^(curl|wget|ssh|scp|nc|netcat|telnet|nmap|ftp)(\\s+|$)',
      action: 'ask',
      reason: 'Outbound network connections require user confirmation',
      requireNetwork: true,
    },
  ],
};

export class PolicyEngine {
  private policy: SecurityPolicy;
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string, policy: SecurityPolicy = DEFAULT_SECURITY_POLICY) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.policy = { ...policy };
  }

  public getPolicy(): SecurityPolicy {
    return { ...this.policy };
  }

  public setMode(mode: PolicyMode): void {
    this.policy.mode = mode;
  }

  public setToolRule(toolName: string, action: PolicyAction): void {
    this.policy.tools[toolName] = action;
  }

  public addCommandRule(rule: CommandRule): void {
    this.policy.commands.unshift(rule); // Higher priority
  }

  /**
   * Evaluates a tool call against the active security policy, taking mode,
   * command patterns, path safety, network flags, and untrusted taint into account.
   */
  public evaluate(request: PolicyEvaluationRequest): PolicyEvaluationResult {
    const { toolName, args, isTainted, taintSource } = request;
    const mode = this.policy.mode;

    // 1. Path Escape Check for file-based tools
    if (args['path'] && typeof args['path'] === 'string') {
      const filePath = args['path'];
      if (this.isPathEscaping(filePath)) {
        return {
          action: 'deny',
          riskLevel: 'critical',
          reason: `Access outside workspace is strictly prohibited: "${filePath}"`,
          matchedRule: 'workspace_confinement',
        };
      }
    }

    // 2. Command Evaluation for run_shell
    if (toolName === 'run_shell' || toolName === 'shell') {
      const command = (args['command'] as string | undefined)?.trim() ?? '';
      const allowNetwork = Boolean(args['allowNetwork']);

      const commandResult = this.evaluateCommand(command, allowNetwork);

      // If the command is denied, return immediately
      if (commandResult.action === 'deny') {
        return commandResult;
      }

      // If mode is 'ask_all', escalate allow -> ask
      if (mode === 'ask_all') {
        return {
          ...commandResult,
          action: 'ask',
          reason: `Mode is "ask_all": confirmation required for shell command`,
        };
      }

      // Check untrusted taint escalation
      if (isTainted && commandResult.action === 'allow') {
        return {
          action: 'ask',
          riskLevel: 'high',
          reason: `Tool execution triggered right after reading untrusted external data (${taintSource ?? 'untrusted input'}). Elevated to user approval to prevent indirect prompt injection.`,
          requiresUntrustedWarning: true,
          taintSource,
        };
      }

      return commandResult;
    }

    // 3. Non-shell Tool Evaluation
    const toolDefaultAction = this.policy.tools[toolName] ?? 'allow';

    // Check specific tool rules
    if (mode === 'ask_all') {
      return {
        action: 'ask',
        riskLevel: 'low',
        reason: `Mode is "ask_all": confirmation required for tool "${toolName}"`,
      };
    }

    if (toolDefaultAction === 'deny') {
      return {
        action: 'deny',
        riskLevel: 'high',
        reason: `Tool "${toolName}" is prohibited by security policy`,
        matchedRule: `tool:${toolName}`,
      };
    }

    if (toolDefaultAction === 'ask') {
      return {
        action: 'ask',
        riskLevel: 'medium',
        reason: `Tool "${toolName}" requires user confirmation by security policy`,
        matchedRule: `tool:${toolName}`,
      };
    }

    // If writing or modifying files while tainted by untrusted external data, escalate to ask
    if (isTainted && (toolName === 'write_file' || toolName === 'edit_file')) {
      return {
        action: 'ask',
        riskLevel: 'high',
        reason: `File modification triggered right after reading untrusted external data (${taintSource ?? 'untrusted input'}). Elevated to user approval to prevent prompt injection payload persistence.`,
        requiresUntrustedWarning: true,
        taintSource,
      };
    }

    // Default autonomous or safe allow
    return {
      action: 'allow',
      riskLevel: 'low',
      reason: `Tool "${toolName}" allowed under ${mode} policy`,
    };
  }

  /**
   * Evaluates a shell command string against command rules, network flags, and mode.
   */
  private evaluateCommand(command: string, allowNetwork: boolean): PolicyEvaluationResult {
    // 1. Check for path escapes in shell command arguments (e.g. rm -rf / or rm -rf ..)
    if (this.isShellCommandEscaping(command)) {
      return {
        action: 'deny',
        riskLevel: 'critical',
        reason: `Command attempts destructive actions outside workspace: "${command}"`,
        matchedRule: 'deny_out_of_workspace_rm',
      };
    }

    // 2. Match against configured command rules (order matters: top rules checked first)
    for (const rule of this.policy.commands) {
      const regex = new RegExp(rule.pattern, 'i');
      if (regex.test(command)) {
        const riskLevel: RiskLevel =
          rule.action === 'deny' ? 'critical' : rule.action === 'ask' ? 'medium' : 'low';

        return {
          action: rule.action,
          riskLevel,
          reason: rule.reason ?? `Command matched policy rule pattern "${rule.pattern}"`,
          matchedRule: rule.pattern,
        };
      }
    }

    // 3. Network Access Check
    if (allowNetwork) {
      return {
        action: 'ask',
        riskLevel: 'medium',
        reason: 'Command requests network access; requires explicit confirmation',
        matchedRule: 'network_access',
      };
    }

    // 4. Default for autonomous_sandbox or ask_risky
    return {
      action: 'allow',
      riskLevel: 'low',
      reason: 'Command is permitted within sandbox boundary',
    };
  }

  /**
   * Checks if a direct file path escapes the workspace.
   */
  private isPathEscaping(filePath: string): boolean {
    const normalized = path.normalize(filePath);
    if (path.isAbsolute(normalized)) {
      const rel = path.relative(this.workspaceRoot, normalized);
      return rel.startsWith('..') || path.isAbsolute(rel);
    }
    const resolved = path.resolve(this.workspaceRoot, normalized);
    const rel = path.relative(this.workspaceRoot, resolved);
    return rel.startsWith('..') || path.isAbsolute(rel);
  }

  /**
   * Detects dangerous command attempts to delete or alter files outside workspace
   */
  private isShellCommandEscaping(cmd: string): boolean {
    // Look for rm -rf / or rm -rf C:\ or rm -rf .. or rm -rf ~
    const dangerousRm = /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f*\s+([/~]|(\.\.[/\\]?)|[a-zA-Z]:[/\\])/i;
    return dangerousRm.test(cmd);
  }

  /**
   * Loads policy from .agent/policy.yaml (or .agent/policy.json). If absent, returns default policy.
   */
  public static async loadFromWorkspace(workspaceRoot: string): Promise<PolicyEngine> {
    const yamlPath = path.join(workspaceRoot, '.agent', 'policy.yaml');
    const jsonPath = path.join(workspaceRoot, '.agent', 'policy.json');

    try {
      const content = await fs.readFile(yamlPath, 'utf-8');
      const parsed = parseYaml(content) as unknown as SecurityPolicy;
      const mergedPolicy: SecurityPolicy = {
        version: parsed.version ?? DEFAULT_SECURITY_POLICY.version,
        mode: parsed.mode ?? DEFAULT_SECURITY_POLICY.mode,
        tools: { ...DEFAULT_SECURITY_POLICY.tools, ...(parsed.tools ?? {}) },
        commands: [...(parsed.commands ?? []), ...DEFAULT_SECURITY_POLICY.commands],
      };
      return new PolicyEngine(workspaceRoot, mergedPolicy);
    } catch {
      // Check json
      try {
        const jsonContent = await fs.readFile(jsonPath, 'utf-8');
        const parsed = JSON.parse(jsonContent) as SecurityPolicy;
        return new PolicyEngine(workspaceRoot, { ...DEFAULT_SECURITY_POLICY, ...parsed });
      } catch {
        // Return default policy
        return new PolicyEngine(workspaceRoot, DEFAULT_SECURITY_POLICY);
      }
    }
  }

  /**
   * Saves the current policy configuration to .agent/policy.yaml
   */
  public async saveToWorkspace(): Promise<string> {
    const policyDir = path.join(this.workspaceRoot, '.agent');
    await fs.mkdir(policyDir, { recursive: true });
    const policyPath = path.join(policyDir, 'policy.yaml');

    const yamlStr = stringifyYaml(this.policy as unknown as Record<string, unknown>);
    const header = `# NIRMAN Agent Security Policy Configuration\n# Modes: 'ask_all' | 'ask_risky' | 'autonomous_sandbox'\n\n`;
    await fs.writeFile(policyPath, header + yamlStr, 'utf-8');
    return policyPath;
  }
}
