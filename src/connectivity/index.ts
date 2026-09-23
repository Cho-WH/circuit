import {
  diagnostic,
  validateDocument,
  type CircuitCompiler,
  type CircuitDocument,
  type CompileResult,
  type CompiledCircuit,
  type CompiledElement,
  type ComponentInstance,
  type Diagnostic,
  type Net,
} from '../domain';

export type { CircuitCompiler, CompileResult, CompiledCircuit } from '../domain';

const compareIds = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const endpointMap = (): Record<string, string> => Object.create(null) as Record<string, string>;

const emptyCircuit = (): CompiledCircuit => ({
  nets: [],
  elements: [],
  endpointToNet: endpointMap(),
});

class DisjointSet {
  private readonly parent = new Map<string, string>();

  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    const parent = this.parent.get(id);
    if (parent === undefined) throw new Error(`Unknown endpoint: ${id}`);
    if (parent === id) return id;
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(first: string, second: string): void {
    const firstRoot = this.find(first);
    const secondRoot = this.find(second);
    if (firstRoot === secondRoot) return;
    const [smaller, larger] =
      compareIds(firstRoot, secondRoot) <= 0
        ? [firstRoot, secondRoot]
        : [secondRoot, firstRoot];
    this.parent.set(larger, smaller);
  }
}

function compileNets(document: CircuitDocument): {
  nets: Net[];
  endpointToNet: Record<string, string>;
} {
  const endpointIds = [
    ...document.components.flatMap((component) =>
      component.terminals.map((terminal) => terminal.id),
    ),
    ...document.junctions.map((junction) => junction.id),
  ].sort(compareIds);

  const sets = new DisjointSet();
  for (const endpointId of endpointIds) sets.add(endpointId);
  for (const wire of [...document.wires].sort((left, right) => compareIds(left.id, right.id))) {
    sets.union(wire.start.id, wire.end.id);
  }

  const endpointsByRoot = new Map<string, string[]>();
  for (const endpointId of endpointIds) {
    const root = sets.find(endpointId);
    const group = endpointsByRoot.get(root) ?? [];
    group.push(endpointId);
    endpointsByRoot.set(root, group);
  }

  const endpointToNet = endpointMap();
  const netsById = new Map<string, Net>();
  for (const endpoints of endpointsByRoot.values()) {
    endpoints.sort(compareIds);
    const netId = `net:${endpoints[0]}`;
    netsById.set(netId, { id: netId, endpointIds: endpoints, wireIds: [] });
    for (const endpointId of endpoints) endpointToNet[endpointId] = netId;
  }

  for (const wire of [...document.wires].sort((left, right) => compareIds(left.id, right.id))) {
    netsById.get(endpointToNet[wire.start.id])?.wireIds.push(wire.id);
  }

  const sortedEndpointToNet = endpointMap();
  for (const endpointId of Object.keys(endpointToNet).sort(compareIds)) {
    sortedEndpointToNet[endpointId] = endpointToNet[endpointId];
  }

  return {
    nets: [...netsById.values()].sort((left, right) => compareIds(left.id, right.id)),
    endpointToNet: sortedEndpointToNet,
  };
}

function terminalPair(
  component: ComponentInstance,
  diagnostics: Diagnostic[],
): readonly [string, string] | null {
  if (component.terminals.length !== 2) {
    diagnostics.push(
      diagnostic('UNSUPPORTED_TERMINALS', [component.id], 'error', {
        expected: 2,
        actual: component.terminals.length,
      }),
    );
    return null;
  }

  if (component.type !== 'dc-voltage-source') {
    return [component.terminals[0].id, component.terminals[1].id];
  }

  const positive = component.terminals.filter((terminal) => terminal.role === 'positive');
  const negative = component.terminals.filter((terminal) => terminal.role === 'negative');
  const hasPolarityRole = positive.length > 0 || negative.length > 0;
  if (!hasPolarityRole) return [component.terminals[0].id, component.terminals[1].id];
  if (positive.length !== 1 || negative.length !== 1) {
    diagnostics.push(
      diagnostic(
        'UNSUPPORTED_TERMINALS',
        [component.id, ...component.terminals.map((terminal) => terminal.id)],
        'error',
        { reason: 'AMBIGUOUS_SOURCE_POLARITY' },
      ),
    );
    return null;
  }
  return [positive[0].id, negative[0].id];
}

function numericValue(
  component: ComponentInstance,
  diagnostics: Diagnostic[],
): number | null {
  let propertyName: 'voltageV' | 'resistanceOhm' | null = null;
  if (component.type === 'dc-voltage-source') propertyName = 'voltageV';
  if (component.type === 'resistor' || component.type === 'resistive-load') {
    propertyName = 'resistanceOhm';
  }
  if (propertyName === null) return 0;

  const value = component.properties[propertyName];
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (propertyName === 'resistanceOhm' && value < 0)
  ) {
    diagnostics.push(
      diagnostic('INVALID_COMPONENT_VALUE', [component.id], 'error', {
        property: propertyName,
      }),
    );
    return null;
  }
  return value;
}

function hasValidSwitchState(
  component: ComponentInstance,
  diagnostics: Diagnostic[],
): boolean {
  if (component.type !== 'switch') return true;
  if (component.properties.state === 'open' || component.properties.state === 'closed') {
    return true;
  }
  diagnostics.push(
    diagnostic('INVALID_COMPONENT_VALUE', [component.id], 'error', { property: 'state' }),
  );
  return false;
}

function compileElements(
  document: CircuitDocument,
  endpointToNet: Record<string, string>,
  diagnostics: Diagnostic[],
): CompiledElement[] {
  const elements: CompiledElement[] = [];
  for (const component of [...document.components].sort((left, right) =>
    compareIds(left.id, right.id),
  )) {
    const terminals = terminalPair(component, diagnostics);
    const value = numericValue(component, diagnostics);
    const validSwitchState = hasValidSwitchState(component, diagnostics);
    if (!terminals || value === null || !validSwitchState) continue;

    elements.push({
      id: component.id,
      type: component.type,
      a: endpointToNet[terminals[0]],
      b: endpointToNet[terminals[1]],
      value,
      closed: component.type === 'switch' && component.properties.state === 'closed',
    });
  }
  return elements;
}

function unconnectedTerminalDiagnostics(document: CircuitDocument): Diagnostic[] {
  const wiredEndpointIds = new Set(
    document.wires.flatMap((wire) => [wire.start.id, wire.end.id]),
  );
  return document.components
    .flatMap((component) => component.terminals)
    .filter((terminal) => !wiredEndpointIds.has(terminal.id))
    .sort((left, right) => compareIds(left.id, right.id))
    .map((terminal) => diagnostic('UNCONNECTED_TERMINAL', [terminal.id], 'warning'));
}

export function compileCircuit(document: CircuitDocument): CompileResult {
  const validation = validateDocument(document);
  if (!validation.ok) {
    return { circuit: emptyCircuit(), diagnostics: validation.diagnostics };
  }

  const validatedDocument = validation.document;
  const { nets, endpointToNet } = compileNets(validatedDocument);
  const diagnostics = unconnectedTerminalDiagnostics(validatedDocument);
  const elements = compileElements(validatedDocument, endpointToNet, diagnostics);
  const referenceNetId = validatedDocument.referenceNode
    ? endpointToNet[validatedDocument.referenceNode.id]
    : undefined;

  return {
    circuit: {
      nets,
      elements,
      endpointToNet,
      ...(referenceNetId === undefined ? {} : { referenceNetId }),
    },
    diagnostics,
  };
}

export const circuitCompiler: CircuitCompiler = {
  compile: compileCircuit,
};
