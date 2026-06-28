import fs from 'fs';
import path from 'path';
import os from 'os';

/** Claude Code accepts these short aliases via `--model`. */
export const CLAUDE_MODEL_ALIASES = ['sonnet', 'opus', 'haiku'] as const;

export interface CodexModelEntry {
  slug: string;
  visibility?: string;
  priority?: number;
}

export interface CodexModelCatalog {
  models: CodexModelEntry[];
}

export interface ClaudeModelDetection {
  models: string[];
  defaultModel: string;
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/** Move `preferred` to the front when present in the list. */
export function reorderModelList(models: string[], preferred?: string | null): string[] {
  if (!preferred || !models.includes(preferred)) return models;
  return [preferred, ...models.filter((m) => m !== preferred)];
}

export function parseOpenCodeModelsOutput(output: string): string[] {
  return dedupe(output.split('\n').map((line) => line.trim()).filter(Boolean));
}

export function parseCodexModelCatalog(json: unknown): string[] {
  if (!json || typeof json !== 'object') return [];
  const catalog = json as CodexModelCatalog;
  if (!Array.isArray(catalog.models)) return [];

  return dedupe(
    catalog.models
      .filter((entry) => typeof entry.slug === 'string' && entry.slug.length > 0)
      .filter((entry) => !entry.visibility || entry.visibility === 'list')
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
      .map((entry) => entry.slug),
  );
}

export function parseClaudeCodeSettings(settings: unknown): ClaudeModelDetection {
  const aliases = [...CLAUDE_MODEL_ALIASES];
  const resolved: string[] = [];

  if (settings && typeof settings === 'object') {
    const env = (settings as { env?: Record<string, unknown> }).env;
    if (env && typeof env === 'object') {
      for (const key of [
        'ANTHROPIC_DEFAULT_SONNET_MODEL',
        'ANTHROPIC_DEFAULT_OPUS_MODEL',
        'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      ]) {
        const value = env[key];
        if (typeof value === 'string' && value.trim()) {
          resolved.push(value.trim());
        }
      }
    }
  }

  const models = dedupe([...aliases, ...resolved]);
  const defaultModel = aliases[0] ?? models[0] ?? 'sonnet';
  return { models, defaultModel };
}

export function readClaudeCodeSettingsFile(): unknown | null {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  if (!fs.existsSync(settingsPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    return null;
  }
}

export function readCodexDefaultModel(): string | null {
  const configPath = path.join(os.homedir(), '.codex', 'config.toml');
  if (!fs.existsSync(configPath)) return null;
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const match = content.match(/^model\s*=\s*"([^"]+)"/m);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}
