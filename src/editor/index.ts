import { parseQuantity } from '../notation';
import {
  cloneDocument,
  diagnostic,
  validateDocument,
  type Annotation,
  type CircuitDocument,
  type ComponentInstance,
  type Diagnostic,
  type EndpointRef,
  type Junction,
  type Point,
  type Wire,
} from '../domain';
import { connectCrossing, disconnectCrossing, insertComponent, splitWire, preserveConnectedWirePaths } from './wire-edits';
import { shiftWireSegment } from '../wire-geometry';
import { wirePoints } from '../component-library';
import { deleteElements } from './delete-elements';
export { insertionCandidates, type InsertionCandidate } from './wire-edits';

export type Command =
  | { type: 'InsertComponentOnWire'; component: ComponentInstance; wireId: string; segment: number; newWireId: string }
  | { type: 'ConnectCrossing'; point: Point; wireIds: [string,string]; junctionId: string; newWireIds: [string,string] }
  | { type: 'DisconnectCrossing'; junctionId: string }
  | { type: 'ConnectToWire'; start: EndpointRef; wireId: string; point: Point; junctionId: string; newWireId: string; branchId: string; waypoints?: Point[] }
  | { type: 'MoveWireSegment'; wireId: string; segment: number; offset: number }
  | { type: 'AddComponent'; component: ComponentInstance }
  | { type: 'MoveComponents'; positions: Record<string, Point> }
  | { type: 'RotateComponents'; ids: string[] }
  | { type: 'DeleteElements'; ids: string[] }
  | { type: 'ConnectWire'; wire: Wire }
  | {
      type: 'SetProperties';
      id: string;
      properties: Record<string, number | string | boolean>;
    }
  | { type: 'SetLabel'; id: string; label: string }
  | { type: 'SetReference'; endpoint: EndpointRef | null }
  | { type: 'AddJunction'; junction: Junction; wireId?: string; newWireId?: string }
  | { type: 'SetOutputScale'; scale: number }
  | { type: 'AddAnnotation'; annotation: Annotation }
  | { type: 'UpdateAnnotation'; id: string; changes: Partial<Pick<Annotation, 'kind' | 'anchor' | 'content' | 'visibility' | 'position' | 'end' | 'arrow' | 'presentation'>> }
  | { type: 'ReplaceDocument'; document: CircuitDocument }
  | ({ type: 'Paste' } & PastePayload);

export interface PastePayload {
  components: ComponentInstance[];
  wires: Wire[];
  junctions: Junction[];
  annotations: Annotation[];
}

export interface History {
  past: CircuitDocument[];
  present: CircuitDocument;
  future: CircuitDocument[];
}

export type ExecuteCommandResult =
  | { ok: true; history: History }
  | { ok: false; diagnostics: Diagnostic[] };

export type PreviewCommandResult =
  | { ok: true; document: CircuitDocument }
  | { ok: false; diagnostics: Diagnostic[] };

const HISTORY_CAPACITY = 200;

function commandError(
  code: string,
  affectedIds: string[] = [],
  parameters: Diagnostic['parameters'] = {},
): { ok: false; diagnostics: Diagnostic[] } {
  return { ok: false, diagnostics: [diagnostic(code, affectedIds, 'error', parameters)] };
}

function missingTargets(ids: Iterable<string>, existingIds: Set<string>): string[] {
  return [...new Set(ids)].filter((id) => !existingIds.has(id)).sort();
}

function invalidProperties(
  component: ComponentInstance,
  properties: Record<string, number | string | boolean>,
): Diagnostic[] {
  for (const [property, value] of Object.entries(properties)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return [diagnostic('INVALID_COMPONENT_VALUE', [component.id], 'error', { property })];
    }
  }

  if (
    (component.type === 'resistor' || component.type === 'resistive-load') &&
    Object.hasOwn(properties, 'resistanceOhm')
  ) {
    const resistance = properties.resistanceOhm;
    if (typeof resistance !== 'number' || !Number.isFinite(resistance) || resistance < 0) {
      return [
        diagnostic('INVALID_COMPONENT_VALUE', [component.id], 'error', {
          property: 'resistanceOhm',
        }),
      ];
    }
  }

  if (component.type === 'switch' && Object.hasOwn(properties, 'state')) {
    if (properties.state !== 'open' && properties.state !== 'closed') {
      return [
        diagnostic('INVALID_COMPONENT_VALUE', [component.id], 'error', { property: 'state' }),
      ];
    }
  }
  return [];
}

