import { Component, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import type { Potential3DProps } from '../potential-3d';
import './potential-workspace.css';

export type PotentialWorkspaceStatus = '2d' | 'preparing' | 'entering' | 'ready' | 'failed';
export interface PotentialWorkspaceProps extends Potential3DProps {
  active: boolean;
  children: ReactNode;
  onReturnTo2D: () => void;
  onStatusChange?: (status: PotentialWorkspaceStatus) => void;
}
// Remember completed documents without keeping their WebGL contexts or document data alive.
const visited = new WeakSet<Potential3DProps['document']>();
let revision = 0;

class SceneBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? null : this.props.children; }
}

function SceneAttempt({ onState, ...props }: Potential3DProps & { onState: (state: PotentialWorkspaceStatus) => void }) {
  const [Scene, setScene] = useState<ComponentType<Potential3DProps> | null>(null);
  const latest = useRef(onState); latest.current = onState;
  const live = useRef(true), ready = useRef(false);
  const duration = useRef(visited.has(props.document) ? 900 : 1100);
  useEffect(() => {
    live.current = true;
    latest.current('preparing');
    const timeout = window.setTimeout(() => { if (live.current && !ready.current) latest.current('failed'); }, 12000);
    import('../potential-3d').then(module => {
      if (live.current) setScene(() => module.Potential3D);
    }).catch(() => { if (live.current) latest.current('failed'); });
    return () => { live.current = false; window.clearTimeout(timeout); };
  }, []);
  const failure = () => { if (live.current) latest.current('failed'); };
  return <SceneBoundary onFailure={failure}>{Scene && <Scene {...props} entryDuration={duration.current}
    onReady={() => { if (live.current) { ready.current = true; visited.add(props.document); latest.current('entering'); } }}
    onEntered={() => { if (live.current) latest.current('ready'); }} onError={failure}/>}</SceneBoundary>;
}

export function PotentialWorkspace({ active, children, onReturnTo2D, onStatusChange, ...scene }: PotentialWorkspaceProps) {
  const [state, setState] = useState<{ document: Potential3DProps['document']; status: PotentialWorkspaceStatus }>({ document: scene.document, status: 'preparing' });
  const [attempt, setAttempt] = useState(0), [waiting, setWaiting] = useState(false);
  const documentKey = useMemo(() => ++revision, [scene.document]);
  const status = !active ? '2d' : state.document === scene.document ? state.status : 'preparing';
  const showing = active && (status === 'entering' || status === 'ready');
  const statusCallback = useRef(onStatusChange); statusCallback.current = onStatusChange;
  useEffect(() => { statusCallback.current?.(status); }, [status]);
  useEffect(() => {
    setWaiting(false);
    if (status !== 'preparing') return;
    const timer = window.setTimeout(() => setWaiting(true), 1000);
    return () => window.clearTimeout(timer);
  }, [status, documentKey, attempt]);
  // A return to 2D must invalidate ready state before the next preparation starts.
  useEffect(() => { if (!active) setState({ document: scene.document, status: 'preparing' }); }, [active, scene.document]);
  return <div className="potential-workspace" data-status={status}>
    <div className="potential-workspace-2d" aria-hidden={showing || undefined} inert={showing || undefined} style={{ visibility: showing ? 'hidden' : 'visible' }}>{children}</div>
    {active && status !== 'failed' && <div className="potential-workspace-3d" aria-hidden={!showing || undefined} inert={!showing || undefined} style={{ visibility: showing ? 'visible' : 'hidden' }}>
      <SceneAttempt key={`${documentKey}:${attempt}`} {...scene} onState={next => setState({ document: scene.document, status: next })}/>
    </div>}
    {active && status === 'preparing' && waiting && <div className="potential-preparation" role="status"><span>3D를 준비하고 있어요</span><button onClick={onReturnTo2D}>취소</button></div>}
    {status === 'failed' && <div className="potential-preparation potential-failure" role="status"><span>3D를 열지 못했어요</span><button onClick={() => { setState({ document: scene.document, status: 'preparing' }); setAttempt(value => value + 1); }}>다시 시도</button><button onClick={onReturnTo2D}>2D 보기</button></div>}
  </div>;
}
