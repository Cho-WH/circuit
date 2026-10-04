import type { ReactNode } from 'react';
import { ArrowLeft, ArrowLeftRight, Ellipsis, NotebookPen, Plus, RotateCcw, Unplug } from 'lucide-react';
import { ActionMenu } from './ActionMenu';
import { FloatingPanel } from './FloatingPanel';
import { measurementLabels, type MeasurementKind } from './AnalysisTools';
import { ProbeGlyph } from './measurement-tools';

interface Props {
  kind: MeasurementKind;
  onChoose: (kind: MeasurementKind) => void;
  onBack: () => void;
  reading: string;
  ready: boolean;
  potentials: Record<'red' | 'black', string>;
  activeProbe: 'red' | 'black';
  onActiveProbe: (color: 'red' | 'black') => void;
  targetName: string;
  needsIsolation: boolean;
  isolated: boolean;
  onIsolate: () => void;
  onRecord: () => void;
  onRecords: () => void;
  onSwap: () => void;
  onReset: () => void;
  records: number;
  diagnostics: ReactNode;
}

/** A different mobile layout over the same measurement values and commands. */
export function CompactMeasurementBar(props: Props) {
  return <>
    <button className="compact-back" aria-label="보기 도구로 돌아가기" data-tooltip="보기 도구로 돌아가기" onClick={props.onBack}>
      <ArrowLeft size={18} />
    </button>
    <ActionMenu label={props.kind === 'voltage' ? '전압' : props.kind === 'current' ? '전류' : '저항'} contentLabel="측정 도구 선택" className="compact-measure-kind" align="start">
      {close => (Object.keys(measurementLabels) as MeasurementKind[]).map(kind =>
        <button key={kind} role="menuitemradio" aria-checked={props.kind === kind} onClick={() => close(() => props.onChoose(kind))}>{measurementLabels[kind]}</button>,
      )}
    </ActionMenu>
    {props.needsIsolation ? <button className="compact-isolate" onClick={props.onIsolate} data-tooltip="등가저항은 전지를 분리하고 측정해요">
      <Unplug size={16} />전지 분리하고 측정
    </button> : <>
      <FloatingPanel label="측정값 상세" contentLabel="측정값 상세" className="compact-reading" contentClassName="compact-reading-detail" width={300}
        trigger={<output aria-label="측정값" aria-live="polite" aria-atomic="true" style={{ fontSize: `${Math.max(12, Math.min(24, 100 / Math.max(4, props.reading.length * .55)))}px` }}>{props.reading}</output>}>
        {() => <>
          <strong>{props.reading}</strong>
          {props.kind === 'voltage' && <p>빨강 {props.potentials.red} · 검정 {props.potentials.black}</p>}
          {props.kind === 'current' && <p>{props.targetName || '측정 위치를 선택하세요'}</p>}
          {props.isolated && <p><Unplug size={14} /> 전지 분리 상태</p>}
          {props.diagnostics}
        </>}
      </FloatingPanel>
      {props.kind === 'current' ? <span className="compact-current-target" data-tooltip={props.targetName}>{props.targetName || '위치 선택'}</span> :
        (['red', 'black'] as const).map(color => <button key={color} className={`compact-probe ${props.activeProbe === color ? 'active' : ''}`}
          aria-label={`${color === 'red' ? '빨강' : '검정'} 탐침${props.kind === 'voltage' ? ` 전위 ${props.potentials[color]}` : ''}`}
          aria-pressed={props.activeProbe === color} onClick={() => props.onActiveProbe(color)}>
          <svg width="13" height="23" viewBox="-11 -47 22 42" aria-hidden="true"><ProbeGlyph color={color} compact /></svg>
          {props.kind === 'voltage' && <span>{props.potentials[color]}</span>}
        </button>)}
    </>}
    <FloatingPanel label="측정 더보기" contentLabel="측정 더보기" className="compact-more" contentClassName="action-menu-content" role="menu" trigger={<Ellipsis size={18} />}>
      {close => <>
        <button role="menuitem" disabled={!props.ready} onClick={() => close(props.onRecord)}><Plus size={16} />측정값 기록</button>
        <button role="menuitem" onClick={() => close(props.onRecords)}><NotebookPen size={16} />기록 보기 {props.records}</button>
        {props.kind !== 'current' && <button role="menuitem" onClick={() => close(props.onSwap)}><ArrowLeftRight size={16} />두 탐침 맞바꾸기</button>}
        <button role="menuitem" onClick={() => close(props.onReset)}><RotateCcw size={16} />측정 위치 지우기</button>
      </>}
    </FloatingPanel>
  </>;
}
