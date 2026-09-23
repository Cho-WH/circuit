import { describe,it,expect } from 'vitest';
import source from '../fixtures/ux/wire-editing.json';
import { cloneDocument, documentMigrator, emptyDocument, type CircuitDocument } from '../src/domain';
import { compactWirePoints, createComponent, wireCrossings, wirePath, wirePoints } from '../src/component-library';
import { createHistory, executeCommand, previewCommand, undo, redo, insertionCandidates, type Command } from '../src/editor';
import { compileCircuit } from '../src/connectivity';
import { solveCircuit } from '../src/simulation';
import { parseDocument, serializeDocument } from '../src/persistence';
import { exportSvg } from '../src/export';

const fixture=()=>documentMigrator.migrate(source);
function apply(document:CircuitDocument,command:Command){const result=executeCommand(createHistory(document),command);if(!result.ok)throw new Error(JSON.stringify(result.diagnostics));return result.history;}
const solve=(doc:CircuitDocument)=>solveCircuit(compileCircuit(doc).circuit);
function crossingFixture(){
  const doc=emptyDocument('crossings');
  doc.junctions=[{id:'L',position:{x:0,y:200}},{id:'R',position:{x:600,y:200}},{id:'T',position:{x:200,y:0}},{id:'B',position:{x:200,y:400}},{id:'T2',position:{x:400,y:0}},{id:'B2',position:{x:400,y:400}}];
  doc.wires=[{id:'H',start:{kind:'junction',id:'L'},end:{kind:'junction',id:'R'},waypoints:[]},{id:'V',start:{kind:'junction',id:'T'},end:{kind:'junction',id:'B'},waypoints:[]},{id:'V2',start:{kind:'junction',id:'T2'},end:{kind:'junction',id:'B2'},waypoints:[]}];return doc;
}
const join:Command={type:'ConnectCrossing',point:{x:200,y:200},wireIds:['H','V'],junctionId:'J',newWireIds:['H2','V3']};
describe('wire insertion and explicit crossing edits',()=>{
  it('inserts 6 Ω in the 9 V / 3 Ω fixture without a bypass, previews identically and undoes atomically',()=>{
    const doc=fixture(),r=createComponent('resistor','R2',{x:300,y:450});r.properties.resistanceOhm=6;
    const candidate=insertionCandidates(doc,r.position)[0];
    const command:Command={type:'InsertComponentOnWire',component:r,wireId:candidate.wireId,segment:candidate.segment,newWireId:'W3'};
    expect(solve(doc).branchCurrents.R1).toBeCloseTo(3);
    const history=apply(doc,command),compiled=compileCircuit(history.present).circuit;
    expect(solve(history.present).branchCurrents.R1).toBeCloseTo(1);
    expect(solve(history.present).branchCurrents.R2).toBeCloseTo(-1); // current follows physical right-to-left route
    expect(compiled.endpointToNet['R2.a']).not.toBe(compiled.endpointToNet['R2.b']);
    expect(history.present.wires).toHaveLength(3);
    expect(previewCommand(doc,command)).toEqual({ok:true,document:history.present});
    expect(history.past).toHaveLength(1);expect(undo(history).present).toEqual(doc);expect(redo(undo(history)).present).toEqual(history.present);
    expect(parseDocument(serializeDocument(history.present))).toMatchObject({ok:true,document:history.present});
    expect(doc).toEqual({...source,version: 4});
  });
  it('keeps the unrelated route and the bends outside an inserted vertical component',()=>{
    const doc=fixture(),r=createComponent('dc-voltage-source','V2',{x:800,y:220});
    const target=insertionCandidates(doc,r.position)[0];
    const next=apply(doc,{type:'InsertComponentOnWire',component:r,...target,newWireId:'W3'}).present;
    expect(next.wires[0]).toEqual(doc.wires[0]);expect(next.components.at(-1)?.rotation).toBe(90);
    expect(wirePoints(next,next.wires.find(w=>w.id==='W2')!)).toEqual([{x:724,y:340},{x:800,y:340},{x:800,y:264}]);
    expect(wirePoints(next,next.wires.find(w=>w.id==='W3')!)).toEqual([{x:800,y:176},{x:800,y:80},{x:400,y:80},{x:400,y:450},{x:200,y:450},{x:200,y:384}]);
  });
  it('uses source polarity roles when the terminal array order is reversed',()=>{
    const doc=fixture(),source=createComponent('dc-voltage-source','V2',{x:800,y:220});
    source.terminals.reverse();doc.referenceNode=null;
    const target=insertionCandidates(doc,source.position)[0];
    const next=apply(doc,{type:'InsertComponentOnWire',component:source,...target,newWireId:'W3'}).present;
    expect(next.referenceNode?.id).toBe('V2.b');
    expect(next.wires.find(w=>w.id==='W2')?.end.id).toBe('V2.b');
    expect(wirePoints(next,next.wires.find(w=>w.id==='W2')!).at(-1)).toEqual({x:800,y:264});
  });
  it.each(['space','crossing','voltmeter','permission','duplicate'])('rejects %s insertion without mutating the document',reason=>{
    const doc=fixture(),before=cloneDocument(doc),p=reason==='space'?{x:210,y:450}:reason==='crossing'?{x:400,y:180}:{x:300,y:450};
    const r=createComponent(reason==='voltmeter'?'voltmeter':'resistor','R2',p),candidate=insertionCandidates(doc,p)[0];
    if(reason==='permission')doc.activity={allowedCommands:['AddComponent'],revealSteps:[]};
    const history=createHistory(doc),result=executeCommand(history,{type:'InsertComponentOnWire',component:r,...candidate,newWireId:reason==='duplicate'?'W1':'W3'});
    expect(result.ok).toBe(false);expect(history.past).toEqual([]);expect({...doc,activity:null}).toEqual(before);
  });
  it('connects only one of multiple crossings, then separates the horizontal and vertical paths',()=>{
    const doc=crossingFixture(),before=compileCircuit(doc).circuit;
    expect(before.endpointToNet.L).not.toBe(before.endpointToNet.T);
    const joined=apply(doc,join).present,after=compileCircuit(joined).circuit;
    expect(after.endpointToNet.L).toBe(after.endpointToNet.T);expect(after.endpointToNet.L).not.toBe(after.endpointToNet.T2);
    expect(wireCrossings(joined)).toHaveLength(1);
    const split=apply(joined,{type:'DisconnectCrossing',junctionId:'J'});
    const nets=compileCircuit(split.present).circuit;
    expect(nets.endpointToNet.L).not.toBe(nets.endpointToNet.T);expect(wireCrossings(split.present)).toHaveLength(2);
    expect(split.present.wires.map(w=>compactWirePoints(wirePoints(split.present,w)))).toEqual(doc.wires.map(w=>wirePoints(doc,w)));
    expect(undo(split).present).toEqual(joined);expect(redo(undo(split)).present).toEqual(split.present);
    expect(parseDocument(serializeDocument(split.present))).toMatchObject({ok:true,document:split.present});
  });
  it('preserves an electrical connection elsewhere after disconnecting this crossing',()=>{
    const doc=crossingFixture();doc.wires.push({id:'elsewhere',start:{kind:'junction',id:'L'},end:{kind:'junction',id:'T'},waypoints:[{x:0,y:0}]});
    const joined=apply(doc,join).present,split=apply(joined,{type:'DisconnectCrossing',junctionId:'J'}).present,nets=compileCircuit(split).circuit;
    expect(nets.endpointToNet.L).toBe(nets.endpointToNet.T);expect(wireCrossings(split)).toHaveLength(2);
  });
  it.each(['reference','annotation','T','overlap','permission'])('preserves the document when a %s makes crossing separation unavailable',reason=>{
    const doc=apply(crossingFixture(),join).present;
    if(reason==='reference')doc.referenceNode={kind:'junction',id:'J'};
    if(reason==='annotation')doc.annotations.push({id:'note',kind:'label',anchor:{kind:'junction',id:'J'},content:'A',visibility:'always'});
    if(reason==='T')doc.wires=doc.wires.filter(w=>w.id!=='H2');
    if(reason==='overlap')doc.wires.push({...doc.wires[0],id:'extra'});
    if(reason==='permission')doc.activity={allowedCommands:['DeleteElements'],revealSteps:[]};
    const before=cloneDocument(doc);expect(previewCommand(doc,{type:'DisconnectCrossing',junctionId:'J'}).ok).toBe(false);expect(doc).toEqual(before);
  });
  it('splits a wire when tapped to finish a branch, preserving bends and undo',()=>{
    const doc=fixture();doc.components.push(createComponent('resistor','R2',{x:300,y:550}));
    const command:Command={type:'ConnectToWire',start:{kind:'terminal',id:'R2.a'},wireId:'W2',point:{x:300,y:450},junctionId:'J',newWireId:'W3',branchId:'W4'};
    const history=apply(doc,command);expect(history.present.wires).toHaveLength(4);
    expect(history.present.wires[1].waypoints).toContainEqual({x:800,y:80});
    const nets=compileCircuit(history.present).circuit;expect(nets.endpointToNet['R2.a']).toBe(nets.endpointToNet['V1.b']);expect(undo(history).present).toEqual(doc);
  });
  it('uses the same unmasked bridges in transparent monochrome exports, including joined and separated states',()=>{
    const doc=crossingFixture(),path=wirePath(doc,doc.wires[0]);
    expect(path.match(/ A/g)).toHaveLength(2);
    const svg=exportSvg(doc,{monochrome:true,background:'transparent'});expect(svg).toContain(`d="${path}"`);expect(svg).not.toContain('<mask');
    const joined=apply(doc,join).present;
    expect(exportSvg(joined,{monochrome:true})).not.toContain('cx="200" cy="200"');
    expect(exportSvg(joined,{monochrome:true}).match(/ A7/g)).toHaveLength(1);
    expect(wirePath(joined,joined.wires[0])).not.toContain(' A');
    const split=apply(joined,{type:'DisconnectCrossing',junctionId:'J'}).present;expect(wirePath(split,split.wires[0])).toBe(path);
  });
});
