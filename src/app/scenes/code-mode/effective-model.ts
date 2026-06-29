import type { CliDetectionResult, CliToolId } from '../../../../shared/types';

export interface EffectiveModelResolution {
  model: string;
  source: 'picked' | 'override' | 'cli-default' | 'cli-first' | 'empty';
}

export function resolveEffectiveModel(
  cli: CliToolId | undefined,
  cliResult: CliDetectionResult | undefined,
  pickedModel: string | undefined,
  codeModeUseOverride: boolean,
  codeModeModel: string,
): EffectiveModelResolution {
  const picked = pickedModel?.trim();
  if (picked) return { model: picked, source: 'picked' };

  const override = cli === 'kavis-code' && codeModeUseOverride ? codeModeModel.trim() : '';
  if (override) return { model: override, source: 'override' };

  if (cliResult?.defaultModel) return { model: cliResult.defaultModel, source: 'cli-default' };
  const first = cliResult?.models?.[0];
  if (first) return { model: first, source: 'cli-first' };
  return { model: '', source: 'empty' };
}
