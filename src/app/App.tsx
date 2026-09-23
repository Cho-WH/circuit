import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Zap, MousePointer2, Cable, Hand, RotateCw, Trash2, Undo2, Redo2, Copy, ClipboardPaste, Plus, Download, FolderOpen, Save, X, CircleHelp, Check, AlignHorizontalJustifyCenter, GitBranch, Crosshair, ChevronRight, SlidersHorizontal, CircuitBoard } from 'lucide-react';
import { cloneDocument, emptyDocument, type CircuitDocument, type ComponentType, type EndpointRef, type Point } from '../domain';
import { componentDefinitions, componentValue, createComponent, symbolMarkup, formatQuantity, wirePoints, type WorksheetMode, type NumberFormat } from '../component-library';
import { createHistory, executeCommand, undo, redo, copySelection, parseValue, type Command, type PastePayload } from '../editor';
import { loadLocal, saveLocal, parseDocument, serializeDocument } from '../persistence';
import { examples } from '../fixtures';
import { analyze } from './analyze';
import { diagnosticText } from './diagnostic-text';
import { layoutExample } from './examples';
import { CircuitCanvas } from './CircuitCanvas';
import { buildPotentialModel, makePath, suggestPaths } from '../visualization';
import { PotentialGraph } from './PotentialGraph';
import { MeasurementPanel } from './MeasurementPanel';
import { WorksheetPanel } from './WorksheetPanel';
import './styles.css';
const Potential3D = lazy(() => import('../potential-3d').then(module => ({ default: module.Potential3D })));

