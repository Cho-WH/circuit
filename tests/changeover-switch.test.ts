import { describe, it, expect } from 'vitest';
import fixture from '../fixtures/FIX-14-bridge-rectifier.json';
import { requireDocument, validateDocument, switchTerminals, nextSwitchState, emptyDocument, createDocumentIdAllocator } from '../src/domain';
import { createComponent, terminalPosition, endpointName, symbolMarkup, componentValue, switchContactPath, componentPresentation, componentValueFontSize, wirePoints } from '../src/component-library';
import { compileCircuit } from '../src/connectivity';
import { solveCircuit } from '../src/simulation';
import { probeCurrent } from '../src/measurement';
import { buildCurrentModel, buildCurrentPaths, buildPotentialModel } from '../src/visualization';
import { createHistory, executeCommand, undo, redo, copySelection } from '../src/editor';
import { parseDocument, serializeDocument } from '../src/persistence';
import { createSvgExport } from '../src/export';
import * as q from '../src/rational';

const document = () => requireDocument(fixture.document);
describe('changeover switch', () => {
  it('routes the bridge directly sideways from each contact without a second terminal below it', () => {
    const doc = document(), s = doc.components.find(c => c.id === 'S1')!;
    expect(s.position).toEqual({x:400,y:272});
    for (const [wireId, role, x] of [['W1','throw-a',424],['W2','throw-b',376]] as const) {
      const end = terminalPosition(s,s.terminals.findIndex(t=>t.role===role));
      expect(end).toEqual({x,y:296});
      const points = wirePoints(doc,doc.wires.find(w=>w.id===wireId)!).reverse();
      expect(points[0]).toEqual(end);
      expect(points[1].y).toBe(end.y);
      expect(points[1].x).not.toBe(end.x);
    }
    expect(symbolMarkup(s)).toContain('d="M-24 0L24 -24"');
    expect(switchContactPath(s)).toHaveLength(2);
    expect(switchContactPath(s).at(-1)).toEqual({x:424,y:296});
  });
  it.each(['switch', 'changeover-switch'] as const)('connects %s wires directly to the symbol contacts in every rotation and after storage', kind => {
    const s = createComponent(kind, 'S1', {x:100,y:100});
    for (const rotation of [0,90,180,270] as const) {
      s.rotation = rotation;
      const doc = {...emptyDocument(),components:[s]};
      const markup = symbolMarkup(s);
      expect(markup.match(/<path /g)).toHaveLength(1);
      expect(markup).not.toContain('44');
      for (const [i,t] of s.terminals.entries()) {
        const local = kind==='switch' ? {x:i===0?-24:24,y:0} : {x:t.role==='common'?-24:24,y:t.role==='throw-a'?-24:t.role==='throw-b'?24:0};
        expect(markup).toContain(`cx="${local.x}" cy="${local.y}"`);
        const angle=rotation*Math.PI/180;
        expect(terminalPosition(s,i)).toEqual({x:100+Math.round(local.x*Math.cos(angle)-local.y*Math.sin(angle)),y:100+Math.round(local.x*Math.sin(angle)+local.y*Math.cos(angle))});
      }
      expect(createSvgExport(doc).content).toContain(markup);
      const restored=parseDocument(serializeDocument(doc));
      expect(restored.ok).toBe(true);
      if(restored.ok)expect(symbolMarkup(restored.document.components[0])).toBe(markup);
    }
    s.terminals[0].localPosition={x:-60,y:12};
    expect(symbolMarkup(s)).toContain('cx="-60" cy="12"');
    expect(symbolMarkup(s)).toContain('d="M-60 12L24');
  });
  it.each(['switch', 'changeover-switch'] as const)('shares compact state and output defaults for %s while preserving explicit choices', kind => {
    const s = createComponent(kind, 'S1', {x:100,y:100});
    const doc = {...emptyDocument(), components:[s]};
    expect(componentValueFontSize([],s,componentValue(s),20)).toBe(10);
    expect(componentPresentation(s).value).toBeNull();
    expect(createSvgExport(doc).content).not.toContain(componentValue(s));
    s.properties.answerVisible = true;
    expect(componentPresentation(s).value).toBe(componentValue(s));
    expect(createSvgExport(doc).content).toContain(componentValue(s));
    s.properties.answerBlank = true;
    expect(componentPresentation(s).value).toBe('□');
    s.properties.answerVisible = false;
    expect(componentPresentation(s).value).toBeNull();
  });
  it('uses one common contact and two throws with stable roles under rotation and terminal reordering', () => {
    const s = createComponent('changeover-switch', 'S1', { x: 100, y: 100 });
    expect(s.type).toBe('switch');
    expect(s.terminals).toHaveLength(3);
    const doc = { ...emptyDocument(), components: [s] };
    expect(endpointName(doc, 'S1.common')).toBe('S1 · 공통 단자');
    expect(endpointName(doc, 'S1.a')).toBe('S1 · A 단자');
    expect(nextSwitchState(s)).toBe('b');
    for (const rotation of [0, 90, 180, 270] as const) {
      s.rotation = rotation;
      const before = Object.fromEntries(s.terminals.map((t, i) => [t.id, terminalPosition(s, i)]));
      s.terminals.reverse();
      expect(Object.fromEntries(s.terminals.map((t, i) => [t.id, terminalPosition(s, i)]))).toEqual(before);
      expect(switchTerminals(s).map(t => t?.id)).toEqual(['S1.common', 'S1.a']);
      expect(compileCircuit(doc).circuit.elements[0]).toMatchObject({ id: 'S1', type: 'switch', a: 'net:S1.common', b: 'net:S1.a', closed: true });
    }
    expect(symbolMarkup(s)).toContain('M-24 0L24 -24');
    expect(symbolMarkup(s).match(/<circle /g)).toHaveLength(3);
    expect(symbolMarkup(s)).toContain('cx="24" cy="24"');
    s.properties.state = 'b';
    expect(symbolMarkup(s)).toContain('M-24 0L24 24');
    expect(componentValue(s)).toBe('B 연결');
    expect(createSvgExport(doc).content).toContain(symbolMarkup(s));
  });

  it('rejects ambiguous contacts and invalid positions without changing the document', () => {
    for (const invalid of ['open', 'closed', 'both', 'c']) {
      const doc = document(); doc.components.find(c => c.id === 'S1')!.properties.state = invalid;
      expect(validateDocument(doc).ok).toBe(false);
      expect(compileCircuit(doc).circuit.elements).toEqual([]);
    }
    const doc = document(), s = doc.components.find(c => c.id === 'S1')!;
    s.terminals[2].role = 'throw-a'; expect(validateDocument(doc).ok).toBe(false);
    const before = document(), history = createHistory(before);
    expect(executeCommand(history, { type: 'SetProperties', id: 'S1', properties: { state: 'closed' } }).ok).toBe(false);
    expect(history.present).toEqual(before);
    before.activity = { allowedCommands: [], revealSteps: [] };
    expect(executeCommand(createHistory(before), { type: 'SetProperties', id: 'S1', properties: { state: 'b' } }).ok).toBe(false);
  });

  it.each(['a', 'b'])('rectifies input %s and leaves the unused contact/source at exactly zero current', state => {
    const doc = document(), s = doc.components.find(c => c.id === 'S1')!;
    s.properties.state = state; s.terminals.reverse();
    const compiled = compileCircuit(doc), result = solveCircuit(compiled.circuit);
    expect(compiled.diagnostics).toEqual([]); expect(result.status).toBe('solved');
    expect(result.branchCurrents.R1).toEqual(q.rational(9n, 2500n));
    expect(result.componentVoltages.R1).toEqual(q.rational(18n, 5n));
    for (const id of state === 'a' ? ['D1', 'D4', 'V2'] : ['D2', 'D3', 'V1'])
      expect(result.branchCurrents[id]).toEqual(q.ZERO);
    for (const id of state === 'a' ? ['D2', 'D3'] : ['D1', 'D4'])
      expect(result.branchCurrents[id]).toEqual(result.branchCurrents.R1);
    const active = probeCurrent(doc, compiled, result, { kind: 'component', id: 'S1' });
    expect(active.ok && active.value.to.id).toBe(`S1.${state}`);
    const unused = probeCurrent(doc, compiled, result, { kind: 'wire', id: state === 'a' ? 'W2' : 'W1' });
    expect(unused.ok && unused.value.amperes).toEqual(q.ZERO);
    const potential = buildPotentialModel(doc, compiled.circuit, result);
    const segment = potential.segments.find(p => p.id === 'S1')!;
    const selected = switchTerminals(s).map(t => terminalPosition(s, s.terminals.indexOf(t!)));
    expect(segment.points.map(({x,y}) => ({x,y}))).toEqual(switchContactPath(s));
    expect([segment.points[0], segment.points.at(-1)].map(p => ({ x:p!.x, y:p!.y }))).toEqual(selected);
    const paths = buildCurrentPaths(doc, buildCurrentModel(doc, compiled, result), potential);
    expect(paths.find(p => p.id === 'S1')!.points.map(({x,y}) => ({x,y}))).toEqual(switchContactPath(s));
  });

  it('reuses property commands, undo/redo, copy/paste and v6 persistence; deletion never joins all three contacts', () => {
    const doc = document(), before = serializeDocument(doc);
    const applied = executeCommand(createHistory(doc), { type: 'SetProperties', id: 'S1', properties: { state: 'b' } });
    expect(applied.ok).toBe(true); if (!applied.ok) return;
    expect(serializeDocument(undo(applied.history).present)).toBe(before);
    expect(redo(undo(applied.history)).present).toEqual(applied.history.present);
    const restored = parseDocument(serializeDocument(applied.history.present));
    expect(restored.ok).toBe(true); if (restored.ok) expect(restored.document).toEqual(applied.history.present);
    const clipboard = copySelection(doc, ['S1'], createDocumentIdAllocator(doc), { x: 0, y: 100 });
    const pasted = executeCommand(createHistory(doc), { type: 'Paste', ...clipboard });
    expect(pasted.ok).toBe(true);
    const deleted = executeCommand(createHistory(doc), { type: 'DeleteElements', ids: ['S1'] });
    expect(deleted.ok).toBe(true); if (!deleted.ok) return;
    const nets = compileCircuit(deleted.history.present).circuit.endpointToNet;
    expect(nets['V1.p']).not.toBe(nets['V2.n']);
    expect(nets['V1.p']).not.toBe(nets.JT);
    expect(nets['V2.n']).not.toBe(nets.JT);
    expect(undo(deleted.history).present).toEqual(doc);
    for (const version of [5, 7]) expect(parseDocument(JSON.stringify({ ...doc, version })).ok).toBe(false);
  });
});
