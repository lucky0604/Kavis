import { describe, expect, it } from 'vitest';
import {
  parseClaudeCodeSettings,
  parseCodexModelCatalog,
  parseOpenCodeModelsOutput,
  reorderModelList,
} from './model-detectors';

describe('parseOpenCodeModelsOutput', () => {
  it('parses one model per line', () => {
    expect(parseOpenCodeModelsOutput('opencode/gpt-4\n\nalibaba/glm-5\n')).toEqual([
      'opencode/gpt-4',
      'alibaba/glm-5',
    ]);
  });
});

describe('parseCodexModelCatalog', () => {
  it('returns list-visible slugs sorted by priority', () => {
    const models = parseCodexModelCatalog({
      models: [
        { slug: 'gpt-5.2', visibility: 'list', priority: 2 },
        { slug: 'gpt-5.5', visibility: 'list', priority: 0 },
        { slug: 'hidden-model', visibility: 'hidden' },
      ],
    });
    expect(models).toEqual(['gpt-5.5', 'gpt-5.2']);
  });
});

describe('parseClaudeCodeSettings', () => {
  it('includes aliases and env-resolved model ids', () => {
    const result = parseClaudeCodeSettings({
      env: {
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-8',
      },
    });
    expect(result.models).toEqual(['sonnet', 'opus', 'haiku', 'claude-sonnet-4-6', 'claude-opus-4-8']);
    expect(result.defaultModel).toBe('sonnet');
  });

  it('falls back to aliases when settings are missing', () => {
    const result = parseClaudeCodeSettings(null);
    expect(result.models).toEqual(['sonnet', 'opus', 'haiku']);
    expect(result.defaultModel).toBe('sonnet');
  });
});

describe('reorderModelList', () => {
  it('moves preferred model to front', () => {
    expect(reorderModelList(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
  });
});
