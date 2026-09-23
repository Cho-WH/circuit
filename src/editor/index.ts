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

export type Command =
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
  | { type: 'AddAnnotation'; annotation: Annotation }
  | { type: 'UpdateAnnotation'; id: string; changes: Partial<Pick<Annotation, 'kind' | 'anchor' | 'content' | 'visibility'>> }
  | { type: 'ReplaceDocument'; document: CircuitDocument }
  | ({ type: 'Paste' } & PastePayload)
  | { type: 'SetWireWaypoints'; paths: Record<string, Point[]> };

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

const HISTORY_CAPACITY = 200;

function commandError(
  code: string,
  affectedIds: string[] = [],
  parameters: Diagnostic['parameters'] = {},
): ExecuteCommandResult {
  return { ok: false, diagnostics: [diagnostic(code, affectedIds, 'error', parameters)] };
}

function missingTargets(ids: Iterable<string>, existingIds: Set<string>): string[] {
  return [...new Set(ids)].filter((id) => !existingIds.has(id)).sort();
}

function clearConnectedWirePaths(document: CircuitDocument, componentIds: Set<string>): void {
  const movedTerminals = new Set(
    document.components
      .filter((component) => componentIds.has(component.id))
      .flatMap((component) => component.terminals.map((terminal) => terminal.id)),
  );
  for (const wire of document.wires) {
    if (movedTerminals.has(wire.start.id) || movedTerminals.has(wire.end.id)) {
      wire.waypoints = [];
    }
  }
}

function applyDelete(document: CircuitDocument, ids: Set<string>): void {
  const removedTerminalIds = new Set(
    document.components
      .filter((component) => ids.has(component.id))
      .flatMap((component) => component.terminals.map((terminal) => terminal.id)),
  );
  const removedJunctionIds = new Set(
    document.junctions.filter((junction) => ids.has(junction.id)).map((junction) => junction.id),
  );
  const removedEndpointIds = new Set([...removedTerminalIds, ...removedJunctionIds]);

  document.components = document.components.filter((component) => !ids.has(component.id));
  document.junctions = document.junctions.filter((junction) => !ids.has(junction.id));
  document.wires = document.wires.filter(
    (wire) =>
      !ids.has(wire.id) &&
      !removedEndpointIds.has(wire.start.id) &&
      !removedEndpointIds.has(wire.end.id),
  );
  document.annotations = document.annotations.filter(
    (annotation) => !ids.has(annotation.id) && !removedEndpointIds.has(annotation.anchor.id),
  );
  if (document.referenceNode && removedEndpointIds.has(document.referenceNode.id)) {
    document.referenceNode = null;
  }
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
    case 'AddComponent':
      document.components.push(command.component);
      break;

    case 'MoveComponents': {
      const ids = Object.keys(command.positions);
      const missing = missingTargets(ids, componentIds);
      if (missing.length) return [diagnostic('COMMAND_TARGET_NOT_FOUND', missing)];
      for (const component of document.components) {
        const position = command.positions[component.id];
        if (position) component.position = { ...position };
      }
      clearConnectedWirePaths(document, new Set(ids));
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
      clearConnectedWirePaths(document, ids);
      break;
    }

    case 'DeleteElements': {
      const ids = new Set(command.ids);
      const missing = missingTargets(ids, allElementIds);
      if (missing.length) return [diagnostic('COMMAND_TARGET_NOT_FOUND', missing)];
      applyDelete(document, ids);
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
        const oldEnd = { ...wire.end };
        wire.end = { kind: 'junction', id: command.junction.id };
        wire.waypoints = [];
        document.wires.push({
          id: command.newWireId,
          start: { kind: 'junction', id: command.junction.id },
          end: oldEnd,
          waypoints: [],
        });
      }
      break;
    }

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

    case 'SetWireWaypoints': {
      const ids = Object.keys(command.paths);
      const missing = missingTargets(ids, wireIds);
      if (missing.length) return [diagnostic('COMMAND_TARGET_NOT_FOUND', missing)];
      for (const wire of document.wires) {
        const waypoints = command.paths[wire.id];
        if (waypoints) wire.waypoints = waypoints.map((point) => ({ ...point }));
      }
      break;
    }
  }
  return document;
}

export function createHistory(document: CircuitDocument): History {
  return { past: [], present: cloneDocument(document), future: [] };
}

export function executeCommand(history: History, command: Command): ExecuteCommandResult {
  const policy = history.present.activity;
  if (policy && !policy.allowedCommands.includes(command.type)) {
    return commandError('COMMAND_NOT_ALLOWED', [], { command: command.type });
  }

  try {
    const applied = applyCommand(history.present, command);
    if (Array.isArray(applied)) return { ok: false, diagnostics: applied };
    const validation = validateDocument(applied);
    if (!validation.ok) return { ok: false, diagnostics: validation.diagnostics };

    const past = [...history.past, cloneDocument(history.present)].slice(-HISTORY_CAPACITY);
    return {
      ok: true,
      history: { past, present: cloneDocument(validation.document), future: [] },
    };
  } catch (error) {
    return commandError('INVALID_COMMAND', [], {
      detail: error instanceof Error ? error.message : String(error),
    });
  }
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
    includedEndpointIds.has(annotation.anchor.id),
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
      anchor: remapEndpoint(annotation.anchor),
    })),
  };
}

export function parseValue(input: string, unit: 'Ω' | 'V' | 'A'): number | null {
  const match = input.match(
    /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([kMmuμµ]?)\s*(Ω|ohm|V|A)?\s*$/,
  );
  if (!match) return null;

  const writtenUnit = match[3];
  const expectedUnits = unit === 'Ω' ? new Set(['Ω', 'ohm']) : new Set([unit]);
  if (writtenUnit && !expectedUnits.has(writtenUnit)) return null;

  const multipliers: Record<string, number> = {
    '': 1,
    k: 1e3,
    M: 1e6,
    m: 1e-3,
    u: 1e-6,
    μ: 1e-6,
    µ: 1e-6,
  };
  const value = Number(match[1]) * multipliers[match[2]];
  if (!Number.isFinite(value) || (unit === 'Ω' && value < 0)) return null;
  return value;
}
