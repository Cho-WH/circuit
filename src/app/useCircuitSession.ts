import { useEffect, useRef, useState } from 'react';
import { diagnostic, defaultOperatingProfileRef, emptyDocument, type CircuitDocument, type ComponentInstance } from '../domain';
import {
  createHistory,
  executeCommand,
  executeCommands,
  undo,
  redo,
  type Command,
  type ExecuteCommandResult,
  type History,
} from '../editor';
import { loadCircuitSession, saveLocal, saveRecoveredLocal, type RecoverySource } from '../persistence';
import { examples } from '../fixtures';
import { layoutExample } from './examples';
import { analyze } from './analyze';
import { acceptOperatingPoint, analysisLocked, analysisStopped, freshAnalysisSession } from './analysis-session';
import { RcSession, hasCapacitor, type RcSessionState } from './rc-session';

export type WorkspaceMode = 'build' | 'analysis' | 'worksheet';

function allowedInMode(document: CircuitDocument, mode: WorkspaceMode, command: Command) {
  if (command.type === 'ReplaceDocument') return true;
  if (mode === 'analysis')
    return ['SetProperties', 'SetLabel', 'SetReference'].includes(command.type);
  if (mode !== 'worksheet') return true;
  switch (command.type) {
    case 'SetProperties':
      return Object.keys(command.properties).every((key) =>
        /^(label|answer|voltage|current)(Visible|Blank|OffsetX|OffsetY)$/.test(key),
      );
    case 'SetLabel':
      return true;
    case 'DeleteElements':
      return command.ids.every((id) =>
        document.annotations.some((annotation) => annotation.id === id),
      );
    case 'SetOutputScale':
    case 'AddAnnotation':
    case 'UpdateAnnotation':
      return true;
    default:
      return false;
  }
}

