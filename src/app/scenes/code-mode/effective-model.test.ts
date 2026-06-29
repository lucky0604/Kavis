import { describe, it, expect } from 'vitest';
import { resolveEffectiveModel } from './effective-model';
import type { CliDetectionResult } from '../../../../shared/types';

const makeCli = (overrides: Partial<CliDetectionResult> = {}): CliDetectionResult => ({
  id: 'kavis-code',
  displayName: 'Kavis Code',
  available: true,
  binaryPath: null,
  models: ['gpt-4o', 'gpt-4o-mini'],
  defaultModel: 'gpt-4o',
  ...overrides,
});

describe('resolveEffectiveModel — priority chain', () => {
  describe('priority 1: picked', () => {
    it('returns picked when it wins over everything else', () => {
      const result = resolveEffectiveModel(
        'kavis-code',
        makeCli(),
        'my-custom-model',
        true,
        'override-model',
      );
      expect(result).toEqual({ model: 'my-custom-model', source: 'picked' });
    });

    it('trims whitespace from picked', () => {
      const result = resolveEffectiveModel('kavis-code', makeCli(), '  trimmed-model  ', false, '');
      expect(result).toEqual({ model: 'trimmed-model', source: 'picked' });
    });

    it('ignores empty/whitespace-only picked and falls through', () => {
      const result = resolveEffectiveModel('kavis-code', makeCli(), '   ', true, 'override-model');
      expect(result).toEqual({ model: 'override-model', source: 'override' });
    });

    it('ignores undefined picked and falls through', () => {
      const result = resolveEffectiveModel('kavis-code', makeCli(), undefined, true, 'override-model');
      expect(result).toEqual({ model: 'override-model', source: 'override' });
    });
  });

  describe('priority 2: override (kavis-code only)', () => {
    it('uses override when picked is empty and cli is kavis-code with useOverride=true', () => {
      const result = resolveEffectiveModel('kavis-code', makeCli(), undefined, true, 'glm-4-plus');
      expect(result).toEqual({ model: 'glm-4-plus', source: 'override' });
    });

    it('ignores override when useOverride=false', () => {
      const result = resolveEffectiveModel('kavis-code', makeCli(), undefined, false, 'glm-4-plus');
      expect(result).toEqual({ model: 'gpt-4o', source: 'cli-default' });
    });

    it('ignores override when cli is NOT kavis-code (codex)', () => {
      const result = resolveEffectiveModel(
        'codex',
        makeCli({ id: 'codex', defaultModel: 'o1' }),
        undefined,
        true,
        'glm-4-plus',
      );
      expect(result).toEqual({ model: 'o1', source: 'cli-default' });
    });

    it('ignores override when cli is NOT kavis-code (claude)', () => {
      const result = resolveEffectiveModel(
        'claudecode',
        makeCli({ id: 'claudecode', defaultModel: 'sonnet' }),
        undefined,
        true,
        'glm-4-plus',
      );
      expect(result).toEqual({ model: 'sonnet', source: 'cli-default' });
    });

    it('ignores whitespace-only override', () => {
      const result = resolveEffectiveModel('kavis-code', makeCli(), undefined, true, '   ');
      expect(result).toEqual({ model: 'gpt-4o', source: 'cli-default' });
    });

    it('trims override value', () => {
      const result = resolveEffectiveModel('kavis-code', makeCli(), undefined, true, '  glm-4-plus  ');
      expect(result).toEqual({ model: 'glm-4-plus', source: 'override' });
    });
  });

  describe('priority 3: cli.defaultModel', () => {
    it('uses defaultModel when no picked and no applicable override', () => {
      const result = resolveEffectiveModel('kavis-code', makeCli(), undefined, false, '');
      expect(result).toEqual({ model: 'gpt-4o', source: 'cli-default' });
    });
  });

  describe('priority 4: cli.models[0]', () => {
    it('falls back to first model when defaultModel is missing', () => {
      const cli = makeCli({ defaultModel: undefined });
      const result = resolveEffectiveModel('kavis-code', cli, undefined, false, '');
      expect(result).toEqual({ model: 'gpt-4o', source: 'cli-first' });
    });

    it('falls back to first model when defaultModel is empty string', () => {
      const cli = makeCli({ defaultModel: '' });
      const result = resolveEffectiveModel('kavis-code', cli, undefined, false, '');
      expect(result).toEqual({ model: 'gpt-4o', source: 'cli-first' });
    });
  });

  describe('priority 5: empty fallback', () => {
    it('returns empty when cli has no models', () => {
      const cli = makeCli({ defaultModel: undefined, models: [] });
      const result = resolveEffectiveModel('kavis-code', cli, undefined, false, '');
      expect(result).toEqual({ model: '', source: 'empty' });
    });

    it('returns empty when cliResult is undefined', () => {
      const result = resolveEffectiveModel('kavis-code', undefined, undefined, false, '');
      expect(result).toEqual({ model: '', source: 'empty' });
    });

    it('returns empty when activeCli is undefined and nothing else applies', () => {
      const result = resolveEffectiveModel(undefined, undefined, undefined, true, 'override');
      expect(result).toEqual({ model: '', source: 'empty' });
    });
  });

  describe('regression: the original bug', () => {
    it('Settings override takes effect immediately without restart (no stored activeModel)', () => {
      // Before: activeModel was sticky as 'gpt-4o' even after user enabled override.
      // After: with picked=undefined, override flips the result on the very next call.
      const before = resolveEffectiveModel('kavis-code', makeCli(), undefined, false, '');
      expect(before.model).toBe('gpt-4o');

      const after = resolveEffectiveModel('kavis-code', makeCli(), undefined, true, 'glm-4-plus');
      expect(after.model).toBe('glm-4-plus');
      expect(after.source).toBe('override');
    });

    it('user picker choice survives toggling override on/off', () => {
      const withOverride = resolveEffectiveModel('kavis-code', makeCli(), 'user-pick', true, 'override-model');
      const withoutOverride = resolveEffectiveModel('kavis-code', makeCli(), 'user-pick', false, '');
      expect(withOverride.model).toBe('user-pick');
      expect(withoutOverride.model).toBe('user-pick');
    });

    it('each CLI keeps its own picked model (caller scopes pickedModel by CLI)', () => {
      // Hook reads pickedModelByCli[activeCli], so different CLIs naturally get different picks.
      const codexResult = resolveEffectiveModel(
        'codex',
        makeCli({ id: 'codex', defaultModel: 'o1' }),
        'o1-pro',
        false,
        '',
      );
      const claudeResult = resolveEffectiveModel(
        'claudecode',
        makeCli({ id: 'claudecode', defaultModel: 'sonnet' }),
        'opus',
        false,
        '',
      );
      expect(codexResult.model).toBe('o1-pro');
      expect(claudeResult.model).toBe('opus');
    });
  });
});
