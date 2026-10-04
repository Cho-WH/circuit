import type { ComponentProperties } from '../domain';
import * as q from '../rational';
import { parseComponentValue } from './component-value';
import { Tooltip } from './Tooltip';
import { ExampleMenu, ExampleChoices } from './ExampleMenu';
import { CanvasDiagnostics } from './CanvasDiagnostics';
import { SwitchStateButton } from './SwitchStateButton';
import { saveBlob } from './download';
import { ComponentNameInput } from './ComponentNameInput';
import { QuantityDisplaySelect } from './QuantityDisplay';
import {
  anchorEndpoint,
  anchorPose,
  defaultWireAnchor,
  type MeasurementAnchor,
  type MeasurementTool,
} from './measurement-tools';
import { probeCurrent, probeVoltage } from '../measurement';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Zap,
  MousePointer2,
  Cable,
  RotateCw,
  Trash2,
  Undo2,
  Redo2,
  Copy,
  ClipboardPaste,
  Plus,
  Check,
  AlertCircle,
  LoaderCircle,
  X,
  CircleHelp,
  AlignHorizontalJustifyCenter,
  SlidersHorizontal,
  CircuitBoard,
  MessageCircle,
  Ellipsis,
  NotebookPen,
} from 'lucide-react';
import {
  cloneDocument,
  emptyDocument,
  type CircuitDocument,
  type ComponentType,
  type EndpointRef,
  type Point,
} from '../domain';
import {
  componentDefinitions,
  componentValueInput,
  createComponent,
  symbolMarkup,
  endpointName,
  quantityFormatForTargets,
  adjustableParameter,
} from '../component-library';
import {
  ParameterControl,
  ParameterRangeFields,
  parameterRangeProperties,
  parameterContext,
  parameterScales,
} from './parameters';
import { copySelection, type Command, type PastePayload } from '../editor';
import { parseDocument, serializeDocument } from '../persistence';
import { useCircuitSession, type WorkspaceMode } from './useCircuitSession';
import { examples } from '../fixtures';
import { analyze } from './analyze';
import { diagnosticText } from './diagnostic-text';
import { layoutExample } from './examples';
import { CircuitCanvas } from './CircuitCanvas';
import { ComponentPalette, type PaletteDrag } from './ComponentPalette';
import {
  buildPotentialModel,
  potentialAxisValue,
  buildCurrentModel,
  defaultPotentialPalette,
  makePath,
  suggestPaths,
  type PotentialPaletteId,
} from '../visualization';
import { PotentialPalettePicker } from './PotentialPalettePicker';
import { PotentialGraph } from './PotentialGraph';
import { MeasurementPanel } from './MeasurementPanel';
import { AnalysisTools, type MeasurementKind, type AnalysisPanel } from './AnalysisTools';
import { WorksheetPanel } from './WorksheetPanel';
import { OutputCanvas, type OutputTool } from './OutputCanvas';
import type { VoltageMeasurement } from '../potential-3d';
import type { ExportOptions } from '../export';
import { formatQuantity, quantityFormatFor, type QuantityMode } from '../quantity';
import { Notation } from './Notation';
import { PotentialSettings, defaultPotentialSettings } from './PotentialSettings';
import { QuickStartDialog } from './QuickStartDialog';
import { FileMenu } from './FileMenu';
import { FeedbackLoading } from './FeedbackLoading';
import { PotentialWorkspace, type PotentialWorkspaceStatus } from './PotentialWorkspace';
import { CurrentControls, CurrentSettings, useCurrentDisplay } from './CurrentControls';
import { useVisibleViewport } from './useVisibleViewport';
import { useCompactLayout } from './useCompactLayout';
import { FloatingPanel } from './FloatingPanel';
import './styles.css';
import './ux.css';
import './mobile.css';
const FeedbackFeature = lazy(() => import('./FeedbackBoard'));
const noSelection: string[] = [];

function GroundIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 3V12 M2 12H22 M6 16H18 M10 20H14" />
    </svg>
  );
}

