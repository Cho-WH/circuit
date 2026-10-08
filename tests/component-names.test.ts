import { describe, expect, it } from 'vitest';
import { componentDefinitions, createComponent, createComponentLabelAllocator } from '../src/component-library';
import { emptyDocument } from '../src/domain';
import { copySelection, createHistory, executeCommand, undo, redo } from '../src/editor';
import { parseDocument, serializeDocument } from '../src/persistence';

describe('component display names independent of internal IDs', () => {
  it('reserves plain, braced, unicode and leading-zero suffixes across all existing labels', () => {
    const allocate = createComponentLabelAllocator(['R1', 'R_2', 'R_{03}', 'R₄', 'R_6']);
    expect(allocate(componentDefinitions.resistor)).toBe('R_5');
    expect(allocate(componentDefinitions.resistor)).toBe('R_7');
    expect(allocate(componentDefinitions.diode)).toBe('D_1');
  });

  it('uses the lowest free number and reserves names only within the current batch', () => {
    const names = ['R_1', 'R_3', '측정 부하'];
    const allocate = createComponentLabelAllocator(names);
    expect(allocate(componentDefinitions.resistor)).toBe('R_2');
    expect(allocate(componentDefinitions.resistor)).toBe('R_4');
    // Cancelling a draft and starting again never consumes a display number.
    expect(createComponentLabelAllocator(names)(componentDefinitions.resistor)).toBe('R_2');
    expect(names).toEqual(['R_1', 'R_3', '측정 부하']);
  });

  it('keeps case and compound custom names distinct when checking numeric aliases', () => {
    expect(createComponentLabelAllocator(['r_1'])(componentDefinitions.resistor)).toBe('R_1');
    const names = Array.from({ length: 11 }, (_, i) => `R_${i + 1}`);
    expect(createComponentLabelAllocator([...names, 'R1_2'])(componentDefinitions.resistor)).toBe('R_12');
  });

  it('uses registry prefixes for every kind, including shared switch numbering', () => {
    const allocate = createComponentLabelAllocator([]);
    expect(Object.values(componentDefinitions).map(allocate)).toEqual([
      'V_1', 'V_2', 'R_1', 'VR_1', 'S_1', 'S_2', 'A_1', 'M_1', 'D_1',
    ]);
    // A future definition needs only a prefix, with no new naming branch.
    expect(createComponentLabelAllocator(['C1'])({ short: 'C' })).toBe('C_2');
  });

  it('accepts an explicit display name without changing IDs or terminal references', () => {
    for (const kind of ['resistor', 'resistive-load', 'changeover-switch'] as const) {
      const component = createComponent(kind, 'internal-987', { x: 0, y: 0 }, '실험_1');
      expect(component.label).toBe('실험_1');
      expect(component.id).toBe('internal-987');
      expect(component.terminals.every(t => t.id.startsWith('internal-987.'))).toBe(true);
    }
  });

  it('renames a copied batch without changing original custom names and retains names through history and storage', () => {
    const doc = emptyDocument('names');
    doc.components = [
      createComponent('resistor', 'source-a', { x: 0, y: 0 }, '측정 부하'),
      createComponent('resistor', 'source-b', { x: 200, y: 0 }, 'R_2'),
      createComponent('diode', 'source-c', { x: 400, y: 0 }, 'R1'),
    ];
    const before = structuredClone(doc);
    let counter = 300;
    const copy = () => copySelection(doc, ['source-b', 'source-a'], prefix => `${prefix}${counter++}`, { x: 0, y: 200 });
    const payload = copy();
    expect(payload.components.map(c => c.label)).toEqual(['R_3', 'R_4']);
    expect(copy().components.map(c => c.label)).toEqual(['R_3', 'R_4']);
    expect(doc).toEqual(before);
    const result = executeCommand(createHistory(doc), { type: 'Paste', ...payload });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(undo(result.history).present).toEqual(doc);
    expect(redo(undo(result.history)).present).toEqual(result.history.present);
    const restored = parseDocument(serializeDocument(result.history.present));
    expect(restored.ok && restored.document).toEqual(result.history.present);
    expect(result.history.present.components.slice(0, 3)).toEqual(doc.components);
  });
});
