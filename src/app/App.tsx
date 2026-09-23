import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Zap, MousePointer2, Cable, Hand, RotateCw, Trash2, Undo2, Redo2, Copy, ClipboardPaste, Plus, Download, FolderOpen, Save, X, CircleHelp, AlignHorizontalJustifyCenter, Crosshair, ChevronRight, SlidersHorizontal, CircuitBoard, MessageCircle } from 'lucide-react';
import { cloneDocument, emptyDocument, type CircuitDocument, type ComponentType, type EndpointRef, type Point } from '../domain';
import { componentDefinitions, componentValue, componentValueInput, createComponent, symbolMarkup, formatQuantity, endpointName } from '../component-library';
import { createHistory, executeCommand, executeCommands, undo, redo, copySelection, type Command, type PastePayload } from '../editor';
import { loadLocal, saveLocal, parseDocument, serializeDocument } from '../persistence';
import { examples } from '../fixtures';
import { analyze } from './analyze';
import { diagnosticText } from './diagnostic-text';
import { layoutExample } from './examples';
import { CircuitCanvas } from './CircuitCanvas';
import { buildPotentialModel, makePath, potentialColor, potentialColorStops, suggestPaths } from '../visualization';
import { PotentialGraph } from './PotentialGraph';
import { MeasurementPanel } from './MeasurementPanel';
import { WorksheetPanel } from './WorksheetPanel';
import { OutputCanvas, type OutputTool } from './OutputCanvas';
import type { ExportOptions } from '../export';
import { parseQuantity } from '../notation';
import { Notation, QuantityInput } from './Notation';
import { useDialogFocus } from './useDialogFocus';
import './styles.css';
import './ux.css';
const Potential3D = lazy(() => import('../potential-3d').then(module => ({ default: module.Potential3D })));
const FeedbackFeature = lazy(() => import('./FeedbackBoard'));

