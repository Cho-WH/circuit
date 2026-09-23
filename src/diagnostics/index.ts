export type { DiagnosticEngine, Diagnostic, DiagnosticInput } from '../domain';
import type { Diagnostic, DiagnosticEngine, DiagnosticInput } from '../domain';
export function evaluateDiagnostics({ compilation, result }: DiagnosticInput): Diagnostic[] {
  const all = [...compilation.diagnostics, ...result.diagnostics];
  return all.filter((d, i) => all.findIndex(other => other.code === d.code && JSON.stringify(other.affectedIds) === JSON.stringify(d.affectedIds)) === i);
}
export const diagnosticEngine: DiagnosticEngine = { evaluate: evaluateDiagnostics };
