import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { compileCircuit } from '../src/connectivity';
import { solveCircuit } from '../src/simulation';
import { buildPotentialModel } from '../src/visualization';
import { sceneAnchors, sceneExtent, selectedVoltage, voltageTicks, automaticHeight, fitPotentialHeight } from '../src/potential-3d';
import type { CircuitDocument } from '../src/domain';
function model() {
  const document = JSON.parse(readFileSync('fixtures/FIX-02-series.json','utf8')).document as CircuitDocument;
  const compiled = compileCircuit(document).circuit;
  const result = solveCircuit(compiled);
  return { document, potential: buildPotentialModel(document,compiled,result) };
}
describe('3D reference plane and voltage readings',()=>{
  it('normalizes mV, V and kV to the same height while preserving voltage ratios and colors',()=>{
    const {document}=model();
    let expected:number[] | undefined;
    for(const voltageV of [.009,9,9000]) {
      document.components[0].properties.voltageV=voltageV;
      const compiled=compileCircuit(document).circuit;
      const source=buildPotentialModel(document,compiled,solveCircuit(compiled));
      const target=automaticHeight(document,source,1000,600);
      const fitted=fitPotentialHeight(source,target,1);
      const heights=Object.values(fitted.nets).map(n=>n.height!);
      if(expected) heights.forEach((h,i)=>expect(h).toBeCloseTo(expected![i]));
      else expected=heights;
      const extent=sceneExtent(document,fitted);
      expect(extent.maxZ-extent.minZ).toBeCloseTo(target);
      for(const [id,net] of Object.entries(fitted.nets)) {
        expect(net.voltage).toBe(source.nets[id].voltage);
        expect(net.color).toBe(source.nets[id].color);
        expect(net.height).toBeCloseTo(fitted.scale*(net.voltage!-fitted.referenceVoltage));
      }
      for(const [id,net] of Object.entries(fitted.endpoints)) expect(net).toBe(fitted.nets[source.endpoints[id].netId]);
    }
    document.referenceNode={kind:'junction',id:'J1'};
    const compiled=compileCircuit(document).circuit;
    const signed=fitPotentialHeight(buildPotentialModel(document,compiled,solveCircuit(compiled)),200,1);
    expect(sceneExtent(document,signed).minZ).toBeLessThan(0);
    expect(sceneExtent(document,signed).maxZ).toBeGreaterThan(0);
    document.components[0].properties.voltageV=0;
    const zero=fitPotentialHeight(buildPotentialModel(document,compiled,solveCircuit(compileCircuit(document).circuit)),200,1);
    expect(Object.values(zero.nets).every(n=>n.height===0)).toBe(true);
    expect(Number.isFinite(zero.scale)).toBe(true);
  });
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
