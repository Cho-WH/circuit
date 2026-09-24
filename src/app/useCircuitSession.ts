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

export type WorkspaceMode = 'build' | 'measure' | 'potential' | 'worksheet';

function allowedInMode(document: CircuitDocument, mode: WorkspaceMode, command: Command) {
  if (command.type === 'ReplaceDocument') return true;
  if (mode === 'measure') return false;
  if (mode !== 'worksheet') return true;
  switch (command.type) {
    case 'SetProperties':
      return Object.keys(command.properties).every((key) =>
        /^(label|answer|voltage|current)(Text|Display|Visible|Blank|OffsetX|OffsetY)$/.test(key),
      );
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
  const [saveStatus, setSaveStatus] = useState<'saving' | 'saved' | 'failed'>('saving');

  function publish(next: History) {
    current.current = next;
    setHistory(next);
  }

  function execute(command: Command | readonly Command[]): ExecuteCommandResult {
    const commands: readonly Command[] = 'type' in command ? [command] : command;
    const denied = commands.find((item) => !allowedInMode(current.current.present, mode, item));
    if (denied)
      return {
        ok: false,
        diagnostics: [diagnostic('COMMAND_NOT_ALLOWED', [], 'error', { command: denied.type })],
      };
    const result =
      'type' in command
        ? executeCommand(current.current, command)
        : executeCommands(current.current, command);
    if (result.ok) publish(result.history);
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
    saveStatus,
    execute,
    placeComponent,
    undo: () => {
      if (mode !== 'measure') publish(undo(current.current));
    },
    redo: () => {
      if (mode !== 'measure') publish(redo(current.current));
    },
  };
}
