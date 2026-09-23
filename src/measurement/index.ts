import {
  cloneDocument,
  diagnostic,
  validateDocument,
  type CircuitCompiler,
  type CircuitDocument,
  type CompileResult,
  type ComponentInstance,
  type Diagnostic,
  type EndpointRef,
  type SimulationEngine,
  type SimulationResult,
  type Wire,
} from '../domain';

export type MeasurementResult<T> =
  | { ok: true; value: T; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

export interface ProbeVoltage {
  voltageV: number;
  redNetId: string;
  blackNetId: string;
}

export interface CurrentTarget { kind: 'component' | 'wire'; id: string }
export interface CurrentReading { amperes: number; from: EndpointRef; to: EndpointRef }

/** Non-contact measurement. Wire direction is start → end, never inferred from coordinates. */
export function probeCurrent(document: CircuitDocument, compilation: CompileResult, result: SimulationResult, target: CurrentTarget | null): MeasurementResult<CurrentReading> {
  if (!target) return fail('INCOMPLETE_PROBE');
  const upstream = [...compilation.diagnostics, ...result.diagnostics];
  if (result.status === 'error' || hasErrors(upstream)) return { ok: false, diagnostics: upstream.length ? upstream : [diagnostic('MEASUREMENT_UNAVAILABLE', [target.id])] };
  const pair = (c: ComponentInstance) => {
    const positive = c.type === 'dc-voltage-source' ? c.terminals.find(t => t.role === 'positive') : undefined;
    const first = positive ?? c.terminals[0];
    return [first, c.terminals.find(t => t.id !== first?.id)] as const;
  };
  if (target.kind === 'component') {
    const c = document.components.find(c => c.id === target.id);
    if (!c) return fail('MEASUREMENT_TARGET_NOT_FOUND', [target.id]);
    const [a, b] = pair(c), amperes = result.branchCurrents[c.id];
    if (!a || !b || !owns(result.branchCurrents, c.id) || !Number.isFinite(amperes)) return fail('MEASUREMENT_UNAVAILABLE', [c.id]);
    return ok({ amperes, from: {kind:'terminal',id:a.id}, to: {kind:'terminal',id:b.id} });
  }
  const wire = document.wires.find(w => w.id === target.id);
  if (!wire) return fail('MEASUREMENT_TARGET_NOT_FOUND', [target.id]);
  // Remove only the queried wire from the ideal conductor graph. A remaining path
  // means a zero-resistance cycle: its individual wire currents are not unique.
  const neighbors = new Map<string, string[]>();
  for (const w of document.wires) {
    if (w.id === wire.id) continue;
    for (const [a,b] of [[w.start.id,w.end.id],[w.end.id,w.start.id]]) neighbors.set(a,[...(neighbors.get(a) ?? []),b]);
  }
  const side = new Set<string>([wire.start.id]), queue = [wire.start.id];
  for (let i=0;i<queue.length;i++) for (const id of neighbors.get(queue[i]) ?? []) if (!side.has(id)) { side.add(id); queue.push(id); }
  if (side.has(wire.end.id)) return fail('WIRE_CURRENT_UNDEFINED', [wire.id]);
  let amperes = 0;
  // KCL on one side of the cut. Sum all terminal injections, including several
  // components at a junction; assigning one current to an entire net is invalid.
  for (const c of [...document.components].sort((a,b)=>a.id.localeCompare(b.id))) {
    const [a,b] = pair(c);
    if (!a || !b) return fail('MEASUREMENT_UNAVAILABLE', [c.id]);
    const sign = Number(side.has(b.id)) - Number(side.has(a.id));
    if (!sign) continue;
    const current = result.branchCurrents[c.id];
    if (!owns(result.branchCurrents,c.id) || !Number.isFinite(current)) return fail('MEASUREMENT_UNAVAILABLE', [wire.id,c.id]);
    amperes += sign * current;
  }
  if (!Number.isFinite(amperes)) return fail('MEASUREMENT_UNAVAILABLE', [wire.id]);
  return ok({amperes,from:wire.start,to:wire.end});
}

export interface AmmeterInsertionRequest {
  componentId: string;
  ammeter: ComponentInstance;
  newWireId: string;
}

export interface AmmeterInsertion {
  document: CircuitDocument;
  ammeterId: string;
  terminalId: string;
  rewiredWireIds: string[];
  newWireId: string;
  positiveDirection: { from: EndpointRef; to: EndpointRef };
}

export type SweepQuantity =
  | { kind: 'probe-voltage'; red: EndpointRef; black: EndpointRef }
  | {
      kind: 'branch-current' | 'component-voltage' | 'component-power';
      componentId: string;
    };

export interface SweepRequest {
  componentId: string;
  property: 'resistanceOhm' | 'voltageV';
  values: number[];
  xLabel: string;
  xUnit: 'Ω' | 'V';
  yLabel: string;
  quantity: SweepQuantity;
}

export type ParameterSweepRequest = SweepRequest;

export interface SweepSample {
  x: number;
  y: number | null;
  diagnostics: Diagnostic[];
}

export interface SweepResult {
  xLabel: string;
  xUnit: 'Ω' | 'V';
  yLabel: string;
  yUnit: 'V' | 'A' | 'W';
  samples: SweepSample[];
}

export type ParameterSweepResult = SweepResult;

export type MeasurementQuantity = 'voltage' | 'current' | 'resistance' | 'power';
export type MeasurementUnit = 'V' | 'A' | 'Ω' | 'W';

export interface MeasurementRecordFields {
  condition: string;
  source: 'simulation' | 'external';
  quantity: MeasurementQuantity;
  value: number | null;
  unit: MeasurementUnit;
  targetIds: string[];
  recordedAt?: string;
}

export interface MeasurementRecord extends MeasurementRecordFields {
  documentSnapshot: CircuitDocument;
}

const ok = <T>(value: T, diagnostics: Diagnostic[] = []): MeasurementResult<T> => ({
  ok: true,
  value,
  diagnostics,
});

const fail = <T>(
  code: string,
  affectedIds: string[] = [],
  parameters: Diagnostic['parameters'] = {},
): MeasurementResult<T> => ({
  ok: false,
  diagnostics: [diagnostic(code, affectedIds, 'error', parameters)],
});

const hasErrors = (diagnostics: Diagnostic[]): boolean =>
  diagnostics.some((item) => item.severity === 'error');

const owns = (record: Record<string, number>, id: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, id);

export function probeVoltage(
  compilation: CompileResult,
  result: SimulationResult,
  red: EndpointRef | null,
  black: EndpointRef | null,
): MeasurementResult<ProbeVoltage> {
  if (!red || !black) {
    return fail('INCOMPLETE_PROBE', [red?.id, black?.id].filter((id): id is string => !!id));
  }

  const redNetId = compilation.circuit.endpointToNet[red.id];
  const blackNetId = compilation.circuit.endpointToNet[black.id];
  const missing = [
    ...(redNetId === undefined ? [red.id] : []),
    ...(blackNetId === undefined ? [black.id] : []),
  ];
  if (missing.length) return fail('INVALID_REFERENCE', missing);

  const upstreamDiagnostics = [...compilation.diagnostics, ...result.diagnostics];
  if (hasErrors(upstreamDiagnostics) || result.status === 'error') {
    return {
      ok: false,
      diagnostics:
        upstreamDiagnostics.length > 0
          ? upstreamDiagnostics
          : [diagnostic('MEASUREMENT_UNAVAILABLE', [red.id, black.id])],
    };
  }

  if (!owns(result.nodeVoltages, redNetId) || !owns(result.nodeVoltages, blackNetId)) {
    return fail('MEASUREMENT_UNAVAILABLE', [red.id, black.id]);
  }
  const voltageV = result.nodeVoltages[redNetId] - result.nodeVoltages[blackNetId];
  if (!Number.isFinite(voltageV)) {
    return fail('MEASUREMENT_UNAVAILABLE', [red.id, black.id]);
  }
  return ok({ voltageV, redNetId, blackNetId }, upstreamDiagnostics);
}

function insertionTerminal(component: ComponentInstance): string | null {
  if (component.type !== 'dc-voltage-source') return component.terminals[0]?.id ?? null;
  const positive = component.terminals.filter((terminal) => terminal.role === 'positive');
  return positive.length === 1 ? positive[0].id : null;
}

function wireTouchesOnlyOnce(wire: Wire, endpointId: string): boolean {
  return (wire.start.id === endpointId) !== (wire.end.id === endpointId);
}

export function insertSeriesAmmeter(
  document: CircuitDocument,
  request: AmmeterInsertionRequest,
): MeasurementResult<AmmeterInsertion> {
  const sourceValidation = validateDocument(document);
  if (!sourceValidation.ok) return { ok: false, diagnostics: sourceValidation.diagnostics };

  const component = sourceValidation.document.components.find(
    (candidate) => candidate.id === request.componentId,
  );
  if (!component) return fail('MEASUREMENT_TARGET_NOT_FOUND', [request.componentId]);
  const terminalId = insertionTerminal(component);
  if (!terminalId) {
    return fail('INVALID_AMMETER_INSERTION', [component.id], {
      reason: 'MISSING_OR_AMBIGUOUS_INSERTION_TERMINAL',
    });
  }
  if (request.ammeter.type !== 'ammeter' || request.ammeter.terminals.length !== 2) {
    return fail('INVALID_AMMETER_INSERTION', [request.ammeter.id], {
      reason: 'AMMETER_REQUIRES_TWO_TERMINALS',
    });
  }

  const incidentWires = sourceValidation.document.wires.filter(
    (wire) => wire.start.id === terminalId || wire.end.id === terminalId,
  );
  if (incidentWires.length === 0) {
    return fail('MEASUREMENT_TARGET_NOT_FOUND', [terminalId], {
      reason: 'UNCONNECTED_INSERTION_TERMINAL',
    });
  }
  if (incidentWires.some((wire) => !wireTouchesOnlyOnce(wire, terminalId))) {
    return fail('INVALID_AMMETER_INSERTION', [terminalId], {
      reason: 'SELF_CONNECTED_WIRE',
    });
  }

  const temporary = cloneDocument(sourceValidation.document);
  const firstMeterTerminal: EndpointRef = {
    kind: 'terminal',
    id: request.ammeter.terminals[0].id,
  };
  const secondMeterTerminal: EndpointRef = {
    kind: 'terminal',
    id: request.ammeter.terminals[1].id,
  };
  const originalTerminal: EndpointRef = { kind: 'terminal', id: terminalId };
  const rewiredWireIds = new Set(incidentWires.map((wire) => wire.id));

  for (const wire of temporary.wires) {
    if (!rewiredWireIds.has(wire.id)) continue;
    if (wire.start.id === terminalId) wire.start = { ...firstMeterTerminal };
    if (wire.end.id === terminalId) wire.end = { ...firstMeterTerminal };
    wire.waypoints = [];
  }
  temporary.components.push(request.ammeter);
  temporary.wires.push({
    id: request.newWireId,
    start: { ...secondMeterTerminal },
    end: { ...originalTerminal },
    waypoints: [],
  });

  const validation = validateDocument(temporary);
  if (!validation.ok) return { ok: false, diagnostics: validation.diagnostics };
  return ok({
    document: cloneDocument(validation.document),
    ammeterId: request.ammeter.id,
    terminalId,
    rewiredWireIds: [...rewiredWireIds].sort(),
    newWireId: request.newWireId,
    positiveDirection: { from: firstMeterTerminal, to: secondMeterTerminal },
  });
}

function quantityUnit(quantity: SweepQuantity): SweepResult['yUnit'] {
  if (quantity.kind === 'branch-current') return 'A';
  if (quantity.kind === 'component-power') return 'W';
  return 'V';
}

function sweepReading(
  quantity: SweepQuantity,
  compilation: CompileResult,
  result: SimulationResult,
): MeasurementResult<number> {
  if (quantity.kind === 'probe-voltage') {
    const measured = probeVoltage(compilation, result, quantity.red, quantity.black);
    return measured.ok
      ? ok(measured.value.voltageV, measured.diagnostics)
      : measured;
  }

  const values =
    quantity.kind === 'branch-current'
      ? result.branchCurrents
      : quantity.kind === 'component-voltage'
        ? result.componentVoltages
        : result.componentPowers;
  if (result.status === 'error' || !owns(values, quantity.componentId)) {
    return {
      ok: false,
      diagnostics:
        result.diagnostics.length > 0
          ? result.diagnostics
          : [diagnostic('MEASUREMENT_UNAVAILABLE', [quantity.componentId])],
    };
  }
  const value = values[quantity.componentId];
  return Number.isFinite(value)
    ? ok(value, result.diagnostics)
    : fail('MEASUREMENT_UNAVAILABLE', [quantity.componentId]);
}

function validateSweep(
  document: CircuitDocument,
  request: SweepRequest,
): MeasurementResult<ComponentInstance> {
  if (request.values.length === 0 || request.values.length > 100) {
    return fail('INVALID_SWEEP', [request.componentId], {
      reason: request.values.length === 0 ? 'EMPTY_VALUES' : 'TOO_MANY_SAMPLES',
      sampleCount: request.values.length,
    });
  }
  if (
    !request.values.every(
      (value) =>
        Number.isFinite(value) &&
        (request.property !== 'resistanceOhm' || value >= 0),
    )
  ) {
    return fail('INVALID_COMPONENT_VALUE', [request.componentId], {
      property: request.property,
    });
  }
  if (!request.xLabel.trim() || !request.yLabel.trim()) {
    return fail('INVALID_SWEEP', [request.componentId], { reason: 'MISSING_AXIS_LABEL' });
  }
  if (
    (request.property === 'resistanceOhm' && request.xUnit !== 'Ω') ||
    (request.property === 'voltageV' && request.xUnit !== 'V')
  ) {
    return fail('INVALID_SWEEP', [request.componentId], { reason: 'X_UNIT_MISMATCH' });
  }

  const component = document.components.find((candidate) => candidate.id === request.componentId);
  if (!component) return fail('MEASUREMENT_TARGET_NOT_FOUND', [request.componentId]);
  const propertyMatches =
    request.property === 'voltageV'
      ? component.type === 'dc-voltage-source'
      : component.type === 'resistor' || component.type === 'resistive-load';
  return propertyMatches
    ? ok(component)
    : fail('INVALID_SWEEP', [component.id], { reason: 'PROPERTY_TYPE_MISMATCH' });
}

function annotateSampleDiagnostics(
  diagnostics: Diagnostic[],
  sampleIndex: number,
  x: number,
): Diagnostic[] {
  return diagnostics.map((item) => ({
    ...item,
    affectedIds: [...item.affectedIds],
    parameters: { ...item.parameters, sampleIndex, x },
    suggestedActions: [...item.suggestedActions],
  }));
}

export function parameterSweep(
  document: CircuitDocument,
  request: SweepRequest,
  compiler: CircuitCompiler,
  engine: SimulationEngine,
): MeasurementResult<SweepResult> {
  const documentValidation = validateDocument(document);
  if (!documentValidation.ok) {
    return { ok: false, diagnostics: documentValidation.diagnostics };
  }
  const requestValidation = validateSweep(documentValidation.document, request);
  if (!requestValidation.ok) return requestValidation;

  const samples: SweepSample[] = [];
  const diagnostics: Diagnostic[] = [];
  for (let index = 0; index < request.values.length; index += 1) {
    const x = request.values[index];
    const candidate = cloneDocument(documentValidation.document);
    const component = candidate.components.find((item) => item.id === request.componentId)!;
    component.properties = { ...component.properties, [request.property]: x };

    const compilation = compiler.compile(candidate);
    const compileErrors = compilation.diagnostics.filter((item) => item.severity === 'error');
    if (compileErrors.length > 0) {
      const annotated = annotateSampleDiagnostics(compilation.diagnostics, index, x);
      samples.push({ x, y: null, diagnostics: annotated });
      diagnostics.push(...annotated);
      continue;
    }

    const result = engine.solve(compilation.circuit);
    const reading = sweepReading(request.quantity, compilation, result);
    const sampleDiagnostics = annotateSampleDiagnostics(
      reading.ok ? reading.diagnostics : reading.diagnostics,
      index,
      x,
    );
    samples.push({ x, y: reading.ok ? reading.value : null, diagnostics: sampleDiagnostics });
    diagnostics.push(...sampleDiagnostics);
  }

  return ok(
    {
      xLabel: request.xLabel,
      xUnit: request.xUnit,
      yLabel: request.yLabel,
      yUnit: quantityUnit(request.quantity),
      samples,
    },
    diagnostics,
  );
}

const unitsByQuantity: Record<MeasurementQuantity, MeasurementUnit> = {
  voltage: 'V',
  current: 'A',
  resistance: 'Ω',
  power: 'W',
};

function validateRecordFields(
  fields: MeasurementRecordFields,
  affectedIds?: string[],
): Diagnostic[] {
  const diagnosticIds =
    affectedIds ?? (Array.isArray(fields.targetIds) ? fields.targetIds : []);
  if (
    typeof fields.condition !== 'string' ||
    !fields.condition.trim() ||
    (fields.source !== 'simulation' && fields.source !== 'external') ||
    !(fields.quantity in unitsByQuantity) ||
    unitsByQuantity[fields.quantity] !== fields.unit ||
    (fields.value !== null &&
      (typeof fields.value !== 'number' || !Number.isFinite(fields.value))) ||
    !Array.isArray(fields.targetIds) ||
    !fields.targetIds.every((id) => typeof id === 'string') ||
    (fields.recordedAt !== undefined && typeof fields.recordedAt !== 'string')
  ) {
    return [diagnostic('INVALID_MEASUREMENT_RECORD', diagnosticIds)];
  }
  return [];
}

export function createMeasurementRecord(
  document: CircuitDocument,
  fields: MeasurementRecordFields,
): MeasurementResult<MeasurementRecord> {
  const validation = validateDocument(document);
  if (!validation.ok) return { ok: false, diagnostics: validation.diagnostics };
  const diagnostics = validateRecordFields(fields);
  if (diagnostics.length) return { ok: false, diagnostics };
  return ok({
    ...fields,
    targetIds: [...fields.targetIds],
    documentSnapshot: cloneDocument(validation.document),
  });
}

function protectSpreadsheetText(value: string): string {
  return /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string): string {
  const protectedValue = protectSpreadsheetText(value);
  return /[",\r\n]/.test(protectedValue)
    ? `"${protectedValue.replace(/"/g, '""')}"`
    : protectedValue;
}

export function measurementsToCsv(
  records: MeasurementRecord[],
): MeasurementResult<string> {
  const rows = [
    [
      'condition',
      'documentId',
      'source',
      'quantity',
      'value',
      'unit',
      'targetIds',
      'recordedAt',
      'documentSnapshot',
    ].join(','),
  ];

  for (const record of records) {
    const fieldDiagnostics = validateRecordFields(record);
    if (fieldDiagnostics.length) return { ok: false, diagnostics: fieldDiagnostics };
    const documentValidation = validateDocument(record.documentSnapshot);
    if (!documentValidation.ok) {
      return { ok: false, diagnostics: documentValidation.diagnostics };
    }
    rows.push(
      [
        csvCell(record.condition),
        csvCell(record.documentSnapshot.documentId),
        csvCell(record.source),
        csvCell(record.quantity),
        record.value === null ? '' : String(record.value),
        csvCell(record.unit),
        csvCell(record.targetIds.join('|')),
        csvCell(record.recordedAt ?? ''),
        csvCell(JSON.stringify(record.documentSnapshot)),
      ].join(','),
    );
  }
  return ok(rows.join('\r\n'));
}
