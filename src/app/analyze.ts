import type { CircuitDocument } from '../domain';
import { compileCircuit } from '../connectivity';
import { analyzeOperatingCircuit, failedResult, type OperatingAssessment } from '../simulation';
import { evaluateDiagnostics } from '../diagnostics';

export function analyze(document: CircuitDocument, componentModel = false) {
  const compilation = compileCircuit(document);
  const evaluated = compilation.diagnostics.some(d => d.severity === 'error')
    ? { result: failedResult(compilation.diagnostics), assessment: { status: 'unverified', components: [] } as OperatingAssessment }
    : analyzeOperatingCircuit(compilation.circuit, {
        referencePolicy: 'independent',
        ...(componentModel ? { physicalModel: 'component' as const } : {}),
      });
  const { result, assessment } = evaluated;
  const diagnostics = evaluateDiagnostics({ document, compilation, result });
  return { compilation, assessment, result: { ...result, diagnostics, status: result.status === 'error' ? 'error' as const : diagnostics.some(d => d.severity === 'warning') ? 'warning' as const : result.status } };
}
