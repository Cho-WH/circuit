import * as q from '../rational';
import type { CircuitDocument, CompiledCircuit, SimulationResult } from '../domain';
import { endpointPosition, wirePoints } from '../component-library';
import { potentialColor, type PotentialPaletteId } from './palettes';

export interface PotentialValue {
  netId: string;
  /** Normalized display coordinate; physical labels use exactVoltage. */
  voltage?: number;
  exactVoltage?: q.StoredScalar;
  color: string;
  height?: number;
  endpointIds: string[];
  wireIds: string[];
}
export interface PotentialSegment {
  id: string;
  points: { x: number; y: number; z: number }[];
  color: string;
  kind: 'wire' | 'component';
}
export interface PotentialRange {
  min: q.Scalar;
  max: q.Scalar;
}
export interface PotentialOptions {
  scale?: number;
  range?: PotentialRange;
  palette?: PotentialPaletteId;
}
export interface PotentialModel {
  voltageUnit: q.StoredScalar;
  approximation?: import('../domain').Approximation;
  nets: Record<string, PotentialValue>;
  endpoints: Record<string, PotentialValue>;
  segments: PotentialSegment[];
  min: number;
  max: number;
  scale: number;
  referenceVoltage: number;
  undefinedCount: number;
}
export function buildPotentialModel(
  document: CircuitDocument,
  circuit: CompiledCircuit,
  result: SimulationResult,
  options: PotentialOptions = {},
): PotentialModel {
  const exactValues = Object.values(result.nodeVoltages).filter(q.isRational);
  const finite = (v: q.Scalar) => typeof v !== 'number' || Number.isFinite(v);
  const validRange =
    options.range &&
    finite(options.range.min) &&
    finite(options.range.max) &&
    q.compare(options.range.min, options.range.max) < 0;
  const exactMin = validRange
    ? q.from(options.range!.min)
    : exactValues.reduce((a, b) => (q.compare(a, b) < 0 ? a : b), q.ZERO);
  const exactMax = validRange
    ? q.from(options.range!.max)
    : exactValues.reduce((a, b) => (q.compare(a, b) > 0 ? a : b), q.ZERO);
  const magnitude = exactValues
    .concat([exactMin, exactMax])
    .reduce((a, b) => (q.compare(a, q.abs(b)) > 0 ? a : q.abs(b)), q.ZERO);
  const exponent = q.decimalExponent(magnitude),
    voltageUnit = q.power10(Math.abs(exponent) > 100 ? exponent : 0);
  const axis = { voltageUnit: q.store(voltageUnit) };
  const coordinate = (v: q.Scalar) => potentialAxisCoordinate(axis, v);
  const min = coordinate(exactMin),
    max = coordinate(exactMax);
  const scale = Number.isFinite(options.scale) && options.scale! > 0 ? options.scale! : 18;
  const reference = circuit.referenceNetId
    ? (result.nodeVoltages[circuit.referenceNetId] ?? q.ZERO)
    : q.ZERO;
  const referenceVoltage = coordinate(reference);
  const nets = Object.fromEntries(
    circuit.nets.map((net) => {
      const v = result.nodeVoltages[net.id];
      const voltage = q.isRational(v) ? coordinate(v) : undefined;
      return [
        net.id,
        {
          netId: net.id,
          voltage,
          exactVoltage: v ? q.store(v) : undefined,
          color: potentialColor(
            v
              ? q.equal(exactMax, exactMin)
                ? 0.5
                : q.toNumber(q.div(q.sub(v, exactMin), q.sub(exactMax, exactMin)))
              : undefined,
            0,
            1,
            options.palette,
          ),
          height:
            voltage === undefined
              ? undefined
              : q.toNumber(q.mul(scale, q.div(q.sub(v, reference), voltageUnit))),
          endpointIds: net.endpointIds,
          wireIds: net.wireIds,
        },
      ];
    }),
  ) as Record<string, PotentialValue>;
  const endpoints = Object.fromEntries(
    Object.entries(circuit.endpointToNet).map(([id, net]) => [id, nets[net]]),
  );
  const segments: PotentialSegment[] = [];
  for (const wire of document.wires) {
    const net = endpoints[wire.start.id];
    if (net?.height === undefined) continue;
    segments.push({
      id: wire.id,
      kind: 'wire',
      color: net.color,
      points: wirePoints(document, wire).map((p) => ({ ...p, z: net.height! })),
    });
  }
  for (const c of document.components) {
    if (c.type === 'switch' && c.properties.state === 'open') continue;
    if (c.type === 'voltmeter') continue;
    const points = c.terminals.slice(0, 2).map((t) => {
      const v = endpoints[t.id];
      return v?.height === undefined
        ? null
        : { ...endpointPosition(document, { kind: 'terminal', id: t.id }), z: v.height };
    });
    if (points[0] && points[1])
      segments.push({
        id: c.id,
        kind: 'component',
        color: '#586879',
        points: [points[0], points[1]],
      });
  }
  return {
    ...axis,
    approximation: exactValues.find((v) => v.approximation)?.approximation,
    nets,
    endpoints,
    segments,
    min,
    max,
    scale,
    referenceVoltage,
    undefinedCount: Object.values(nets).filter((n) => n.voltage === undefined).length,
  };
}
/** Convert a voltage display coordinate back to the exact axis value. */
export function potentialAxisValue(model: PotentialModel, value: number): q.Rational {
  const v = q.mul(value, model.voltageUnit);
  return model.approximation
    ? { ...v, approximation: { ...model.approximation, absoluteError: 0 } }
    : v;
}

/** Convert an exact physical value to a finite scene coordinate using the model's unit. */
export function potentialAxisCoordinate(
  model: Pick<PotentialModel, 'voltageUnit'>,
  value: q.Scalar,
): number {
  return q.toNumber(q.div(value, model.voltageUnit));
}
