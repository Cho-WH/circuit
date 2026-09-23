import { describe, expect, it } from 'vitest';
import { examples } from '../src/fixtures';
import { compileCircuit } from '../src/connectivity';
import { solveCircuit } from '../src/simulation';
import { probeCurrent } from '../src/measurement';
import { layoutExample } from '../src/app/examples';
import { anchorPose, anchorEndpoint, measurementHit } from '../src/app/measurement-tools';

const parallel=()=>layoutExample(examples.find(e=>e.id==='FIX-03')!.document);
const read=(doc:ReturnType<typeof parallel>,id:string,kind:'wire'|'component'='wire')=>{const c=compileCircuit(doc);return probeCurrent(doc,c,solveCircuit(c.circuit),{kind,id});};
describe('non-contact current',()=>{
  it.each(examples)('$id reads every component without modifying the document or its routes',example=>{
    const doc=layoutExample(example.document),before=JSON.stringify(doc),compilation=compileCircuit(doc),result=solveCircuit(compilation.circuit);
    for(const component of doc.components){const reading=probeCurrent(doc,compilation,result,{kind:'component',id:component.id});expect(reading.ok).toBe(true);if(reading.ok)expect(reading.value.amperes).toBeCloseTo(result.branchCurrents[component.id],10);}
    expect(JSON.stringify(doc)).toBe(before);
  });
  it('distinguishes 3 A before a parallel split from 1 A and 2 A after it, including the return',()=>{
    const doc=parallel();
    for(const [id,expected] of Object.entries({W1:3,W2:1,W3:2,W4:1,W5:2,W6:3})) {const r=read(doc,id);expect(r.ok).toBe(true);if(r.ok)expect(r.value.amperes).toBeCloseTo(expected,10);}
    const w=doc.wires[0];[w.start,w.end]=[w.end,w.start];const r=read(doc,w.id);if(!r.ok)throw Error('reading');expect(r.value.amperes).toBeCloseTo(-3);
  });
  it('preserves source polarity when terminal storage order changes',()=>{
    const doc=parallel();doc.components[0].terminals.reverse();const r=read(doc,'V1','component');if(!r.ok)throw Error('reading');expect(r.value.from.id).toBe('V1.p');expect(r.value.amperes).toBeCloseTo(-3);expect(read(doc,'W1')).toMatchObject({ok:true,value:{amperes:3}});
  });
  it('does not invent a wire current around an ideal conductor cycle',()=>{
    const doc=parallel();doc.wires.push({...structuredClone(doc.wires[0]),id:'duplicate'});
    expect(read(doc,'W1')).toMatchObject({ok:false,diagnostics:[{code:'WIRE_CURRENT_UNDEFINED'}]});
    expect(read(doc,'W2')).toMatchObject({ok:true,value:{amperes:1}});
  });
  it('withholds missing, incomplete and invalid readings while showing real zero current',()=>{
    const doc=parallel(),c=compileCircuit(doc),r=solveCircuit(c.circuit);
    expect(probeCurrent(doc,c,r,null).ok).toBe(false);
    expect(read(doc,'missing').ok).toBe(false);
    expect(probeCurrent(doc,c,{...r,status:'error'}, {kind:'wire',id:'W1'}).ok).toBe(false);
    const open=layoutExample(examples.find(e=>e.id==='FIX-05')!.document);expect(read(open,'W1')).toMatchObject({ok:true,value:{amperes:0}});
    const missing={...r,branchCurrents:{}};expect(probeCurrent(doc,c,missing,{kind:'wire',id:'W1'}).ok).toBe(false);
  });
});
describe('measurement placement',()=>{
  it('accepts a generous wire hit area and retains the actual touched position',()=>{
    const doc=parallel(),hit=measurementHit(doc,{x:400,y:210},1,'red');expect(hit).toMatchObject({kind:'wire',id:'W2'});
    expect(anchorPose(doc,hit)?.point).toEqual({x:400,y:200});expect(anchorEndpoint(doc,hit)?.id).toBe('JT');
    expect(measurementHit(doc,{x:400,y:245},1,'red')).toBeNull();
  });
  it('avoids selecting an arbitrary branch at a junction or disconnected crossing',()=>{
    const doc=parallel();expect(measurementHit(doc,{x:320,y:360},1,'current')).toBeNull();
    doc.wires.push({id:'cross',start:{kind:'terminal',id:'V1.p'},end:{kind:'terminal',id:'V1.n'},waypoints:[{x:400,y:100},{x:400,y:300}]});
    expect(measurementHit(doc,{x:400,y:200},1,'current')).toBeNull();
  });
  it('places sensors on a component lead and rejects deleted anchors',()=>{
    const doc=parallel();expect(measurementHit(doc,{x:560,y:200},1,'current')).toEqual({kind:'component',id:'R1'});
    expect(anchorPose(doc,{kind:'component',id:'R1'})?.point.y).toBe(200);
    expect(anchorPose(doc,{kind:'component',id:'deleted'})).toBeNull();
  });
});
