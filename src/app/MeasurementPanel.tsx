import { saveBlob } from './download';
import { createQuantityScale, formatQuantity, quantityFormatFor } from '../quantity';
import { Notation, QuantityInput } from './Notation';
import { useId, useRef, useState, type ReactNode } from 'react';
import type { CircuitDocument, CompileResult, EndpointRef, SimulationResult, Diagnostic } from '../domain';
import { circuitCompiler } from '../connectivity';
import { dcEngine, checkKcl, checkKvl, equivalentResistance, type ConservationResult } from '../simulation';
import { endpointName, notationWidth, quantityFormatForTargets } from '../component-library';
import { probeVoltage, parameterSweep, createMeasurementRecord, measurementsToCsv, type MeasurementRecord, type ParameterSweepResult } from '../measurement';
import { suggestPaths } from '../visualization';
import { ProbeGlyph, CurrentGlyph, anchorName, type MeasurementAnchor, type MeasurementTool } from './measurement-tools';
import type { CurrentReading, MeasurementResult } from '../measurement';
import { ArrowLeftRight, RotateCcw, Plus, NotebookPen, Unplug } from 'lucide-react';
import './measurement.css';
import { diagnosticText } from './diagnostic-text';

interface Props {
  kind: 'voltage'|'current'|'resistance'; onKind: (kind: 'voltage'|'current'|'resistance') => void;
  branchId: string; onBranch: (id: string) => void; children: ReactNode;
  document: CircuitDocument; compilation: CompileResult; result: SimulationResult; active: boolean;
  red: string; black: string; activeProbe: 'red' | 'black';
  anchors:Record<MeasurementTool,MeasurementAnchor|null>; currentReading:MeasurementResult<CurrentReading>;
  onReset:()=>void; onSwap:()=>void; onActiveProbe: (probe: 'red' | 'black') => void;
  toolbarEnd?: ReactNode;
}
function Diagnostics({ items }: { items: Diagnostic[] }) { return <>{items.map((d, i) => <p className="tiny-note" key={i}>{diagnosticText[d.code]?.title ?? '측정할 수 없어요'} · {diagnosticText[d.code]?.action ?? '대상과 연결 상태를 확인하세요.'}</p>)}</>; }
function Conservation({ value, unit, document:doc }: { value: ConservationResult; unit: string; document:CircuitDocument }) {
  return <div className="conservation"><p>{value.defined ? `합 ${formatQuantity(value.sum, unit)}${value.passes ? ' · 0과 일치' : ''}` : '측정할 수 없습니다'}</p>{value.defined && <><ul>{value.terms.map((t, i) => <li key={i}><Notation symbol text={doc.components.find(c=>c.id===t.elementId)?.label??t.elementId}/>: {t.value >= 0 ? '+' : ''}{formatQuantity(t.value, unit, quantityFormatFor(doc.components.find(c=>c.id===t.elementId)?.properties))}</li>)}</ul><small>허용오차 {formatQuantity(value.tolerance, unit)}</small></>}<Diagnostics items={value.diagnostics}/></div>;
}
function SweepGraph({ data, xProperties, yProperties }: { data: ParameterSweepResult; xProperties?:Record<string,string|number|boolean>; yProperties?:Record<string,string|number|boolean> }) {
  const valid = data.samples.filter(s => s.y !== null); const minX = Math.min(...data.samples.map(s => s.x)), maxX = Math.max(...data.samples.map(s => s.x));
  const minY = Math.min(0, ...valid.map(s => s.y!)), maxY = Math.max(0, ...valid.map(s => s.y!));
  const xs=createQuantityScale(data.samples.map(s=>s.x),data.xUnit,quantityFormatFor(xProperties)), ys=createQuantityScale(valid.map(s=>s.y!),data.yUnit,quantityFormatFor(yProperties));
  const left=Math.max(52,Math.ceil(Math.max(notationWidth(ys.format(minY),11),notationWidth(ys.format(maxY),11)))+12), graphWidth=left+248;
  const x = (v: number) => left + 222 * (v - minX) / (maxX - minX || 1), y = (v: number) => 160 - 120 * (v - minY) / (maxY - minY || 1);
  let path = '', connected = false; for (const s of data.samples) { if (s.y === null) { connected = false; continue; } path += `${connected ? 'L' : 'M'}${x(s.x)} ${y(s.y)} `; connected = true; }
  return <><div className="quantity-graph-scroll"><svg className="sweep-graph" style={{minWidth:graphWidth>400?graphWidth:undefined}} viewBox={`0 0 ${graphWidth} 212`} role="img" aria-label={`${data.xLabel} (${data.xUnit})에 따른 ${data.yLabel} (${data.yUnit})`}><path d={`M${left} 32V160H${left+230}`} fill="none" stroke="#8998aa"/><text x="12" y="20" fontSize="12">{data.yLabel} ({ys.unit})</text><text x={left} y="178" fontSize="11">{xs.format(minX)}</text><text x={left+223} y="178" fontSize="11" textAnchor="end">{xs.format(maxX)}</text><text x={left+110} y="204" fontSize="12" textAnchor="middle">{data.xLabel} ({xs.unit})</text><text x={left-4} y="40" fontSize="10" textAnchor="end">{ys.format(maxY)}</text><text x={left-4} y="160" fontSize="10" textAnchor="end">{ys.format(minY)}</text><path d={path} fill="none" stroke="#3478f6" strokeWidth="2"/>{valid.map((s,i)=><circle key={i} cx={x(s.x)} cy={y(s.y!)} r="3" fill="#3478f6"><title>{`${formatQuantity(s.x,data.xUnit,quantityFormatFor(xProperties))}: ${formatQuantity(s.y??undefined,data.yUnit,quantityFormatFor(yProperties))}`}</title></circle>)}</svg></div>{valid.length < data.samples.length && <p className="tiny-note">계산할 수 없는 지점 {data.samples.length-valid.length}곳은 비워 두었어요.</p>}<details className="sweep-values"><summary>값 보기</summary><table><thead><tr><th>{data.xLabel} ({xs.unit})</th><th>{data.yLabel} ({ys.unit})</th></tr></thead><tbody>{data.samples.map((s,i)=><tr key={i}><td>{xs.format(s.x)}</td><td>{ys.format(s.y??undefined)}</td></tr>)}</tbody></table></details></>;
}
function SourceIsolationHint() {
  const [open,setOpen]=useState(false),id=useId();
  return <span className="source-isolation-hint" onPointerEnter={e=>{if(e.pointerType==='mouse')setOpen(true);}} onPointerLeave={()=>setOpen(false)}>
    <button type="button" className="measure-icon-button" aria-label="전원 분리 안내" aria-describedby={open?id:undefined} onFocus={()=>setOpen(true)} onBlur={()=>setOpen(false)} onClick={()=>setOpen(true)} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setOpen(false);}}}><Unplug size={18}/></button>
    {open&&<span id={id} role="tooltip">실제 저항계는 전원을 분리한 회로에 작은 시험 신호를 보내 저항을 측정해요.</span>}
  </span>;
}
export function MeasurementPanel(props: Props) {
  const { document: doc, compilation, result, red, black } = props;
  const { kind, onKind: setKind, branchId, onBranch: setBranchId } = props;
  const sweepDetails=useRef<HTMLDetailsElement>(null);
  const [showSweep,setShowSweep]=useState(false);
  const [showNotebook,setShowNotebook]=useState(false);

  const [prediction, setPrediction] = useState(''); const [condition, setCondition] = useState('');
  const [records, setRecords] = useState<MeasurementRecord[]>([]); const [message,setMessage] = useState('');
  const [loopIndex,setLoopIndex] = useState(0);
  const [variableId,setVariableId] = useState(''); const [sweepStart,setSweepStart] = useState(1); const [sweepEnd,setSweepEnd] = useState(20);
  const [sweepKind,setSweepKind] = useState<'branch-current'|'component-voltage'|'component-power'>('branch-current');
  const [sweep,setSweep] = useState<ParameterSweepResult|null>(null);
  const [sweepFormats,setSweepFormats]=useState<{x?:Record<string,string|number|boolean>;y?:Record<string,string|number|boolean>}>({});
  const endpoints = [...doc.components.flatMap(c=>c.terminals.map(t=>({kind:'terminal' as const,id:t.id}))), ...doc.junctions.map(j=>({kind:'junction' as const,id:j.id}))];
  const ref = (id: string): EndpointRef|null => endpoints.find(e=>e.id===id)??null;
  const voltage = probeVoltage(compilation,result,ref(red),ref(black));
  const branch = doc.components.find(c=>c.id===branchId) ?? doc.components.find(c=>c.type==='resistor') ?? doc.components[0];
  const redNet=compilation.circuit.endpointToNet[red],blackNet=compilation.circuit.endpointToNet[black];
  const excluded=compilation.circuit.elements.filter(e=>e.type==='dc-voltage-source').map(e=>e.id);
  const resistance=redNet&&blackNet&&!compilation.diagnostics.some(d=>d.severity==='error') ? equivalentResistance(compilation.circuit,redNet,blackNet,{excludeSourceIds:excluded}) : null;
  const loops=suggestPaths(compilation.circuit);const loop=loops[loopIndex]??loops[0];
  const current=props.currentReading.ok?Math.abs(props.currentReading.value.amperes):undefined;
  const measuredTarget=props.anchors.current;
  const targetName=anchorName(doc,measuredTarget);
  const reading=kind==='voltage'?(voltage.ok?voltage.value.voltageV:undefined):kind==='current'?current:resistance?.ohms;
  const unit=kind==='voltage'?'V':kind==='current'?'A':'Ω';
  const variables=doc.components.filter(c=>c.type==='resistor'||c.type==='resistive-load'||c.type==='dc-voltage-source');
  const variable=variables.find(c=>c.id===variableId)??variables[0];
  function record() {
    if(reading===undefined||!Number.isFinite(reading)){setMessage('측정 위치를 먼저 골라 주세요.');return;}
    const saved=createMeasurementRecord(doc,{condition: `${condition||doc.title} · ${kind==='resistance'?`모든 전원 분리${excluded.length?' ('+excluded.map(id=>doc.components.find(c=>c.id===id)?.label??id).join(', ')+')':''}`:kind==='current'?`전류 · ${targetName}${props.currentReading.ok?' · '+endpointName(doc,props.currentReading.value.from.id)+' → '+endpointName(doc,props.currentReading.value.to.id):''}`:'빨강−검정'}${prediction?` · 예측: ${prediction}`:''}`,source:'simulation',quantity:kind,value:kind==='current'&&props.currentReading.ok?props.currentReading.value.amperes:reading,unit,targetIds:kind==='current'?[measuredTarget!.id]:[red,black],recordedAt:new Date().toISOString()});
    if(saved.ok){setRecords(r=>[...r,saved.value]);setShowNotebook(true);setMessage('측정값을 기록했어요.');}else setMessage('기록 형식을 확인하세요.');
  }
  const connected = kind==='current' ? reading!==undefined : Boolean(ref(red)&&ref(black));
  const ready = reading!==undefined && Number.isFinite(reading);
  const diagnostics=kind==='voltage'?(connected&&!voltage.ok?voltage.diagnostics:[]):kind==='resistance'?(resistance?.diagnostics??[]):measuredTarget&&!props.currentReading.ok?props.currentReading.diagnostics:[];
  return <section className={`measurement-panel${showNotebook?' notebook-open':''}`} aria-label="측정 작업 공간">
    <header className="measure-header">
      <div className="measure-tools" aria-label="측정 도구">{(['voltage','current','resistance'] as const).map(k=><button key={k} aria-pressed={kind===k} className={kind===k?'active':''} onClick={()=>setKind(k)}><span>{k==='voltage'?'V':k==='current'?'A':'Ω'}</span>{k==='voltage'?'전압':k==='current'?'전류':'등가저항'}</button>)}</div>
      <button className="sweep-entry" onClick={()=>{setShowNotebook(true);setShowSweep(true);window.setTimeout(()=>sweepDetails.current?.scrollIntoView({block:'nearest'}),0);}}>값 바꿔 보기</button><button className="notebook-toggle" aria-expanded={showNotebook} aria-controls="measurement-notebook" onClick={()=>setShowNotebook(value=>!value)}><NotebookPen size={16}/>기록 {records.length}</button>{props.toolbarEnd}
    </header>
    <div className="measure-console">
      <div className="measure-connections">
        {kind!=='current'?<div className="probe-pair">{(['red','black'] as const).map(color=>{
          const name=color==='red'?'빨강':'검정',attached=Boolean(ref(color==='red'?red:black));
          return <button key={color} className={`probe-choice probe-${color}${props.activeProbe===color?' is-active':''}`} aria-label={`${name} 탐침`} aria-pressed={props.activeProbe===color} onClick={()=>props.onActiveProbe(color)} title={anchorName(doc,props.anchors[color])||`${name} 탐침 놓기`}><svg width="28" height="44" viewBox="-14 -46 28 50" aria-hidden="true"><ProbeGlyph color={color}/></svg><span>{name}</span><i className={attached?'attached':''} aria-label={attached?'연결됨':'연결 안 됨'}/></button>;
        })}<button className="measure-icon-button" aria-label="두 탐침 맞바꾸기" title="두 탐침 맞바꾸기" onClick={props.onSwap}><ArrowLeftRight size={17}/></button></div>:<div className="current-tool"><svg width="36" height="48" viewBox="-18 -39 36 54" aria-hidden="true"><CurrentGlyph/></svg><span>{measuredTarget?<Notation symbol={measuredTarget.kind==='component'} text={measuredTarget.kind==='component'?targetName:'도선 전류'}/>: '전류 센서'}</span></div>}
        <button className="measure-icon-button" aria-label="측정 위치 지우기" title="측정 위치 지우기" onClick={props.onReset}><RotateCcw size={16}/></button>
        {kind==='resistance'&&excluded.length>0&&<SourceIsolationHint/>}
      </div>
      <div className={`measure-result${ready?' ready':''}`}><output aria-label="측정값" aria-live="polite">{kind==='resistance'&&resistance?.status==='open'?'∞ Ω':formatQuantity(reading,unit,quantityFormatForTargets(doc,kind==='current'?[measuredTarget?.id??'']:[red,black]))}</output><button className="record-reading" aria-label="측정값 기록" title="측정값 기록" disabled={!ready} onClick={record}><Plus size={15}/>기록</button></div>
      {diagnostics.length>0&&<div className="measure-diagnostics" role="status"><Diagnostics items={diagnostics}/></div>}
    </div>
    <div className="measure-circuit">{props.children}</div>
    <aside id="measurement-notebook" hidden={!showNotebook} className="measure-notebook" aria-label="실험 기록"><div className="notebook-heading"><h3>실험 기록</h3><span>{records.length}</span></div>
    {message&&<p role="status" className="tiny-note">{message}</p>}
    <details className="measurement-details record-condition"><summary>예상값 · 메모</summary><label className="field-label">예상값<input aria-label="예상한 측정값" value={prediction} onChange={e=>setPrediction(e.target.value)} placeholder="예측값"/></label><label className="field-label">메모<input aria-label="기록 조건" value={condition} onChange={e=>setCondition(e.target.value)} placeholder="기록에 남길 메모"/></label></details>
    <details className="measurement-details" open><summary>측정 기록 ({records.length})</summary><div className="record-scroll">{records.length===0&&<p className="records-empty">측정값 옆의 ‘기록’을 눌러 남겨보세요.</p>}<table hidden={records.length===0}><thead><tr><th>메모</th><th>값</th></tr></thead><tbody>{records.map((r,i)=><tr key={i}><td><Notation text={r.condition}/>{r.recordedAt&&<small>{new Date(r.recordedAt).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</small>}</td><td>{formatQuantity(r.value??undefined,r.unit,quantityFormatForTargets(r.documentSnapshot,r.targetIds))}</td></tr>)}</tbody></table></div>{records.length>0&&<><p className="record-retention">창을 닫기 전에 기록을 저장하세요.</p><div className="record-actions"><button className="primary" onClick={()=>{const csv=measurementsToCsv(records);if(csv.ok)saveBlob(new Blob(['\uFEFF'+csv.value],{type:'text/csv;charset=utf-8'}),'회로-측정기록.csv');else setMessage('CSV를 만들 수 없습니다.');}}>기록 저장 (CSV)</button><button onClick={()=>setRecords([])}>기록 비우기</button></div></>}</details>
    <details className="measurement-details"><summary>전류·전압의 합 확인</summary><h4>전류의 합</h4><p className="tiny-note">빨강 탐침이 놓인 곳에서 나가는 전류는 +, 들어오는 전류는 −</p>{redNet?<Conservation document={doc} value={checkKcl(compilation.circuit,result,redNet)} unit="A"/>:<p className="tiny-note">빨강 탐침 위치를 선택하세요.</p>}<h4>한 바퀴의 전압 합</h4><select aria-label="전압을 더할 경로" value={loopIndex} onChange={e=>setLoopIndex(Number(e.target.value))}>{loops.map((p,i)=><option key={p.id} value={i}>{p.steps.map(s=>doc.components.find(c=>c.id===s.elementId)?.label??s.elementId).join(' → ')}</option>)}</select>{loop?<Conservation document={doc} value={checkKvl(compilation.circuit,result,loop.steps)} unit="V"/>:<p className="tiny-note">전원을 지나 다시 돌아오는 경로가 없어요.</p>}</details>
    <details ref={sweepDetails} open={showSweep} onToggle={e=>setShowSweep(e.currentTarget.open)} className="measurement-details"><summary>값 바꿔 보기</summary><p className="tiny-note">값을 조금씩 바꾸면 어떤 변화가 생길까요?</p><label className="field-label">바꿀 값<select value={variable?.id??''} onChange={e=>setVariableId(e.target.value)}>{variables.map(c=><option value={c.id} key={c.id}>{c.label} ({c.type==='dc-voltage-source'?'V':'Ω'})</option>)}</select></label><div className="range-inputs"><label>시작<QuantityInput label="실험 시작값" unit={variable?.type==='dc-voltage-source'?'V':'Ω'} value={sweepStart} onChange={setSweepStart}/></label><label>끝<QuantityInput label="실험 끝값" unit={variable?.type==='dc-voltage-source'?'V':'Ω'} value={sweepEnd} onChange={setSweepEnd}/></label></div><label className="field-label">살펴볼 부품<select aria-label="실험 관찰 부품" value={branch?.id??''} onChange={e=>setBranchId(e.target.value)}>{doc.components.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label><select aria-label="살펴볼 값" value={sweepKind} onChange={e=>setSweepKind(e.target.value as typeof sweepKind)}><option value="branch-current">전류 (A)</option><option value="component-voltage">전압 (V)</option><option value="component-power">전력 (W)</option></select><button className="wide-button" disabled={!variable||!branch} onClick={()=>{if(!variable||!branch)return;const computed=parameterSweep(doc,{componentId:variable.id,property:variable.type==='dc-voltage-source'?'voltageV':'resistanceOhm',values:Array.from({length:21},(_,i)=>sweepStart+(sweepEnd-sweepStart)*i/20),xLabel:variable.label,xUnit:variable.type==='dc-voltage-source'?'V':'Ω',yLabel:branch.label,quantity:{kind:sweepKind,componentId:branch.id}},circuitCompiler,dcEngine);if(computed.ok){setSweepFormats({x:{...variable.properties},y:{...branch.properties}});setSweep(computed.value);setMessage('그래프를 그렸어요.');}else{setSweep(null);setMessage('시작값과 끝값을 확인해 주세요. 저항은 0 이상이어야 해요.');}}}>그래프 그리기</button>{sweep&&<SweepGraph data={sweep} xProperties={sweepFormats.x} yProperties={sweepFormats.y}/>}</details>
    </aside>
  </section>;
}
