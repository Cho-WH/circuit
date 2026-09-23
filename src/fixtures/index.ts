import type { CircuitDocument } from '../domain';
const imported = import.meta.glob<{ id: string; title: string; document: CircuitDocument }>('../../fixtures/FIX-*.json', { eager: true, import: 'default' });
export const examples = Object.values(imported).sort((a, b) => a.id.localeCompare(b.id));
