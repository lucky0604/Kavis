import { execSync } from 'child_process';
import type { CliToolConfig, CliToolId, CliDetectionResult } from '../../../shared/types';
import {
  parseClaudeCodeSettings,
  parseCodexModelCatalog,
  parseOpenCodeModelsOutput,
  readClaudeCodeSettingsFile,
  readCodexDefaultModel,
  reorderModelList,
} from './model-detectors';

const modelCache = new Map<CliToolId, { models: string[]; defaultModel?: string; ts: number }>();
const MODEL_CACHE_TTL = 5 * 60 * 1000;

const CLI_CONFIGS: CliToolConfig[] = [
  {
    id: 'claudecode',
    binaryName: 'claude',
    displayName: 'Claude Code',
    defaultModels: ['sonnet', 'opus', 'haiku'],
    capabilities: {
      streamJson: true,
      ptyRequired: false,
      supportsModels: true,
    },
  },
  {
    id: 'codex',
    binaryName: 'codex',
    displayName: 'Codex',
    subCommand: 'exec',
    defaultModels: ['gpt-5.4', 'gpt-5.5', 'gpt-5.3-codex'],
    capabilities: {
      streamJson: true,
      ptyRequired: false,
      supportsModels: true,
    },
  },
  {
    id: 'opencode',
    binaryName: 'opencode',
    displayName: 'OpenCode',
    subCommand: 'run',
    defaultModels: [],
    capabilities: {
      streamJson: true,
      ptyRequired: false,
      supportsModels: true,
    },
  },
];

function whichBinary(name: string): string | null {
  const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`;
  try {
    const result = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return result.split('\n')[0] || null;
  } catch {
    return null;
  }
}

function execCliOutput(command: string, timeoutMs: number): string {
  return execSync(command, {
    encoding: 'utf-8',
    timeout: timeoutMs,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      TERM: process.env.TERM && process.env.TERM !== 'dumb' ? process.env.TERM : 'xterm-256color',
    },
  }).trim();
}

interface ModelDetection {
  models: string[];
  defaultModel?: string;
}

function detectOpenCodeModels(binaryName: string): ModelDetection {
  const out = execCliOutput(`${binaryName} models --pure`, 8000);
  const models = parseOpenCodeModelsOutput(out);
  return { models, defaultModel: models[0] };
}

function detectCodexModels(binaryName: string): ModelDetection {
  const out = execCliOutput(`${binaryName} debug models`, 12000);
  const models = parseCodexModelCatalog(JSON.parse(out));
  const configuredDefault = readCodexDefaultModel();
  const ordered = reorderModelList(models, configuredDefault);
  return {
    models: ordered,
    defaultModel: configuredDefault ?? ordered[0],
  };
}

function detectClaudeCodeModels(): ModelDetection {
  const settings = readClaudeCodeSettingsFile();
  const parsed = parseClaudeCodeSettings(settings);
  return parsed;
}

function detectModelsForCli(id: CliToolId, binaryName: string): ModelDetection {
  const cached = modelCache.get(id);
  if (cached && Date.now() - cached.ts < MODEL_CACHE_TTL) {
    return { models: cached.models, defaultModel: cached.defaultModel };
  }

  let detection: ModelDetection = { models: [] };
  try {
    switch (id) {
      case 'opencode':
        detection = detectOpenCodeModels(binaryName);
        break;
      case 'codex':
        detection = detectCodexModels(binaryName);
        break;
      case 'claudecode':
        detection = detectClaudeCodeModels();
        break;
    }
  } catch {
    // fall through to defaults
  }

  if (detection.models.length > 0) {
    modelCache.set(id, { ...detection, ts: Date.now() });
  }
  return detection;
}

export function detectCli(id: CliToolId): CliDetectionResult {
  const config = CLI_CONFIGS.find((c) => c.id === id);
  if (!config) {
    return { id, displayName: id, available: false, binaryPath: null, models: [] };
  }
  const binaryPath = whichBinary(config.binaryName);
  const available = binaryPath !== null;

  let models = config.defaultModels;
  let defaultModel = config.defaultModels[0];

  if (available) {
    const detected = detectModelsForCli(id, config.binaryName);
    if (detected.models.length > 0) {
      models = detected.models;
      defaultModel = detected.defaultModel ?? detected.models[0];
    }
  }

  return {
    id: config.id,
    displayName: config.displayName,
    available,
    binaryPath,
    models,
    defaultModel,
  };
}

export function detectAllClis(): CliDetectionResult[] {
  return CLI_CONFIGS.map((config) => detectCli(config.id));
}

export function getCliConfig(id: CliToolId): CliToolConfig | undefined {
  return CLI_CONFIGS.find((c) => c.id === id);
}

export function getAvailableClis(): CliToolConfig[] {
  return CLI_CONFIGS.filter((config) => whichBinary(config.binaryName) !== null);
}

/**
 * Check if a model is compatible with a given CLI.
 * Known incompatible: Codex + DeepSeek (requires Responses API, DeepSeek only has Chat Completions)
 */
export interface CompatibilityCheck {
  compatible: boolean;
  warning?: string;
  suggestion?: string;
}

const INCOMPATIBLE_PATTERNS: Array<{
  cli: CliToolId;
  modelPattern: RegExp;
  warning: string;
  suggestion: string;
}> = [
  {
    cli: 'codex',
    modelPattern: /deepseek/i,
    warning: 'Codex CLI requires the Responses API, but DeepSeek only supports Chat Completions. This will result in 404 errors.',
    suggestion: 'Use OpenCode with DeepSeek models, or configure a local codex-bridge proxy.',
  },
];

export function checkModelCompatibility(cliId: CliToolId, model: string): CompatibilityCheck {
  for (const rule of INCOMPATIBLE_PATTERNS) {
    if (rule.cli === cliId && rule.modelPattern.test(model)) {
      return { compatible: false, warning: rule.warning, suggestion: rule.suggestion };
    }
  }
  return { compatible: true };
}