function applyCommand(
  present: CircuitDocument,
  command: Command,
): CircuitDocument | Diagnostic[] {
  if (command.type === 'ReplaceDocument') return command.document;

  const document = cloneDocument(present);
  const componentIds = new Set(document.components.map((component) => component.id));
  const wireIds = new Set(document.wires.map((wire) => wire.id));
  const junctionIds = new Set(document.junctions.map((junction) => junction.id));
  const annotationIds = new Set(document.annotations.map((annotation) => annotation.id));
  const allElementIds = new Set([
    ...componentIds,
    ...wireIds,
    ...junctionIds,
    ...annotationIds,
  ]);

  switch (command.type) {
    case 'InsertComponentOnWire': {
      const error=insertComponent(document,structuredClone(command.component),command.wireId,command.segment,command.newWireId);
      if(error)return error;
      break;
    }
    case 'ConnectCrossing': {
      const error=connectCrossing(document,command.point,command.wireIds,command.junctionId,command.newWireIds);
      if(error)return error;
      break;
    }
    case 'DisconnectCrossing': {
      const error=disconnectCrossing(document,command.junctionId);
      if(error)return error;
      break;
    }
    case 'ConnectToWire': {
      const wire=document.wires.find(w=>w.id===command.wireId);
      if(!wire||!splitWire(document,wire,command.point,command.junctionId,command.newWireId))return [diagnostic('WIRE_EDIT_UNAVAILABLE',[command.wireId],'error',{reason:'target'})];
      document.junctions.push({id:command.junctionId,position:command.point});
      document.wires.push({id:command.branchId,start:command.start,end:{kind:'junction',id:command.junctionId},waypoints:command.waypoints ?? []});
      break;
    }
    case 'MoveWireSegment': {
      const wire = document.wires.find(w => w.id === command.wireId);
      if (!wire) return [diagnostic('COMMAND_TARGET_NOT_FOUND', [command.wireId])];
      const path = shiftWireSegment(wirePoints(present, wire), command.segment, command.offset);
      if (!path) return [diagnostic('INVALID_COMMAND', [command.wireId], 'error', { command: command.type })];
      if (command.offset) wire.waypoints = path.slice(1, -1);
      break;
    }
    case 'AddComponent':
      document.components.push(command.component);
      break;

    case 'MoveComponents': {
      const ids = Object.keys(command.positions);
      const missing = missingTargets(ids, componentIds);
      if (missing.length) return [diagnostic('COMMAND_TARGET_NOT_FOUND', missing)];
      const invalid = ids.filter(id => !Number.isFinite(command.positions[id].x) || !Number.isFinite(command.positions[id].y));
      if (invalid.length) return [diagnostic('INVALID_COMMAND', invalid, 'error', { command: command.type })];
      for (const component of document.components) {
        const position = command.positions[component.id];
        if (position && (position.x !== component.position.x || position.y !== component.position.y)) {
          component.position = { ...position };
        }
      }
      preserveConnectedWirePaths(present, document);
      break;
    }

    case 'RotateComponents': {
      const ids = new Set(command.ids);
      const missing = missingTargets(ids, componentIds);
      if (missing.length) return [diagnostic('COMMAND_TARGET_NOT_FOUND', missing)];
      for (const component of document.components) {
        if (ids.has(component.id)) {
          component.rotation = ((component.rotation + 90) % 360) as ComponentInstance['rotation'];
        }
      }
      preserveConnectedWirePaths(present, document);
      break;
    }

    case 'DeleteElements': {
      const ids = new Set(command.ids);
      const missing = missingTargets(ids, allElementIds);
      if (missing.length) return [diagnostic('COMMAND_TARGET_NOT_FOUND', missing)];
      const junctionTargets = document.junctions.filter(j => ids.has(j.id)).map(j => j.id);
      if (junctionTargets.length) return [diagnostic('INVALID_COMMAND', junctionTargets, 'error', { command: command.type })];
      deleteElements(document, ids);
      break;
    }

    case 'ConnectWire':
      document.wires.push(command.wire);
      break;

    case 'SetProperties': {
      const component = document.components.find((item) => item.id === command.id);
      if (!component) return [diagnostic('COMMAND_TARGET_NOT_FOUND', [command.id])];
      const diagnostics = invalidProperties(component, command.properties);
      if (diagnostics.length) return diagnostics;
      for (const key of ['resistanceOhm','voltageV']) {
        if (key in command.properties && !(key+'Fraction' in command.properties)) delete component.properties[key+'Fraction'];
      }
      component.properties = { ...component.properties, ...command.properties };
      break;
    }

    case 'SetLabel': {
      const component = document.components.find((item) => item.id === command.id);
      if (!component) return [diagnostic('COMMAND_TARGET_NOT_FOUND', [command.id])];
      component.label = command.label;
      break;
    }

    case 'SetReference':
      document.referenceNode = command.endpoint ? { ...command.endpoint } : null;
      break;

    case 'AddJunction': {
      if ((command.wireId === undefined) !== (command.newWireId === undefined)) {
        return [diagnostic('INVALID_COMMAND', [command.junction.id], 'error', { command: command.type })];
      }
      document.junctions.push(command.junction);
      if (command.wireId !== undefined && command.newWireId !== undefined) {
        const wire = document.wires.find((item) => item.id === command.wireId);
        if (!wire) return [diagnostic('COMMAND_TARGET_NOT_FOUND', [command.wireId])];
        if (!splitWire(document, wire, command.junction.position, command.junction.id, command.newWireId)) {
          return [diagnostic('WIRE_EDIT_UNAVAILABLE', [command.wireId], 'error', { reason: 'target' })];
        }
      }
      break;
    }

    case 'SetOutputScale':
      document.output = {...document.output, fontScale: command.scale};
      break;
    case 'AddAnnotation':
      document.annotations.push(command.annotation);
      break;

    case 'UpdateAnnotation': {
      const item = document.annotations.find(a => a.id === command.id);
      if (!item) return [diagnostic('COMMAND_TARGET_NOT_FOUND', [command.id])];
      Object.assign(item, command.changes);
      break;
    }

    case 'Paste':
      document.components.push(...command.components);
      document.wires.push(...command.wires);
      document.junctions.push(...command.junctions);
      document.annotations.push(...command.annotations);
      break;

  }
  return document;
}

