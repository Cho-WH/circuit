import { anchorEndpoint, anchorPose, defaultWireAnchor, type MeasurementAnchor, type MeasurementTool } from './measurement-tools';
import { probeCurrent } from '../measurement';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Zap, MousePointer2, Cable, Hand, RotateCw, Trash2, Undo2, Redo2, Copy, ClipboardPaste, Plus, Check, AlertCircle, LoaderCircle, X, CircleHelp, AlignHorizontalJustifyCenter, Crosshair, SlidersHorizontal, CircuitBoard, MessageCircle } from 'lucide-react';
import { cloneDocument, emptyDocument, type CircuitDocument, type ComponentType, type EndpointRef, type Point } from '../domain';
import { componentDefinitions, componentValueInput, createComponent, symbolMarkup, formatQuantity, endpointName } from '../component-library';
import { createHistory, executeCommand, executeCommands, undo, redo, copySelection, type Command, type PastePayload } from '../editor';
import { loadLocal, saveLocal, parseDocument, serializeDocument } from '../persistence';
import { examples } from '../fixtures';
import { analyze } from './analyze';
import { diagnosticText } from './diagnostic-text';
import { layoutExample } from './examples';
import { CircuitCanvas } from './CircuitCanvas';
import { ComponentPalette, type PaletteDrag } from './ComponentPalette';
import { buildPotentialModel, makePath, potentialColor, potentialColorStops, suggestPaths } from '../visualization';
import { PotentialGraph } from './PotentialGraph';
import { MeasurementPanel } from './MeasurementPanel';
import { WorksheetPanel } from './WorksheetPanel';
import { OutputCanvas, type OutputTool } from './OutputCanvas';
import type { ExportOptions } from '../export';
import { parseQuantity } from '../notation';
import { Notation, QuantityInput } from './Notation';
import { useDialogFocus } from './useDialogFocus';
import { FileMenu } from './FileMenu';
import { FeedbackLoading } from './FeedbackLoading';
import { PotentialWorkspace } from './PotentialWorkspace';
import { useVisibleViewport } from './useVisibleViewport';
import './styles.css';
import './ux.css';
const FeedbackFeature = lazy(() => import('./FeedbackBoard'));

