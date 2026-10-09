import { Component, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { FeedbackLoading } from './FeedbackLoading';
import { feedbackFailure, type FeedbackFailure } from './feedback-failure';

type BoardProps = { onClose: () => void };
type Loader = () => Promise<{ default: ComponentType<BoardProps> }>;
const loadBoard: Loader = () => import('./FeedbackBoard');

class FeedbackBoundary extends Component<
  BoardProps & { onRetry: () => void; children: ReactNode },
  { failure: FeedbackFailure | null }
> {
  state: { failure: FeedbackFailure | null } = { failure: null };
  static getDerivedStateFromError(error: unknown) {
    return { failure: feedbackFailure('render', error) };
  }
  render() {
    return this.state.failure ? (
      <FeedbackLoading
        failure={this.state.failure}
        onClose={this.props.onClose}
        onRetry={this.props.onRetry}
      />
    ) : (
      this.props.children
    );
  }
}

function FeedbackAttempt({
  load,
  onClose,
  onRetry,
}: BoardProps & { load: Loader; onRetry: () => void }) {
  const [Board, setBoard] = useState<ComponentType<BoardProps> | null>(null);
  const [failure, setFailure] = useState<FeedbackFailure | null>(null);
  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      if (active) {
        active = false;
        setFailure(feedbackFailure('load', { code: 'LOAD_TIMEOUT' }));
      }
    }, 15000);
    // A new attempt calls import again instead of reusing React.lazy's rejected promise.
    void Promise.resolve()
      .then(load)
      .then(
        (module) => {
          if (active) {
            window.clearTimeout(timeout);
            setBoard(() => module.default);
          }
        },
        (error) => {
          if (active) {
            window.clearTimeout(timeout);
            setFailure(feedbackFailure('load', error));
          }
        },
      );
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [load]);
  return Board ? (
    <Board onClose={onClose} />
  ) : (
    <FeedbackLoading failure={failure ?? undefined} onClose={onClose} onRetry={onRetry} />
  );
}

export function FeedbackFeature({ onClose, load = loadBoard }: BoardProps & { load?: Loader }) {
  const [attempt, setAttempt] = useState(0);
  const retry = () => setAttempt((value) => value + 1);
  return (
    <FeedbackBoundary key={attempt} onClose={onClose} onRetry={retry}>
      <FeedbackAttempt load={load} onClose={onClose} onRetry={retry} />
    </FeedbackBoundary>
  );
}