/** Owns the committed document. Selection, gestures and panel drafts stay in the views. */
export function useCircuitSession(mode: WorkspaceMode) {
  const [startup] = useState(loadCircuitSession);
  const [recovery, setRecovery] = useState(startup.recovery);
  const [readFailed, setReadFailed] = useState(startup.readFailed ?? false);
  const [history, setHistory] = useState(() => createHistory(startup.document ??
    (startup.recovery ? emptyDocument('recovery-pending') : layoutExample(examples[1].document))));
  const current = useRef(history);
  const [analysisSession, setAnalysisSession] = useState(freshAnalysisSession);
  const operating = useRef(analysisSession);
  const workspace = useRef(mode);
  workspace.current = mode;
  const group = useRef<{ token: object; base: History; past: History['past'] } | null>(null);
  const [documentEpoch, setDocumentEpoch] = useState(0);
  const [saveStatus, setSaveStatus] = useState<'saving' | 'saved' | 'failed' | 'paused'>(startup.recovery ? 'paused' : 'saving');
  const [rcSession, setRcSession] = useState<RcSessionState | null>(null);
  const [rc] = useState(() => new RcSession({
    history: () => current.current,
    publish: (next, state) => {
      if (next !== current.current) { group.current = null; publish(next); }
      setRcSession(state);
    },
    now: () => performance.now(),
    reducedMotion: () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  }));
  const inRc = () => workspace.current === 'analysis' && hasCapacitor(current.current.present);

  function updateOperating(next: typeof analysisSession) {
    operating.current = next;
    setAnalysisSession(next);
  }
  function assess(document: CircuitDocument) {
    if (hasCapacitor(document)) {
      updateOperating({ ...freshAnalysisSession(), active: true });
      void rc.enter();
      return;
    }
    const evaluation = analyze(document);
    updateOperating(acceptOperatingPoint(operating.current, evaluation.assessment));
  }
  function changeWorkspace(next: WorkspaceMode) {
    if (next === workspace.current && (next !== 'analysis' || (operating.current.active && (!inRc() || rc.state)))) return;
    rc.cancel();
    workspace.current = next;
    updateOperating(freshAnalysisSession());
    if (next === 'analysis') assess(current.current.present);
  }
  useEffect(() => {
    if (mode !== 'analysis') { rc.cancel(); updateOperating(freshAnalysisSession()); }
    else if (!operating.current.active) assess(current.current.present);
  }, [mode]);
  useEffect(() => () => { rc.cancel(); operating.current = freshAnalysisSession(); }, [rc]);
  useEffect(() => {
    const visibility = () => rc.visibility(document.hidden);
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, [rc]);
  useEffect(() => {
    if (rcSession?.phase !== 'running' && rcSession?.phase !== 'settling') return;
    let frame = 0;
    const tick = (now: number) => {
      rc.tick(now);
      if (rc.state?.phase === 'running' || rc.state?.phase === 'settling') frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [rc, rcSession?.phase]);
  useEffect(() => {
    if (analysisSession.phase !== 'breaking') return;
    const finish = () => {
      if (operating.current === analysisSession)
        updateOperating({ ...analysisSession, phase: 'broken' });
    };
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
    const timer = window.setTimeout(finish, 500);
    return () => window.clearTimeout(timer);
  }, [analysisSession]);

  function publish(next: History) {
    current.current = next;
    setHistory(next);
  }

  function execute(command: Command | readonly Command[], token?: object): ExecuteCommandResult {
    if (recovery) return { ok: false, diagnostics: [diagnostic('DOCUMENT_RECOVERY_REQUIRED')] };
    const commands: readonly Command[] = 'type' in command ? [command] : command;
    // RC electrical edits must go through prepare -> atomic apply. File opening
    // remains an explicit replacement and invalidates every pending RC request.
    if (inRc() && !(commands.length === 1 && commands[0].type === 'ReplaceDocument'))
      return { ok: false, diagnostics: [diagnostic('COMMAND_NOT_ALLOWED', [], 'error', { reason: 'rc-transaction-required' })] };
    const denied = commands.find((item) => analysisLocked(operating.current) || !allowedInMode(current.current.present, workspace.current, item));
    if (denied)
      return {
        ok: false,
        diagnostics: [diagnostic('COMMAND_NOT_ALLOWED', [], 'error', { command: denied.type })],
      };
    const result =
      'type' in command
        ? executeCommand(current.current, command)
        : executeCommands(current.current, command);
    if (result.ok) {
      if (token && group.current?.token !== token)
        group.current = { token, base: current.current, past: result.history.past };
      if (!token) group.current = null;
      if (group.current) {
        const base = group.current.base;
        result.history =
          JSON.stringify(base.present) === JSON.stringify(result.history.present)
            ? base
            : { ...result.history, past: group.current.past };
      }
      if (commands.some((item) => item.type === 'ReplaceDocument')) {
        rc.cancel();
        setDocumentEpoch((value) => value + 1);
      }
      publish(result.history);
      if (workspace.current === 'analysis') assess(result.history.present);
    }
    return result;
  }

  function placeComponent(
    component: ComponentInstance,
    target?: { wireId: string; segment: number; newWireId: string },
  ): ExecuteCommandResult {
    return execute(
      target
        ? { type: 'InsertComponentOnWire', component, ...target }
        : { type: 'AddComponent', component },
    );
  }

  useEffect(() => {
    if (recovery) { setSaveStatus('paused'); return; }
    if (readFailed) { setSaveStatus('failed'); return; }
    setSaveStatus('saving');
    const timer = window.setTimeout(() => {
      const saved = saveLocal(history.present);
      setSaveStatus(saved.ok ? 'saved' : 'failed');
    }, 450);
    return () => window.clearTimeout(timer);
  }, [history.present, recovery, readFailed]);

  function finishRecovery(document: CircuitDocument, source: RecoverySource): boolean {
    const result = saveRecoveredLocal(document, source);
    if (!result.ok) return false;
    group.current = null;
    rc.cancel();
    updateOperating(freshAnalysisSession());
    publish(createHistory(document));
    if (workspace.current === 'analysis') assess(document);
    setRecovery(undefined);
    setReadFailed(false);
    setDocumentEpoch(value => value + 1);
    setSaveStatus('saved');
    return true;
  }

  function canRestore(document: CircuitDocument | undefined): boolean {
    if (!document || inRc() || analysisLocked(operating.current)) return false;
    if (workspace.current === 'build') return true;
    const profiles = (doc: CircuitDocument) => JSON.stringify(doc.components
      .filter(c => c.type === 'diode')
      .map(c => {
        const ref = c.operatingProfile ?? defaultOperatingProfileRef('diode')!;
        return [c.id, ref.id, ref.revision];
      })
      .sort(([a], [b]) => String(a).localeCompare(String(b))));
    return profiles(document) === profiles(current.current.present);
  }
  return {
    canUndo: () => canRestore(current.current.past.at(-1)),
    canRedo: () => canRestore(current.current.future[0]),
    history,
    documentEpoch,
    saveStatus,
    recovery,
    finishRecovery,
    analysisSession,
    rcSession,
    rcPlayback: rc,
    applyRc: (command: Command) => inRc() && !recovery ? rc.apply(command) : Promise.resolve({ ok: false as const, diagnostics: [diagnostic('COMMAND_NOT_ALLOWED')] }),
    changeWorkspace,
    canMeasure: () => inRc() ? rc.canRecord() : !analysisStopped(operating.current),
    canChangeValues: () => inRc() ? rc.state?.phase === 'equilibrium' : !analysisLocked(operating.current),
    automaticEpoch: () => operating.current.stopEpoch,
    execute,
    placeComponent,
    undo: () => {
      if (!canRestore(current.current.past.at(-1))) return;
      group.current = null;
      const next = undo(current.current);
      publish(next);
      if (workspace.current === 'analysis') assess(next.present);
    },
    redo: () => {
      if (!canRestore(current.current.future[0])) return;
      group.current = null;
      const next = redo(current.current);
      publish(next);
      if (workspace.current === 'analysis') assess(next.present);
    },
  };
}