type Mode = WorkspaceMode;
export function App() {
  useVisibleViewport();
  const compact = useCompactLayout();
  const [mode, setMode] = useState<Mode>('build');
  const {
    history,
    documentEpoch,
    saveStatus,
    execute,
    placeComponent,
    undo: undoEdit,
    redo: redoEdit,
  } = useCircuitSession(mode);
  const saveStatusLabel = {
    saved: '이 브라우저에 저장됨',
    saving: '이 브라우저에 저장 중',
    failed: '이 브라우저에 자동 저장 실패',
  }[saveStatus];
  const doc = history.present;
  const [selected, setSelected] = useState<string[]>([]);
  const [tool, setTool] = useState('select');
  const [placement, setPlacement] = useState<ComponentType | null>(null);
  const [paletteDrag, setPaletteDrag] = useState<PaletteDrag | null>(null);
  const [wiringResetKey, setWiringResetKey] = useState(0);
  const [notice, updateNotice] = useState({ message: '', kind: 'status' as 'status' | 'error' });
  function setNotice(message: string, kind: 'status' | 'error' = 'status') {
    updateNotice({ message, kind });
  }

  const canvasView = useRef<{
    documentId: string;
    view: { x: number; y: number; width: number; height: number };
  } | null>(null);
  const [clipboard, setClipboard] = useState<PastePayload | null>(null);
  const [valueDraft, setValueDraft] = useState('');
  const [help, setHelp] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [potentialView, setPotentialView] = useState<'2d' | '3d'>('2d');
  const [potentialStatus, setPotentialStatus] = useState<PotentialWorkspaceStatus>('2d');
  const [analysisPanel, setAnalysisPanel] = useState<AnalysisPanel>(null);
  const showGraph = analysisPanel === 'path';
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [focusIds, setFocusIds] = useState<string[]>([]);
  const [showNumbers, setShowNumbers] = useState(true);
  const [showColors, setShowColors] = useState(true);
  const [potentialPalette, setPotentialPalette] =
    useState<PotentialPaletteId>(defaultPotentialPalette);
  const [showCurrent, setShowCurrent] = useState(false);
  const [selectedNet, setSelectedNet] = useState<string | null>(null);
  const [potentialSettings, setPotentialSettings] = useState(defaultPotentialSettings);
  const { fixedRange, rangeMin, rangeMax, heightScale } = potentialSettings;
  const [activePath, setActivePath] = useState(0);
  const [customPathIds, setCustomPathIds] = useState<string[]>([]);
  const [outputFontPreview, setOutputFontPreview] = useState<number | null>(null);
  const [outputTool, setOutputTool] = useState<OutputTool>('select');
  const [outputOptions, setOutputOptions] = useState<ExportOptions>({
    background: 'white',
    highResolution: false,
  });
  const [presentation, setPresentation] = useState(false);
  const [storedMeasurementAnchors, setMeasurementAnchors] = useState<
    Record<MeasurementTool, MeasurementAnchor | null>
  >({ red: null, black: null, current: null });
  const measurementAnchors: Record<MeasurementTool, MeasurementAnchor | null> = {
    red: anchorPose(doc, storedMeasurementAnchors.red) ? storedMeasurementAnchors.red : null,
    black: anchorPose(doc, storedMeasurementAnchors.black) ? storedMeasurementAnchors.black : null,
    current: anchorPose(doc, storedMeasurementAnchors.current)
      ? storedMeasurementAnchors.current
      : null,
  };
  const redProbe = anchorEndpoint(doc, measurementAnchors.red)?.id ?? '',
    blackProbe = anchorEndpoint(doc, measurementAnchors.black)?.id ?? '';
  const [activeProbe, setActiveProbe] = useState<'red' | 'black'>('red');
  const [measurementKind, setMeasurementKind] = useState<MeasurementKind | null>(null);
  const [mobileMeasuring, setMobileMeasuring] = useState(false);
  const [measurementConsoleHost, setMeasurementConsoleHost] = useState<HTMLDivElement | null>(null);
  const [sourcesDetached, setSourcesDetached] = useState(false);
  const hasSources = doc.components.some((c) => c.type === 'dc-voltage-source');
  const resistanceMode = mode === 'analysis' && measurementKind === 'resistance';
  const needsIsolation = resistanceMode && hasSources && !sourcesDetached;
  const isolated = resistanceMode && !needsIsolation;
  const analysisView = resistanceMode ? '2d' : potentialView;
  const measurementActive =
    mode === 'analysis' && measurementKind !== null && analysisView === '2d' && !needsIsolation && (!compact || mobileMeasuring);
  const measurementEnabled = mode === 'analysis' && measurementKind !== null && !needsIsolation;
  const showOperatingState = mode === 'analysis' && !isolated;
  function chooseMeasurement(kind: MeasurementKind | null) {
    setMeasurementKind(kind);
    setMobileMeasuring(kind !== null);
    setSourcesDetached(false);
    setTool('select');
    if (kind && kind !== 'resistance') setPotentialView('2d');
    if (kind === 'resistance') setAnalysisPanel(null);
  }
  function chooseView(view: '2d' | '3d') {
    if (view === '3d' && measurementKind !== 'voltage') chooseMeasurement(null);
    setPotentialView(view);
  }
  useEffect(() => {
    if (!compact) return;
    setPresentation(false);
    setAnalysisPanel(panel => panel === 'path' ? null : panel);
    setTool(tool => tool === 'path' ? 'select' : tool);
    setOutputFontPreview(null);
  }, [compact]);
  useEffect(() => {
    setMeasurementAnchors({ red: null, black: null, current: null });
    setActiveProbe('red');
    setSourcesDetached(false);
  }, [doc.documentId]);
  const [hovered, setHovered] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const valueInput = useRef<HTMLInputElement>(null);
  const idCounter = useRef(1);
  const [comparisonParameterId, setComparisonParameterId] = useState('');
  const [adjustingParameters, setAdjustingParameters] = useState<Set<string>>(() => new Set());
  const onParameterAdjusting = useCallback((id: string, adjusting: boolean) => {
    setAdjustingParameters(previous => {
      if (previous.has(id) === adjusting) return previous;
      const next = new Set(previous);
      if (adjusting) next.add(id); else next.delete(id);
      return next;
    });
  }, []);
  useEffect(() => setComparisonParameterId(''), [documentEpoch]);
  const adjustableComponents = doc.components.filter((c) => adjustableParameter(c));
  const controlledComponent = adjustableComponents.find(
    (c) => selected.length === 1 && c.id === selected[0] && adjustableParameter(c),
  );
  // Closing the controls preserves the comparison scale while automatic changes continue.
  const comparisonComponent =
    controlledComponent ?? adjustableComponents.find((c) => c.id === comparisonParameterId);
  const comparisonParameter = comparisonComponent
    ? adjustableParameter(comparisonComponent)!
    : null;
  useEffect(() => {
    if (controlledComponent) setComparisonParameterId(controlledComponent.id);
  }, [controlledComponent?.id]);
  const scaleContext =
    mode === 'analysis' && comparisonComponent && comparisonParameter
      ? parameterContext(doc, comparisonComponent.id, comparisonParameter)
      : null;
  const comparisonScales = useMemo(
    () =>
      scaleContext && comparisonComponent && comparisonParameter
        ? parameterScales(doc, comparisonComponent.id, comparisonParameter)
        : null,
    [scaleContext],
  );
  const { compilation, result } = useMemo(() => analyze(doc), [doc]);
  const voltageReading = useMemo(
    () =>
      probeVoltage(
        compilation,
        result,
        anchorEndpoint(doc, measurementAnchors.red),
        anchorEndpoint(doc, measurementAnchors.black),
      ),
    [doc, compilation, result, redProbe, blackProbe],
  );
  const voltageLabel = formatQuantity(
    voltageReading.ok ? voltageReading.value.voltageV : undefined,
    'V',
    quantityFormatForTargets(doc, [redProbe, blackProbe]),
  );
  const voltageMeasurement = useMemo<VoltageMeasurement | undefined>(() => {
    if (mode !== 'analysis' || measurementKind !== 'voltage') return undefined;
    const probe = (anchor: MeasurementAnchor | null) => {
      const pose = anchorPose(doc, anchor),
        endpoint = anchorEndpoint(doc, anchor);
      return pose && endpoint ? { point: pose.point, endpointId: endpoint.id } : null;
    };
    const red = probe(measurementAnchors.red),
      black = probe(measurementAnchors.black);
    return { red, black, label: voltageReading.ok ? voltageLabel : null };
  }, [doc, storedMeasurementAnchors, voltageReading, voltageLabel, measurementKind, mode]);

  const currents = useMemo(
    () => buildCurrentModel(doc, compilation, result),
    [doc, compilation, result],
  );
  const {
    display: currentDisplay,
    setPaused: setCurrentPaused,
    setWidthScale: setCurrentWidthScale,
  } = useCurrentDisplay(currents, comparisonScales?.current, adjustingParameters.size > 0);
  const potential = useMemo(
    () =>
      buildPotentialModel(doc, compilation.circuit, result, {
        palette: potentialPalette,
        ...(fixedRange
          ? { range: { min: rangeMin, max: rangeMax } }
          : comparisonScales
            ? { range: comparisonScales.voltage }
            : {}),
      }),
    [doc, compilation, result, potentialPalette, fixedRange, rangeMin, rangeMax, comparisonScales],
  );
  const paths = useMemo(() => suggestPaths(compilation.circuit), [compilation]);
  const path = customPathIds.length
    ? makePath(compilation.circuit, customPathIds)
    : (paths[activePath] ?? paths[0] ?? null);
  const component = doc.components.find((c) => c.id === selected[0]);
  const definition = component ? componentDefinitions[component.type] : null;
  function newId(prefix: string) {
    const all = new Set(
      [
        ...doc.components,
        ...doc.components.flatMap((c) => c.terminals),
        ...doc.wires,
        ...doc.junctions,
        ...doc.annotations,
      ].map((x) => x.id),
    );
    let id: string;
    do {
      id = `${prefix}${idCounter.current++}`;
    } while (all.has(id));
    return id;
  }
  function dispatch(command: Command) {
    const applied = execute(command);
    if (!applied.ok) {
      setNotice(
        applied.diagnostics
          .map((d) => diagnosticText[d.code]?.title ?? `변경할 수 없습니다 (${d.code})`)
          .join(' · '),
        'error',
      );
      return false;
    }
    return true;
  }

  useEffect(() => {
    if (!notice.message || notice.kind === 'error') return;
    const timer = window.setTimeout(() => setNotice(''), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    setValueDraft(component && definition?.property ? componentValueInput(component) : '');
  }, [component?.id, component?.properties, definition?.property]);
  function copy() {
    if (!selected.length) return;
    setClipboard(copySelection(doc, selected, newId, { x: 40, y: 40 }));
    setNotice('복사했어요');
  }
  function paste() {
    if (!clipboard) return;
    const temporary = { ...emptyDocument(), ...clipboard };
    const payload = copySelection(
      temporary,
      [...clipboard.components, ...clipboard.junctions, ...clipboard.wires].map((x) => x.id),
      newId,
      { x: 20, y: 20 },
    );
    if (dispatch({ type: 'Paste', ...payload })) {
      setSelection(payload.components.map((c) => c.id));
      setClipboard(payload);
    }
  }
  function remove() {
    if (dispatch({ type: 'DeleteElements', ids: selected })) setSelection([]);
  }
  function cancelTool() {
    setMeasurementKind(null);
    setMobileMeasuring(false);
    setSourcesDetached(false);
    setPaletteDrag(null);
    setOutputFontPreview(null);
    setOutputTool('select');
    setPlacement(null);
    setTool('select');
    setWiringResetKey((key) => key + 1);
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (feedbackOpen || help) return;
      if ((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) return;
      if (compact && mode === 'worksheet') return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? redoEdit() : undoEdit();
      } else if (modifier && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redoEdit();
      } else if (mode === 'analysis') {
        if (event.key === 'Escape') cancelTool();
        return;
      } else if (mode === 'worksheet') {
        if (event.key === 'Escape') {
          cancelTool();
          setSelection([]);
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          dispatch({
            type: 'DeleteElements',
            ids: selected.filter((id) => doc.annotations.some((a) => a.id === id)),
          });
          setSelection([]);
        }
        return;
      } else if (modifier && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelection(doc.components.map((c) => c.id));
      } else if (modifier && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copy();
      } else if (modifier && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        paste();
      } else if (event.key === 'Escape') {
        cancelTool();
        setSelection([]);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        remove();
      } else if (event.key.toLowerCase() === 'r')
        dispatch({ type: 'RotateComponents', ids: selected });
      else if (event.key.toLowerCase() === 'w') {
        setPlacement(null);
        setTool('wire');
      } else if (event.key.startsWith('Arrow') && selected.length) {
        event.preventDefault();
        const step = event.shiftKey ? 100 : 20;
        dispatch({
          type: 'MoveComponents',
          positions: Object.fromEntries(
            doc.components
              .filter((c) => selected.includes(c.id))
              .map((c) => [
                c.id,
                {
                  x:
                    c.position.x +
                    (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
                  y:
                    c.position.y +
                    (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0),
                },
              ]),
          ),
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  function place(
    type: ComponentType,
    position: Point,
    target?: { wireId: string; segment: number },
  ) {
    const c = createComponent(type, newId(componentDefinitions[type].short), position);
    const added = placeComponent(c, target ? { ...target, newWireId: newId('W') } : undefined);
    if (!added.ok) {
      setNotice('부품을 놓을 수 없어요. 삽입 공간과 편집 권한을 확인해 주세요.', 'error');
      return;
    }
    setSelection([c.id]);
    cancelTool();
  }
  const currentAnchor = anchorPose(doc, measurementAnchors.current)
    ? measurementAnchors.current
    : null;
  const currentTarget =
    currentAnchor && currentAnchor.kind !== 'endpoint'
      ? { kind: currentAnchor.kind, id: currentAnchor.id }
      : null;
  const currentReading = useMemo(
    () => probeCurrent(doc, compilation, result, currentTarget),
    [doc, compilation, result, currentAnchor],
  );
  function placeMeasurement(which: MeasurementTool, anchor: MeasurementAnchor | null) {
    setMeasurementAnchors((previous) => ({ ...previous, [which]: anchor }));
    if (which === 'red' && anchor) setActiveProbe('black');
  }
  function endpoint(endpoint: EndpointRef) {
    if (tool === 'reference') {
      dispatch({ type: 'SetReference', endpoint });
      cancelTool();
      setNotice(`0 V 기준점: ${endpointName(doc, endpoint.id)}`);
      return;
    }
    if (measurementActive) {
      if (measurementKind !== 'current')
        placeMeasurement(activeProbe, {
          kind: 'endpoint',
          id: endpoint.id,
          endpointKind: endpoint.kind,
        });
      return;
    }
    if (mode === 'analysis') {
      selectNet(compilation.circuit.endpointToNet[endpoint.id]);
      return;
    }
  }
  function onWire(id: string) {
    if (measurementActive) {
      placeMeasurement(
        measurementKind === 'current' ? 'current' : activeProbe,
        defaultWireAnchor(doc, id),
      );
      return;
    }
    selectElement(id);
  }

  function commitWiring(commands: readonly Command[]) {
    if (mode !== 'build') return false;
    const applied = execute(commands);
    if (!applied.ok) {
      setNotice(
        applied.diagnostics
          .map((d) => diagnosticText[d.code]?.title ?? '연결을 변경할 수 없습니다.')
          .join(' · '),
      );
      return false;
    }
    return true;
  }
  function toggleSwitch(id: string): boolean {
    const component = doc.components.find((c) => c.id === id);
    if (!component || component.type !== 'switch') return false;
    return dispatch({
      type: 'SetProperties',
      id,
      properties: { state: component.properties.state === 'closed' ? 'open' : 'closed' },
    });
  }
  function applyValue() {
    if (!component || !definition?.property) return;
    const parsed = parseComponentValue(component, valueDraft);
    if (!parsed.ok) {
      setNotice(parsed.error);
      return;
    }
    const value = parsed.value;
    if (
      q.equal(value, component.properties[definition.property] as q.Scalar) &&
      (parsed?.fraction ?? '') === (component.properties[definition.property + 'Fraction'] ?? '')
    )
      return;
    dispatch({
      type: 'SetProperties',
      id: component.id,
      properties: {
        [definition.property]: value,
        [definition.property + 'Fraction']: parsed?.fraction ?? '',
      },
    });
  }
  function applyQuantityMode(next: QuantityMode, all = false) {
    if (!component) return;
    const commands: Command[] = (all ? doc.components : [component])
      .filter((c) => quantityFormatFor(c.properties).mode !== next)
      .map((c) => ({ type: 'SetProperties', id: c.id, properties: { quantityMode: next } }));
    if (!commands.length) return;
    const applied = execute(commands);
    if (!applied.ok) setNotice('표시 방식을 바꿀 수 없습니다.', 'error');
    else if (all) setNotice('모든 부품에 표시 방식을 적용했습니다.');
  }
  const quantityControl = component ? (
    <QuantityDisplaySelect
      key={component.id}
      value={quantityFormatFor(component.properties).mode ?? 'auto'}
      onChange={(next) => applyQuantityMode(next)}
      onApplyAll={() =>
        applyQuantityMode(quantityFormatFor(component.properties).mode ?? 'auto', true)
      }
    />
  ) : null;
  function replace(document: CircuitDocument) {
    if (dispatch({ type: 'ReplaceDocument', document })) {
      setSelection([]);
      cancelTool();
      setCustomPathIds([]);
      setActivePath(0);
      return true;
    }
    return false;
  }
  function newCircuit() {
    if (!replace(emptyDocument(newId('circuit-')))) return;
    changeMode('build');
    setDetailsOpen(false);
    setPresentation(false);
  }
  function setSelection(ids: string[], net: string | null = null) {
    setSelected(ids);
    setSelectedNet(net);
    setHovered(null);
  }
  function selectNet(netId: string) {
    setSelection([], netId);
  }
  function selectElement(id: string | null, additive?: boolean) {
    if (measurementActive) {
      if (id === null) setSelection([]);
      else if (doc.components.some((c) => c.id === id)) {
        setSelection([id]);
        if (measurementKind === 'current') placeMeasurement('current', { kind: 'component', id });
      }
      return;
    }
    if (tool === 'path' && id) {
      setCustomPathIds((ids) => [...ids, id]);
      setHovered(id);
      return;
    }
    const wire = mode === 'analysis' ? doc.wires.find((w) => w.id === id) : undefined;
    setSelection(
      id === null
        ? []
        : additive
          ? selected.includes(id)
            ? selected.filter((x) => x !== id)
            : [...selected, id]
          : [id],
      wire ? compilation.circuit.endpointToNet[wire.start.id] : null,
    );
  }
  function downloadJson() {
    try {
      const data = serializeDocument(doc);
      const blob = new Blob([data], { type: 'application/json' });
      saveBlob(blob, `${doc.title || '회로'}.json`);
      setNotice('회로 파일을 저장했어요');
    } catch {
      setNotice('회로 파일을 저장하지 못했어요. 다시 시도해 주세요.', 'error');
    }
  }
  async function openFile(file?: File) {
    if (!file) return;
    try {
      const parsed = parseDocument(await file.text());
      if (parsed.ok) {
        replace(parsed.document);
        setNotice('회로 파일을 열었습니다.');
      } else
        setNotice(
          '이 파일을 열 수 없어요. 파일 형식이나 연결 정보가 올바르지 않습니다. 다른 회로 파일을 골라 주세요.',
          'error',
        );
    } catch {
      setNotice('파일을 읽지 못했어요. 다시 골라 주세요.', 'error');
    }
    if (fileInput.current) fileInput.current.value = '';
  }
  function changeMode(next: Mode) {
    setMode(next);
    if (compact) { setDetailsOpen(false); setPresentation(false); }
    cancelTool();
    setHovered(null);
    setSelected((ids) =>
      next === 'worksheet'
        ? ids.filter(
            (id) =>
              doc.components.some((c) => c.id === id) || doc.annotations.some((a) => a.id === id),
          )
        : ids.filter((id) => !doc.annotations.some((a) => a.id === id)),
    );
  }
  const settingsButton = (
    <button
      ref={settingsTrigger}
      className="settings-toggle"
      aria-label={mode === 'worksheet' ? '표시 설정' : '상세 설정'}
      aria-expanded={detailsOpen}
      onClick={() => setDetailsOpen((v) => !v)}
    >
      <SlidersHorizontal size={17} />
      <span>{mode === 'worksheet' ? '표시 설정' : '상세 설정'}</span>
    </button>
  );
  const modeNavigation = <nav className="modebar" aria-label="작업 모드">
    <div className="mode-tabs">
      <button aria-pressed={mode === 'build'} className={mode === 'build' ? 'active' : ''} onClick={() => changeMode('build')}><MousePointer2 size={16} />회로 만들기</button>
      <button aria-pressed={mode === 'analysis'} className={mode === 'analysis' ? 'active' : ''} onClick={() => changeMode('analysis')}><Zap size={16} />분석하기</button>
      {!compact && <button aria-pressed={mode === 'worksheet'} className={mode === 'worksheet' ? 'active' : ''} onClick={() => changeMode('worksheet')}><Copy size={16} />회로도 출력</button>}
    </div>
    {!compact && <button className="presentation-toggle" onClick={() => setPresentation(v => !v)}>{presentation ? '편집 화면' : '수업 화면'}</button>}
  </nav>;
  const viewSwitcher = <div className="segmented" role="group" aria-label="회로 차원">
    {(['2d', '3d'] as const).map(view => <button key={view} aria-pressed={analysisView === view} className={analysisView === view ? 'active' : ''} onClick={() => chooseView(view)}>{view.toUpperCase()}</button>)}
  </div>;
  const togglePotentialColors = () => setShowColors(value => !value);
  const toggleCurrentDisplay = () => setShowCurrent(value => !value);
  const mobileViewControls = <>
    {viewSwitcher}
    <div className="segmented compact-layers" role="group" aria-label="회로 표시">
      <button className={showColors ? 'active' : ''} aria-pressed={showColors} onClick={togglePotentialColors}>전위</button>
      <button className={showCurrent ? 'active' : ''} aria-pressed={showCurrent} onClick={toggleCurrentDisplay}>전류</button>
    </div>
    <button className="compact-measure-start" onClick={() => chooseMeasurement(measurementKind ?? 'voltage')}>측정</button>
    <FloatingPanel label="보기 더보기" contentLabel="보기 더보기" className="compact-more" contentClassName="action-menu-content" role="menu" trigger={<Ellipsis size={18} />}>
      {close => <>
        <div className="compact-palette-row">
          <span>전위 색상표</span>
          <PotentialPalettePicker value={potentialPalette} min={potential.min} max={potential.max} onChange={setPotentialPalette} />
        </div>
        <hr />
        <button role="menuitem" onClick={() => close(() => setAnalysisPanel('records'))}><NotebookPen size={16} />측정 기록 보기</button>
        <button role="menuitem" onClick={() => close(() => setDetailsOpen(true))}><SlidersHorizontal size={16} />상세 설정</button>
      </>}
    </FloatingPanel>
  </>;
  const canvasDiagnostics =
    !isolated && result.diagnostics.length > 0 ? (
      <CanvasDiagnostics
        key={`${documentEpoch}:${doc.documentId}:${mode}`}
        document={doc}
        diagnostics={result.diagnostics}
        onLocate={(ids) => {
          setSelection(ids);
          setFocusIds([...ids]);
        }}
      />
    ) : null;
  const circuitCanvas = (
    <CircuitCanvas
      paletteDrag={paletteDrag}
      preserveViewOnResize={mode === 'analysis'}
      initialView={
        canvasView.current?.documentId === doc.documentId ? canvasView.current.view : undefined
      }
      onViewChange={(view) => {
        canvasView.current = { documentId: doc.documentId, view };
      }}
      viewLabel={
        showOperatingState ? (
          <div
            className="potential-reference"
            data-tooltip={`접지(0V): ${doc.referenceNode ? endpointName(doc, doc.referenceNode.id) : '미지정'}`}
          >
            <span>접지(0V):</span>
            <Notation
              symbol
              text={doc.referenceNode ? endpointName(doc, doc.referenceNode.id) : '미지정'}
            />
          </div>
        ) : undefined
      }
      document={doc}
      largeLabels={presentation}
      measurement={
        measurementActive
          ? {
              disconnectSources: isolated,
              tool: measurementKind === 'current' ? 'current' : activeProbe,
              anchors: measurementAnchors,
              amperes: currentReading.ok ? currentReading.value.amperes : undefined,
              onPlace: placeMeasurement,
              onActivate: (which) => {
                if (which !== 'current') setActiveProbe(which);
              },
            }
          : undefined
      }
      readOnly={mode === 'analysis'}
      readOnlyLabel="분석 회로"
      allowValueEditing={mode === 'analysis' && !measurementActive}
      onWiringCommit={mode === 'build' ? commitWiring : undefined}
      wiringResetKey={wiringResetKey}
      selected={
        measurementActive
          ? measurementKind === 'current'
            ? currentTarget
              ? [currentTarget.id]
              : []
            : []
          : selected
      }
      tool={measurementActive ? 'probe' : tool}
      placement={placement}
      currentDisplay={
        showOperatingState &&
        showCurrent &&
        !(analysisView === '3d' && (potentialStatus === 'entering' || potentialStatus === 'ready'))
          ? currentDisplay
          : undefined
      }
      endpointColors={
        showOperatingState && showColors
          ? Object.fromEntries(Object.entries(potential.endpoints).map(([id, v]) => [id, v.color]))
          : undefined
      }
      endpointGroups={compilation.circuit.endpointToNet}
      endpointLabels={
        showOperatingState && showNumbers
          ? Object.fromEntries(
              Object.entries(potential.endpoints).map(([id, v]) => [
                id,
                formatQuantity(v.exactVoltage, 'V'),
              ]),
            )
          : undefined
      }
      highlightedEndpoints={
        mode === 'analysis' && selectedNet ? potential.nets[selectedNet]?.endpointIds : undefined
      }
      highlightedElements={!measurementActive && hovered ? [hovered] : undefined}
      onHoverElement={setHovered}
      onSelect={selectElement}
      onMove={(positions) => dispatch({ type: 'MoveComponents', positions })}
      onPlace={place}
      onEndpoint={endpoint}
      onWire={onWire}
      focusIds={focusIds}
      onCancel={cancelTool}
      onCommitComponent={(id, edit) => {
        const c = doc.components.find((c) => c.id === id);
        if (!c || mode === 'worksheet') return false;
        const commands: Command[] = [];
        if (edit.label !== c.label) commands.push({ type: 'SetLabel', id, label: edit.label });
        const property = componentDefinitions[c.type].property;
        const properties: ComponentProperties = {};
        if (edit.range) {
          const parameter = adjustableParameter(c);
          if (mode !== 'build' || !parameter) return false;
          Object.assign(properties, parameterRangeProperties(parameter, edit.range));
        }
        if (property && edit.value !== undefined) {
          properties[property] = edit.value;
          properties[property + 'Fraction'] = edit.fraction ?? '';
        }
        if (Object.entries(properties).some(([key, value]) => (c.properties[key] ?? '') !== value))
          commands.push({ type: 'SetProperties', id, properties });
        const applied = execute(commands);
        if (!applied.ok) return false;
        return true;
      }}
      onAction={
        mode === 'build'
          ? (action) =>
              action === 'rotate'
                ? dispatch({ type: 'RotateComponents', ids: selected })
                : action === 'copy'
                  ? copy()
                  : remove()
          : undefined
      }
      onValue={(id) => {
        setSelection([id]);
        setDetailsOpen(true);
        window.setTimeout(() => valueInput.current?.focus(), 0);
      }}
      onSwitch={toggleSwitch}
      onBackground={() => {}}
    />
  );
  return (
    <div
      className={`app-shell mode-${mode}${compact ? ' compact-layout' : ''}${compact && controlledComponent ? ' parameter-open' : ''}${mode === 'analysis' && analysisView === '3d' ? ' view-3d' : ''}${detailsOpen ? ' details-open' : ''}${presentation ? ' presentation' : ''}`}
    >
      <Tooltip />
      <header className="topbar">
        <a className="brand" aria-label="회로 실험실" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-mark">
            <CircuitBoard size={23} />
          </span>
          <span>회로 실험실</span>
        </a>
        <div className="document-heading">
          <input
            aria-label="회로 제목"
            key={doc.documentId + doc.title}
            defaultValue={doc.title}
            onBlur={(e) => {
              if (e.target.value !== doc.title)
                replace({ ...cloneDocument(doc), title: e.target.value });
            }}
          />
          <span
            className={`save-state ${saveStatus}`}
            role="status"
            data-tooltip={saveStatusLabel}
            aria-label={saveStatusLabel}
          >
            {saveStatus === 'saved' ? (
              <Check size={15} />
            ) : saveStatus === 'saving' ? (
              <LoaderCircle size={15} />
            ) : (
              <AlertCircle size={16} />
            )}
          </span>
        </div>
        {compact && modeNavigation}
        <div className="top-actions">
          <FileMenu
            compact={compact}
            extraItems={compact ? close => <>
              <button role="menuitem" onClick={() => close(() => changeMode('worksheet'))}><Copy size={16} />회로도 출력</button>
            </> : undefined}
            document={doc}
            onNew={newCircuit}
            onOpen={() => fileInput.current?.click()}
            onSave={downloadJson}
            onRestore={replace}
            onNotice={setNotice}
          />
          <button onClick={() => setFeedbackOpen(true)} aria-label="사용 후기 및 피드백">
            <MessageCircle size={18} />
            {!compact && '한마디'}
          </button>
          <button onClick={() => setHelp(true)} aria-label="사용 도움말">
            <CircleHelp size={19} />
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => void openFile(e.target.files?.[0])}
        />
      </header>
      {feedbackOpen && (
        <Suspense fallback={<FeedbackLoading onClose={() => setFeedbackOpen(false)} />}>
          <FeedbackFeature onClose={() => setFeedbackOpen(false)} />
        </Suspense>
      )}
      {!compact && modeNavigation}
      <div className="workspace">
        <aside className="library-panel" hidden={mode === 'worksheet'}>
          {mode === 'analysis' ? (!compact &&
            <AnalysisTools
              kind={measurementKind}
              onChoose={chooseMeasurement}
              needsIsolation={needsIsolation}
              onIsolate={() => setSourcesDetached(true)}
              threeDimensional={analysisView === '3d'}
            />
          ) : (!compact &&
            <>
              <div className="section-heading">
                <h2>부품</h2>
              </div>
              <ComponentPalette
                key={mode}
                resetKey={doc}
                placement={placement}
                onChoose={(type) => {
                  setPlacement(type);
                  setTool('select');
                  setWiringResetKey((key) => key + 1);
                }}
                onClear={() => setPlacement(null)}
                onDrag={(event) => {
                  setPaletteDrag(event);
                  if (event.phase === 'cancel') setPlacement(null);
                }}
              />
              <div className="library-divider" />
              <div className="section-heading">
                <h2>시작하기</h2>
              </div>
              <button
                className="wide-button new-circuit-button"
                aria-label="빈 회로 만들기"
                onClick={newCircuit}
              >
                <Plus size={16} aria-hidden="true" />
                <span className="new-circuit-desktop-label">빈 회로 만들기</span>
                <span className="new-circuit-mobile-label">빈 회로</span>
              </button>
              <ExampleMenu documentId={doc.documentId} onSelect={replace} />
              <div className="palette-start-divider" aria-hidden="true" />
            </>
          )}
          <div
            className="analysis-console-host"
            ref={setMeasurementConsoleHost}
            hidden={mode !== 'analysis'}
          />
          {mode === 'analysis' &&
            adjustableComponents.map((adjustableComponent) => {
              const parameter = adjustableParameter(adjustableComponent)!;
              return (
                <section
                  key={`${documentEpoch}:${doc.documentId}:${adjustableComponent.id}:${q.exactText(parameter.min)}:${q.exactText(parameter.max)}`}
                  className="parameter-panel"
                  aria-label="가변저항 조절"
                  hidden={controlledComponent?.id !== adjustableComponent.id}
                >
                  <div className="section-heading">
                    <h2>가변저항</h2>
                    {compact && <button aria-label="가변저항 조절 닫기" onClick={() => setSelection([])}><X size={16} /></button>}
                    <span className="parameter-name">
                      <Notation symbol text={adjustableComponent.label} />
                    </span>
                  </div>
                  <ParameterControl
                    onAdjustingChange={onParameterAdjusting}
                    component={adjustableComponent}
                    parameter={parameter}
                    disabled={
                      !!doc.activity && !doc.activity.allowedCommands.includes('SetProperties')
                    }
                    onChange={(value, group, fraction) => {
                      if (
                        q.equal(value,parameter.value) &&
                        (fraction ?? '') ===
                          (adjustableComponent.properties[parameter.property + 'Fraction'] ?? '')
                      )
                        return true;
                      return execute(
                        {
                          type: 'SetProperties',
                          id: adjustableComponent.id,
                          properties: {
                            [parameter.property]: value,
                            [parameter.property + 'Fraction']: fraction ?? '',
                            [parameter.minimumProperty]: parameter.min,
                            [parameter.maximumProperty]: parameter.max,
                          },
                        },
                        group,
                      ).ok;
                    }}
                  />
                </section>
              );
            })}
        </aside>
        <main className="canvas-column">
          <div className="editor-toolbar" hidden={mode !== 'build'}>
            {compact && <FloatingPanel label="부품 추가" contentLabel="부품 추가" trigger={<><Plus size={17} />부품</>} className="compact-parts" contentClassName="compact-parts-panel" align="start" width={330}>
              {close => <>
                <ComponentPalette tapOnly resetKey={doc} placement={placement} onChoose={type => close(() => {setPlacement(type);setTool('select');setWiringResetKey(key => key + 1);})} onClear={() => close(() => setPlacement(null))} />
                <details className="compact-examples"><summary>예제 회로</summary><ExampleChoices documentId={doc.documentId} onSelect={document => close(() => replace(document))} /></details>
              </>}
            </FloatingPanel>}
            <div className="tool-group desktop-editor-tools">
              {[
                { id: 'select', label: '선택', Icon: MousePointer2 },
                { id: 'wire', label: '배선', Icon: Cable },
                { id: 'reference', label: '접지(0V)', Icon: GroundIcon },
              ].map(({ id, label, Icon }) => (
                <button
                  key={id}
                  aria-pressed={tool === id && !placement}
                  className={tool === id && !placement ? 'active' : ''}
                  data-tooltip={label}
                  aria-label={label}
                  onClick={() => {
                    setTool(id);
                    setPlacement(null);
                    setWiringResetKey((key) => key + 1);
                  }}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <span className="toolbar-separator" />
            <div className="tool-group">
              <button
                aria-label="실행 취소"
                data-tooltip="실행 취소 Ctrl+Z"
                disabled={!history.past.length}
                onClick={() => undoEdit()}
              >
                <Undo2 size={18} />
              </button>
              <button
                aria-label="다시 실행"
                data-tooltip="다시 실행 Ctrl+Shift+Z"
                disabled={!history.future.length}
                onClick={() => redoEdit()}
              >
                <Redo2 size={18} />
              </button>
            </div>
            {compact ? <FloatingPanel label="편집 더보기" contentLabel="편집 더보기" className="compact-edit-more" contentClassName="action-menu-content" role="menu" trigger={<Ellipsis size={18} />}>
              {close => <>
                <button role="menuitem" onClick={() => close(() => { setTool('reference'); setPlacement(null); setWiringResetKey(key => key + 1); })}><GroundIcon size={16} />접지(0V) 지정</button>
                <button role="menuitem" onClick={() => close(() => setDetailsOpen(true))}><SlidersHorizontal size={16} />상세 설정</button>
              </>}
            </FloatingPanel> : settingsButton}
          </div>
          {mode === 'worksheet' && <div id="worksheet-actions" className="worksheet-topbar" />}
          {mode === 'analysis' && !compact && (
            <div className={`potential-controls${isolated || !showColors ? ' no-legend' : ''}`}>
              {viewSwitcher}
              <label>
                <input
                  type="checkbox"
                  disabled={isolated}
                  checked={!isolated && showColors}
                  onChange={togglePotentialColors}
                />
                색상
              </label>
              <label>
                <input
                  type="checkbox"
                  disabled={isolated}
                  checked={!isolated && showNumbers}
                  onChange={(e) => setShowNumbers(e.target.checked)}
                />
                숫자
              </label>
              <label className="potential-current">
                <input
                  type="checkbox"
                  disabled={isolated}
                  checked={!isolated && showCurrent}
                  onChange={toggleCurrentDisplay}
                />
                전류 흐름
              </label>
              <button
                disabled={isolated}
                aria-expanded={showGraph}
                onClick={() => setAnalysisPanel(showGraph ? null : 'path')}
              >
                경로 그래프
              </button>
              <div className="potential-legend-tools">
                <div className="potential-legend" hidden={isolated || !showColors}>
                  {potential.undefinedCount === Object.keys(potential.nets).length ? (
                    <span>전위 미정</span>
                  ) : (
                    <>
                      <span>{formatQuantity(potentialAxisValue(potential,potential.min), 'V')}</span>
                      <PotentialPalettePicker
                        value={potentialPalette}
                        min={potential.min}
                        max={potential.max}
                        onChange={setPotentialPalette}
                      />
                      <span>{formatQuantity(potentialAxisValue(potential,potential.max), 'V')}</span>
                    </>
                  )}
                </div>
                {settingsButton}
              </div>
            </div>
          )}
          <div hidden={mode !== 'analysis'} className="measurement-workspace">
            <MeasurementPanel
              mobile={compact ? {
                viewControls: mobileViewControls, measuring: mobileMeasuring,
                onBack: () => { setMobileMeasuring(false); setAnalysisPanel(null); if (measurementKind === 'resistance') chooseMeasurement(null); },
                onChoose: chooseMeasurement, needsIsolation, onIsolate: () => setSourcesDetached(true),
              } : undefined}
              consoleHost={measurementConsoleHost}
              kind={measurementKind}
              onExit={() => chooseMeasurement(null)}
              enabled={measurementEnabled}
              isolated={isolated}
              panel={analysisPanel}
              onPanel={setAnalysisPanel}
              document={doc}
              compilation={compilation}
              result={result}
              voltageReading={voltageReading}
              voltageLabel={voltageLabel}
              active={mode === 'analysis'}
              red={redProbe}
              black={blackProbe}
              activeProbe={activeProbe}
              anchors={measurementAnchors}
              currentReading={currentReading}
              onReset={() => setMeasurementAnchors({ red: null, black: null, current: null })}
              onSwap={() => setMeasurementAnchors((a) => ({ ...a, red: a.black, black: a.red }))}
              onActiveProbe={(probe) => {
                setActiveProbe(probe);
                setPotentialView('2d');
              }}
            >
              {mode === 'analysis' && (
                <PotentialWorkspace
                  sceneIdentity={`${documentEpoch}:${doc.documentId}`}
                  heightRange={comparisonScales?.height}
                  overlayControls={
                    <>
                      {canvasDiagnostics}
                      {showOperatingState && showCurrent && (
                        <CurrentControls
                          paused={currentDisplay.paused}
                          onPause={setCurrentPaused}
                        />
                      )}
                    </>
                  }
                  onStatusChange={setPotentialStatus}
                  active={analysisView === '3d'}
                  sourceView={
                    canvasView.current?.documentId === doc.documentId
                      ? canvasView.current.view
                      : undefined
                  }
                  onReturnTo2D={() => setPotentialView('2d')}
                  document={doc}
                  potential={potential}
                  voltageMeasurement={voltageMeasurement}
                  currentDisplay={showOperatingState && showCurrent ? currentDisplay : undefined}
                  heightMultiplier={heightScale}
                  selectedIds={measurementKind === 'voltage' ? noSelection : selected}
                  highlightedId={hovered}
                  selectedNet={selectedNet}
                  showNumbers={!isolated && showNumbers}
                  showColors={!isolated && showColors}
                  referenceLabel={
                    doc.referenceNode ? endpointName(doc, doc.referenceNode.id) : '미지정'
                  }
                  onSelect={selectElement}
                  onSelectNet={measurementKind === 'voltage' ? undefined : selectNet}
                >
                  {circuitCanvas}
                </PotentialWorkspace>
              )}
            </MeasurementPanel>
          </div>
          {mode !== 'analysis' && (
            <div className="canvas-stage">
              {mode === 'worksheet' ? (
                <OutputCanvas
                  readOnly={compact}
                  document={
                    outputFontPreview === null
                      ? doc
                      : { ...doc, output: { ...doc.output, fontScale: outputFontPreview } }
                  }
                  result={result}
                  options={outputOptions}
                  selected={compact ? noSelection : selected}
                  tool={compact ? 'select' : outputTool}
                  onSelect={selectElement}
                  onInspect={() => {
                    if (window.matchMedia('(min-width: 641px)').matches) setDetailsOpen(true);
                  }}
                  onTool={setOutputTool}
                  dispatch={dispatch}
                  newId={newId}
                />
              ) : (
                circuitCanvas
              )}
              {canvasDiagnostics}
            </div>
          )}
          {showOperatingState && showGraph && !compact && (
            <section className="graph-panel">
              <div className="graph-heading">
                <h2>경로에 따른 전위 변화</h2>
                <select
                  aria-label="전위 그래프 경로"
                  value={customPathIds.length ? 'custom' : String(activePath)}
                  onChange={(e) => {
                    setCustomPathIds([]);
                    setActivePath(Number(e.target.value));
                  }}
                >
                  {paths.map((p, i) => (
                    <option key={p.id} value={i}>
                      {p.steps
                        .map(
                          (s) =>
                            doc.components.find((c) => c.id === s.elementId)?.label ?? s.elementId,
                        )
                        .join(' → ')}
                    </option>
                  ))}
                  {customPathIds.length > 0 && <option value="custom">직접 선택한 경로</option>}
                </select>
                <button
                  onClick={() => {
                    setCustomPathIds([]);
                    chooseMeasurement(null);
                    setTool('path');
                    setPotentialView('2d');
                    setNotice('회로에서 경로를 따라 부품을 순서대로 선택하세요.');
                  }}
                >
                  경로 직접 선택
                </button>
                {customPathIds.length > 0 && (
                  <button
                    onClick={() => {
                      setCustomPathIds([]);
                      setTool('select');
                    }}
                  >
                    초기화
                  </button>
                )}
              </div>
              <PotentialGraph
                document={doc}
                path={path}
                result={result}
                hovered={hovered ?? selected[0] ?? null}
                onHover={setHovered}
              />
              {customPathIds.length > 0 && !path && (
                <p className="graph-note">
                  연속으로 연결된 부품을 선택하세요: {customPathIds.join(' → ')}
                </p>
              )}
            </section>
          )}
        </main>
        <aside className="inspector-panel" hidden={!detailsOpen}>
          <div className="section-heading">
            <h2>
              {mode === 'worksheet'
                ? '표시 설정'
                : mode === 'analysis'
                  ? '분석 설정'
                  : component
                    ? '선택한 부품'
                    : '선택'}
            </h2>
            <button
              aria-label="설정 닫기"
              onClick={() => {
                setDetailsOpen(false);
                settingsTrigger.current?.focus();
              }}
            >
              <X size={16} />
            </button>
          </div>
          <div hidden={mode !== 'worksheet'}>
            <WorksheetPanel
              compact={compact}
              toolbarEnd={settingsButton}
              active={mode === 'worksheet'}
              document={doc}
              result={result}
              selected={compact ? noSelection : selected}
              onSelect={(id) => setSelection([id])}
              dispatch={dispatch}
              onNotice={setNotice}
              tool={outputTool}
              onTool={setOutputTool}
              options={outputOptions}
              onOptions={setOutputOptions}
              onFontPreview={setOutputFontPreview}
              undo={() => undoEdit()}
              redo={() => redoEdit()}
              canUndo={!!history.past.length}
              canRedo={!!history.future.length}
            />
          </div>

          {showOperatingState && (
            <>
            <PotentialSettings
              document={doc}
              potential={potential}
              selectedNet={showNumbers ? selectedNet : null}
              threeDimensional={analysisView === '3d'}
              value={potentialSettings}
              onChange={setPotentialSettings}
            />
            </>
          )}

          {showOperatingState && showCurrent && (
            <CurrentSettings
              document={doc}
              display={currentDisplay}
              selectedId={selected[0]}
              onWidthScale={setCurrentWidthScale}
            />
          )}
          <div hidden={mode === 'worksheet'}>
            {mode === 'analysis' && (
              <label className="field-label">
                값을 바꿀 부품
                <select
                  aria-label="값을 바꿀 부품"
                  value={component?.id ?? ''}
                  onChange={(e) => setSelection(e.target.value ? [e.target.value] : [])}
                >
                  <option value="">부품 선택</option>
                  {doc.components.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {component && definition ? (
              <>
                <div className="selected-component">
                  <span className="selected-icon">{definition.short}</span>
                  <div>
                    <h3>
                      <Notation symbol text={component.label} />
                    </h3>
                    <p>{definition.name}</p>
                  </div>
                </div>
                <div>
                  <label className="field-label">
                    이름
                    <ComponentNameInput
                      key={component.id}
                      label="부품 이름"
                      value={component.label}
                      onCommit={(label) => dispatch({ type: 'SetLabel', id: component.id, label })}
                    />
                  </label>
                  {definition.property && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        applyValue();
                      }}
                    >
                      <label className="field-label">
                        {definition.unit === 'Ω' ? '저항값' : '전압'}
                        <div className="unit-input">
                          <input
                            ref={valueInput}
                            aria-label={`${component.label} 값`}
                            value={valueDraft}
                            onChange={(e) => setValueDraft(e.target.value)}
                            onBlur={applyValue}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                e.stopPropagation();
                                setValueDraft(componentValueInput(component));
                              }
                            }}
                          />
                          <span>{definition.unit}</span>
                        </div>
                      </label>
                      {quantityControl}
                      <p className="tiny-note">
                        {definition.unit === 'Ω'
                          ? '1k, 1.5 kΩ처럼 입력할 수 있어요.'
                          : '9, 1.5 V처럼 입력할 수 있어요.'}
                      </p>
                    </form>
                  )}
                  {mode === 'build' && adjustableParameter(component) && (
                    <ParameterRangeFields
                      key={`range-${component.id}`}
                      component={component}
                      onChange={(properties) =>
                        dispatch({ type: 'SetProperties', id: component.id, properties })
                      }
                    />
                  )}
                  {!definition.property && quantityControl}
                  {component.type === 'switch' && (
                    <SwitchStateButton
                      closed={component.properties.state === 'closed'}
                      onToggle={() => toggleSwitch(component.id)}
                    />
                  )}
                  <div className="selection-actions" hidden={mode !== 'build'}>
                    <button onClick={() => dispatch({ type: 'RotateComponents', ids: selected })}>
                      <RotateCw size={17} />
                      회전
                    </button>
                    <button onClick={copy}>
                      <Copy size={17} />
                      복사
                    </button>
                    <button onClick={remove}>
                      <Trash2 size={17} />
                      삭제
                    </button>
                  </div>
                </div>
                <div hidden={mode === 'analysis' && (isolated || !showNumbers)}>
                  <div className="library-divider" />
                  <div className="section-heading">
                    <h2>빠른 값 보기</h2>
                    <span className="live-label">자동 계산</span>
                  </div>
                  <p className="tiny-note">a → b 방향 · 전원은 + → −</p>
                  <div className="readings">
                    <div>
                      <span>양단 전압</span>
                      <strong>
                        {formatQuantity(
                          result.componentVoltages[component.id],
                          'V',
                          quantityFormatFor(component.properties),
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>가지 전류</span>
                      <strong>
                        {formatQuantity(
                          result.branchCurrents[component.id],
                          'A',
                          quantityFormatFor(component.properties),
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>
                        {q.sign(result.componentPowers[component.id] ?? 0) < 0
                          ? '공급 전력'
                          : '소비 전력'}
                      </span>
                      <strong>
                        {formatQuantity(
                          result.componentPowers[component.id] === undefined ? undefined : q.abs(result.componentPowers[component.id]),
                          'W',
                          quantityFormatFor(component.properties),
                        )}
                      </strong>
                    </div>
                  </div>
                </div>
              </>
            ) : mode === 'build' ? (
              <div className="inspector-empty">
                <MousePointer2 size={24} />
                <p>{selected.length ? '선택한 도선' : '선택한 부품이 없어요'}</p>
              </div>
            ) : null}
            {mode === 'build' && selected.length > 1 && (
              <button
                className="wide-button"
                onClick={() => {
                  const chosen = doc.components.filter((c) => selected.includes(c.id));
                  if (!chosen.length) return;
                  const y = chosen[0].position.y;
                  dispatch({
                    type: 'MoveComponents',
                    positions: Object.fromEntries(chosen.map((c) => [c.id, { ...c.position, y }])),
                  });
                }}
              >
                <AlignHorizontalJustifyCenter size={16} />
                {selected.length}개 가로 정렬
              </button>
            )}
            {mode === 'build' && selected.length > 0 && !component && (
              <button className="wide-button" onClick={remove}>
                <Trash2 size={16} />
                선택 요소 삭제
              </button>
            )}
            {mode === 'build' && clipboard && (
              <button className="wide-button" onClick={paste}>
                <ClipboardPaste size={16} />
                붙여넣기
              </button>
            )}
          </div>
        </aside>
      </div>
      {saveStatus === 'failed' && (
        <div className="save-failure" role="alert">
          <AlertCircle size={17} />
          <span>저장하지 못했어요</span>
          <button onClick={downloadJson}>회로 파일 저장</button>
        </div>
      )}
      {notice.message && (
        <div className={`toast ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          {notice.message}
          <button onClick={() => setNotice('')} aria-label="알림 닫기">
            <X size={16} />
          </button>
        </div>
      )}
      {help && <QuickStartDialog onClose={() => setHelp(false)} />}
    </div>
  );
}