type Mode = 'build' | 'measure' | 'potential' | 'worksheet';
export function App() {
  const [history, setHistory] = useState(() => { const saved = loadLocal(); return createHistory(saved?.ok ? saved.document : layoutExample(examples[1].document)); });
  const doc = history.present;
  const [selected, setSelected] = useState<string[]>([]);
  const [tool, setTool] = useState('select');
  const [placement, setPlacement] = useState<ComponentType | null>(null);
  const [wireStart, setWireStart] = useState<EndpointRef | null>(null);
  const [mode, setMode] = useState<Mode>('build');
  const [notice, setNotice] = useState('');
  const [saveStatus, setSaveStatus] = useState('저장 준비');
  const [clipboard, setClipboard] = useState<PastePayload | null>(null);
  const [valueDraft, setValueDraft] = useState('');
  const [help, setHelp] = useState(false);
  const [routePreview, setRoutePreview] = useState(false);
  const [potentialView, setPotentialView] = useState<'2d' | '3d'>('2d');
  const [show3dGraph, setShow3dGraph] = useState(false);
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
  const [worksheetMode, setWorksheetMode] = useState<WorksheetMode>('problem');
  const [numberFormat, setNumberFormat] = useState<NumberFormat>({kind:'significant',digits:3});
  const [annotationAnchor, setAnnotationAnchor] = useState('');
  const [presentation, setPresentation] = useState(false);
  const [redProbe, setRedProbe] = useState('');
  const [blackProbe, setBlackProbe] = useState('');
  const [activeProbe, setActiveProbe] = useState<'red'|'black'>('red');
  const [measurementPreview, setMeasurementPreview] = useState<CircuitDocument|null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const valueInput = useRef<HTMLInputElement>(null);
  const idCounter = useRef(1);
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
    const applied = executeCommand(history, command);
    if (!applied.ok) { setNotice(applied.diagnostics.map(d => diagnosticText[d.code]?.title ?? `변경할 수 없습니다 (${d.code})`).join(' · ')); return false; }
    setHistory(applied.history); return true;
  }
  useEffect(() => {
    const timer = window.setTimeout(() => { const saved = saveLocal(doc); setSaveStatus(saved.ok ? '자동 저장됨' : '저장 실패 · JSON으로 저장하세요'); }, 450);
    return () => window.clearTimeout(timer);
  }, [doc]);
  useEffect(() => {
    if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 6000); return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => { setValueDraft(component && definition?.property ? String(component.properties[definition.property]) : ''); }, [component?.id, component?.properties, definition?.property]);
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
  function cancelTool() { setPlacement(null); setWireStart(null); setTool('select'); }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); setHistory(h => event.shiftKey ? redo(h) : undo(h)); }
      else if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); setHistory(h => redo(h)); }
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
  function place(type: ComponentType, position: Point) {
    const c = createComponent(type, newId(componentDefinitions[type].short), position);
    const added = executeCommand(history, { type: 'AddComponent', component: c });
    if (!added.ok) { setNotice('이 문서에서는 부품 추가가 허용되지 않습니다.'); return; }
    let next = added.history;
    if (!doc.referenceNode && type === 'dc-voltage-source') {
      const ref = executeCommand(next, { type: 'SetReference', endpoint: { kind: 'terminal', id: c.terminals[1].id } }); if (ref.ok) next = { ...ref.history, past: added.history.past };
    }
    setHistory(next); setSelected([c.id]); cancelTool();
  }
  function endpoint(endpoint: EndpointRef) {
    if (tool === 'reference') { dispatch({ type: 'SetReference', endpoint }); cancelTool(); setNotice(`${endpoint.id}를 0 V 기준점으로 지정했습니다.`); return; }
    if (mode === 'worksheet') { setAnnotationAnchor(endpoint.id); setNotice(`${endpoint.id}에 주석을 추가할 수 있습니다.`); return; }
    if (mode === 'measure') { if (activeProbe === 'red') { setRedProbe(endpoint.id); setActiveProbe('black'); } else setBlackProbe(endpoint.id); return; }
    if (mode === 'potential') { setSelectedNet(compilation.circuit.endpointToNet[endpoint.id]); return; }
    if (!wireStart) { setWireStart(endpoint); setTool('wire'); setPlacement(null); return; }
    if (wireStart.id === endpoint.id) { setWireStart(null); return; }
    if (dispatch({ type: 'ConnectWire', wire: { id: newId('W'), start: wireStart, end: endpoint, waypoints: [] } })) { setWireStart(null); setTool('select'); }
  }
  function onWire(id: string, p: Point) {
    if (mode === 'potential') { const wire = doc.wires.find(w => w.id === id); if (wire) setSelectedNet(compilation.circuit.endpointToNet[wire.start.id]); return; }
    if (tool === 'junction') {
      const wire = doc.wires.find(w => w.id === id)!; const points = wirePoints(doc, wire);
      const candidates = points.slice(1).map((b, i) => { const a = points[i]; return a.x === b.x ? { x: a.x, y: Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), p.y)) } : { x: Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), p.x)), y: a.y }; });
      const position = candidates.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0] ?? p;
      dispatch({ type: 'AddJunction', junction: { id: newId('J'), position }, wireId: id, newWireId: newId('W') }); cancelTool();
    }
    else setSelected([id]);
  }
  function applyValue() {
    if (!component || !definition?.property) return;
    const value = parseValue(valueDraft, definition.unit as 'Ω' | 'V' | 'A');
    if (value === null || (definition.unit === 'Ω' && value < 0)) { setNotice('유효한 값을 입력하세요. 예: 10, 1k, 1.5 kΩ. 이전 값은 유지됩니다.'); return; }
    dispatch({ type: 'SetProperties', id: component.id, properties: { [definition.property]: value } });
  }
  function replace(document: CircuitDocument) { if (dispatch({ type: 'ReplaceDocument', document })) { setSelected([]); cancelTool(); setRoutePreview(false); setSelectedNet(null); setHovered(null); setCustomPathIds([]); setActivePath(0); } }
  function selectElement(id: string | null, additive?: boolean) {
    if (tool === 'path' && id) { setCustomPathIds(ids => [...ids, id]); setHovered(id); return; }
    setSelected(id === null ? [] : additive ? selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id] : [id]);
  }
  function downloadJson() {
    try {
      const data = serializeDocument(doc); const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const a = window.document.createElement('a'); a.href = url; a.download = `${doc.title || '회로'}.json`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      const saved = saveLocal(doc, 'manual'); setNotice(saved.ok ? 'JSON 파일과 명시 저장본을 저장했습니다.' : 'JSON을 내려받았습니다. 브라우저 저장 공간을 확인하세요.');
    } catch { setNotice('문서를 저장하지 못했습니다. 회로 데이터 형식을 확인하세요.'); }
  }
  async function openFile(file?: File) {
    if (!file) return;
    try { const parsed = parseDocument(await file.text()); if (parsed.ok) { replace(parsed.document); setNotice('회로 파일을 열었습니다.'); } else setNotice('파일을 열지 못했습니다. edu-circuit v1 JSON과 연결 참조를 확인하세요. 현재 회로는 유지됩니다.'); }
    catch { setNotice('파일을 읽지 못했습니다. 다시 선택해 주세요.'); }
    if (fileInput.current) fileInput.current.value = '';
  }
  const shownDoc = mode === 'measure' && measurementPreview ? measurementPreview : routePreview ? { ...doc, wires: doc.wires.map(w => ({ ...w, waypoints: [] })) } : doc;
  const source = doc.components.find(c => c.type === 'dc-voltage-source');
  return <div className={`app-shell mode-${mode}${mode === 'potential' && potentialView === '3d' ? ' view-3d' : ''}${presentation ? ' presentation' : ''}`}>
    <header className="topbar"><a className="brand" href="#" onClick={e => e.preventDefault()}><span className="brand-mark"><CircuitBoard size={23}/></span><span>회로 실험실<small>CIRCUIT LAB</small></span></a>
      <div className="document-heading"><input aria-label="회로 제목" key={doc.documentId + doc.title} defaultValue={doc.title} onBlur={e => { if (e.target.value !== doc.title) replace({ ...cloneDocument(doc), title: e.target.value }); }} /><span><span className="status-dot"/>{saveStatus}</span></div>
      <div className="top-actions"><button onClick={() => setHelp(true)} aria-label="사용 도움말"><CircleHelp size={19}/></button><button onClick={() => fileInput.current?.click()}><FolderOpen size={17}/>열기</button><button onClick={downloadJson}><Download size={17}/>JSON 저장</button><button className="primary" onClick={() => { const saved = saveLocal(doc, 'manual'); setNotice(saved.ok ? '현재 회로를 명시 저장했습니다.' : saved.error); }}><Save size={16}/>저장</button></div>
      <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e => void openFile(e.target.files?.[0])}/>
    </header>
    <nav className="modebar" aria-label="작업 모드"><div className="mode-tabs"><button className={mode === 'build' ? 'active' : ''} onClick={() => { setMode('build'); cancelTool(); }}><MousePointer2 size={16}/>회로 만들기</button><button className={mode === 'potential' ? 'active' : ''} onClick={() => { setMode('potential'); cancelTool(); }}><Zap size={16}/>전위 보기</button><button className={mode === 'measure' ? 'active' : ''} onClick={() => { setMode('measure'); cancelTool(); }}><Crosshair size={16}/>측정하기</button><button className={mode === 'worksheet' ? 'active' : ''} onClick={() => { setMode('worksheet'); cancelTool(); }}><Copy size={16}/>문제 만들기</button></div><button className="presentation-toggle" onClick={()=>setPresentation(v=>!v)}>{presentation?'편집 화면':'수업 화면'}</button><div className="mode-meta"><span className="pill">DC</span>이상적인 직류 회로<span className="separator"/>MVP 0.1 · 문서 v1</div></nav>
    <div className="workspace">
      <aside className="library-panel"><div className="section-heading"><h2>부품 라이브러리</h2><span>6</span></div><p className="muted">선택한 뒤 캔버스에 놓으세요</p>
        <div className="component-grid">{(Object.keys(componentDefinitions) as ComponentType[]).map(type => <button key={type} className={placement === type ? 'component-tile chosen' : 'component-tile'} draggable onDragStart={e => e.dataTransfer.setData('component', type)} onClick={() => { setPlacement(type); setTool('select'); setWireStart(null); }}>
          <span className="tile-symbol"><svg width="62" height="32" viewBox="-50 -27 100 54" aria-hidden="true" stroke="currentColor" fill="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{__html:symbolMarkup(createComponent(type,'palette',{x:0,y:0}))}}/></span><span>{componentDefinitions[type].name}</span></button>)}</div>
        <div className="library-divider"/><div className="section-heading"><h2>시작하기</h2></div>
        <button className="wide-button" onClick={() => replace(emptyDocument(newId('circuit-')))}><Plus size={16}/>빈 회로 만들기</button>
        <label className="field-label">예제 회로<select aria-label="예제 회로" value={examples.some(x => x.document.documentId === doc.documentId) ? doc.documentId : ''} onChange={e => { const ex = examples.find(x => x.document.documentId === e.target.value); if (ex) replace(layoutExample(ex.document)); }}><option value="" disabled>예제 선택</option>{examples.map(e => <option key={e.id} value={e.document.documentId}>{e.title}</option>)}</select></label>
        <div className="lesson-card"><span>TRY THIS</span><h3>전압은 어떻게 나뉠까요?</h3><p>직렬 회로에서 저항값을 바꾸며 각 저항의 전압 변화를 관찰하세요.</p><button onClick={() => replace(layoutExample(examples[1].document))}>직렬 회로 열기 <ChevronRight size={15}/></button></div>
        <div className="library-bottom"><span className="status-dot"/>로그인 없이, 이 기기에 저장</div>
      </aside>
      <main className="canvas-column"><div className="editor-toolbar"><div className="tool-group">{[{ id: 'select', label: '선택', Icon: MousePointer2 }, { id: 'wire', label: '배선', Icon: Cable }, { id: 'junction', label: '분기점', Icon: GitBranch }, { id: 'pan', label: '화면 이동', Icon: Hand }, { id: 'reference', label: '기준점', Icon: Crosshair }].map(({ id, label, Icon }) => <button key={id} className={tool === id && !placement ? 'active' : ''} title={label} aria-label={label} onClick={() => { setTool(id); setPlacement(null); setWireStart(null); }}><Icon size={18}/><span>{label}</span></button>)}</div><span className="toolbar-separator"/><div className="tool-group"><button aria-label="실행 취소" title="실행 취소 Ctrl+Z" disabled={!history.past.length} onClick={() => setHistory(undo(history))}><Undo2 size={18}/></button><button aria-label="다시 실행" title="다시 실행 Ctrl+Shift+Z" disabled={!history.future.length} onClick={() => setHistory(redo(history))}><Redo2 size={18}/></button></div><button className="tidy-button" onClick={() => setRoutePreview(v => !v)}>배선 정리</button></div>
        {routePreview && <div className="preview-banner">자동 경로 미리보기<button onClick={() => { dispatch({ type: 'SetWireWaypoints', paths: Object.fromEntries(doc.wires.map(w => [w.id, []])) }); setRoutePreview(false); }}>적용</button><button onClick={() => setRoutePreview(false)}>취소</button></div>}
        {mode === 'worksheet' && <div className="worksheet-topbar"><strong>{worksheetMode === 'problem' ? '문제지' : '정답지'}</strong><span>같은 회로, 다른 표시 규칙</span><button onClick={()=>setWorksheetMode(v=>v==='problem'?'answer':'problem')}>{worksheetMode === 'problem' ? '정답 보기' : '문제 보기'}</button></div>}
        {mode === 'measure' && measurementPreview && <div className="preview-banner">임시 전류계 삽입 후 연결 · 원본 회로는 유지됩니다</div>}
        {mode === 'potential' && <div className="potential-controls"><div className="segmented"><button className={potentialView === '2d' ? 'active' : ''} onClick={() => setPotentialView('2d')}>2D 전위</button><button className={potentialView === '3d' ? 'active' : ''} onClick={() => setPotentialView('3d')}>3D 높이</button></div><label><input type="checkbox" checked={showColors} onChange={e => setShowColors(e.target.checked)}/>색상</label><label><input type="checkbox" checked={showNumbers} onChange={e => setShowNumbers(e.target.checked)}/>숫자</label>{potentialView === '2d' && <label><input type="checkbox" checked={showCurrent} onChange={e=>setShowCurrent(e.target.checked)}/>전류 화살표</label>}{potentialView === '3d' && <button className="graph-toggle" aria-pressed={show3dGraph} onClick={()=>setShow3dGraph(!show3dGraph)}>경로 그래프 {show3dGraph?'접기':'보기'}</button>}<div className="potential-legend">{potential.undefinedCount === Object.keys(potential.nets).length ? <span>전위 미정</span> : <><span>{formatQuantity(potential.min,'V')}</span><i/><span>{formatQuantity(potential.max,'V')}</span><small>기준 0 V</small></>}</div></div>}
        {mode === 'potential' && potentialView === '3d' ? <div className="three-container"><Suspense fallback={<p>3D 보기를 준비하고 있습니다…</p>}><Potential3D document={doc} potential={potential} selectedIds={selected} highlightedId={hovered} selectedNet={selectedNet} showNumbers={showNumbers} showColors={showColors} referenceLabel={doc.referenceNode ? doc.referenceNode.id + ' · 0 V' : '미지정'} onSelect={id => { setHovered(id); setSelected([id]); const wire=doc.wires.find(w=>w.id===id); setSelectedNet(wire ? compilation.circuit.endpointToNet[wire.start.id] : null); }}/></Suspense></div> : <CircuitCanvas document={shownDoc} worksheetMode={mode === 'worksheet' ? worksheetMode : undefined} numberFormat={numberFormat} simulationResult={result} largeLabels={presentation} probes={mode === 'measure' ? {red:redProbe,black:blackProbe} : undefined} selected={selected} tool={mode === 'measure' && tool === 'select' ? 'probe' : tool} placement={placement} wireStart={wireStart} currentArrows={mode === 'potential' && showCurrent ? result.branchCurrents : undefined} endpointColors={mode === 'measure' ? { [redProbe]: '#dc4545', [blackProbe]: '#252f3c' } : mode === 'potential' && showColors ? Object.fromEntries(Object.entries(potential.endpoints).map(([id, v]) => [id, v.color])) : undefined} endpointGroups={compilation.circuit.endpointToNet} endpointLabels={mode === 'potential' && showNumbers ? Object.fromEntries(Object.entries(potential.endpoints).map(([id, v]) => [id, formatQuantity(v.voltage, 'V')])) : undefined} highlightedEndpoints={mode === 'potential' && selectedNet ? potential.nets[selectedNet]?.endpointIds : undefined} highlightedElements={hovered ? [hovered] : undefined} onHoverElement={setHovered} onSelect={selectElement} onMove={positions => dispatch({ type: 'MoveComponents', positions })} onPlace={place} onEndpoint={endpoint} onWire={onWire} onValue={id => { setSelected([id]); window.setTimeout(() => valueInput.current?.focus(), 0); }} onSwitch={id => { const c = doc.components.find(x => x.id === id)!; dispatch({ type: 'SetProperties', id, properties: { state: c.properties.state === 'closed' ? 'open' : 'closed' } }); }} onBackground={() => { if (tool === 'junction') setNotice('분기점은 도선 위에 놓아 주세요. 도선을 선택한 뒤 Enter로도 만들 수 있습니다.'); }}/>} 
        {mode === 'potential' && (potentialView === '2d' || show3dGraph) && <section className="graph-panel"><div className="graph-heading"><h2>경로에 따른 전위 변화</h2><select aria-label="전위 그래프 경로" value={customPathIds.length ? 'custom' : String(activePath)} onChange={e => { setCustomPathIds([]); setActivePath(Number(e.target.value)); }}>{paths.map((p,i)=><option key={p.id} value={i}>{p.label}</option>)}{customPathIds.length>0&&<option value="custom">직접 선택한 경로</option>}</select><button onClick={()=>{setCustomPathIds([]);setTool('path');setPotentialView('2d');setNotice('회로에서 경로를 따라 부품을 순서대로 선택하세요.');}}>경로 직접 선택</button>{customPathIds.length>0&&<button onClick={()=>{setCustomPathIds([]);setTool('select');}}>초기화</button>}</div><PotentialGraph path={path} result={result} hovered={hovered} onHover={setHovered}/><p className="graph-note">도선은 같은 전위의 수평 구간입니다. 부품의 경사는 집중소자의 전압 변화를 펼쳐 그린 교육적 표현입니다.</p>{customPathIds.length>0&&!path&&<p className="graph-note">연속으로 연결된 부품을 선택하세요: {customPathIds.join(' → ')}</p>}</section>}
        <div className="canvas-status"><span className={result.status === 'error' ? 'calc-status warning' : 'calc-status'}>{result.status === 'error' ? <CircleHelp size={15}/> : <Check size={15}/>}<span role="status">{result.status === 'solved' ? '계산 완료' : result.status === 'error' ? '회로 연결을 확인하세요' : '회로 준비 중'}</span></span><span>{doc.components.length} 부품 · {doc.wires.length} 도선 · {compilation.circuit.nets.length} 절점</span><span className="reference-label">기준점 {doc.referenceNode ? doc.referenceNode.id + ' · 0 V' : '미지정'}</span></div>
        <div className="hint-strip"><span>{placement ? `${componentDefinitions[placement].name}를 놓을 위치를 클릭하세요. Esc로 취소합니다.` : tool === 'wire' ? wireStart ? '연결할 두 번째 단자를 선택하세요.' : '시작 단자를 선택하세요. 단자를 직접 눌러도 배선됩니다.' : tool === 'junction' ? '도선 위를 누르면 전기적으로 연결된 분기점이 만들어집니다.' : tool === 'reference' ? '0 V로 삼을 단자 또는 분기점을 선택하세요.' : 'Shift+클릭 복수 선택 · 방향키 이동 · R 회전 · W 배선 · Ctrl+Z 실행 취소'}</span></div>
      </main>
      <aside className="inspector-panel"><div className="section-heading"><h2><SlidersHorizontal size={16}/>속성</h2>{selected.length > 0 && <button aria-label="선택 해제" onClick={() => setSelected([])}><X size={16}/></button>}</div>
        <div hidden={mode !== 'worksheet'}><WorksheetPanel document={doc} result={result} selected={selected} mode={worksheetMode} onMode={setWorksheetMode} numberFormat={numberFormat} onNumberFormat={setNumberFormat} anchor={annotationAnchor} onAnchor={setAnnotationAnchor} onSelect={id=>setSelected([id])} dispatch={dispatch} newId={newId} onNotice={setNotice}/></div>
        <div hidden={mode !== 'measure'}><MeasurementPanel document={doc} compilation={compilation} result={result} active={mode === 'measure'} red={redProbe} black={blackProbe} activeProbe={activeProbe} onProbes={(red, black) => { setRedProbe(red); setBlackProbe(black); }} onActiveProbe={setActiveProbe} onPreview={setMeasurementPreview}/></div>
        {mode === 'potential' && <div className="potential-settings"><h3>같은 연결, 같은 전위</h3><p className="tiny-note">단자나 도선을 누르면 같은 절점 전체가 강조됩니다.</p>{selectedNet&&potential.nets[selectedNet]&&<div className="net-readout"><strong>{formatQuantity(potential.nets[selectedNet].voltage,'V')}</strong><p>{potential.nets[selectedNet].endpointIds.join(' · ')}</p></div>}<label className="field-label">색상 범위<select value={fixedRange?'fixed':'auto'} onChange={e=>setFixedRange(e.target.value==='fixed')}><option value="auto">자동 범위</option><option value="fixed">고정 범위로 비교</option></select></label>{fixedRange&&<div className="range-inputs"><label>최소 V<input aria-label="고정 범위 최소" type="number" value={rangeMin} onChange={e=>setRangeMin(e.target.valueAsNumber)}/></label><label>최대 V<input aria-label="고정 범위 최대" type="number" value={rangeMax} onChange={e=>setRangeMax(e.target.valueAsNumber)}/></label></div>}{fixedRange&&(!Number.isFinite(rangeMin)||!Number.isFinite(rangeMax)||rangeMin>=rangeMax)&&<p className="tiny-note">최소보다 큰 최대값을 입력하세요. 현재 자동 범위가 적용됩니다.</p>}<label className="field-label">전위 높이 축척 · {heightScale} 단위/V<input aria-label="전위 높이 축척" type="range" min="4" max="40" value={heightScale} onChange={e=>setHeightScale(Number(e.target.value))}/></label><p className="tiny-note">높이는 전위, 화살표는 관습적 전류 방향입니다. 화살표 굵기는 전류 크기의 상대적 표현이며 전자 속도가 아닙니다. 열린 스위치는 연결하지 않습니다.</p>{potential.undefinedCount>0&&<p className="tiny-note">전위 미정 {potential.undefinedCount}개 절점: 회색으로 표시하고 3D 높이를 부여하지 않습니다.</p>}<div className="library-divider"/></div>}
        {component && definition ? <><div className="selected-component"><span className="selected-icon">{definition.short}</span><div><h3>{component.label}</h3><p>{definition.name}</p></div></div><label className="field-label">이름<input key={`${component.id}:${component.label}`} aria-label="부품 이름" defaultValue={component.label} onBlur={e => dispatch({ type: 'SetLabel', id: component.id, label: e.target.value })}/></label>
          {definition.property && <form onSubmit={e => { e.preventDefault(); applyValue(); }}><label className="field-label">{definition.unit === 'Ω' ? '저항값' : '전압'}<div className="unit-input"><input ref={valueInput} aria-label={`${component.label} 값`} value={valueDraft} onChange={e => setValueDraft(e.target.value)}/><span>{definition.unit}</span></div></label><button className="wide-button apply-value" type="submit">값 적용</button><p className="tiny-note">1k, 1.5 kΩ처럼 입력할 수 있어요.</p></form>}
          {component.type === 'switch' && <button className="wide-button" onClick={() => dispatch({ type: 'SetProperties', id: component.id, properties: { state: component.properties.state === 'closed' ? 'open' : 'closed' } })}>스위치 {component.properties.state === 'closed' ? '열기' : '닫기'}</button>}
          <div className="selection-actions"><button onClick={() => dispatch({ type: 'RotateComponents', ids: selected })}><RotateCw size={17}/>회전</button><button onClick={copy}><Copy size={17}/>복사</button><button onClick={remove}><Trash2 size={17}/>삭제</button></div>
          <div className="library-divider"/><div className="section-heading"><h2>빠른 값 보기</h2><span className="live-label">LIVE</span></div><p className="tiny-note">a → b 방향 · 전원은 + → −</p><div className="readings"><div><span>양단 전압</span><strong>{formatQuantity(result.componentVoltages[component.id], 'V')}</strong></div><div><span>가지 전류</span><strong>{formatQuantity(result.branchCurrents[component.id], 'A')}</strong></div><div><span>{(result.componentPowers[component.id] ?? 0) < 0 ? '공급 전력' : '소비 전력'}</span><strong>{formatQuantity(Math.abs(result.componentPowers[component.id] ?? NaN), 'W')}</strong></div></div>
        </> : <div className="inspector-empty"><MousePointer2 size={28}/><h3>부품을 선택하세요</h3><p>회로 위의 부품을 누르면<br/>값과 계산 결과를 확인할 수 있어요.</p></div>}
        {selected.length > 1 && <button className="wide-button" onClick={() => { const chosen = doc.components.filter(c => selected.includes(c.id)); if (!chosen.length) return; const y = chosen[0].position.y; dispatch({ type: 'MoveComponents', positions: Object.fromEntries(chosen.map(c => [c.id, { ...c.position, y }])) }); }}><AlignHorizontalJustifyCenter size={16}/>{selected.length}개 가로 정렬</button>}
        {selected.length > 0 && !component && <button className="wide-button" onClick={remove}><Trash2 size={16}/>선택 요소 삭제</button>}
        {clipboard && <button className="wide-button" onClick={paste}><ClipboardPaste size={16}/>붙여넣기</button>}
        <div className="library-divider"/><div className="section-heading"><h2>회로 요약</h2></div><div className="summary-grid"><div><span>전원 전압</span><strong>{source ? formatQuantity(Number(source.properties.voltageV), 'V') : '—'}</strong></div><div><span>전원 전류 크기</span><strong>{source ? formatQuantity(Math.abs(result.branchCurrents[source.id] ?? NaN), 'A') : '—'}</strong></div></div>
        {result.diagnostics.length > 0 && <div className="diagnostics-list">{result.diagnostics.slice(0, 4).map((d, i) => <div className="diagnostic-card" key={i}><strong>{diagnosticText[d.code]?.title ?? d.code}</strong><p>{diagnosticText[d.code]?.detail}</p><p>{diagnosticText[d.code]?.action}</p><button onClick={() => setSelected(d.affectedIds.map(id => doc.components.find(c => c.terminals.some(t => t.id === id))?.id ?? id))}>관련 요소 보기</button></div>)}</div>}
        <button className="recovery-button" onClick={() => { const saved = loadLocal('manual'); if (saved?.ok) { replace(saved.document); setNotice('마지막 명시 저장본을 복원했습니다.'); } else setNotice('복원할 명시 저장본이 없습니다.'); }}>마지막 저장본 복원</button>
      </aside>
    </div>
    {notice && <div className="toast" role="alert">{notice}<button onClick={() => setNotice('')} aria-label="알림 닫기"><X size={16}/></button></div>}
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section className="help-dialog" role="dialog" aria-modal="true" aria-label="사용 도움말" onClick={e => e.stopPropagation()}><button className="dialog-close" onClick={() => setHelp(false)} aria-label="도움말 닫기"><X/></button><span className="eyebrow">QUICK START</span><h2>작은 회로에서 시작하세요.</h2><ol><li>부품을 선택하고 캔버스를 눌러 놓습니다. 드래그해서 놓을 수도 있습니다.</li><li>첫 번째 단자, 두 번째 단자를 눌러 도선을 연결합니다.</li><li>저항이나 전원을 선택해 값을 바꾸면 결과가 즉시 갱신됩니다.</li><li>Shift+클릭으로 복수 선택하고 방향키·회전·복사·삭제를 사용할 수 있습니다.</li><li>JSON 저장으로 파일을 보관하세요. 자동 저장은 이 브라우저에만 남습니다.</li></ol><p>도선이 교차하는 것만으로는 전기적으로 연결되지 않습니다. 분기점 도구로 도선을 나누고 그 점에 연결하세요.</p><button className="primary" onClick={() => setHelp(false)}>시작하기</button></section></div>}
  </div>;
}

