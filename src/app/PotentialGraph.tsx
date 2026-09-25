import { notationWidth } from '../component-library';
import { createQuantityScale } from '../quantity';
import { SvgNotation } from './Notation';
import type { CircuitDocument } from '../domain';
import type { CircuitPath } from '../visualization';
import { pathVoltages } from '../visualization';
import type { SimulationResult } from '../domain';
export function PotentialGraph({ path, result, hovered, onHover, document }: { document: CircuitDocument; path: CircuitPath | null; result: SimulationResult; hovered: string | null; onHover: (id: string | null) => void }) {
  if (!path) return <div className="graph-empty">전원을 포함한 회로를 연결하거나 경로를 직접 선택하세요.</div>;
  const steps = pathVoltages(path, result);
  if (steps.some(s => s.fromVoltage === undefined || s.toVoltage === undefined)) return <div className="graph-empty">전위가 정해지지 않아 그래프를 그릴 수 없습니다. 기준점과 회로 연결을 확인하세요.</div>;
  const values = steps.flatMap(s => [s.fromVoltage, s.toVoltage]); const min = Math.min(0, ...values), max = Math.max(...values, 0);
  const scale=createQuantityScale(values,'V');
  const left=Math.max(50,Math.ceil(Math.max(notationWidth(scale.format(min),12),notationWidth(scale.format(max),12)))+20);
  const y = (v: number) => 80 - (v - min) / (max - min || 1) * 60; const width = Math.max(680,left+520); const right=width-30, segment=(right-left-15) / steps.length;
  return <div className="quantity-graph-scroll"><svg style={{minWidth:width>900?width:undefined}} className="potential-graph" viewBox={`0 0 ${width} 110`} role="img" aria-label="경로 전위 그래프: 도선은 수평, 부품은 전위 변화">
    <path d={`M${left} 13V85H${right}`} fill="none" stroke="#d8e1ec"/><text x="12" y="14" fill="#62748c" fontSize="12">{scale.unit}</text>
    {[min, max].map((v, i) => <g key={i}><path d={`M${left} ${y(v)}H${right}`} stroke="#e9edf3" strokeDasharray="4 4"/><text x={left-10} y={y(v) + 4} textAnchor="end" fill="#62748c" fontSize="12">{scale.format(v)}</text></g>)}
    {steps.map((step, i) => { const x = left+15 + i * segment; const name=document.components.find(c=>c.id===step.elementId)?.label??step.elementId; return <g key={i} tabIndex={0} role="button" aria-label={`${name} 전위 변화`} onMouseEnter={() => onHover(step.elementId)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(step.elementId)} onBlur={() => onHover(null)}>
      <path d={`M${x} ${y(step.fromVoltage)}h${segment * .3}L${x + segment * .9} ${y(step.toVoltage)}H${x + segment}`} fill="none" stroke={hovered === step.elementId ? '#efa638' : '#547fc0'} strokeWidth={hovered === step.elementId ? 4 : 2.5}/>
      <rect x={x} y="13" width={segment} height="72" fill="transparent"/>
      <SvgNotation x={x + segment * .6} y={104} textAnchor="middle" fill="#526781" fontSize={14} text={name} symbol/>
    </g>; })}
  </svg></div>;
}
