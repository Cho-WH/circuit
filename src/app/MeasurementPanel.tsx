import { useEffect, useMemo, useState } from 'react';
import type { CircuitDocument, CompileResult, EndpointRef, SimulationResult, Diagnostic } from '../domain';
import { circuitCompiler } from '../connectivity';
import { dcEngine, checkKcl, checkKvl, equivalentResistance, type ConservationResult } from '../simulation';
import { createComponent, formatQuantity } from '../component-library';
import { probeVoltage, insertSeriesAmmeter, parameterSweep, createMeasurementRecord, measurementsToCsv, type MeasurementRecord, type ParameterSweepResult } from '../measurement';
import { suggestPaths } from '../visualization';
import { diagnosticText } from './diagnostic-text';

interface Props {
  document: CircuitDocument; compilation: CompileResult; result: SimulationResult; active: boolean;
  red: string; black: string; activeProbe: 'red' | 'black';
  onProbes: (red: string, black: string) => void; onActiveProbe: (probe: 'red' | 'black') => void;
  onPreview: (document: CircuitDocument | null) => void;
}
function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type })); const a = window.document.createElement('a'); a.href = url; a.download = name; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Diagnostics({ items }: { items: Diagnostic[] }) { return <>{items.map((d, i) => <p className="tiny-note" key={i}>{diagnosticText[d.code]?.title ?? d.code} · {diagnosticText[d.code]?.action ?? '대상과 연결 상태를 확인하세요.'}</p>)}</>; }
function Conservation({ value, unit }: { value: ConservationResult; unit: string }) {
  return <div className="conservation"><p>{value.defined ? `${value.passes ? '일치' : '잔차 확인'} · 합 ${formatQuantity(value.sum, unit)}` : '측정할 수 없습니다'}</p>{value.defined && <><ul>{value.terms.map((t, i) => <li key={i}>{t.elementId}: {t.value >= 0 ? '+' : ''}{formatQuantity(t.value, unit)}</li>)}</ul><small>허용오차 {formatQuantity(value.tolerance, unit)}</small></>}<Diagnostics items={value.diagnostics}/></div>;
}
function SweepGraph({ data }: { data: ParameterSweepResult }) {
  const valid = data.samples.filter(s => s.y !== null); const minX = Math.min(...data.samples.map(s => s.x)), maxX = Math.max(...data.samples.map(s => s.x));
  const minY = Math.min(0, ...valid.map(s => s.y!)), maxY = Math.max(0, ...valid.map(s => s.y!));
  const x = (v: number) => 52 + 222 * (v - minX) / (maxX - minX || 1), y = (v: number) => 160 - 120 * (v - minY) / (maxY - minY || 1);
  let path = '', connected = false; for (const s of data.samples) { if (s.y === null) { connected = false; continue; } path += `${connected ? 'L' : 'M'}${x(s.x)} ${y(s.y)} `; connected = true; }
  return <><svg className="sweep-graph" viewBox="0 0 300 212" role="img" aria-label={`${data.xLabel} (${data.xUnit})에 따른 ${data.yLabel} (${data.yUnit})`}><path d="M52 32V160H282" fill="none" stroke="#8998aa"/><text x="12" y="20" fontSize="12">{data.yLabel} ({data.yUnit})</text><text x="52" y="178" fontSize="11">{formatQuantity(minX,data.xUnit)}</text><text x="275" y="178" fontSize="11" textAnchor="end">{formatQuantity(maxX,data.xUnit)}</text><text x="160" y="204" fontSize="12" textAnchor="middle">{data.xLabel} ({data.xUnit})</text><text x="48" y="40" fontSize="10" textAnchor="end">{formatQuantity(maxY,data.yUnit)}</text><text x="48" y="160" fontSize="10" textAnchor="end">{formatQuantity(minY,data.yUnit)}</text><path d={path} fill="none" stroke="#3478f6" strokeWidth="2"/>{valid.map((s,i)=><circle key={i} cx={x(s.x)} cy={y(s.y!)} r="3" fill="#3478f6"><title>{s.x} {data.xUnit}: {s.y} {data.yUnit}</title></circle>)}</svg>{valid.length < data.samples.length && <p className="tiny-note">해석할 수 없는 표본 {data.samples.length-valid.length}개는 선으로 연결하지 않았습니다.</p>}<details><summary>그래프 수치 표</summary><table><thead><tr><th>{data.xLabel} ({data.xUnit})</th><th>{data.yLabel} ({data.yUnit})</th></tr></thead><tbody>{data.samples.map((s,i)=><tr key={i}><td>{s.x}</td><td>{s.y===null?'미정':s.y.toPrecision(5)}</td></tr>)}</tbody></table></details></>;
}
export function MeasurementPanel(props: Props) {
  const { document: doc, compilation, result, red, black } = props;
  const [kind, setKind] = useState<'voltage'|'current'|'resistance'>('voltage');
  const [branchId, setBranchId] = useState(''); const [insertedView, setInsertedView] = useState(true);
  const [resistanceMode, setResistanceMode] = useState<'load'|'whole'>('load');
  const [prediction, setPrediction] = useState(''); const [condition, setCondition] = useState('');
  const [records, setRecords] = useState<MeasurementRecord[]>([]); const [message,setMessage] = useState('');
  const [loopIndex,setLoopIndex] = useState(0);
  const [variableId,setVariableId] = useState(''); const [sweepStart,setSweepStart] = useState(1); const [sweepEnd,setSweepEnd] = useState(20);
  const [sweepKind,setSweepKind] = useState<'branch-current'|'component-voltage'|'component-power'>('branch-current');
  const [sweep,setSweep] = useState<ParameterSweepResult|null>(null);
  const endpoints = [...doc.components.flatMap(c=>c.terminals.map(t=>({kind:'terminal' as const,id:t.id}))), ...doc.junctions.map(j=>({kind:'junction' as const,id:j.id}))];
  const ref = (id: string): EndpointRef|null => endpoints.find(e=>e.id===id)??null;
  const voltage = probeVoltage(compilation,result,ref(red),ref(black));
  const branch = doc.components.find(c=>c.id===branchId) ?? doc.components.find(c=>c.type==='resistor') ?? doc.components[0];
  const insertion = useMemo(()=>{
    if (!branch) return null;
    const all = new Set([...doc.components,...doc.components.flatMap(c=>c.terminals),...doc.wires,...doc.junctions,...doc.annotations].map(x=>x.id));
    let id='__meter'; while ([id,id+'.a',id+'.b',id+'.wire'].some(x=>all.has(x))) id+='_';
    const meter=createComponent('ammeter',id,{x:branch.position.x-130,y:branch.position.y+100}); meter.label='A (임시)';
    return insertSeriesAmmeter(doc,{componentId:branch.id,ammeter:meter,newWireId:id+'.wire'});
  },[doc,branch]);
  const inserted = useMemo(()=>{
    if (!insertion?.ok) return null; const c=circuitCompiler.compile(insertion.value.document);
    return c.diagnostics.some(d=>d.severity==='error') ? null : dcEngine.solve(c.circuit);
  },[insertion]);
  useEffect(()=>{ props.onPreview(props.active&&kind==='current'&&insertedView&&insertion?.ok ? insertion.value.document : null); },[props.active,props.onPreview,kind,insertedView,insertion]);
  const redNet=compilation.circuit.endpointToNet[red],blackNet=compilation.circuit.endpointToNet[black];
  const excluded=compilation.circuit.elements.filter(e=>e.type==='dc-voltage-source'&&((e.a===redNet&&e.b===blackNet)||(e.a===blackNet&&e.b===redNet))).map(e=>e.id);
  const resistance=redNet&&blackNet&&!compilation.diagnostics.some(d=>d.severity==='error') ? equivalentResistance(compilation.circuit,redNet,blackNet,{excludeSourceIds:resistanceMode==='load'?excluded:[]}) : null;
  const loops=suggestPaths(compilation.circuit);const loop=loops[loopIndex]??loops[0];
  const current=insertion?.ok&&inserted?.status!=='error' ? inserted?.branchCurrents[insertion.value.ammeterId] : undefined;
  const reading=kind==='voltage'?(voltage.ok?voltage.value.voltageV:undefined):kind==='current'?current:resistance?.ohms;
  const unit=kind==='voltage'?'V':kind==='current'?'A':'Ω';
  const variables=doc.components.filter(c=>c.type==='resistor'||c.type==='resistive-load'||c.type==='dc-voltage-source');
  const variable=variables.find(c=>c.id===variableId)??variables[0];
  function record() {
    if(reading===undefined||!Number.isFinite(reading)){setMessage('확정된 측정값을 먼저 얻으세요.');return;}
    const saved=createMeasurementRecord(doc,{condition: `${condition||doc.title} · ${kind==='resistance'?(resistanceMode==='load'?`부하, 분리 전원 ${excluded.join(',')||'없음'}`:'전체 회로'):kind==='current'?`임시 직렬 전류계 ${branch?.id}`:'빨강−검정'}${prediction?` · 예측: ${prediction}`:''}`,source:'simulation',quantity:kind,value:reading,unit,targetIds:kind==='current'?[branch!.id]:[red,black],recordedAt:new Date().toISOString()});
    if(saved.ok){setRecords(r=>[...r,saved.value]);setMessage('현재 회로 조건과 측정값을 기록했습니다.');}else setMessage('기록 형식을 확인하세요.');
  }
  return <section className="measurement-panel"><h3>측정기 연결</h3><div className="segmented measurement-kinds">{(['voltage','current','resistance'] as const).map(k=><button key={k} className={kind===k?'active':''} onClick={()=>setKind(k)}>{k==='voltage'?'전압':k==='current'?'전류':'등가저항'}</button>)}</div>
    {kind!=='current'?<><p className="tiny-note">탐침을 고른 뒤 단자·분기점을 누르거나 목록에서 선택하세요.</p>{(['red','black'] as const).map(color=><label className={`field-label probe-${color}`} key={color}><button className={props.activeProbe===color?'active':''} onClick={()=>props.onActiveProbe(color)}>{color==='red'?'빨강 (+)':'검정 (−)'} 탐침</button><select aria-label={`${color==='red'?'빨강':'검정'} 탐침 위치`} value={endpoints.some(e=>e.id===(color==='red'?red:black))?(color==='red'?red:black):''} onChange={e=>props.onProbes(color==='red'?e.target.value:red,color==='black'?e.target.value:black)}><option value="">미연결</option>{endpoints.map(e=><option key={e.id}>{e.id}</option>)}</select></label>)}<button className="wide-button" onClick={()=>props.onProbes(black,red)}>탐침 순서 바꾸기</button></>:<><label className="field-label">전류를 측정할 가지<select aria-label="전류 측정 가지" value={branch?.id??''} onChange={e=>setBranchId(e.target.value)}>{doc.components.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label><div className="segmented"><button className={!insertedView?'active':''} onClick={()=>setInsertedView(false)}>원본 연결</button><button className={insertedView?'active':''} onClick={()=>setInsertedView(true)}>전류계 삽입 후</button></div><p className="tiny-note">{insertion?.ok?`${insertion.value.terminalId} 앞에 이상적인 0 Ω 전류계를 직렬로 삽입합니다. 계기 a→b 방향. 원본은 저장·변경하지 않습니다.`:'측정할 부품을 선택하세요.'}</p>{insertion&&!insertion.ok&&<Diagnostics items={insertion.diagnostics}/>}<Diagnostics items={inserted?.diagnostics??[]}/></>}
    {kind==='resistance'&&<><label className="field-label">측정 대상<select value={resistanceMode} onChange={e=>setResistanceMode(e.target.value as 'load'|'whole')}><option value="load">부하 · 포트 전원 분리</option><option value="whole">전체 회로 · 전원 0 V 치환</option></select></label><p className="tiny-note">{resistanceMode==='load'?`분리한 외부 전원: ${excluded.join(', ')||'없음'}`:'모든 독립 전압원을 0 V로 치환합니다.'} · 1 V 시험 전원으로 계산</p></>}
    <output className="meter-display" aria-label="측정값">{kind==='resistance'&&resistance?.status==='open'?'개방 · ∞ Ω':formatQuantity(reading,unit)}</output>
    {kind==='voltage'&&<><p className="tiny-note">V빨강 − V검정{redNet&&redNet===blackNet?' · 같은 절점이므로 전위차 0 V':''}</p>{!voltage.ok&&<Diagnostics items={voltage.diagnostics}/>}</>}{kind==='resistance'&&<Diagnostics items={resistance?.diagnostics??[]}/>}
    <label className="field-label">측정 전 예측<input aria-label="측정 전 예측" value={prediction} onChange={e=>setPrediction(e.target.value)} placeholder="예: 빨강 쪽이 3 V 높다"/></label><label className="field-label">기록 조건<input aria-label="기록 조건" value={condition} onChange={e=>setCondition(e.target.value)} placeholder="예: 저항값을 바꾸기 전"/></label><button className="primary wide-button" onClick={record}>측정값 기록</button>{message&&<p role="status" className="tiny-note">{message}</p>}
    <details className="measurement-details"><summary>측정 기록 ({records.length})</summary><div className="record-scroll"><table><thead><tr><th>조건</th><th>값</th></tr></thead><tbody>{records.map((r,i)=><tr key={i}><td>{r.condition}<small>{r.recordedAt}</small></td><td>{formatQuantity(r.value??undefined,r.unit)}</td></tr>)}</tbody></table></div><button className="wide-button" disabled={!records.length} onClick={()=>{const csv=measurementsToCsv(records);if(csv.ok)download('\uFEFF'+csv.value,'회로-측정기록.csv','text/csv;charset=utf-8');else setMessage('CSV를 만들 수 없습니다.');}}>CSV 저장 · 단위와 회로 조건 포함</button><button disabled={!records.length} onClick={()=>setRecords([])}>기록 비우기</button></details>
    <details className="measurement-details"><summary>KCL · KVL 확인</summary><h4>KCL: 빨강 탐침 절점</h4><p className="tiny-note">나가는 전류 (+), 들어오는 전류 (−)</p>{redNet?<Conservation value={checkKcl(compilation.circuit,result,redNet)} unit="A"/>:<p className="tiny-note">빨강 탐침 위치를 선택하세요.</p>}<h4>KVL: 폐경로의 전위 변화</h4><select aria-label="KVL 경로" value={loopIndex} onChange={e=>setLoopIndex(Number(e.target.value))}>{loops.map((p,i)=><option key={p.id} value={i}>{p.label}</option>)}</select>{loop?<Conservation value={checkKvl(compilation.circuit,result,loop.steps)} unit="V"/>:<p className="tiny-note">전원을 포함한 폐경로가 없습니다.</p>}</details>
    <details className="measurement-details"><summary>값 변화 실험</summary><p className="tiny-note">원본을 바꾸지 않고 21개 조건에서 계산합니다. 그래프는 실행 당시 조건을 유지합니다.</p><label className="field-label">x축: 바꿀 부품<select value={variable?.id??''} onChange={e=>setVariableId(e.target.value)}>{variables.map(c=><option value={c.id} key={c.id}>{c.label} ({c.type==='dc-voltage-source'?'V':'Ω'})</option>)}</select></label><div className="range-inputs"><label>시작<input aria-label="실험 시작값" type="number" value={sweepStart} onChange={e=>setSweepStart(e.target.valueAsNumber)}/></label><label>끝<input aria-label="실험 끝값" type="number" value={sweepEnd} onChange={e=>setSweepEnd(e.target.valueAsNumber)}/></label></div><label className="field-label">y축: 관찰할 부품<select aria-label="실험 관찰 부품" value={branch?.id??''} onChange={e=>setBranchId(e.target.value)}>{doc.components.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label><select aria-label="실험 관찰 물리량" value={sweepKind} onChange={e=>setSweepKind(e.target.value as typeof sweepKind)}><option value="branch-current">가지 전류 (A)</option><option value="component-voltage">양단 전압 (V)</option><option value="component-power">전력 (W)</option></select><button className="wide-button" disabled={!variable||!branch} onClick={()=>{if(!variable||!branch)return;const computed=parameterSweep(doc,{componentId:variable.id,property:variable.type==='dc-voltage-source'?'voltageV':'resistanceOhm',values:Array.from({length:21},(_,i)=>sweepStart+(sweepEnd-sweepStart)*i/20),xLabel:variable.label,xUnit:variable.type==='dc-voltage-source'?'V':'Ω',yLabel:branch.label,quantity:{kind:sweepKind,componentId:branch.id}},circuitCompiler,dcEngine);if(computed.ok){setSweep(computed.value);setMessage('값 변화 실험을 완료했습니다.');}else{setSweep(null);setMessage('실험 범위를 확인하세요. 유한한 전압·0 이상 저항을 입력하세요.');}}}>실험 실행</button>{sweep&&<SweepGraph data={sweep}/>}</details>
    <div className="library-divider"/>
  </section>;
}
