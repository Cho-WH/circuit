import { Component, type ReactNode } from 'react';
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main style={{ padding: 40, fontFamily: 'system-ui' }}><h1>화면을 표시하지 못했습니다.</h1><p>저장된 회로는 브라우저에 남아 있습니다. 새로고침으로 다시 열어 주세요.</p><button onClick={() => window.location.reload()}>회로 다시 열기</button></main>;
    return this.props.children;
  }
}
