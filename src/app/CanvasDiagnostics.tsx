import { Info, TriangleAlert, X } from 'lucide-react';
import type { CircuitDocument, Diagnostic } from '../domain';
import { diagnosticText } from './diagnostic-text';
import { FloatingPanel } from './FloatingPanel';
import './canvas-diagnostics.css';
import type { OperatingAssessment } from '../simulation';
import { Notation } from './Notation';
import { operatingReason } from './operating-text';

interface Props {
  document: CircuitDocument;
  diagnostics: Diagnostic[];
  onLocate: (ids: string[]) => void;
  assessment?: OperatingAssessment;
  analyzing?: boolean;
  selectedId?: string;
  onHighlight?: (ids: string[]) => void;
  onReset?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CanvasDiagnostics({ document, diagnostics, onLocate, assessment, analyzing, selectedId, onHighlight, onReset, open, onOpenChange }: Props) {
  const risk = assessment?.components.length ? assessment : undefined;
  const cause = risk?.components.find(c => c.componentId === selectedId) ?? risk?.representative ?? risk?.components[0];
  const component = document.components.find(c => c.id === cause?.componentId);
  if (!diagnostics.length && !cause) return null;
  // An unfinished circuit is normal during assembly; preserve engine severity separately.
  const warning = diagnostics.some(
    (d) =>
      d.severity !== 'info' &&
      !['EMPTY_CIRCUIT', 'UNCONNECTED_TERMINAL', 'FLOATING_SUBCIRCUIT', 'INFEASIBLE_OPERATING_POINT', 'OPERATING_POINT_UNVERIFIED', 'NONUNIQUE_OPERATING_POINT', 'APPROXIMATE_SOLVE_FAILED', 'EXACT_SOLVE_FAILED'].includes(d.code),
  );
  const title = cause ? (assessment?.status === 'damage' ? '파손 주의' : '과부하 주의') : warning ? '회로 연결 확인' : document.components.length ? '조립 안내' : '시작 안내';
  const groups = Object.values(
    diagnostics.reduce<Record<string, Diagnostic[]>>((groups, d) => {
      (groups[d.code] ??= []).push(d);
      return groups;
    }, {}),
  );
  return (
    <div className="canvas-status-actions">
    <FloatingPanel
      open={open}
      label={title}
      trigger={
        cause || warning ? (
          <TriangleAlert size={20} aria-hidden="true" />
        ) : (
          <Info size={20} aria-hidden="true" />
        )
      }
      contentLabel={title}
      className={'canvas-diagnostics-trigger' + (cause ? assessment?.status === 'damage' ? ' is-damage' : ' is-warning' : warning ? ' is-warning' : '')}
      contentClassName="canvas-diagnostics-bubble"
      align="start"
      width={320}
      onOpenChange={open => { onOpenChange?.(open); onHighlight?.(open && risk ? risk.components.map(c => c.componentId) : []); }}
    >
      {(close) => (
        <>
          <div className="canvas-diagnostics-heading">
            <strong>{title}</strong>
            <button type="button" aria-label="안내 닫기" onClick={() => close()}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          {cause && component ? <p className="operating-caution">
            {!analyzing && '분석하면 '}<Notation symbol text={component.label} />
            {analyzing ? `: ${operatingReason(cause, cause.level === 'damage')}` : cause.level === 'damage' ? '이 손상돼요' : '에 과부하가 걸려요'}
          </p> : groups.map((items) => {
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
    {onReset && <button type="button" className="analysis-reset" onClick={onReset}>회로 초기화</button>}
    </div>
  );
}
