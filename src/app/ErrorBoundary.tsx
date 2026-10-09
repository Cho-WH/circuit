import { Component, type ReactNode } from 'react';
import { ErrorDetails } from './ErrorDetails';
import {
  screenFailure,
  screenFailureReport,
  screenStageLabels,
  type ScreenFailure,
} from './screen-failure';

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failure: ScreenFailure | null }
> {
  state: { failure: ScreenFailure | null } = { failure: null };
  static getDerivedStateFromError(error: unknown) {
    return { failure: screenFailure(error) };
  }
  render() {
    const { failure } = this.state;
    if (failure)
      return (
        <main className="screen-failure">
          <h1>화면을 표시하지 못했습니다.</h1>
          <p role="alert">{screenStageLabels[failure.stage]} 단계에서 문제가 생겼어요.</p>
          <p>새로고침해 다시 열어 주세요. 저장 전 변경과 실행 취소 기록은 사라질 수 있어요.</p>
          <button className="primary" type="button" onClick={() => window.location.reload()}>
            회로 다시 열기
          </button>
          <ErrorDetails report={screenFailureReport(failure)} label="화면 오류 정보" />
        </main>
      );
    return this.props.children;
  }
}
