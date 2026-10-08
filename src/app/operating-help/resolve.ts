import type {
  CircuitDocument,
  CompiledCircuit,
  CompiledElement,
  SimulationResult,
} from '../../domain';
import {
  queryCurrent,
  queryVoltage,
  type OperatingAssessment,
  type OperatingCause,
} from '../../simulation';
import * as q from '../../rational';
import { formatQuantity, quantityFormatFor } from '../../quantity';
import type { HelpQuestion } from './topics';

export interface OperatingHelpItem {
  key: string;
  componentId: string;
  label: string;
  questions: HelpQuestion[];
  automatic: boolean;
}
export interface OperatingHelpInput {
  document: CircuitDocument;
  circuit: CompiledCircuit;
  result: SimulationResult;
  assessment: OperatingAssessment;
  phase: 'normal' | 'overload' | 'breaking' | 'broken';
  active: boolean;
  selectedIds: readonly string[];
  measuredComponentIds?: readonly string[];
  showNumbers?: boolean;
}

function causeQuestion(
  e: CompiledElement,
  cause: OperatingCause,
  zeroCurrent: boolean,
): HelpQuestion | undefined {
  const damaged = cause.level === 'damage';
  switch (e.type) {
    case 'dc-voltage-source':
      if (cause.reason === 'sourceCurrent') return { topic: 'source-current', damaged };
      if (cause.reason === 'internalPower') return { topic: 'source-power', damaged };
      break;
    case 'diode':
      if (cause.reason === 'forwardCurrent') return { topic: 'diode-current', damaged };
      if (cause.reason === 'power') return { topic: 'diode-power', damaged };
      if (cause.reason === 'reverseVoltage')
        return { topic: 'diode-reverse', damaged, zeroCurrent: !damaged && zeroCurrent };
      break;
    case 'resistor':
    case 'resistive-load':
      if (cause.reason === 'power') return { topic: 'resistor-power', damaged };
  }
}

/** UI relevance only: traverse already compiled endpoints, never infer wires from pixels. */
function relatedElements(circuit: CompiledCircuit, causes: OperatingCause[]): Set<string> {
  const nets = new Set<string>();
  const ids = new Set(causes.map((c) => c.componentId));
  for (const e of circuit.elements)
    if (ids.has(e.id)) {
      nets.add(e.a);
      nets.add(e.b);
    }
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of circuit.elements) {
      if (e.type === 'voltmeter' || (e.type === 'switch' && !e.closed)) continue;
      if (!nets.has(e.a) && !nets.has(e.b)) continue;
      if (!nets.has(e.a) || !nets.has(e.b)) changed = true;
      nets.add(e.a);
      nets.add(e.b);
      ids.add(e.id);
    }
  }
  return ids;
}

export function resolveOperatingHelp(input: OperatingHelpInput): OperatingHelpItem[] {
  const { document, circuit, result, assessment, phase } = input;
  if (!input.active || phase === 'breaking') return [];
  const focused = new Set([...input.selectedIds, ...(input.measuredComponentIds ?? [])]);
  const related =
    phase === 'overload' ? relatedElements(circuit, assessment.components) : new Set<string>();
  const items: OperatingHelpItem[] = [];
  for (const e of circuit.elements) {
    const component = document.components.find((c) => c.id === e.id);
    if (!component) continue;
    const causes = assessment.components.filter(
      (c) => c.componentId === e.id && (phase !== 'broken' || c.level === 'damage'),
    );
    // After damage, only saved causes are observations. Do not query pre-damage live values.
    const current =
      phase === 'broken'
        ? undefined
        : queryCurrent(result, [{ componentId: e.id, coefficient: 1 }]);
    const direction = current?.status === 'unique' ? q.direction(current.value) : undefined;
    const questions = causes
      .map((c) => causeQuestion(e, c, direction === 0))
      .filter((x): x is HelpQuestion => !!x);
    if (phase !== 'broken' && result.provenance?.physicalModel === 'component') {
      const voltage = queryVoltage(result, e.a, e.b);
      if (
        e.type === 'dc-voltage-source' &&
        direction !== undefined &&
        voltage.status === 'unique'
      ) {
        const difference = q.direction(q.sub(voltage.value, e.value));
        if (q.sign(e.value) > 0 && direction < 0 && difference === -1) {
          const format = quantityFormatFor(component.properties);
          const sameDisplay =
            formatQuantity(
              { numerator: voltage.value.numerator, denominator: voltage.value.denominator },
              'V',
              format,
            ) === formatQuantity(e.value, 'V', format);
          questions.push({
            topic: 'source-terminal-drop',
            general: input.showNumbers === false || sameDisplay,
          });
        } else if (q.sign(e.value) > 0 && direction > 0 && difference === 1) {
          questions.push({
            topic: input.showNumbers === false ? 'source-terminal-general' : 'source-terminal-rise',
          });
        } else if (focused.has(e.id) && q.sign(e.value) <= 0)
          questions.push({ topic: 'source-terminal-general' });
      }
      if (e.type === 'diode' && direction === 1 && voltage.status === 'unique') {
        questions.push({
          topic: 'diode-forward-voltage',
          general:
            !e.operatingProfile?.diodeThresholdV ||
            !q.equal(e.operatingProfile.diodeThresholdV, q.rational(7n, 10n)),
        });
      }
    }
    if (!questions.length) continue;
    if (phase === 'normal' && !focused.has(e.id)) continue;
    const unique = questions.filter(
      (question, i) => questions.findIndex((x) => x.topic === question.topic) === i,
    );
    // Current and power stress share the same physical lesson; keep the engine's first cause.
    const compact = unique.filter((question) => {
      const group =
        question.topic === 'diode-power' || question.topic === 'diode-current'
          ? ['diode-power', 'diode-current']
          : question.topic === 'source-power' || question.topic === 'source-current'
            ? ['source-power', 'source-current']
            : null;
      return !group || unique.find((x) => group.includes(x.topic)) === question;
    });
    if (compact.some((x) => x.topic === 'source-terminal-drop'))
      compact.push({ topic: 'source-not-broken' });
    if (compact.some((x) => x.topic === 'diode-reverse'))
      compact.push({ topic: 'diode-reverse-current' });
    const automatic = focused.has(e.id) || causes.length > 0 || related.has(e.id);
    const visibleQuestions = compact.slice(0, 3);
    items.push({
      componentId: e.id,
      label: component.label,
      key: `${e.id}:${phase}:${JSON.stringify(visibleQuestions)}`,
      questions: visibleQuestions,
      automatic,
    });
  }
  const priority = (item: OperatingHelpItem) =>
    focused.has(item.componentId)
      ? 0
      : assessment.representative?.componentId === item.componentId
        ? 1
        : item.questions.some((x) => x.topic.startsWith('source-terminal'))
          ? 2
          : assessment.components.some((c) => c.componentId === item.componentId)
            ? 3
            : 4;
  return items.sort(
    (a, b) =>
      priority(a) - priority(b) ||
      (a.componentId < b.componentId ? -1 : a.componentId > b.componentId ? 1 : 0),
  );
}

/** A voltage observation refers to a component only when both endpoint nets match. */
export function measuredHelpComponents(
  circuit: CompiledCircuit,
  red: string,
  black: string,
  currentId?: string,
): string[] {
  const a = circuit.endpointToNet[red],
    b = circuit.endpointToNet[black];
  return circuit.elements
    .filter(
      (e) =>
        e.id === currentId ||
        (a && b && a !== b && ((a === e.a && b === e.b) || (a === e.b && b === e.a))),
    )
    .map((e) => e.id);
}
