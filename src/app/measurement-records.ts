import * as q from '../rational';
import type { MeasurementEntry } from '../persistence';
import {
  componentDefinitions,
  endpointName,
  wireName,
  quantityFormatForTargets,
} from '../component-library';
import { formatQuantity } from '../quantity';
import { notationDisplayText } from '../notation';

// Only electrical state defines a condition. Panning, layout, labels and number
// formatting may change without creating a new experimental condition.
export function measurementConditionKey(entry: MeasurementEntry): string {
  const doc = entry.record.documentSnapshot;
  const sorted = <T extends { id: string }>(items: T[]) =>
    [...items].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({
    documentId: doc.documentId,
    isolated: entry.sourcesDisconnected,
    provenance: entry.record.provenance,
    components: sorted(doc.components).map((c) => ({
      id: c.id,
      type: c.type,
      operatingProfile: c.operatingProfile,
      characteristics: [c.properties.diodeThresholdV,c.properties.diodeOnResistanceOhm,c.properties.sourceResistanceOhm],
      terminals: c.terminals.map((t) => [t.id, t.role]),
      value: componentDefinitions[c.type].property
        ? c.properties[componentDefinitions[c.type].property!]
        : c.properties.state,
    })),
    junctions: sorted(doc.junctions).map((j) => j.id),
    wires: sorted(doc.wires).map((w) => [w.id, w.start, w.end]),
  });
}

export function measurementConditions(entries: MeasurementEntry[]) {
  const groups = new Map<
    string,
    { number: number; entry: MeasurementEntry; entries: MeasurementEntry[] }
  >();
  for (const entry of entries) {
    const key = measurementConditionKey(entry);
    if (!groups.has(key)) groups.set(key, { number: groups.size + 1, entry, entries: [] });
    groups.get(key)!.entries.push(entry);
  }
  return [...groups.values()];
}

export function conditionValues(entry: MeasurementEntry): { label: string; value: string }[] {
  const doc = entry.record.documentSnapshot;
  return doc.components.flatMap((c) => {
    const definition = componentDefinitions[c.type];
    if (definition.property)
      return [
        {
          label: c.label,
          value: formatQuantity(
            c.properties[definition.property] as q.Scalar,
            definition.unit,
            quantityFormatForTargets(doc, [c.id]),
          ),
        },
      ];
    return c.type === 'switch'
      ? [{ label: c.label, value: c.properties.state === 'closed' ? '닫힘' : '열림' }]
      : [];
  });
}

export function conditionDescription(entry: MeasurementEntry): string {
  return [
    entry.record.documentSnapshot.title,
    ...conditionValues(entry).map(({ label, value }) => `${label} ${value}`),
    ...(entry.sourcesDisconnected ? ['모든 전원 분리'] : []),
    ...(entry.record.provenance?.physicalModel === 'component' ? ['부품 특성'] : []),
  ].join(' · ');
}

export function measurementQuantityName(entry: MeasurementEntry): string {
  return entry.record.quantity === 'current'
    ? '전류'
    : entry.record.quantity === 'resistance'
      ? '등가저항'
      : '전압';
}

export function measurementLocation(entry: MeasurementEntry): string {
  const { documentSnapshot: doc, targetIds: ids, quantity } = entry.record;
  if (quantity === 'current') {
    const component = doc.components.find((c) => c.id === ids[0]);
    return component?.label ?? wireName(doc, ids[0]);
  }
  const component = doc.components.find(
    (c) => ids[0] !== ids[1] && ids.every((id) => c.terminals.some((t) => t.id === id)),
  );
  return component
    ? `${component.label} 양단`
    : ids.map((id) => endpointName(doc, id).replace(' · ', ' ').replace(' 단자', '')).join(' — ');
}

export function measurementDirection(entry: MeasurementEntry): string {
  const { record: r } = entry;
  const name = (id: string) => endpointName(r.documentSnapshot, id);
  if (entry.currentDirection) {
    if (r.value !== null && q.direction(r.value) === undefined) return '방향 불확실';
    if (r.value !== null && q.sign(r.value) === 0) return '0 A · 방향 없음';
    const { from, to } = entry.currentDirection;
    return q.sign(r.value ?? 0) < 0
      ? `${name(to.id)} → ${name(from.id)}`
      : `${name(from.id)} → ${name(to.id)}`;
  }
  return `빨강 ${name(r.targetIds[0])} · 검정 ${name(r.targetIds[1])}`;
}

export function measurementValue(entry: MeasurementEntry): string {
  const r = entry.record;
  return formatQuantity(
    r.quantity === 'current' && r.value !== null ? q.abs(r.value) : (r.value ?? undefined),
    r.unit,
    { ...quantityFormatForTargets(r.documentSnapshot, r.targetIds), modelApproximation: r.provenance?.physicalModel === 'component' },
  );
}

export function measurementTableRows(entries: MeasurementEntry[]): string[][] {
  return [
    ['기록', '측정 위치', '측정', '측정값', '방향 / 탐침', '회로 조건', '메모'],
    ...measurementConditions(entries).flatMap((group) =>
      group.entries.map((entry) => [
        String(entries.indexOf(entry) + 1),
        measurementLocation(entry),
        measurementQuantityName(entry),
        measurementValue(entry),
        measurementDirection(entry),
        `조건 ${group.number} · ${conditionDescription(entry)}`,
        entry.note,
      ]),
    ),
  ].map((row) => row.map((cell) => notationDisplayText(cell)));
}

const safeText = (text: string) => (/^[\s]*[=+\-@]/.test(text) ? `'${text}` : text);
export function measurementTableText(entries: MeasurementEntry[], separator = '\t'): string {
  return measurementTableRows(entries)
    .map((row) =>
      row
        .map((value) => {
          const text = safeText(value);
          if (separator === '\t') return text.replace(/[\t\r\n]+/g, ' ');
          return `"${text.replace(/"/g, '""')}"`;
        })
        .join(separator),
    )
    .join('\r\n');
}

export function measurementTableHtml(entries: MeasurementEntry[]): string {
  const escape = (text: string) =>
    safeText(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  return `<table>${measurementTableRows(entries)
    .map(
      (row, index) =>
        `<tr>${row.map((value) => `<${index ? 'td' : 'th'}>${escape(value)}</${index ? 'td' : 'th'}>`).join('')}</tr>`,
    )
    .join('')}</table>`;
}
