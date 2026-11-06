import { FastForward, Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import type { CircuitDocument } from '../domain';
import { RcSession, rcSpeeds, type RcSessionState } from './rc-session';
import { diagnosticText } from './diagnostic-text';
import './rc-session.css';

const status = {
  preparing: '회로 변화 계산 중',
  running: '충전·방전 관찰 중',
  paused: '일시정지',
  settling: '평형으로 전환 중',
  equilibrium: '평형 · 충분한 시간이 지난 상태',
  error: '계산을 계속할 수 없습니다',
};
export function RcPlaybackControls({
  state,
  session,
  document,
}: {
  state: RcSessionState;
  session: RcSession;
  document: CircuitDocument;
}) {
  const playable = state.phase === 'running' || state.phase === 'paused';
  return (
    <section className="rc-playback" aria-label="RC 실험 재생">
      <span title="정격·열·파손을 계산하지 않는 이상적인 선형 RC 모델입니다.">이상적 RC</span>
      <span role="status">{status[state.phase]}</span>
      <span className="rc-clock">
        {playable ? `${state.seconds.toPrecision(4)} s · ` : ''}
        {Number(state.speed.toPrecision(4))}배
      </span>
      <div className="rc-playback-buttons">
        {playable && (
          <button
            type="button"
            title={state.phase === 'paused' ? '재개' : '일시정지'}
            aria-label={state.phase === 'paused' ? '재개' : '일시정지'}
            onClick={() => (state.phase === 'paused' ? session.resume() : session.pause())}
          >
            {state.phase === 'paused' ? <Play size={18} /> : <Pause size={18} />}
          </button>
        )}
        {state.longPlayback && (
          <>
            <details className="rc-speed-menu">
              <summary aria-label="재생 배속 선택" title="재생 배속 선택">
                <FastForward size={18} />
              </summary>
              <div role="group" aria-label="재생 배속">
                {rcSpeeds.map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    disabled={!playable}
                    aria-pressed={state.speed === speed}
                    onClick={(event) => {
                      session.setSpeed(speed);
                      event.currentTarget.closest('details')?.removeAttribute('open');
                    }}
                  >
                    {speed}배
                  </button>
                ))}
              </div>
            </details>
            <button
              type="button"
              disabled={!playable}
              aria-label="최종 평형으로 넘기기"
              title="최종 평형으로 넘기기"
              onClick={() => session.skip()}
            >
              <SkipForward size={18} />
            </button>
          </>
        )}
        <button
          type="button"
          aria-label="분석 진입 상태로 다시 시작"
          title="분석 진입 상태로 다시 시작"
          disabled={state.phase === 'settling'}
          onClick={() => void session.restart()}
        >
          <RotateCcw size={18} />
        </button>
      </div>
      {state.diagnostics.length > 0 && (
        <p className="rc-error" role="alert">
          {state.diagnostics
            .map((d) => {
              const names = d.affectedIds
                .map((id) => document.components.find((c) => c.id === id)?.label)
                .filter(Boolean);
              const help = diagnosticText[d.code];
              return `${names.length ? names.join(', ') + ': ' : ''}${help?.title ?? '회로 설정을 확인해 주세요.'} ${help?.action ?? ''}`;
            })
            .join(' · ')}
        </p>
      )}
    </section>
  );
}
