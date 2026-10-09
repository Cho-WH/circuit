import { version } from '../../package.json';
import { releaseChannel } from '../release';

export type ScreenStage = 'calculation' | 'preparation' | 'render';
export interface ScreenFailure {
  stage: ScreenStage;
  errorType: string;
}
export const screenStageLabels: Record<ScreenStage, string> = {
  calculation: '회로 계산',
  preparation: '측정·표시 준비',
  render: '화면 준비·표시',
};
const knownTypes = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError']);

export function screenFailure(error: unknown): ScreenFailure {
  if (error instanceof ScreenStageError) return error.failure;
  const name = error instanceof Error ? error.name : undefined;
  return { stage: 'render', errorType: name && knownTypes.has(name) ? name : 'Unknown' };
}

class ScreenStageError extends Error {
  readonly failure: ScreenFailure;
  constructor(stage: ScreenStage, error: unknown) {
    super('Screen update failed', { cause: error });
    this.failure = { ...screenFailure(error), stage };
  }
}

/** Tag synchronous app work; preserve the innermost failure without substituting a result. */
export function runScreenStage<T>(stage: ScreenStage, work: () => T): T {
  try {
    return work();
  } catch (error) {
    throw error instanceof ScreenStageError ? error : new ScreenStageError(stage, error);
  }
}

export function screenFailureReport(failure: ScreenFailure): string {
  // Only these fields may be copied; exception messages, causes and documents stay out.
  return JSON.stringify(
    {
      feature: 'screen',
      version,
      channel: releaseChannel(),
      build: import.meta.env.VITE_BUILD_ID ?? 'local',
      stage: failure.stage,
      errorType: failure.errorType,
    },
    null,
    2,
  );
}
