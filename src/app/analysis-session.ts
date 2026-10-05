import type { OperatingAssessment } from '../simulation';

export interface AnalysisSession {
  active: boolean;
  phase: 'normal' | 'overload' | 'breaking' | 'broken';
  componentModel: boolean;
  assessment: OperatingAssessment;
  events: Record<string, number>;
  stopEpoch: number;
}

export const freshAnalysisSession = (): AnalysisSession => ({
  active: false, phase: 'normal', componentModel: false,
  assessment: { status: 'unverified', components: [] }, events: {}, stopEpoch: 0,
});

export const analysisLocked = (session: AnalysisSession) =>
  session.active && (session.phase === 'breaking' || session.phase === 'broken');

/** Only committed electrical changes and entering analysis can create an event. */
export function acceptOperatingPoint(
  previous: AnalysisSession,
  assessment: OperatingAssessment,
  componentModel: boolean,
): AnalysisSession {
  if (analysisLocked(previous)) return previous;
  const events = { ...previous.events };
  let entered = false;
  for (const cause of assessment.components) {
    const old = previous.assessment.components.find(c => c.componentId === cause.componentId && c.reason === cause.reason);
    if (!previous.active || old?.level !== cause.level) {
      events[cause.componentId] = (events[cause.componentId] ?? 0) + 1;
      entered = true;
    }
  }
  return {
    active: true, componentModel: previous.componentModel || componentModel,
    phase: assessment.status === 'damage' ? 'breaking' : assessment.status === 'overload' ? 'overload' : 'normal',
    assessment, events,
    stopEpoch: previous.stopEpoch + (entered || assessment.status === 'unverified' ? 1 : 0),
  };
}
