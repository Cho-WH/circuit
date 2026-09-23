import type { CircuitDocument } from '../domain';
import { compileCircuit } from '../connectivity';
import { dcEngine, failedResult } from '../simulation';
import { evaluateDiagnostics } from '../diagnostics';

export function analyze(document: CircuitDocument) {
  const compilation = compileCircuit(document);
  const result = compilation.diagnostics.some(d => d.severity === 'error') ? failedResult(compilation.diagnostics) : dcEngine.solve(compilation.circuit);
  const diagnostics = evaluateDiagnostics({ document, compilation, result });
  return { compilation, result: { ...result, diagnostics, status: result.status === 'error' ? 'error' as const : diagnostics.some(d => d.severity === 'warning') ? 'warning' as const : result.status } };
}
