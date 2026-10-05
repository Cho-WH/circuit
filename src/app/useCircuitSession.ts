import { useEffect, useRef, useState } from 'react';
import { diagnostic, type CircuitDocument, type ComponentInstance } from '../domain';
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
import { loadLocal, saveLocal } from '../persistence';
import { examples } from '../fixtures';
import { layoutExample } from './examples';
import { analyze } from './analyze';
import { acceptOperatingPoint, analysisLocked, analysisStopped, freshAnalysisSession } from './analysis-session';

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
  const [history, setHistory] = useState(() => {
    const saved = loadLocal();
    return createHistory(saved?.ok ? saved.document : layoutExample(examples[1].document));
  });
  const current = useRef(history);
  const [analysisSession, setAnalysisSession] = useState(freshAnalysisSession);
  const operating = useRef(analysisSession);
  const workspace = useRef(mode);
  workspace.current = mode;
  const group = useRef<{ token: object; base: History; past: History['past'] } | null>(null);
  const [documentEpoch, setDocumentEpoch] = useState(0);
  const [saveStatus, setSaveStatus] = useState<'saving' | 'saved' | 'failed'>('saving');

  function updateOperating(next: typeof analysisSession) {
    operating.current = next;
    setAnalysisSession(next);
  }
  function assess(document: CircuitDocument) {
    const evaluation = analyze(document, operating.current.componentModel);
    updateOperating(acceptOperatingPoint(operating.current, evaluation.assessment,
      evaluation.result.provenance?.physicalModel === 'component'));
  }
  function changeWorkspace(next: WorkspaceMode) {
    if (next === workspace.current && (next !== 'analysis' || operating.current.active)) return;
    workspace.current = next;
    updateOperating(freshAnalysisSession());
    if (next === 'analysis') assess(current.current.present);
  }
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
    const commands: readonly Command[] = 'type' in command ? [command] : command;
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
      if (commands.some((item) => item.type === 'ReplaceDocument'))
        setDocumentEpoch((value) => value + 1);
      if (workspace.current === 'analysis') assess(result.history.present);
      publish(result.history);
    }
    return result;
  }

  // The first source gets a reference when permitted, in the same undo step.
  // Denying SetReference must still allow the independently permitted placement.
  function placeComponent(
    component: ComponentInstance,
    target?: { wireId: string; segment: number; newWireId: string },
  ): ExecuteCommandResult {
    const result = execute(
      target
        ? { type: 'InsertComponentOnWire', component, ...target }
        : { type: 'AddComponent', component },
    );
    if (!result.ok) return result;
    if (result.history.present.referenceNode || component.type !== 'dc-voltage-source')
      return result;
    const reference = executeCommand(result.history, {
      type: 'SetReference',
      endpoint: { kind: 'terminal', id: component.terminals[1].id },
    });
    if (!reference.ok) return result;
    const next = { ...reference.history, past: result.history.past };
    publish(next);
    return { ok: true, history: next };
  }

  useEffect(() => {
    setSaveStatus('saving');
    const timer = window.setTimeout(() => {
      const saved = saveLocal(history.present);
      setSaveStatus(saved.ok ? 'saved' : 'failed');
    }, 450);
    return () => window.clearTimeout(timer);
  }, [history.present]);

  return {
    history,
    documentEpoch,
    saveStatus,
    analysisSession,
    changeWorkspace,
    canMeasure: () => !analysisStopped(operating.current),
    canChangeValues: () => !analysisLocked(operating.current),
    automaticEpoch: () => operating.current.stopEpoch,
    execute,
    placeComponent,
    undo: () => {
      if (analysisLocked(operating.current)) return;
      group.current = null;
      const next = undo(current.current);
      if (workspace.current === 'analysis') assess(next.present);
      publish(next);
    },
    redo: () => {
      if (analysisLocked(operating.current)) return;
      group.current = null;
      const next = redo(current.current);
      if (workspace.current === 'analysis') assess(next.present);
      publish(next);
    },
  };
}
