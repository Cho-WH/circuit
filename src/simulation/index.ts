export type { SimulationEngine, SimulationResult, SolveOptions } from '../domain';
export { failedResult, solveCircuit, dcEngine } from './solver';
export { queryVoltage, queryCurrent, independentReferences } from './piecewise';
export type { QuantityQuery } from './solution-space';
export {
  analyzeOperatingCircuit,
  assessOperatingPoint,
  type OperatingAssessment,
  type OperatingCause,
  type OperatingOptions,
} from './operating';
export {
  equivalentResistance,
  checkKcl,
  checkKvl,
  type ResistanceResult,
  type ConservationResult,
} from './measurements';
