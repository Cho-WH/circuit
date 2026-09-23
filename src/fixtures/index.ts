import { documentMigrator, type CircuitDocument } from '../domain';
import wireEditing from '../../fixtures/ux/wire-editing.json';
const imported = import.meta.glob<{ id: string; title: string; document: CircuitDocument }>('../../fixtures/FIX-*.json', { eager: true, import: 'default' });
export const examples = [...Object.values(imported).sort((a, b) => a.id.localeCompare(b.id)),{id:'UX-WIRE',title:'연습 · 도선 삽입·교차 연결',document:documentMigrator.migrate(wireEditing)}];