export function createHistory(document: CircuitDocument): History {
  return { past: [], present: cloneDocument(document), future: [] };
}

/** The same validated transformation is used by previews and committed edits. No history or persistence. */
export function previewCommand(document: CircuitDocument, command: Command): PreviewCommandResult {
  const policy = document.activity;
  if (policy && !policy.allowedCommands.includes(command.type)) {
    return commandError('COMMAND_NOT_ALLOWED', [], { command: command.type });
  }

  try {
    const applied = applyCommand(document, command);
    if (Array.isArray(applied)) return { ok: false, diagnostics: applied };
    const validation = validateDocument(applied);
    if (!validation.ok) return { ok: false, diagnostics: validation.diagnostics };

    return { ok: true, document: cloneDocument(validation.document) };
  } catch (error) {
    return commandError('INVALID_COMMAND', [], {
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

export function executeCommand(history: History, command: Command): ExecuteCommandResult {
  const preview = previewCommand(history.present, command);
  if (!preview.ok) return preview;
  if (command.type === 'MoveWireSegment' && command.offset === 0) return { ok: true, history };
  // A click, sub-grid movement, or returning to the starting position is not an edit.
  if (command.type === 'MoveComponents' && Object.entries(command.positions).every(([id, p]) => {
    const original = history.present.components.find(c => c.id === id)!;
    return original.position.x === p.x && original.position.y === p.y;
  })) return { ok: true, history };
  const past = [...history.past, cloneDocument(history.present)].slice(-HISTORY_CAPACITY);
  return { ok: true, history: { past, present: preview.document, future: [] } };
}

/** Validate every command, then publish one undo step. Failure never publishes a partial edit. */
export function executeCommands(history: History, commands: readonly Command[]): ExecuteCommandResult {
  if (!commands.length) return { ok: true, history };
  let present = history.present;
  for (const command of commands) {
    const result = previewCommand(present, command);
    if (!result.ok) return result;
    present = result.document;
  }
  if (JSON.stringify(present) === JSON.stringify(history.present)) return { ok: true, history };
  return { ok: true, history: { past: [...history.past, cloneDocument(history.present)].slice(-HISTORY_CAPACITY), present, future: [] } };
}

export function undo(history: History): History {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: cloneDocument(previous),
    future: [cloneDocument(history.present), ...history.future].slice(0, HISTORY_CAPACITY),
  };
}

export function redo(history: History): History {
  if (history.future.length === 0) return history;
  const [next, ...remaining] = history.future;
  return {
    past: [...history.past, cloneDocument(history.present)].slice(-HISTORY_CAPACITY),
    present: cloneDocument(next),
    future: remaining,
  };
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function copySelection(
  document: CircuitDocument,
  ids: string[],
  newId: (prefix: string) => string,
  offset: Point,
): PastePayload {
  const selectedIds = new Set(ids);
  const selectedComponents = document.components.filter((component) => selectedIds.has(component.id));
  const selectedJunctions = document.junctions.filter((junction) => selectedIds.has(junction.id));
  const includedEndpointIds = new Set([
    ...selectedComponents.flatMap((component) =>
      component.terminals.map((terminal) => terminal.id),
    ),
    ...selectedJunctions.map((junction) => junction.id),
  ]);
  const selectedWires = document.wires.filter(
    (wire) => includedEndpointIds.has(wire.start.id) && includedEndpointIds.has(wire.end.id),
  );
  const selectedAnnotations = document.annotations.filter((annotation) =>
    (annotation.anchor ? includedEndpointIds.has(annotation.anchor.id) : selectedIds.has(annotation.id)),
  );

  const idMap = new Map<string, string>();
  for (const component of selectedComponents) {
    idMap.set(component.id, newId('component'));
    for (const terminal of component.terminals) idMap.set(terminal.id, newId('terminal'));
  }
  for (const junction of selectedJunctions) idMap.set(junction.id, newId('junction'));
  for (const wire of selectedWires) idMap.set(wire.id, newId('wire'));
  for (const annotation of selectedAnnotations) idMap.set(annotation.id, newId('annotation'));

  const remapEndpoint = (endpoint: EndpointRef): EndpointRef => ({
    kind: endpoint.kind,
    id: idMap.get(endpoint.id) as string,
  });

  return {
    components: selectedComponents.map((component) => ({
      ...cloneValue(component),
      id: idMap.get(component.id) as string,
      position: {
        x: component.position.x + offset.x,
        y: component.position.y + offset.y,
      },
      terminals: component.terminals.map((terminal) => ({
        ...cloneValue(terminal),
        id: idMap.get(terminal.id) as string,
      })),
    })),
    wires: selectedWires.map((wire) => ({
      ...cloneValue(wire),
      id: idMap.get(wire.id) as string,
      start: remapEndpoint(wire.start),
      end: remapEndpoint(wire.end),
      waypoints: wire.waypoints.map((point) => ({
        x: point.x + offset.x,
        y: point.y + offset.y,
      })),
    })),
    junctions: selectedJunctions.map((junction) => ({
      ...cloneValue(junction),
      id: idMap.get(junction.id) as string,
      position: {
        x: junction.position.x + offset.x,
        y: junction.position.y + offset.y,
      },
    })),
    annotations: selectedAnnotations.map((annotation) => ({
      ...cloneValue(annotation),
      id: idMap.get(annotation.id) as string,
      anchor: annotation.anchor ? remapEndpoint(annotation.anchor) : null,
      ...(annotation.position ? {position: {x: annotation.position.x + offset.x, y: annotation.position.y + offset.y}} : {}),
      ...(annotation.end ? {end: {x: annotation.end.x + offset.x, y: annotation.end.y + offset.y}} : {}),
    })),
  };
}

export function parseValue(input: string, unit: 'Ω' | 'V' | 'A'): number | null {
  return parseQuantity(input,unit)?.value ?? null;
}