function GroundIcon({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 3V12 M2 12H22 M6 16H18 M10 20H14"/></svg>;
}

type Mode = 'build' | 'measure' | 'potential' | 'worksheet';
export function App() {
  useVisibleViewport();
  const [history, setHistory] = useState(() => { const saved = loadLocal(); return createHistory(saved?.ok ? saved.document : layoutExample(examples[1].document)); });
  const doc = history.present;
  const [selected, setSelected] = useState<string[]>([]);
  const [tool, setTool] = useState('select');
  const [placement, setPlacement] = useState<ComponentType | null>(null);
  const [paletteDrag,setPaletteDrag]=useState<PaletteDrag|null>(null);
  const [wiringResetKey, setWiringResetKey] = useState(0);
  const [mode, setMode] = useState<Mode>('build');
  const [notice, updateNotice] = useState({ message: '', kind: 'status' as 'status' | 'error' });
  function setNotice(message: string, kind: 'status' | 'error' = 'status') { updateNotice({ message, kind }); }
  const [saveStatus, setSaveStatus] = useState<'saving'|'saved'|'failed'>('saving');
  const canvasView = useRef<{documentId:string;view:{x:number;y:number;width:number;height:number}} | null>(null);
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
  const [storedMeasurementAnchors,setMeasurementAnchors]=useState<Record<MeasurementTool,MeasurementAnchor|null>>({red:null,black:null,current:null});
  const measurementAnchors:Record<MeasurementTool,MeasurementAnchor|null>={
    red:anchorPose(doc,storedMeasurementAnchors.red)?storedMeasurementAnchors.red:null,
    black:anchorPose(doc,storedMeasurementAnchors.black)?storedMeasurementAnchors.black:null,
    current:anchorPose(doc,storedMeasurementAnchors.current)?storedMeasurementAnchors.current:null,
  };
  const redProbe=anchorEndpoint(doc,measurementAnchors.red)?.id??'', blackProbe=anchorEndpoint(doc,measurementAnchors.black)?.id??'';
  const [activeProbe, setActiveProbe] = useState<'red'|'black'>('red');
  const [measurementKind, setMeasurementKind] = useState<'voltage'|'current'|'resistance'>('voltage');
  const [measurementBranch, setMeasurementBranch] = useState('');
  useEffect(()=>{setMeasurementAnchors({red:null,black:null,current:null});setActiveProbe('red');setMeasurementBranch('');},[doc.documentId]);
  const [hovered, setHovered] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
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
    if (!applied.ok) { setNotice(applied.diagnostics.map(d => diagnosticText[d.code]?.title ?? `변경할 수 없습니다 (${d.code})`).join(' · '), 'error'); return false; }
    setHistory(applied.history); return true;
  }
  useEffect(() => {
    setSaveStatus('saving');
    const timer = window.setTimeout(() => { const saved = saveLocal(doc); setSaveStatus(saved.ok ? 'saved' : 'failed'); }, 450);
    return () => window.clearTimeout(timer);
  }, [doc]);
  useEffect(() => {
    if (!notice.message || notice.kind === 'error') return; const timer = window.setTimeout(() => setNotice(''), 6000); return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => { setValueDraft(component && definition?.property ? componentValueInput(component) : ''); }, [component?.id, component?.properties, definition?.property]);
  function copy() {
    if (!selected.length) return;
    setClipboard(copySelection(doc, selected, newId, { x: 40, y: 40 })); setNotice('복사했어요');
  }
  function paste() {
    if (!clipboard) return;
    const temporary = { ...emptyDocument(), ...clipboard };
    const payload = copySelection(temporary, [...clipboard.components, ...clipboard.junctions, ...clipboard.wires].map(x => x.id), newId, { x: 20, y: 20 });
    if (dispatch({ type: 'Paste', ...payload })) { setSelected(payload.components.map(c => c.id)); setClipboard(payload); }
  }
  function remove() { if (dispatch({ type: 'DeleteElements', ids: selected })) setSelected([]); }
  function cancelTool() { setPaletteDrag(null); setOutputFontPreview(null); setOutputTool('select'); setPlacement(null); setTool('select'); setWiringResetKey(key=>key+1); }
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
    if (!added.ok) { setNotice('부품을 놓을 수 없어요. 삽입 공간과 편집 권한을 확인해 주세요.', 'error'); return; }
    let next = added.history;
    if (!next.present.referenceNode && type === 'dc-voltage-source') {
      const ref = executeCommand(next, { type: 'SetReference', endpoint: { kind: 'terminal', id: c.terminals[1].id } }); if (ref.ok) next = { ...ref.history, past: added.history.past };
    }
    setHistory(next); setSelected([c.id]); cancelTool();
  }
  const currentAnchor=anchorPose(doc,measurementAnchors.current)?measurementAnchors.current:null;
  const currentTarget=currentAnchor&&currentAnchor.kind!=='endpoint'?{kind:currentAnchor.kind,id:currentAnchor.id}:null;
  const currentReading=useMemo(()=>probeCurrent(doc,compilation,result,currentTarget),[doc,compilation,result,currentAnchor]);
  function placeMeasurement(which:MeasurementTool,anchor:MeasurementAnchor|null) {
    setMeasurementAnchors(previous=>({...previous,[which]:anchor}));
    if(which==='red'&&anchor)setActiveProbe('black');
    if(which==='current'&&anchor?.kind==='component')setMeasurementBranch(anchor.id);
  }
  function endpoint(endpoint: EndpointRef) {
    if (tool === 'reference') { dispatch({ type: 'SetReference', endpoint }); cancelTool(); setNotice(`${endpoint.id}를 0 V 기준점으로 지정했습니다.`); return; }
    if (mode === 'measure') { if(measurementKind!=='current')placeMeasurement(activeProbe,{kind:'endpoint',id:endpoint.id,endpointKind:endpoint.kind}); return; }
    if (mode === 'potential') { setSelectedNet(compilation.circuit.endpointToNet[endpoint.id]); return; }
  }
  function onWire(id: string) {
    if (mode === 'measure') { placeMeasurement(measurementKind==='current'?'current':activeProbe,defaultWireAnchor(doc,id)); return; }
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
    if (mode === 'measure') { if (id && measurementKind === 'current' && doc.components.some(c=>c.id===id)) placeMeasurement('current',{kind:'component',id}); return; }
    if (tool === 'path' && id) { setCustomPathIds(ids => [...ids, id]); setHovered(id); return; }
    if(mode==='worksheet'&&id&&window.matchMedia('(min-width: 641px)').matches)setDetailsOpen(true);
    setSelected(id === null ? [] : additive ? selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id] : [id]);
  }
  function downloadJson() {
    try {
      const data = serializeDocument(doc); const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const a = window.document.createElement('a'); a.href = url; a.download = `${doc.title || '회로'}.json`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('회로 파일을 저장했어요');
    } catch { setNotice('회로 파일을 저장하지 못했어요. 다시 시도해 주세요.', 'error'); }
  }
  async function openFile(file?: File) {
    if (!file) return;
    try { const parsed = parseDocument(await file.text()); if (parsed.ok) { replace(parsed.document); setNotice('회로 파일을 열었습니다.'); } else setNotice('이 파일을 열 수 없어요. 파일 형식이나 연결 정보가 올바르지 않습니다. 다른 회로 파일을 골라 주세요.', 'error'); }
    catch { setNotice('파일을 읽지 못했어요. 다시 골라 주세요.', 'error'); }
    if (fileInput.current) fileInput.current.value = '';
  }
  function changeMode(next: Mode) {
    setMode(next); cancelTool(); setHovered(null);
    setSelected(ids => next === 'measure' ? [] : next === 'worksheet' ? ids.filter(id => doc.components.some(c => c.id === id) || doc.annotations.some(a => a.id === id)) : ids.filter(id => !doc.annotations.some(a => a.id === id)));
  }
  const settingsButton = <button ref={settingsTrigger} className="settings-toggle" aria-label={mode === 'worksheet' ? '표시 설정' : '상세 설정'} aria-expanded={detailsOpen} onClick={() => setDetailsOpen(v => !v)}><SlidersHorizontal size={17}/><span>{mode === 'worksheet' ? '표시 설정' : '상세 설정'}</span></button>;
  const circuitCanvas = <CircuitCanvas paletteDrag={paletteDrag} initialView={canvasView.current?.documentId===doc.documentId?canvasView.current.view:undefined} onViewChange={view=>{canvasView.current={documentId:doc.documentId,view};}} document={doc} largeLabels={presentation} measurement={mode==='measure'?{disconnectSources:measurementKind==='resistance',tool:measurementKind==='current'?'current':activeProbe,anchors:measurementAnchors,amperes:currentReading.ok?currentReading.value.amperes:undefined,onPlace:placeMeasurement,onActivate:which=>{if(which!=='current')setActiveProbe(which);}}:undefined} readOnly={mode === 'measure'} onWiringCommit={mode==='build'?commitWiring:undefined} wiringResetKey={wiringResetKey} selected={mode === 'measure' ? measurementKind === 'current' ? currentTarget?[currentTarget.id]:[] : [] : selected} tool={mode === 'measure' && tool === 'select' ? 'probe' : tool} placement={placement} currentArrows={mode === 'potential' && showCurrent ? result.branchCurrents : undefined} endpointColors={mode === 'measure' ? measurementKind === 'current' ? undefined : { [redProbe]: '#dc4545', [blackProbe]: '#252f3c' } : mode === 'potential' && showColors ? Object.fromEntries(Object.entries(potential.endpoints).map(([id, v]) => [id, v.color])) : undefined} endpointGroups={compilation.circuit.endpointToNet} endpointLabels={mode === 'potential' && showNumbers ? Object.fromEntries(Object.entries(potential.endpoints).map(([id, v]) => [id, formatQuantity(v.voltage, 'V')])) : undefined} highlightedEndpoints={mode === 'potential' && selectedNet ? potential.nets[selectedNet]?.endpointIds : undefined} highlightedElements={mode !== 'measure' && hovered ? [hovered] : undefined} onHoverElement={setHovered} onSelect={selectElement} onMove={positions => dispatch({ type: 'MoveComponents', positions })} onPlace={place} onEndpoint={endpoint} onWire={onWire} focusIds={focusIds} onCancel={cancelTool} onCommitComponent={(id,edit)=>{
    const c=doc.components.find(c=>c.id===id);if(!c||mode!=='build')return false;
    const commands:Command[]=[];
    if(edit.label!==c.label)commands.push({type:'SetLabel',id,label:edit.label});
    const property=componentDefinitions[c.type].property;
    if(property&&edit.value!==undefined&&(edit.value!==c.properties[property]||(edit.fraction??'')!==(c.properties[property+'Fraction']??'')))commands.push({type:'SetProperties',id,properties:{[property]:edit.value,[property+'Fraction']:edit.fraction??''}});
    const applied=executeCommands(history,commands);if(!applied.ok)return false;
    setHistory(applied.history);return true;
  }} onAction={mode==='build'?action=>action==='rotate'?dispatch({type:'RotateComponents',ids:selected}):action==='copy'?copy():remove():undefined} onValue={id => { setSelected([id]); setDetailsOpen(true); window.setTimeout(() => valueInput.current?.focus(), 0); }} onSwitch={id => { const c = doc.components.find(x => x.id === id)!; dispatch({ type: 'SetProperties', id, properties: { state: c.properties.state === 'closed' ? 'open' : 'closed' } }); }} onBackground={()=>{}}/>;
  return <div className={`app-shell mode-${mode}${mode === 'potential' && potentialView === '3d' ? ' view-3d' : ''}${detailsOpen ? ' details-open' : ''}${presentation ? ' presentation' : ''}`}>
    <header className="topbar"><a className="brand" aria-label="회로 실험실" href="#" onClick={e => e.preventDefault()}><span className="brand-mark"><CircuitBoard size={23}/></span><span>회로 실험실</span></a>
      <div className="document-heading"><input readOnly={mode === 'measure'} aria-label="회로 제목" key={doc.documentId + doc.title} defaultValue={doc.title} onBlur={e => { if (e.target.value !== doc.title) replace({ ...cloneDocument(doc), title: e.target.value }); }} /><span className={`save-state ${saveStatus}`} role="status" aria-label={saveStatus==='saved'?'저장됨':saveStatus==='saving'?'저장 중':'자동 저장 실패'}>{saveStatus==='saved'?<Check size={15}/>:saveStatus==='saving'?<LoaderCircle size={15}/>:<AlertCircle size={16}/>}</span></div>
      <div className="top-actions"><FileMenu document={doc} onNew={()=>replace(emptyDocument(newId('circuit-')))} onOpen={()=>fileInput.current?.click()} onSave={downloadJson} onRestore={replace} onNotice={setNotice}/><button onClick={() => setFeedbackOpen(true)} aria-label="사용 후기 및 피드백"><MessageCircle size={18}/>한마디</button><button onClick={() => setHelp(true)} aria-label="사용 도움말"><CircleHelp size={19}/></button></div>
      <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e => void openFile(e.target.files?.[0])}/>
    </header>
    {feedbackOpen && <Suspense fallback={<FeedbackLoading onClose={()=>setFeedbackOpen(false)}/>}><FeedbackFeature onClose={() => setFeedbackOpen(false)}/></Suspense>}
    <nav className="modebar" aria-label="작업 모드"><div className="mode-tabs"><button aria-pressed={mode === 'build'} className={mode === 'build' ? 'active' : ''} onClick={() => changeMode('build')}><MousePointer2 size={16}/>회로 만들기</button><button aria-pressed={mode === 'potential'} className={mode === 'potential' ? 'active' : ''} onClick={() => changeMode('potential')}><Zap size={16}/>전위 보기</button><button aria-pressed={mode === 'measure'} className={mode === 'measure' ? 'active' : ''} onClick={() => changeMode('measure')}><Crosshair size={16}/>측정하기</button><button aria-pressed={mode === 'worksheet'} className={mode === 'worksheet' ? 'active' : ''} onClick={() => changeMode('worksheet')}><Copy size={16}/>회로도 출력</button></div><button className="presentation-toggle" onClick={()=>setPresentation(v=>!v)}>{presentation?'편집 화면':'수업 화면'}</button></nav>
    <div className="workspace">
      <aside className="library-panel" hidden={mode !== 'build'}><div className="section-heading"><h2>부품</h2></div>
        <ComponentPalette key={mode} resetKey={doc} placement={placement} onChoose={type=>{setPlacement(type);setTool('select');setWiringResetKey(key=>key+1);}} onClear={()=>setPlacement(null)} onDrag={event=>{setPaletteDrag(event);if(event.phase==='cancel')setPlacement(null);}}/>
        <div className="library-divider"/><div className="section-heading"><h2>시작하기</h2></div>
        <button className="wide-button" onClick={() => replace(emptyDocument(newId('circuit-')))}><Plus size={16}/>빈 회로 만들기</button>
        <label className="field-label">예제 회로<select aria-label="예제 회로" value={examples.some(x => x.document.documentId === doc.documentId) ? doc.documentId : ''} onChange={e => { const ex = examples.find(x => x.document.documentId === e.target.value); if (ex) replace(layoutExample(ex.document)); }}><option value="" disabled>예제 선택</option>{examples.map(example => <option key={example.id} value={example.document.documentId}>{example.title}</option>)}</select></label>

      </aside>
      <main className="canvas-column"><div className="editor-toolbar" hidden={mode !== 'build'}><div className="tool-group">{[{ id: 'select', label: '선택', Icon: MousePointer2 }, { id: 'wire', label: '배선', Icon: Cable }, { id: 'pan', label: '화면 이동', Icon: Hand }, { id: 'reference', label: '접지(0V)', Icon: GroundIcon }].map(({ id, label, Icon }) => <button key={id} aria-pressed={tool === id && !placement} className={tool === id && !placement ? 'active' : ''} title={label} aria-label={label} onClick={() => { setTool(id); setPlacement(null); setWiringResetKey(key=>key+1); }}><Icon size={18}/><span>{label}</span></button>)}</div><span className="toolbar-separator"/><div className="tool-group"><button aria-label="실행 취소" title="실행 취소 Ctrl+Z" disabled={!history.past.length} onClick={() => setHistory(undo(history))}><Undo2 size={18}/></button><button aria-label="다시 실행" title="다시 실행 Ctrl+Shift+Z" disabled={!history.future.length} onClick={() => setHistory(redo(history))}><Redo2 size={18}/></button></div>{settingsButton}</div>
        {mode==='worksheet'&&<div id="worksheet-actions" className="worksheet-topbar"/>}
        {mode === 'potential' && <div className="potential-controls"><div className="segmented"><button aria-pressed={potentialView === '2d'} className={potentialView === '2d' ? 'active' : ''} onClick={() => setPotentialView('2d')}>2D</button><button aria-pressed={potentialView === '3d'} className={potentialView === '3d' ? 'active' : ''} onClick={() => setPotentialView('3d')}>3D</button></div><label><input type="checkbox" checked={showColors} onChange={e => setShowColors(e.target.checked)}/>색상</label><label><input type="checkbox" checked={showNumbers} onChange={e => setShowNumbers(e.target.checked)}/>숫자</label>{potentialView === '2d' && <label><input type="checkbox" checked={showCurrent} onChange={e=>setShowCurrent(e.target.checked)}/>전류 화살표</label>}{<button className="graph-toggle" aria-pressed={showGraph} onClick={()=>setShowGraph(!showGraph)}>경로 그래프 {showGraph?'접기':'보기'}</button>}<div className="potential-legend">{potential.undefinedCount === Object.keys(potential.nets).length ? <span>전위 미정</span> : <><span>{formatQuantity(potential.min,'V')}</span><i style={{background: potential.min === potential.max ? potentialColor(potential.min, potential.min, potential.max) : `linear-gradient(90deg,${potentialColorStops.map(color => `rgb(${color.join(',')})`).join(',')})`}}/><span>{formatQuantity(potential.max,'V')}</span><small hidden={potentialView==='3d'}>기준: {doc.referenceNode ? <Notation symbol text={endpointName(doc,doc.referenceNode.id)}/> : '미지정'} · 0 V</small></>}</div>{settingsButton}</div>}
        <div hidden={mode !== 'measure'} className="measurement-workspace"><MeasurementPanel kind={measurementKind} onKind={setMeasurementKind} branchId={measurementBranch} onBranch={setMeasurementBranch} document={doc} compilation={compilation} result={result} active={mode === 'measure'} red={redProbe} black={blackProbe} activeProbe={activeProbe} anchors={measurementAnchors} currentReading={currentReading} onReset={()=>setMeasurementAnchors({red:null,black:null,current:null})} onSwap={()=>setMeasurementAnchors(a=>({...a,red:a.black,black:a.red}))} onActiveProbe={setActiveProbe}>{mode === 'measure' ? circuitCanvas : null}</MeasurementPanel></div>
        {mode === 'potential' ? <PotentialWorkspace active={potentialView==='3d'} sourceView={canvasView.current?.documentId===doc.documentId?canvasView.current.view:undefined} onReturnTo2D={()=>setPotentialView('2d')} document={doc} potential={potential} selectedIds={selected} highlightedId={hovered} selectedNet={selectedNet} showNumbers={showNumbers} showColors={showColors} referenceLabel={doc.referenceNode ? endpointName(doc,doc.referenceNode.id) : '미지정'} onSelect={id => { setHovered(id); setSelected([id]); const wire=doc.wires.find(w=>w.id===id); setSelectedNet(wire ? compilation.circuit.endpointToNet[wire.start.id] : null); }}>{circuitCanvas}</PotentialWorkspace> : mode === 'worksheet' ? <OutputCanvas document={outputFontPreview===null?doc:{...doc,output:{...doc.output,fontScale:outputFontPreview}}} result={result} options={outputOptions} selected={selected} tool={outputTool} onSelect={selectElement} onTool={setOutputTool} dispatch={dispatch} newId={newId}/> : mode !== 'measure' ? circuitCanvas : null}
        {mode === 'potential' && showGraph && <section className="graph-panel"><div className="graph-heading"><h2>경로에 따른 전위 변화</h2><select aria-label="전위 그래프 경로" value={customPathIds.length ? 'custom' : String(activePath)} onChange={e => { setCustomPathIds([]); setActivePath(Number(e.target.value)); }}>{paths.map((p,i)=><option key={p.id} value={i}>{p.label}</option>)}{customPathIds.length>0&&<option value="custom">직접 선택한 경로</option>}</select><button onClick={()=>{setCustomPathIds([]);setTool('path');setPotentialView('2d');setNotice('회로에서 경로를 따라 부품을 순서대로 선택하세요.');}}>경로 직접 선택</button>{customPathIds.length>0&&<button onClick={()=>{setCustomPathIds([]);setTool('select');}}>초기화</button>}</div><PotentialGraph path={path} result={result} hovered={hovered??selected[0]??null} onHover={setHovered}/>{customPathIds.length>0&&!path&&<p className="graph-note">연속으로 연결된 부품을 선택하세요: {customPathIds.join(' → ')}</p>}</section>}
        {result.diagnostics.length>0&&<details className="canvas-diagnostics" open={result.status==='error'}><summary>{result.status==='error'?'회로 연결 확인':doc.components.length?'조립 안내':'시작 안내'} · {result.diagnostics.filter(d=>d.code==='UNCONNECTED_TERMINAL').length ? '연결되지 않은 단자가 있습니다' : diagnosticText[result.diagnostics[0].code]?.title}</summary>{Object.values(result.diagnostics.reduce<Record<string,typeof result.diagnostics>>((groups,d)=>{(groups[d.code]??=[]).push(d);return groups;},{})).map(items=>{const d=items[0],ids=[...new Set(items.flatMap(d=>d.affectedIds).map(id=>doc.components.find(c=>c.terminals.some(t=>t.id===id))?.id??id))].filter(id=>[...doc.components,...doc.wires,...doc.junctions].some(x=>x.id===id));return <div key={d.code}><strong>{d.code==='UNCONNECTED_TERMINAL'?'단자 '+items.length+'곳을 연결할 수 있습니다':diagnosticText[d.code]?.title??d.code}</strong><p>{diagnosticText[d.code]?.detail} {diagnosticText[d.code]?.action}</p>{ids.length>0&&<button onClick={()=>{setSelected(ids);setFocusIds([...ids]);}}>회로에서 위치 보기</button>}</div>;})}</details>}
      </main>
      <aside className="inspector-panel" hidden={mode === 'measure'||!detailsOpen}><div className="section-heading"><h2>{mode==='worksheet'?'표시 설정':mode==='potential'?'전위 설정':component?'선택한 부품':'선택'}</h2><button aria-label="설정 닫기" onClick={() => {setDetailsOpen(false);settingsTrigger.current?.focus();}}><X size={16}/></button></div>
        <div hidden={mode !== 'worksheet'}><WorksheetPanel toolbarEnd={settingsButton} active={mode==='worksheet'} document={doc} result={result} selected={selected} onSelect={id=>setSelected([id])} dispatch={dispatch} onNotice={setNotice} tool={outputTool} onTool={setOutputTool} options={outputOptions} onOptions={setOutputOptions} onFontPreview={setOutputFontPreview} undo={()=>setHistory(undo(history))} redo={()=>setHistory(redo(history))} canUndo={!!history.past.length} canRedo={!!history.future.length}/></div>

        {mode === 'potential' && <div className="potential-settings">{selectedNet&&potential.nets[selectedNet]&&<div className="net-readout"><strong>{formatQuantity(potential.nets[selectedNet].voltage,'V')}</strong><p>{potential.nets[selectedNet].endpointIds.map(id=>endpointName(doc,id)).join(' · ')}</p></div>}<label className="field-label">색상 범위<select value={fixedRange?'fixed':'auto'} onChange={e=>setFixedRange(e.target.value==='fixed')}><option value="auto">자동 범위</option><option value="fixed">고정 범위로 비교</option></select></label>{fixedRange&&<div className="range-inputs"><label>최소 V<QuantityInput label="고정 범위 최소" unit="V" value={rangeMin} onChange={setRangeMin}/></label><label>최대 V<QuantityInput label="고정 범위 최대" unit="V" value={rangeMax} onChange={setRangeMax}/></label></div>}{fixedRange&&(!Number.isFinite(rangeMin)||!Number.isFinite(rangeMax)||rangeMin>=rangeMax)&&<p className="tiny-note">최소보다 큰 최대값을 입력하세요. 현재 자동 범위가 적용됩니다.</p>}<label hidden={potentialView!=='3d'} className="field-label">높이 ×{Number((heightScale/18).toFixed(2))}<input aria-label="높이 강조 배율" type="range" min="4" max="40" value={heightScale} onChange={e=>setHeightScale(Number(e.target.value))}/></label>{potential.undefinedCount>0&&<p className="tiny-note">전위 미정 {potential.undefinedCount}개 절점: 회색으로 표시하고 3D 높이를 부여하지 않습니다.</p>}<div className="library-divider"/></div>}
        <div hidden={mode==='worksheet'}>
        {component && definition ? <><div className="selected-component"><span className="selected-icon">{definition.short}</span><div><h3><Notation symbol text={component.label}/></h3><p>{definition.name}</p></div></div><div hidden={mode!=='build'}><label className="field-label">이름<input key={`${component.id}:${component.label}`} aria-label="부품 이름" defaultValue={component.label} onBlur={e => dispatch({ type: 'SetLabel', id: component.id, label: e.target.value })}/></label>
          {definition.property && <form onSubmit={e => { e.preventDefault(); applyValue(); }}><label className="field-label">{definition.unit === 'Ω' ? '저항값' : '전압'}<div className="unit-input"><input ref={valueInput} aria-label={`${component.label} 값`} value={valueDraft} onChange={e => setValueDraft(e.target.value)}/><span>{definition.unit}</span></div></label><button className="wide-button apply-value" type="submit">값 적용</button><p className="tiny-note">{definition.unit==='Ω'?'1k, 1.5 kΩ처럼 입력할 수 있어요.':'9, 1.5 V처럼 입력할 수 있어요.'}</p></form>}
          {component.type === 'switch' && <button className="wide-button" onClick={() => dispatch({ type: 'SetProperties', id: component.id, properties: { state: component.properties.state === 'closed' ? 'open' : 'closed' } })}>스위치 {component.properties.state === 'closed' ? '열기' : '닫기'}</button>}
          <div className="selection-actions"><button onClick={() => dispatch({ type: 'RotateComponents', ids: selected })}><RotateCw size={17}/>회전</button><button onClick={copy}><Copy size={17}/>복사</button><button onClick={remove}><Trash2 size={17}/>삭제</button></div>
          </div><div className="library-divider"/><div className="section-heading"><h2>빠른 값 보기</h2><span className="live-label">자동 계산</span></div><p className="tiny-note">a → b 방향 · 전원은 + → −</p><div className="readings"><div><span>양단 전압</span><strong>{formatQuantity(result.componentVoltages[component.id], 'V')}</strong></div><div><span>가지 전류</span><strong>{formatQuantity(result.branchCurrents[component.id], 'A')}</strong></div><div><span>{(result.componentPowers[component.id] ?? 0) < 0 ? '공급 전력' : '소비 전력'}</span><strong>{formatQuantity(Math.abs(result.componentPowers[component.id] ?? NaN), 'W')}</strong></div></div>
        </> : mode==='build'?<div className="inspector-empty"><MousePointer2 size={24}/><p>{selected.length?'선택한 도선':'선택한 부품이 없어요'}</p></div>:null}
        {mode==='build' && selected.length > 1 && <button className="wide-button" onClick={() => { const chosen = doc.components.filter(c => selected.includes(c.id)); if (!chosen.length) return; const y = chosen[0].position.y; dispatch({ type: 'MoveComponents', positions: Object.fromEntries(chosen.map(c => [c.id, { ...c.position, y }])) }); }}><AlignHorizontalJustifyCenter size={16}/>{selected.length}개 가로 정렬</button>}
        {mode==='build' && selected.length > 0 && !component && <button className="wide-button" onClick={remove}><Trash2 size={16}/>선택 요소 삭제</button>}
        {mode==='build' && clipboard && <button className="wide-button" onClick={paste}><ClipboardPaste size={16}/>붙여넣기</button>}
        </div>
      </aside>
    </div>
    {saveStatus==='failed' && <div className="save-failure" role="alert"><AlertCircle size={17}/><span>저장하지 못했어요</span><button onClick={downloadJson}>회로 파일 저장</button></div>}
    {notice.message && <div className={`toast ${notice.kind}`} role={notice.kind==='error'?'alert':'status'}>{notice.message}<button onClick={() => setNotice('')} aria-label="알림 닫기"><X size={16}/></button></div>}
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section ref={helpDialog} tabIndex={-1} className="help-dialog" role="dialog" aria-modal="true" aria-label="사용 도움말" onClick={e => e.stopPropagation()}><button className="dialog-close" onClick={() => setHelp(false)} aria-label="도움말 닫기"><X/></button><span className="eyebrow">빠른 시작</span><h2>작은 회로에서 시작하세요.</h2><ol><li>부품을 선택하고 놓을 곳을 누릅니다. 터치는 길게 눌러 끌어올 수도 있습니다. 도선 위에서는 미리보기를 확인하고 삽입을 누릅니다.</li><li>첫 번째 단자, 두 번째 단자를 눌러 도선을 연결합니다.</li><li>저항이나 전원을 선택해 값을 바꾸면 결과가 즉시 갱신됩니다.</li><li>터치는 미선택 부품을 길게 눌러 옮기거나, 선택 후 이동·놓기 버튼을 사용합니다. 짧게 밀면 화면 이동, 두 손가락은 확대·이동입니다. 마우스 복수 선택은 Shift+클릭입니다.</li><li>파일 메뉴에서 회로 파일을 저장하세요. 자동 저장은 이 브라우저에만 남습니다.</li></ol><p>도선이 교차하는 것만으로는 전기적으로 연결되지 않습니다. 교차점을 누르면 연결 상태가 바뀌어요.</p><p>이 앱은 이상적인 직류 저항 회로를 다룹니다. 전위 높이와 부품의 경사는 전압 차이를 보여 주는 표현이며 실제 공간 높이가 아닙니다. 화살표는 관습적 전류 방향이고, 굵기는 전류 크기를 나타냅니다.</p><button className="primary" onClick={() => setHelp(false)}>닫기</button></section></div>}
  </div>;
}
