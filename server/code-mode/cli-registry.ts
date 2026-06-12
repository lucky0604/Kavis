import { execSync } from 'child_process';
import type { CliToolConfig, CliToolId, CliDetectionResult } from '../../shared/types';

const modelCache = new Map<CliToolId, { models: string[]; ts: number }>();
const MODEL_CACHE_TTL = 5 * 60 * 1000;

const CLI_CONFIGS: CliToolConfig[] = [
  {
    id: 'claudecode',
    binaryName: 'claude',
    displayName: 'Claude Code',
    defaultModels: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514'],
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
    defaultModels: ['o4-mini', 'o3', 'gpt-4.1'],
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
    defaultModels: ['claude-sonnet-4-20250514', 'gpt-4.1', 'gemini-2.5-pro'],
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

function detectModelsForCli(id: CliToolId, binaryName: string): string[] {
  const cached = modelCache.get(id);
  if (cached && Date.now() - cached.ts < MODEL_CACHE_TTL) return cached.models;

  let models: string[] = [];
  try {
    if (id === 'opencode') {
      const out = execSync(`${binaryName} models --pure`, {
        encoding: 'utf-8',
        timeout: 8000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      models = out.split('\n').map((l) => l.trim()).filter(Boolean);
    }
  } catch {
    // detection failed, fall through to defaults
  }

  if (models.length > 0) {
    modelCache.set(id, { models, ts: Date.now() });
  }
  return models;
}

export function detectCli(id: CliToolId): CliDetectionResult {
  const config = CLI_CONFIGS.find((c) => c.id === id);
  if (!config) {
    return { id, displayName: id, available: false, binaryPath: null, models: [] };
  }
  const binaryPath = whichBinary(config.binaryName);
  const available = binaryPath !== null;

  let models = config.defaultModels;
  if (available) {
    const detected = detectModelsForCli(id, config.binaryName);
    if (detected.length > 0) models = detected;
  }

  return {
    id: config.id,
    displayName: config.displayName,
    available,
    binaryPath,
    models,
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
