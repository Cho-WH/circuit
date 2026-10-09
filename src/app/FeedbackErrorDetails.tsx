import { ErrorDetails } from './ErrorDetails';
import { feedbackFailureReport, type FeedbackFailure } from './feedback-failure';

export function FeedbackErrorDetails({ failure }: { failure: FeedbackFailure }) {
  return <ErrorDetails report={feedbackFailureReport(failure)} label="한마디 오류 정보" />;
}
