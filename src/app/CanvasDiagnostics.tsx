import { Info, TriangleAlert, X } from 'lucide-react';
import type { CircuitDocument, Diagnostic } from '../domain';
import { diagnosticText } from './diagnostic-text';
import { FloatingPanel } from './FloatingPanel';
import './canvas-diagnostics.css';

interface Props {
  document: CircuitDocument;
  diagnostics: Diagnostic[];
  onLocate: (ids: string[]) => void;
}

export function CanvasDiagnostics({ document, diagnostics, onLocate }: Props) {
  if (!diagnostics.length) return null;
  // An unfinished circuit is normal during assembly; preserve engine severity separately.
  const warning = diagnostics.some(
    (d) =>
      d.severity !== 'info' &&
      !['EMPTY_CIRCUIT', 'UNCONNECTED_TERMINAL', 'FLOATING_SUBCIRCUIT'].includes(d.code),
  );
  const title = warning ? '회로 연결 확인' : document.components.length ? '조립 안내' : '시작 안내';
  const groups = Object.values(
    diagnostics.reduce<Record<string, Diagnostic[]>>((groups, d) => {
      (groups[d.code] ??= []).push(d);
      return groups;
    }, {}),
  );
  return (
    <FloatingPanel
      label={title}
      trigger={
        warning ? (
          <TriangleAlert size={20} aria-hidden="true" />
        ) : (
          <Info size={20} aria-hidden="true" />
        )
      }
      contentLabel={title}
      className={'canvas-diagnostics-trigger' + (warning ? ' is-warning' : '')}
      contentClassName="canvas-diagnostics-bubble"
      align="start"
      width={320}
    >
      {(close) => (
        <>
          <div className="canvas-diagnostics-heading">
            <strong>{title}</strong>
            <button type="button" aria-label="안내 닫기" onClick={() => close()}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          {groups.map((items) => {
            const d = items[0],
              text = diagnosticText[d.code];
            const ids = [
              ...new Set(
                items
                  .flatMap((d) => d.affectedIds)
                  .map(
                    (id) =>
                      document.components.find((c) => c.terminals.some((t) => t.id === id))?.id ??
                      id,
                  ),
              ),
            ].filter((id) =>
              [...document.components, ...document.wires, ...document.junctions].some(
                (x) => x.id === id,
              ),
            );
            return (
              <section key={d.code}>
                <h3>
                  {d.code === 'UNCONNECTED_TERMINAL'
                    ? '단자 ' + items.length + '곳을 연결할 수 있습니다'
                    : (text?.title ?? d.code)}
                </h3>
                <p>
                  {text?.detail} {text?.action}
                </p>
                {ids.length > 0 && (
                  <button type="button" onClick={() => close(() => onLocate(ids))}>
                    회로에서 위치 보기
                  </button>
                )}
              </section>
            );
          })}
        </>
      )}
    </FloatingPanel>
  );
}
