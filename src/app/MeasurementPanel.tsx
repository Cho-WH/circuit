import * as q from '../rational';
import { formatQuantity } from '../quantity';
import { Notation } from './Notation';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { AnalysisPanel, MeasurementKind } from './AnalysisTools';
import type { CircuitDocument, CompileResult, EndpointRef, Diagnostic } from '../domain';
import { equivalentResistance } from '../simulation';
import { quantityFormatForTargets } from '../component-library';
import { createMeasurementRecord } from '../measurement';
import {
  ProbeGlyph,
  CurrentGlyph,
  anchorName,
  type MeasurementAnchor,
  type MeasurementTool,
} from './measurement-tools';
import type { CurrentReading, MeasurementResult, ProbeVoltage } from '../measurement';
import { ArrowLeftRight, RotateCcw, Plus, NotebookPen, Unplug, Power } from 'lucide-react';
import './measurement.css';
import { diagnosticText } from './diagnostic-text';
import { useMeasurementRecords } from './useMeasurementRecords';
import { MeasurementTable } from './MeasurementTable';

interface Props {
  kind: MeasurementKind | null;
  enabled: boolean;
  isolated: boolean;
  onExit: () => void;
  panel: AnalysisPanel;
  onPanel: (panel: AnalysisPanel) => void;
  children: ReactNode;
  document: CircuitDocument;
  compilation: CompileResult;
  voltageReading: MeasurementResult<ProbeVoltage>;
  voltageLabel: string;
  active: boolean;
  red: string;
  black: string;
  activeProbe: 'red' | 'black';
  anchors: Record<MeasurementTool, MeasurementAnchor | null>;
  currentReading: MeasurementResult<CurrentReading>;
  onReset: () => void;
  onSwap: () => void;
  onActiveProbe: (probe: 'red' | 'black') => void;
  consoleHost?: HTMLElement | null;
}
function Diagnostics({ items }: { items: Diagnostic[] }) {
  return (
    <>
      {items.map((d, i) => (
        <p className="tiny-note" key={i}>
          {diagnosticText[d.code]?.title ?? '측정할 수 없어요'} ·{' '}
          {diagnosticText[d.code]?.action ?? '대상과 연결 상태를 확인하세요.'}
        </p>
      ))}
    </>
  );
}
export function MeasurementPanel(props: Props) {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px)');
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const { document: doc, compilation, red, black } = props;
  const { kind, panel, onPanel, enabled, isolated } = props;
  const showNotebook = panel === 'records';

  const { entries, setEntries, storageWarning } = useMeasurementRecords();
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(''), 1800);
    return () => window.clearTimeout(timeout);
  }, [message, entries]);
  const endpoints = [
    ...doc.components.flatMap((c) =>
      c.terminals.map((t) => ({ kind: 'terminal' as const, id: t.id })),
    ),
    ...doc.junctions.map((j) => ({ kind: 'junction' as const, id: j.id })),
  ];
  const ref = (id: string): EndpointRef | null => endpoints.find((e) => e.id === id) ?? null;
  const voltage = props.voltageReading;
  const redNet = compilation.circuit.endpointToNet[red],
    blackNet = compilation.circuit.endpointToNet[black];
  const excluded = compilation.circuit.elements
    .filter((e) => e.type === 'dc-voltage-source')
    .map((e) => e.id);
  const resistance =
    enabled &&
    isolated &&
    kind === 'resistance' &&
    redNet &&
    blackNet &&
    !compilation.diagnostics.some((d) => d.severity === 'error')
      ? equivalentResistance(compilation.circuit, redNet, blackNet, { excludeSourceIds: excluded })
      : null;
  const current = props.currentReading.ok
    ? q.abs(props.currentReading.value.amperes)
    : undefined;
  const measuredTarget = props.anchors.current;
  const targetName = anchorName(doc, measuredTarget);
  const reading =
    kind === 'voltage'
      ? voltage.ok
        ? voltage.value.voltageV
        : undefined
      : kind === 'current'
        ? current
        : resistance?.ohms;
  const unit = kind === 'voltage' ? 'V' : kind === 'current' ? 'A' : 'Ω';
  function record() {
    if (!enabled || !kind || reading === undefined || !q.isRational(reading)) {
      setMessage('측정 위치를 먼저 골라 주세요.');
      return;
    }
    const saved = createMeasurementRecord(doc, {
      condition: kind === 'resistance' ? '모든 전원 분리' : '정상 연결',
      source: 'simulation',
      quantity: kind,
      value:
        kind === 'current' && props.currentReading.ok
          ? props.currentReading.value.amperes
          : reading,
      unit,
      targetIds: kind === 'current' ? [measuredTarget!.id] : [red, black],
      recordedAt: new Date().toISOString(),
    });
    if (saved.ok) {
      setEntries((previous) => [
        ...previous,
        {
          id: crypto.randomUUID(),
          record: saved.value,
          note: '',
          sourcesDisconnected: kind === 'resistance',
          anchors: structuredClone(
            kind === 'current'
              ? { red: null, black: null, current: props.anchors.current }
              : { red: props.anchors.red, black: props.anchors.black, current: null },
          ),
          ...(kind === 'current' && props.currentReading.ok
            ? {
                currentDirection: {
                  from: props.currentReading.value.from,
                  to: props.currentReading.value.to,
                },
              }
            : {}),
        },
      ]);
      setMessage('측정값을 기록했어요.');
    } else setMessage('기록 형식을 확인하세요.');
  }
  const connected = kind === 'current' ? reading !== undefined : Boolean(ref(red) && ref(black));
  const ready = enabled && reading !== undefined && q.isRational(reading);
  const diagnostics =
    kind === 'voltage'
      ? connected && !voltage.ok
        ? voltage.diagnostics
        : []
      : kind === 'resistance'
        ? (resistance?.diagnostics ?? [])
        : measuredTarget && !props.currentReading.ok
          ? props.currentReading.diagnostics
          : [];
  const formattedReading =
    kind === 'resistance' && resistance?.status === 'open'
      ? '∞ Ω'
      : kind === 'voltage'
        ? props.voltageLabel
        : formatQuantity(
            reading,
            unit,
            quantityFormatForTargets(
              doc,
              kind === 'current' ? [measuredTarget?.id ?? ''] : [red, black],
            ),
          );
  // Keep the shared formatter's value and SI prefix intact; only separate typography.
  const unitStart = formattedReading.lastIndexOf(' ');
  const displayValue = formattedReading.slice(0, unitStart);
  const displayUnit = formattedReading.slice(unitStart + 1);
  const recordsToggle = (
    <button
      className={`notebook-toggle${enabled ? '' : ' standalone'}`}
      aria-label={`기록 보기 ${entries.length}`}
      data-tooltip="측정 기록 보기"
      aria-expanded={showNotebook}
      aria-controls="measurement-notebook"
      onClick={() => onPanel(showNotebook ? null : 'records')}
    >
      <NotebookPen size={14} />
      {enabled ? '보기' : `기록 보기 ${entries.length}`}
    </button>
  );
  const measurementConsole = enabled ? (
    <div className="measure-console">
      <div className="measure-connections">
        {kind !== 'current' ? (
          <div className="probe-pair">
            {(['red', 'black'] as const).map((color) => {
              const name = color === 'red' ? '빨강' : '검정',
                attached = Boolean(ref(color === 'red' ? red : black));
              return (
                <button
                  key={color}
                  className={`probe-choice probe-${color}${props.activeProbe === color ? ' is-active' : ''}`}
                  aria-label={`${name} 탐침`}
                  aria-pressed={props.activeProbe === color}
                  onClick={() => props.onActiveProbe(color)}
                  data-tooltip={anchorName(doc, props.anchors[color]) || `${name} 탐침 놓기`}
                >
                  <svg width="28" height="44" viewBox="-14 -46 28 50" aria-hidden="true">
                    <ProbeGlyph color={color} />
                  </svg>
                  <span>{name}</span>
                  <i
                    className={attached ? 'attached' : ''}
                    aria-label={attached ? '연결됨' : '연결 안 됨'}
                  />
                </button>
              );
            })}
            <button
              className="measure-icon-button"
              aria-label="두 탐침 맞바꾸기"
              data-tooltip="두 탐침 맞바꾸기"
              onClick={props.onSwap}
            >
              <ArrowLeftRight size={17} />
            </button>
          </div>
        ) : (
          <div className="current-tool">
            <svg width="36" height="48" viewBox="-18 -39 36 54" aria-hidden="true">
              <CurrentGlyph />
            </svg>
            <span>
              {measuredTarget ? (
                <Notation
                  symbol={measuredTarget.kind === 'component'}
                  text={measuredTarget.kind === 'component' ? targetName : '도선 전류'}
                />
              ) : (
                '전류 센서'
              )}
            </span>
          </div>
        )}
        <button
          className="measure-icon-button"
          aria-label="측정 위치 지우기"
          data-tooltip="측정 위치 지우기"
          onClick={props.onReset}
        >
          <RotateCcw size={16} />
        </button>
        {isolated && (
          <span className="isolation-state">
            <Unplug size={15} />
            {excluded.length ? '전지 분리 상태' : '전원 없는 회로'}
          </span>
        )}
      </div>
      <div className="measure-readout">
        <div className="measure-lcd">
          <span className="measure-lcd-caption">
            {kind === 'voltage' ? '전압' : kind === 'current' ? '전류' : '저항'}
          </span>
          <output aria-label="측정값" aria-live="polite" aria-atomic="true">
            <span
              className="measure-lcd-value"
              style={{
                fontSize: `clamp(18px, calc((100cqi - 34px) / ${Math.max(1, displayValue.length * 0.62)}), 46px)`,
              }}
            >
              {displayValue}
            </span>{' '}
            <span className="measure-lcd-unit">{displayUnit}</span>
          </output>
        </div>
        <div className="measure-record-row" role="group" aria-label="측정 기록과 도구 종료">
          <span className="measure-record-label">기록</span>
          <button
            className="record-reading"
            aria-label="측정값 기록"
            data-tooltip="측정값 기록"
            disabled={!ready}
            onClick={record}
          >
            <Plus size={14} />
            {message === '측정값을 기록했어요.' ? '완료' : '추가'}
          </button>
          {recordsToggle}
          <button
            className="measure-exit"
            onClick={props.onExit}
            aria-label="도구 종료"
            data-tooltip="도구 종료 · Esc"
          >
            <Power size={16} />
          </button>
        </div>
      </div>
      <span className="measurement-sr-only" role="status">
        {message}
      </span>
      {enabled && diagnostics.length > 0 && (
        <div className="measure-diagnostics" role="status">
          <Diagnostics items={diagnostics} />
        </div>
      )}
    </div>
  ) : null;
  const recordsFooter = (
    <>
      {!enabled && recordsToggle}
      {storageWarning && !showNotebook && (
        <p className="record-storage-warning" role="status">
          {storageWarning}
        </p>
      )}
    </>
  );
  return (
    <section
      className={`measurement-panel${showNotebook ? ' notebook-open' : ''}`}
      aria-label="측정 작업 공간"
    >
      {props.consoleHost ? (
        <>
          {createPortal(
            <>
              {!compact && measurementConsole}
              {recordsFooter}
            </>,
            props.consoleHost,
          )}
          {compact && measurementConsole}
        </>
      ) : (
        <>
          {measurementConsole}
          {recordsFooter}
        </>
      )}
      <div className="measure-circuit">{props.children}</div>
      <MeasurementTable
        entries={entries}
        open={showNotebook && props.active}
        storageWarning={storageWarning}
        onClose={() => onPanel(null)}
        onNote={(id, note) =>
          setEntries((previous) =>
            previous.map((entry) => (entry.id === id ? { ...entry, note } : entry)),
          )
        }
        onDelete={(id) => setEntries((previous) => previous.filter((entry) => entry.id !== id))}
        onClear={() => setEntries([])}
      />
    </section>
  );
}
