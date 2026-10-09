import { version } from '../../package.json';
import { releaseChannel } from '../release';

export type FeedbackStage =
  | 'load'
  | 'initialize'
  | 'render'
  | 'list'
  | 'create'
  | 'update'
  | 'remove';
export interface FeedbackFailure {
  stage: FeedbackStage;
  code: string;
  errorType: string;
}
const knownCodes = new Set([
  'UNAVAILABLE',
  'FORBIDDEN',
  'INVALID_INPUT',
  'DAILY_LIMIT',
  'NOT_FOUND',
  'LOAD_TIMEOUT',
  'auth/network-request-failed',
  'auth/web-storage-unsupported',
  'auth/invalid-api-key',
  'auth/already-initialized',
  'app/duplicate-app',
  'app/no-app',
  'failed-precondition',
]);
const knownTypes = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'FirebaseError',
]);

// Never include exception messages, stacks, URLs, circuit data or post contents.
export function feedbackFailure(stage: FeedbackStage, error?: unknown): FeedbackFailure {
  if (error instanceof FeedbackInitializationError) return error.failure;
  const value =
    error && typeof error === 'object'
      ? (error as { code?: unknown; name?: unknown; message?: unknown })
      : {};
  let code =
    typeof value.code === 'string' && knownCodes.has(value.code)
      ? value.code
      : `FEEDBACK_${stage.toUpperCase()}_FAILED`;
  if (stage === 'load' && typeof value.message === 'string') {
    if (
      /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(
        value.message,
      )
    )
      code = 'MODULE_FETCH_FAILED';
    else if (/Unable to preload CSS/i.test(value.message)) code = 'STYLESHEET_LOAD_FAILED';
  }
  return {
    stage,
    code,
    errorType:
      typeof value.name === 'string' && knownTypes.has(value.name) ? value.name : 'Unknown',
  };
}

export class FeedbackInitializationError extends Error {
  readonly failure: FeedbackFailure;
  constructor(error: unknown) {
    super('Feedback initialization failed');
    this.failure = feedbackFailure('initialize', error);
  }
}

export function feedbackFailureReport(failure: FeedbackFailure): string {
  return JSON.stringify(
    {
      feature: 'feedback',
      version,
      channel: releaseChannel(),
      build: import.meta.env.VITE_BUILD_ID ?? 'local',
      ...failure,
    },
    null,
    2,
  );
}
