import Ajv2020 from 'ajv/dist/2020';
import schema from '../../schemas/circuit-document.schema.json';
import versionThreeSchema from '../../schemas/circuit-document-v3.schema.json';
import versionTwoSchema from '../../schemas/circuit-document-v2.schema.json';
import previousSchema from '../../schemas/circuit-document-v1.schema.json';

export type Point = { x: number; y: number };
export type EndpointRef = { kind: 'terminal' | 'junction'; id: string };
export type ComponentType = 'dc-voltage-source' | 'resistor' | 'switch' | 'ammeter' | 'voltmeter' | 'resistive-load';
export interface Terminal { id: string; role: string; localPosition?: Point }
export interface ComponentInstance {
  id: string; type: ComponentType; label: string; position: Point;
  rotation: 0 | 90 | 180 | 270;
  properties: Record<string, number | string | boolean>;
  terminals: Terminal[];
}
export interface Wire { id: string; start: EndpointRef; end: EndpointRef; waypoints: Point[] }
export interface Junction { id: string; position: Point }
export interface ArrowStyle { shape: 'straight' | 'corner'; length: number; legLength: number; rotation: number; reversed: boolean }
export interface Annotation {
  id: string; kind: 'label' | 'arrow' | 'blank' | 'question' | 'note' | 'point';
  anchor: EndpointRef | null; position?: Point; end?: Point; arrow?: ArrowStyle; presentation?: Record<string,string|number|boolean>; content: string; visibility: 'always' | 'hidden';
}
export interface ActivityDefinition {
  allowedCommands: string[]; revealSteps: Record<string, unknown>[];
  resetSnapshotId?: string | null; [key: string]: unknown;
}
export interface CircuitDocument {
  $schema?: string; format: 'edu-circuit'; version: 4; output?: { fontScale?: number }; documentId: string; title: string;
  components: ComponentInstance[]; wires: Wire[]; junctions: Junction[];
  annotations: Annotation[]; referenceNode: EndpointRef | null; activity: ActivityDefinition | null;
}
/** Reserve fresh document-wide IDs without time, randomness, or mutating the source document. */
export function createDocumentIdAllocator(document: CircuitDocument): (prefix: string) => string {
  const taken = new Set([
    ...document.components, ...document.components.flatMap(c => c.terminals),
    ...document.wires, ...document.junctions, ...document.annotations,
  ].map(item => item.id));
  return prefix => {
    let n = 1;
    while (taken.has(`${prefix}${n}`)) n++;
    const id = `${prefix}${n}`;
    taken.add(id);
    return id;
  };
}

export interface Diagnostic {
  code: string; severity: 'info' | 'warning' | 'error'; affectedIds: string[];
  parameters: Record<string, string | number | boolean | null>; suggestedActions: string[];
}
export const diagnostic = (code: string, affectedIds: string[] = [], severity: Diagnostic['severity'] = 'error', parameters: Diagnostic['parameters'] = {}): Diagnostic =>
  ({ code, severity, affectedIds: [...new Set(affectedIds)], parameters, suggestedActions: ['INSPECT_CONNECTIONS'] });
export interface Net { id: string; endpointIds: string[]; wireIds: string[] }
export interface CompiledElement { id: string; type: ComponentType; a: string; b: string; value: number; closed: boolean }
export interface CompiledCircuit {
  nets: Net[]; elements: CompiledElement[]; endpointToNet: Record<string, string>;
  referenceNetId?: string;
}
export interface CompileResult { circuit: CompiledCircuit; diagnostics: Diagnostic[] }
export interface CircuitCompiler { compile(document: CircuitDocument): CompileResult }
export interface SolveOptions { absoluteTolerance?: number; relativeTolerance?: number }
export interface SimulationResult {
  status: 'solved' | 'warning' | 'error'; nodeVoltages: Record<string, number>;
  branchCurrents: Record<string, number>; componentVoltages: Record<string, number>;
  componentPowers: Record<string, number>; diagnostics: Diagnostic[];
}
export interface SimulationEngine { solve(circuit: CompiledCircuit, options?: SolveOptions): SimulationResult }
export interface DiagnosticInput { document: CircuitDocument; compilation: CompileResult; result: SimulationResult }
export interface DiagnosticEngine { evaluate(input: DiagnosticInput): Diagnostic[] }
export interface Exporter<TOptions> { export(document: CircuitDocument, options: TOptions): Promise<Blob> }
export interface DocumentMigrator { canMigrate(version: number): boolean; migrate(input: unknown): CircuitDocument }

