import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { compileCircuit } from '../src/connectivity';
import { solveCircuit } from '../src/simulation';
import { buildPotentialModel } from '../src/visualization';
import { sceneAnchors, sceneExtent, selectedVoltage, voltageTicks } from '../src/potential-3d';
import type { CircuitDocument } from '../src/domain';
function model() {
  const document = JSON.parse(readFileSync('fixtures/FIX-02-series.json','utf8')).document as CircuitDocument;
  const compiled = compileCircuit(document).circuit;
  const result = solveCircuit(compiled);
  return { document, potential: buildPotentialModel(document,compiled,result) };
}
describe('3D reference plane and voltage readings',()=>{
  it('covers negative, positive and small voltage ranges with finite ordered ticks including zero',()=>{
    for(const values of [[-9,-3],[0,6,9],[-2,4],[.00001,.00004],[0],[NaN,Infinity]]) {
      const ticks=voltageTicks(values), finite=values.filter(Number.isFinite);
      expect(ticks).toContain(0); expect(ticks.every(Number.isFinite)).toBe(true);
      expect(ticks[0]).toBeLessThanOrEqual(Math.min(0,...finite));
      expect(ticks.at(-1)).toBeGreaterThanOrEqual(Math.max(0,...finite));
      expect(ticks).toEqual([...ticks].sort((a,b)=>a-b));
      expect(ticks.length).toBeLessThanOrEqual(8);
    }
  });
  it('keeps one anchor per solved net and preserves its voltage and height',()=>{
    const {document,potential}=model(); const anchors=sceneAnchors(document,potential);
    expect(anchors.length).toBe(Object.keys(potential.nets).length);
    for(const a of anchors) { expect(a.z).toBe(potential.nets[a.id].height); expect(a.voltage).toBe(potential.nets[a.id].voltage); }
    potential.nets[anchors[0].id].height=undefined;
    expect(sceneAnchors(document,potential).some(a=>a.id===anchors[0].id)).toBe(false);
  });
  it('keeps the floor in framing even when all solved heights are negative',()=>{
    const {document,potential}=model();
    Object.values(potential.nets).forEach(n=>{if(n.voltage!==undefined){n.voltage=-Math.abs(n.voltage);n.height=n.voltage*potential.scale;}});
    const bounds=sceneExtent(document,potential);
    expect(bounds.minZ).toBeLessThan(0); expect(bounds.maxZ).toBe(0);
    for(const c of document.components){expect(c.position.x).toBeGreaterThan(bounds.floor.x);expect(c.position.y).toBeLessThan(bounds.floor.y+bounds.floor.height);}
  });
  it('reads signed terminal differences and never assigns a value to an unsolved terminal',()=>{
    const {document,potential}=model(); const r=selectedVoltage(document,potential,'R1')!;
    expect(r.difference).toBeCloseTo(r.a.voltage-r.b.voltage,12);
    expect(r.a.z-r.b.z).toBeCloseTo(r.difference*potential.scale,12);
    potential.endpoints[r.component.terminals[0].id].height=undefined;
    expect(selectedVoltage(document,potential,'R1')).toBeNull();
    expect(selectedVoltage(document,potential,'missing')).toBeNull();
  });
});