function GroundIcon({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 3V12 M2 12H22 M6 16H18 M10 20H14"/></svg>;
}

type Mode = 'build' | 'measure' | 'potential' | 'worksheet';
export function App() {
  const [history, setHistory] = useState(() => { const saved = loadLocal(); return createHistory(saved?.ok ? saved.document : layoutExample(examples[1].document)); });
  const doc = history.present;
  const [selected, setSelected] = useState<string[]>([]);
  const [tool, setTool] = useState('select');
  const [placement, setPlacement] = useState<ComponentType | null>(null);
  const [wiringResetKey, setWiringResetKey] = useState(0);
  const [mode, setMode] = useState<Mode>('build');
  const [notice, setNotice] = useState('');
  const [saveStatus, setSaveStatus] = useState('저장 준비');
  const [clipboard, setClipboard] = useState<PastePayload | null>(null);
  const [valueDraft, setValueDraft] = useState('');
  const [help, setHelp] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [potentialView, setPotentialView] = useState<'2d' | '3d'>('2d');
  const [showGraph, setShowGraph] = useState(false);
  const [detailsOpen,setDetailsOpen]=useState(false);
  const [focusIds,setFocusIds]=useState<string[]>([]);
  const [showNumbers, setShowNumbers] = useState(true);
  const [showColors, setShowColors] = useState(true);
  const [showCurrent, setShowCurrent] = useState(false);
  const [selectedNet, setSelectedNet] = useState<string | null>(null);
  const [fixedRange, setFixedRange] = useState(false);
  const [rangeMin, setRangeMin] = useState(0);
  const [rangeMax, setRangeMax] = useState(12);
  const [heightScale, setHeightScale] = useState(18);
  const [activePath, setActivePath] = useState(0);
  const [customPathIds, setCustomPathIds] = useState<string[]>([]);
  const [outputFontPreview, setOutputFontPreview] = useState<number|null>(null);
  const [outputTool, setOutputTool] = useState<OutputTool>('select');
  const [outputOptions, setOutputOptions] = useState<ExportOptions>({background:'white',highResolution:false});
  const [presentation, setPresentation] = useState(false);
  const [redProbe, setRedProbe] = useState('');
  const [blackProbe, setBlackProbe] = useState('');
  const [activeProbe, setActiveProbe] = useState<'red'|'black'>('red');
  const [measurementKind, setMeasurementKind] = useState<'voltage'|'current'|'resistance'>('voltage');
  const [measurementBranch, setMeasurementBranch] = useState('');
  const [measurementPreview, setMeasurementPreview] = useState<CircuitDocument|null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const valueInput = useRef<HTMLInputElement>(null);
  const idCounter = useRef(1);
  const helpDialog=useDialogFocus(help,()=>setHelp(false));
  const { compilation, result } = useMemo(() => analyze(doc), [doc]);
  const potential = useMemo(() => buildPotentialModel(doc, compilation.circuit, result, { scale: heightScale, ...(fixedRange ? { range: { min: rangeMin, max: rangeMax } } : {}) }), [doc, compilation, result, heightScale, fixedRange, rangeMin, rangeMax]);
  const paths = useMemo(() => suggestPaths(compilation.circuit), [compilation]);
  const path = customPathIds.length ? makePath(compilation.circuit, customPathIds) : paths[activePath] ?? paths[0] ?? null;
  const component = doc.components.find(c => c.id === selected[0]);
  const definition = component ? componentDefinitions[component.type] : null;
  function newId(prefix: string) {
    const all = new Set([...doc.components, ...doc.components.flatMap(c => c.terminals), ...doc.wires, ...doc.junctions, ...doc.annotations].map(x => x.id));
    let id: string; do { id = `${prefix}${idCounter.current++}`; } while (all.has(id)); return id;
  }
  function dispatch(command: Command) {
    if (mode === 'measure' && command.type !== 'ReplaceDocument') return false;
    if (mode === 'worksheet' && command.type !== 'ReplaceDocument') {
      if (!['SetProperties','SetOutputScale','AddAnnotation','UpdateAnnotation','DeleteElements'].includes(command.type)) return false;
      if (command.type === 'SetProperties' && Object.keys(command.properties).some(key=>! /^(label|answer|voltage|current)(Text|Display|Visible|Blank|OffsetX|OffsetY)$/.test(key))) return false;
      if (command.type === 'DeleteElements' && command.ids.some(id=>!doc.annotations.some(a=>a.id===id))) return false;
    }
    const applied = executeCommand(history, command);
    if (!applied.ok) { setNotice(applied.diagnostics.map(d => diagnosticText[d.code]?.title ?? `변경할 수 없습니다 (${d.code})`).join(' · ')); return false; }
    setHistory(applied.history); return true;
  }
  useEffect(() => {
    setSaveStatus('회로 저장 중…');
    const timer = window.setTimeout(() => { const saved = saveLocal(doc); setSaveStatus(saved.ok ? '회로 자동 저장됨 · 이 브라우저' : '저장 실패 · JSON으로 저장하세요'); }, 450);
    return () => window.clearTimeout(timer);
  }, [doc]);
  useEffect(() => {
    if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 6000); return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => { setValueDraft(component && definition?.property ? componentValueInput(component) : ''); }, [component?.id, component?.properties, definition?.property]);
  function copy() {
    if (!selected.length) return;
    setClipboard(copySelection(doc, selected, newId, { x: 40, y: 40 })); setNotice('선택한 요소를 복사했습니다. 붙여넣기로 새 회로 요소를 만드세요.');
  }
  function paste() {
    if (!clipboard) return;
    const temporary = { ...emptyDocument(), ...clipboard };
    const payload = copySelection(temporary, [...clipboard.components, ...clipboard.junctions, ...clipboard.wires].map(x => x.id), newId, { x: 20, y: 20 });
    if (dispatch({ type: 'Paste', ...payload })) { setSelected(payload.components.map(c => c.id)); setClipboard(payload); }
  }
  function remove() { if (dispatch({ type: 'DeleteElements', ids: selected })) setSelected([]); }
  function cancelTool() { setOutputFontPreview(null); setOutputTool('select'); setPlacement(null); setTool('select'); setWiringResetKey(key=>key+1); }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (feedbackOpen) return;
      if ((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) return;
      if (mode === 'measure') return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); setHistory(h => event.shiftKey ? redo(h) : undo(h)); }
      else if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); setHistory(h => redo(h)); }
      else if (mode === 'worksheet') {
        if(event.key==='Escape'){cancelTool();setSelected([]);}
        else if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();dispatch({type:'DeleteElements',ids:selected.filter(id=>doc.annotations.some(a=>a.id===id))});setSelected([]);}
        return;
      }
      else if (modifier && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelected(doc.components.map(c => c.id)); }
      else if (modifier && event.key.toLowerCase() === 'c') { event.preventDefault(); copy(); }
      else if (modifier && event.key.toLowerCase() === 'v') { event.preventDefault(); paste(); }
      else if (event.key === 'Escape') { cancelTool(); setSelected([]); }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(); }
      else if (event.key.toLowerCase() === 'r') dispatch({ type: 'RotateComponents', ids: selected });
      else if (event.key.toLowerCase() === 'w') { setPlacement(null); setTool('wire'); }
      else if (event.key.startsWith('Arrow') && selected.length) {
        event.preventDefault(); const step = event.shiftKey ? 100 : 20;
        dispatch({ type: 'MoveComponents', positions: Object.fromEntries(doc.components.filter(c => selected.includes(c.id)).map(c => [c.id, { x: c.position.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), y: c.position.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) }])) });
      }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  });
  function place(type: ComponentType, position: Point, target?: {wireId:string;segment:number}) {
    const c = createComponent(type, newId(componentDefinitions[type].short), position);
    const added = executeCommand(history, target ? {type:'InsertComponentOnWire',component:c,...target,newWireId:newId('W')} : { type: 'AddComponent', component: c });
    if (!added.ok) { setNotice('부품을 놓을 수 없습니다. 삽입 공간과 편집 권한을 확인하세요.'); return; }
    let next = added.history;
    if (!next.present.referenceNode && type === 'dc-voltage-source') {
      const ref = executeCommand(next, { type: 'SetReference', endpoint: { kind: 'terminal', id: c.terminals[1].id } }); if (ref.ok) next = { ...ref.history, past: added.history.past };
    }
    setHistory(next); setSelected([c.id]); cancelTool();
  }
  function endpoint(endpoint: EndpointRef) {
    if (tool === 'reference') { dispatch({ type: 'SetReference', endpoint }); cancelTool(); setNotice(`${endpoint.id}를 0 V 기준점으로 지정했습니다.`); return; }
    if (mode === 'measure') { if (measurementKind === 'current') return; if (activeProbe === 'red') { setRedProbe(endpoint.id); setActiveProbe('black'); } else setBlackProbe(endpoint.id); return; }
    if (mode === 'potential') { setSelectedNet(compilation.circuit.endpointToNet[endpoint.id]); return; }
  }
  function onWire(id: string) {
    if (mode === 'measure') { const wire=doc.wires.find(w=>w.id===id); if(wire && measurementKind !== 'current') endpoint(wire.start); return; }
    if (mode === 'potential') { const wire=doc.wires.find(w=>w.id===id); if(wire)setSelectedNet(compilation.circuit.endpointToNet[wire.start.id]); return; }
    setSelected([id]);
  }
  function commitWiring(commands: readonly Command[]) {
    if (mode !== 'build') return false;
    const applied = executeCommands(history, commands);
    if (!applied.ok) { setNotice(applied.diagnostics.map(d=>diagnosticText[d.code]?.title ?? '연결을 변경할 수 없습니다.').join(' · ')); return false; }
    setHistory(applied.history); return true;
  }
  function applyValue() {
    if (!component || !definition?.property) return;
    const parsed = parseQuantity(valueDraft, definition.unit);
    const value = parsed?.value ?? null;
    if (value === null || (definition.unit === 'Ω' && value < 0)) { setNotice(`유효한 값을 입력하세요. 예: ${definition.unit==='Ω'?'10, 1k, 1.5 kΩ':'9, 1.5 V'}. 이전 값은 유지됩니다.`); return; }
    dispatch({ type: 'SetProperties', id: component.id, properties: { [definition.property]: value, [definition.property+'Fraction']: parsed?.fraction??'' } });
  }
  function replace(document: CircuitDocument) { if (dispatch({ type: 'ReplaceDocument', document })) { setSelected([]); cancelTool(); setSelectedNet(null); setHovered(null); setCustomPathIds([]); setActivePath(0); } }
  function selectElement(id: string | null, additive?: boolean) {
    if (mode === 'measure') { if (id && measurementKind === 'current' && doc.components.some(c=>c.id===id)) setMeasurementBranch(id); return; }
    if (tool === 'path' && id) { setCustomPathIds(ids => [...ids, id]); setHovered(id); return; }
    if(mode==='worksheet'&&id)setDetailsOpen(true);
    setSelected(id === null ? [] : additive ? selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id] : [id]);
  }
  function downloadJson() {
    try {
      const data = serializeDocument(doc); const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const a = window.document.createElement('a'); a.href = url; a.download = `${doc.title || '회로'}.json`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      const saved = saveLocal(doc, 'manual'); setNotice(saved.ok ? 'JSON 파일과 복원 지점을 저장했습니다.' : 'JSON을 내려받았습니다. 브라우저 저장 공간을 확인하세요.');
    } catch { setNotice('문서를 저장하지 못했습니다. 회로 데이터 형식을 확인하세요.'); }
  }
  async function openFile(file?: File) {
    if (!file) return;
    try { const parsed = parseDocument(await file.text()); if (parsed.ok) { replace(parsed.document); setNotice('회로 파일을 열었습니다.'); } else setNotice('파일을 열지 못했습니다. edu-circuit v1 JSON과 연결 참조를 확인하세요. 현재 회로는 유지됩니다.'); }
    catch { setNotice('파일을 읽지 못했습니다. 다시 선택해 주세요.'); }
    if (fileInput.current) fileInput.current.value = '';
  }
  const shownDoc = mode === 'measure' && measurementPreview ? measurementPreview : doc;
  const source = doc.components.find(c => c.type === 'dc-voltage-source');
  const circuitCanvas = <CircuitCanvas document={shownDoc} largeLabels={presentation} probes={mode === 'measure' && measurementKind !== 'current' ? {red:redProbe,black:blackProbe} : undefined} readOnly={mode === 'measure'} onWiringCommit={mode==='build'?commitWiring:undefined} wiringResetKey={wiringResetKey} selected={mode === 'measure' ? measurementKind === 'current' ? [doc.components.find(c=>c.id===measurementBranch)?.id ?? doc.components.find(c=>c.type==='resistor')?.id ?? doc.components[0]?.id].filter((id):id is string=>Boolean(id)) : [] : selected} tool={mode === 'measure' && tool === 'select' ? 'probe' : tool} placement={placement} currentArrows={mode === 'potential' && showCurrent ? result.branchCurrents : undefined} endpointColors={mode === 'measure' ? measurementKind === 'current' ? undefined : { [redProbe]: '#dc4545', [blackProbe]: '#252f3c' } : mode === 'potential' && showColors ? Object.fromEntries(Object.entries(potential.endpoints).map(([id, v]) => [id, v.color])) : undefined} endpointGroups={compilation.circuit.endpointToNet} endpointLabels={mode === 'potential' && showNumbers ? Object.fromEntries(Object.entries(potential.endpoints).map(([id, v]) => [id, formatQuantity(v.voltage, 'V')])) : undefined} highlightedEndpoints={mode === 'potential' && selectedNet ? potential.nets[selectedNet]?.endpointIds : undefined} highlightedElements={mode !== 'measure' && hovered ? [hovered] : undefined} onHoverElement={setHovered} onSelect={selectElement} onMove={positions => dispatch({ type: 'MoveComponents', positions })} onPlace={place} onEndpoint={endpoint} onWire={onWire} focusIds={focusIds} onCancel={cancelTool} onCommitComponent={(id,edit)=>{
    const c=doc.components.find(c=>c.id===id);if(!c||mode!=='build')return false;
    const commands:Command[]=[];
    if(edit.label!==c.label)commands.push({type:'SetLabel',id,label:edit.label});
    const property=componentDefinitions[c.type].property;
    if(property&&edit.value!==undefined&&(edit.value!==c.properties[property]||(edit.fraction??'')!==(c.properties[property+'Fraction']??'')))commands.push({type:'SetProperties',id,properties:{[property]:edit.value,[property+'Fraction']:edit.fraction??''}});
    const applied=executeCommands(history,commands);if(!applied.ok)return false;
    setHistory(applied.history);return true;
  }} onAction={mode==='build'?action=>action==='rotate'?dispatch({type:'RotateComponents',ids:selected}):action==='copy'?copy():remove():undefined} onValue={id => { setSelected([id]); setDetailsOpen(true); window.setTimeout(() => valueInput.current?.focus(), 0); }} onSwitch={id => { const c = doc.components.find(x => x.id === id)!; dispatch({ type: 'SetProperties', id, properties: { state: c.properties.state === 'closed' ? 'open' : 'closed' } }); }} onBackground={()=>{}}/>;
  return <div className={`app-shell mode-${mode}${mode === 'potential' && potentialView === '3d' ? ' view-3d' : ''}${detailsOpen ? ' details-open' : ''}${presentation ? ' presentation' : ''}`}>
    <header className="topbar"><a className="brand" href="#" onClick={e => e.preventDefault()}><span className="brand-mark"><CircuitBoard size={23}/></span><span>회로 실험실<small>만들고 · 측정하고 · 설명하기</small></span></a>
      <div className="document-heading"><input readOnly={mode === 'measure'} aria-label="회로 제목" key={doc.documentId + doc.title} defaultValue={doc.title} onBlur={e => { if (e.target.value !== doc.title) replace({ ...cloneDocument(doc), title: e.target.value }); }} /><span><span className="status-dot"/>{saveStatus}</span></div>
      <div className="top-actions"><button onClick={() => setFeedbackOpen(true)} aria-label="사용 후기 및 피드백" title="사용 후기 및 피드백"><MessageCircle size={18}/>한마디</button><button onClick={() => setHelp(true)} aria-label="사용 도움말"><CircleHelp size={19}/></button><button onClick={() => fileInput.current?.click()}><FolderOpen size={17}/>열기</button><button onClick={downloadJson}><Download size={17}/>JSON 저장</button><button title="이 브라우저에 복원할 회로를 저장" aria-label="복원 지점 저장" onClick={() => { const saved = saveLocal(doc, 'manual'); setNotice(saved.ok ? '이 브라우저에 회로 복원 지점을 저장했습니다.' : saved.error); }}><Save size={16}/>복원 지점 저장</button></div>
      <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e => void openFile(e.target.files?.[0])}/>
    </header>
    {feedbackOpen && <Suspense fallback={<div role="status" className="toast">게시판을 여는 중…</div>}><FeedbackFeature onClose={() => setFeedbackOpen(false)}/></Suspense>}
    <nav className="modebar" aria-label="작업 모드"><div className="mode-tabs"><button aria-pressed={mode === 'build'} className={mode === 'build' ? 'active' : ''} onClick={() => { setMode('build'); cancelTool(); }}><MousePointer2 size={16}/>회로 만들기</button><button aria-pressed={mode === 'potential'} className={mode === 'potential' ? 'active' : ''} onClick={() => { setMode('potential'); cancelTool(); }}><Zap size={16}/>전위 보기</button><button aria-pressed={mode === 'measure'} className={mode === 'measure' ? 'active' : ''} onClick={() => { setMode('measure'); cancelTool(); setSelected([]); setHovered(null); }}><Crosshair size={16}/>측정하기</button><button aria-pressed={mode === 'worksheet'} className={mode === 'worksheet' ? 'active' : ''} onClick={() => { setMode('worksheet'); cancelTool(); }}><Copy size={16}/>회로도 출력</button></div><button className="presentation-toggle" onClick={()=>setPresentation(v=>!v)}>{presentation?'편집 화면':'수업 화면'}</button><div className="mode-meta"><span className="pill">DC</span>이상적인 직류 회로</div></nav>
    <div className="workspace">
      <aside className="library-panel" hidden={mode !== 'build'}><div className="section-heading"><h2>부품 라이브러리</h2><span>6</span></div><p className="muted">선택한 뒤 캔버스에 놓으세요</p>
        <div className="component-grid">{(Object.keys(componentDefinitions) as ComponentType[]).map(type => <button key={type} className={placement === type ? 'component-tile chosen' : 'component-tile'} aria-pressed={placement===type} draggable onDragStart={e => {e.dataTransfer.setData('component', type);setPlacement(type);setTool('select');setWiringResetKey(key=>key+1);}} onDragEnd={()=>setPlacement(null)} onClick={() => { setPlacement(type); setTool('select'); setWiringResetKey(key=>key+1); }}>
          <span className="tile-symbol"><svg width="62" height="32" viewBox="-50 -27 100 54" aria-hidden="true" stroke="currentColor" fill="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{__html:symbolMarkup(createComponent(type,'palette',{x:0,y:0}))}}/></span><span>{componentDefinitions[type].name}</span></button>)}</div>
        <div className="library-divider"/><div className="section-heading"><h2>시작하기</h2></div>
        <button className="wide-button" onClick={() => replace(emptyDocument(newId('circuit-')))}><Plus size={16}/>빈 회로 만들기</button>
        <label className="field-label">예제 회로<select aria-label="예제 회로" value={examples.some(x => x.document.documentId === doc.documentId) ? doc.documentId : ''} onChange={e => { const ex = examples.find(x => x.document.documentId === e.target.value); if (ex) replace(layoutExample(ex.document)); }}><option value="" disabled>예제 선택</option>{examples.map(example => <option key={example.id} value={example.document.documentId}>{example.title}</option>)}</select></label>
        <div className="lesson-card"><span>다음 행동</span><h3>{!doc.components.length?'부품을 놓아 시작하세요':!doc.wires.length?'단자를 눌러 연결하세요':'회로의 전위를 살펴보세요'}</h3><p>{!doc.wires.length?'첫 단자와 끝 단자를 차례로 누르면 도선이 생깁니다.':'전위 보기에서 같은 도선의 색과 높이를 비교할 수 있습니다.'}</p><button onClick={() => {setMode('potential');cancelTool();}}>회로 탐구 <ChevronRight size={15}/></button></div>
        <div className="library-bottom"><span className="status-dot"/>로그인 없이, 이 기기에 저장</div>
      </aside>
      <main className="canvas-column"><div className="workspace-actions" hidden={mode==='measure'}>{mode!=='build'&&<button onClick={()=>{setMode('build');cancelTool();}}>회로 편집</button>}<span>{mode==='build'?'부품을 놓고 단자를 연결하세요':mode==='potential'?'같은 도선은 같은 전위입니다':'표시할 값을 고르고 그림으로 복사하세요'}</span><button aria-expanded={detailsOpen} onClick={()=>setDetailsOpen(v=>!v)}>{detailsOpen?'상세 접기':mode==='worksheet'?'표시 설정':'상세 설정'}</button></div><div className="editor-toolbar" hidden={mode !== 'build'}><div className="tool-group">{[{ id: 'select', label: '선택', Icon: MousePointer2 }, { id: 'wire', label: '배선', Icon: Cable }, { id: 'pan', label: '화면 이동', Icon: Hand }, { id: 'reference', label: '접지(0V)', Icon: GroundIcon }].map(({ id, label, Icon }) => <button key={id} aria-pressed={tool === id && !placement} className={tool === id && !placement ? 'active' : ''} title={label} aria-label={label} onClick={() => { setTool(id); setPlacement(null); setWiringResetKey(key=>key+1); }}><Icon size={18}/><span>{label}</span></button>)}</div><span className="toolbar-separator"/><div className="tool-group"><button aria-label="실행 취소" title="실행 취소 Ctrl+Z" disabled={!history.past.length} onClick={() => setHistory(undo(history))}><Undo2 size={18}/></button><button aria-label="다시 실행" title="다시 실행 Ctrl+Shift+Z" disabled={!history.future.length} onClick={() => setHistory(redo(history))}><Redo2 size={18}/></button></div></div>
        {mode==='worksheet'&&<div id="worksheet-actions" className="worksheet-topbar"/>}
        {mode === 'potential' && <div className="potential-controls"><div className="segmented"><button aria-pressed={potentialView === '2d'} className={potentialView === '2d' ? 'active' : ''} onClick={() => setPotentialView('2d')}>2D 전위</button><button aria-pressed={potentialView === '3d'} className={potentialView === '3d' ? 'active' : ''} onClick={() => setPotentialView('3d')}>3D 높이</button></div><label><input type="checkbox" checked={showColors} onChange={e => setShowColors(e.target.checked)}/>색상</label><label><input type="checkbox" checked={showNumbers} onChange={e => setShowNumbers(e.target.checked)}/>숫자</label>{potentialView === '2d' && <label><input type="checkbox" checked={showCurrent} onChange={e=>setShowCurrent(e.target.checked)}/>전류 화살표</label>}{<button className="graph-toggle" aria-pressed={showGraph} onClick={()=>setShowGraph(!showGraph)}>경로 그래프 {showGraph?'접기':'보기'}</button>}<div className="potential-legend">{potential.undefinedCount === Object.keys(potential.nets).length ? <span>전위 미정</span> : <><span>{formatQuantity(potential.min,'V')}</span><i style={{background: potential.min === potential.max ? potentialColor(potential.min, potential.min, potential.max) : `linear-gradient(90deg,${potentialColorStops.map(color => `rgb(${color.join(',')})`).join(',')})`}}/><span>{formatQuantity(potential.max,'V')}</span><small>기준 {doc.referenceNode?.id ?? '미지정'} · 0 V</small></>}</div></div>}
        <div hidden={mode !== 'measure'} className="measurement-workspace"><MeasurementPanel kind={measurementKind} onKind={setMeasurementKind} branchId={measurementBranch} onBranch={setMeasurementBranch} onEdit={()=>{setMode('build');cancelTool();}} document={doc} compilation={compilation} result={result} active={mode === 'measure'} red={redProbe} black={blackProbe} activeProbe={activeProbe} onProbes={(red, black) => { setRedProbe(red); setBlackProbe(black); }} onActiveProbe={setActiveProbe} onPreview={setMeasurementPreview}>{mode === 'measure' ? circuitCanvas : null}</MeasurementPanel></div>
        {mode === 'potential' && potentialView === '3d' ? <div className="three-container"><Suspense fallback={<p>3D 보기를 준비하고 있습니다…</p>}><Potential3D document={doc} potential={potential} selectedIds={selected} highlightedId={hovered} selectedNet={selectedNet} showNumbers={showNumbers} showColors={showColors} referenceLabel={doc.referenceNode ? doc.referenceNode.id + ' · 0 V' : '미지정'} onSelect={id => { setHovered(id); setSelected([id]); const wire=doc.wires.find(w=>w.id===id); setSelectedNet(wire ? compilation.circuit.endpointToNet[wire.start.id] : null); }}/></Suspense></div> : mode === 'worksheet' ? <OutputCanvas document={outputFontPreview===null?doc:{...doc,output:{...doc.output,fontScale:outputFontPreview}}} result={result} options={outputOptions} selected={selected} tool={outputTool} onSelect={selectElement} onTool={setOutputTool} dispatch={dispatch} newId={newId}/> : mode !== 'measure' ? circuitCanvas : null}
        {mode === 'potential' && showGraph && <section className="graph-panel"><div className="graph-heading"><h2>경로에 따른 전위 변화</h2><select aria-label="전위 그래프 경로" value={customPathIds.length ? 'custom' : String(activePath)} onChange={e => { setCustomPathIds([]); setActivePath(Number(e.target.value)); }}>{paths.map((p,i)=><option key={p.id} value={i}>{p.label}</option>)}{customPathIds.length>0&&<option value="custom">직접 선택한 경로</option>}</select><button onClick={()=>{setCustomPathIds([]);setTool('path');setPotentialView('2d');setNotice('회로에서 경로를 따라 부품을 순서대로 선택하세요.');}}>경로 직접 선택</button>{customPathIds.length>0&&<button onClick={()=>{setCustomPathIds([]);setTool('select');}}>초기화</button>}</div><PotentialGraph path={path} result={result} hovered={hovered??selected[0]??null} onHover={setHovered}/><p className="graph-note">도선은 같은 전위의 수평 구간입니다. 부품의 경사는 집중소자의 전압 변화를 펼쳐 그린 교육적 표현입니다.</p>{customPathIds.length>0&&!path&&<p className="graph-note">연속으로 연결된 부품을 선택하세요: {customPathIds.join(' → ')}</p>}</section>}
        {result.diagnostics.length>0&&<details className="canvas-diagnostics" open={result.status==='error'}><summary>{result.status==='error'?'회로 연결 확인':doc.components.length?'조립 안내':'시작 안내'} · {result.diagnostics.filter(d=>d.code==='UNCONNECTED_TERMINAL').length ? '연결되지 않은 단자가 있습니다' : diagnosticText[result.diagnostics[0].code]?.title}</summary>{Object.values(result.diagnostics.reduce<Record<string,typeof result.diagnostics>>((groups,d)=>{(groups[d.code]??=[]).push(d);return groups;},{})).map(items=>{const d=items[0],ids=[...new Set(items.flatMap(d=>d.affectedIds).map(id=>doc.components.find(c=>c.terminals.some(t=>t.id===id))?.id??id))].filter(id=>[...doc.components,...doc.wires,...doc.junctions].some(x=>x.id===id));return <div key={d.code}><strong>{d.code==='UNCONNECTED_TERMINAL'?'단자 '+items.length+'곳을 연결할 수 있습니다':diagnosticText[d.code]?.title??d.code}</strong><p>{diagnosticText[d.code]?.detail} {diagnosticText[d.code]?.action}</p>{ids.length>0&&<button onClick={()=>{setSelected(ids);setFocusIds([...ids]);}}>회로에서 위치 보기</button>}</div>;})}</details>}
      </main>
      <aside className="inspector-panel" hidden={mode === 'measure'||!detailsOpen}><div className="section-heading"><h2><SlidersHorizontal size={16}/>속성</h2>{selected.length > 0 && <button aria-label="선택 해제" onClick={() => setSelected([])}><X size={16}/></button>}</div>
        <div hidden={mode !== 'worksheet'}><WorksheetPanel active={mode==='worksheet'} document={doc} result={result} selected={selected} onSelect={id=>setSelected([id])} dispatch={dispatch} onNotice={setNotice} tool={outputTool} onTool={setOutputTool} options={outputOptions} onOptions={setOutputOptions} onFontPreview={setOutputFontPreview} undo={()=>setHistory(undo(history))} redo={()=>setHistory(redo(history))} canUndo={!!history.past.length} canRedo={!!history.future.length}/></div>

        {mode === 'potential' && <div className="potential-settings"><h3>같은 연결, 같은 전위</h3><p className="tiny-note">단자나 도선을 누르면 같은 절점 전체가 강조됩니다.</p>{selectedNet&&potential.nets[selectedNet]&&<div className="net-readout"><strong>{formatQuantity(potential.nets[selectedNet].voltage,'V')}</strong><p>{potential.nets[selectedNet].endpointIds.map(id=>endpointName(doc,id)).join(' · ')}</p></div>}<label className="field-label">색상 범위<select value={fixedRange?'fixed':'auto'} onChange={e=>setFixedRange(e.target.value==='fixed')}><option value="auto">자동 범위</option><option value="fixed">고정 범위로 비교</option></select></label>{fixedRange&&<div className="range-inputs"><label>최소 V<QuantityInput label="고정 범위 최소" unit="V" value={rangeMin} onChange={setRangeMin}/></label><label>최대 V<QuantityInput label="고정 범위 최대" unit="V" value={rangeMax} onChange={setRangeMax}/></label></div>}{fixedRange&&(!Number.isFinite(rangeMin)||!Number.isFinite(rangeMax)||rangeMin>=rangeMax)&&<p className="tiny-note">최소보다 큰 최대값을 입력하세요. 현재 자동 범위가 적용됩니다.</p>}<label hidden={potentialView!=='3d'} className="field-label">높이 강조 · {Number((heightScale/18).toFixed(2))}배<input aria-label="높이 강조 배율" type="range" min="4" max="40" value={heightScale} onChange={e=>setHeightScale(Number(e.target.value))}/></label><p className="tiny-note">기본 높이를 1배로 삼습니다. 높이는 실제 공간 높이가 아닌 전위의 표현이며 전압값은 변하지 않습니다. 화살표는 관습적 전류 방향입니다. 화살표 굵기는 전류 크기의 상대적 표현이며 전자 속도가 아닙니다. 열린 스위치는 연결하지 않습니다.</p>{potential.undefinedCount>0&&<p className="tiny-note">전위 미정 {potential.undefinedCount}개 절점: 회색으로 표시하고 3D 높이를 부여하지 않습니다.</p>}<div className="library-divider"/></div>}
        <div hidden={mode==='worksheet'}>
        {component && definition ? <><div className="selected-component"><span className="selected-icon">{definition.short}</span><div><h3><Notation symbol text={component.label}/></h3><p>{definition.name}</p></div></div><div hidden={mode!=='build'}><label className="field-label">이름<input key={`${component.id}:${component.label}`} aria-label="부품 이름" defaultValue={component.label} onBlur={e => dispatch({ type: 'SetLabel', id: component.id, label: e.target.value })}/></label>
          {definition.property && <form onSubmit={e => { e.preventDefault(); applyValue(); }}><label className="field-label">{definition.unit === 'Ω' ? '저항값' : '전압'}<div className="unit-input"><input ref={valueInput} aria-label={`${component.label} 값`} value={valueDraft} onChange={e => setValueDraft(e.target.value)}/><span>{definition.unit}</span></div></label><button className="wide-button apply-value" type="submit">값 적용</button><p className="tiny-note">{definition.unit==='Ω'?'1k, 1.5 kΩ처럼 입력할 수 있어요.':'9, 1.5 V처럼 입력할 수 있어요.'}</p></form>}
          {component.type === 'switch' && <button className="wide-button" onClick={() => dispatch({ type: 'SetProperties', id: component.id, properties: { state: component.properties.state === 'closed' ? 'open' : 'closed' } })}>스위치 {component.properties.state === 'closed' ? '열기' : '닫기'}</button>}
          <div className="selection-actions"><button onClick={() => dispatch({ type: 'RotateComponents', ids: selected })}><RotateCw size={17}/>회전</button><button onClick={copy}><Copy size={17}/>복사</button><button onClick={remove}><Trash2 size={17}/>삭제</button></div>
          </div><div className="library-divider"/><div className="section-heading"><h2>빠른 값 보기</h2><span className="live-label">자동 계산</span></div><p className="tiny-note">a → b 방향 · 전원은 + → −</p><div className="readings"><div><span>양단 전압</span><strong>{formatQuantity(result.componentVoltages[component.id], 'V')}</strong></div><div><span>가지 전류</span><strong>{formatQuantity(result.branchCurrents[component.id], 'A')}</strong></div><div><span>{(result.componentPowers[component.id] ?? 0) < 0 ? '공급 전력' : '소비 전력'}</span><strong>{formatQuantity(Math.abs(result.componentPowers[component.id] ?? NaN), 'W')}</strong></div></div>
        </> : <div className="inspector-empty"><MousePointer2 size={28}/><h3>부품을 선택하세요</h3><p>회로 위의 부품을 누르면<br/>값과 계산 결과를 확인할 수 있어요.</p></div>}
        {mode==='build' && selected.length > 1 && <button className="wide-button" onClick={() => { const chosen = doc.components.filter(c => selected.includes(c.id)); if (!chosen.length) return; const y = chosen[0].position.y; dispatch({ type: 'MoveComponents', positions: Object.fromEntries(chosen.map(c => [c.id, { ...c.position, y }])) }); }}><AlignHorizontalJustifyCenter size={16}/>{selected.length}개 가로 정렬</button>}
        {mode==='build' && selected.length > 0 && !component && <button className="wide-button" onClick={remove}><Trash2 size={16}/>선택 요소 삭제</button>}
        {mode==='build' && clipboard && <button className="wide-button" onClick={paste}><ClipboardPaste size={16}/>붙여넣기</button>}
        <div className="library-divider"/><div className="section-heading"><h2>회로 요약</h2></div><div className="summary-grid"><div><span>전원 전압</span><strong><Notation text={source ? componentValue(source) : '—'}/></strong></div><div><span>전원 전류 크기</span><strong>{source ? formatQuantity(Math.abs(result.branchCurrents[source.id] ?? NaN), 'A') : '—'}</strong></div></div>

        </div><button className="recovery-button" onClick={() => { const saved = loadLocal('manual'); if (saved?.ok) { replace(saved.document); setNotice('마지막 복원 지점을 복원했습니다.'); } else setNotice('저장한 복원 지점이 없습니다.'); }}>회로 복원 지점으로 돌아가기</button>
      </aside>
    </div>
    {notice && <div className="toast" role="alert">{notice}<button onClick={() => setNotice('')} aria-label="알림 닫기"><X size={16}/></button></div>}
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section ref={helpDialog} tabIndex={-1} className="help-dialog" role="dialog" aria-modal="true" aria-label="사용 도움말" onClick={e => e.stopPropagation()}><button className="dialog-close" onClick={() => setHelp(false)} aria-label="도움말 닫기"><X/></button><span className="eyebrow">빠른 시작</span><h2>작은 회로에서 시작하세요.</h2><p>앱 0.1 · 회로 파일 형식 v1</p><ol><li>부품을 선택하고 캔버스를 눌러 놓습니다. 드래그해서 놓을 수도 있습니다.</li><li>첫 번째 단자, 두 번째 단자를 눌러 도선을 연결합니다.</li><li>저항이나 전원을 선택해 값을 바꾸면 결과가 즉시 갱신됩니다.</li><li>Shift+클릭으로 복수 선택하고 방향키·회전·복사·삭제를 사용할 수 있습니다.</li><li>JSON 저장으로 파일을 보관하세요. 자동 저장은 이 브라우저에만 남습니다.</li></ol><p>도선이 교차하는 것만으로는 전기적으로 연결되지 않습니다. 교차 연결 도구에서 교차를 선택하고 연결 또는 비연결을 적용하세요.</p><button className="primary" onClick={() => setHelp(false)}>시작하기</button></section></div>}
  </div>;
}