const validateSchema = new Ajv2020({ allErrors: true, strict: false }).compile<CircuitDocument>(schema);
export type DocumentValidation = { ok: true; document: CircuitDocument } | { ok: false; diagnostics: Diagnostic[] };
const validatePrevious = new Ajv2020({ allErrors: true, strict: false }).compile(previousSchema);
const validateVersionTwo = new Ajv2020({ allErrors: true, strict: false }).compile(versionTwoSchema);
const validateVersionThree = new Ajv2020({ allErrors: true, strict: false }).compile(versionThreeSchema);
export function validateDocument(input: unknown): DocumentValidation {
  if (input && typeof input === 'object' && 'version' in input && input.version === 1 && validatePrevious(input)) {
    const migrated = JSON.parse(JSON.stringify(input));
    migrated.version = 2;
    for (const annotation of migrated.annotations) annotation.visibility = ['hidden', 'answer'].includes(annotation.visibility) ? 'hidden' : 'always';
    input = migrated;
  }
  if (input && typeof input === 'object' && 'version' in input && input.version === 2 && validateVersionTwo(input)) {
    input = {...JSON.parse(JSON.stringify(input)), version: 3};
  }
  if (input && typeof input === 'object' && 'version' in input && input.version === 3 && validateVersionThree(input)) {
    input = {...JSON.parse(JSON.stringify(input)), version: 4};
  }
  if (!validateSchema(input)) return { ok: false, diagnostics: [diagnostic('INVALID_DOCUMENT', [], 'error', { detail: (validateSchema.errors ?? []).map(e => `${e.instancePath} ${e.message}`).join('; ') })] };
  const doc = input;
  const ids = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  const endpoints = new Map<string, EndpointRef['kind']>();
  for (const item of [...doc.components, ...doc.components.flatMap(c => c.terminals), ...doc.wires, ...doc.junctions, ...doc.annotations]) {
    if (ids.has(item.id)) diagnostics.push(diagnostic('DUPLICATE_ID', [item.id]));
    ids.add(item.id);
  }
  for (const c of doc.components) for (const t of c.terminals) endpoints.set(t.id, 'terminal');
  for (const j of doc.junctions) endpoints.set(j.id, 'junction');
  const refs = [...doc.wires.flatMap(w => [w.start, w.end]), ...doc.annotations.flatMap(a => a.anchor ? [a.anchor] : []), ...(doc.referenceNode ? [doc.referenceNode] : [])];
  for (const a of doc.annotations) if (!a.anchor && !a.position) diagnostics.push(diagnostic('INVALID_REFERENCE', [a.id]));
  for (const ref of refs) if (endpoints.get(ref.id) !== ref.kind) diagnostics.push(diagnostic('INVALID_REFERENCE', [ref.id]));
  return diagnostics.length ? { ok: false, diagnostics } : { ok: true, document: doc };
}
export function cloneDocument(document: CircuitDocument): CircuitDocument { return JSON.parse(JSON.stringify(document)) as CircuitDocument; }
export class DocumentError extends Error {
  constructor(public readonly diagnostics: Diagnostic[]) { super(diagnostics.map(d => d.code).join(', ')); this.name = 'DocumentError'; }
}
export const documentMigrator: DocumentMigrator = {
  canMigrate: version => version === 1 || version === 2 || version === 3 || version === 4,
  migrate(input) {
    const checked = validateDocument(input);
    if (!checked.ok) throw new DocumentError(checked.diagnostics);
    return cloneDocument(checked.document);
  },
};
export function emptyDocument(id = 'untitled'): CircuitDocument {
  return { format: 'edu-circuit', version: 4, documentId: id, title: '새 회로', components: [], wires: [], junctions: [], annotations: [], referenceNode: null, activity: null };
}
