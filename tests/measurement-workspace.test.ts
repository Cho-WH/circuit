import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { CircuitCanvas, type CanvasProps } from '../src/app/CircuitCanvas';
import { MeasurementPanel } from '../src/app/MeasurementPanel';
import { compileCircuit } from '../src/connectivity';
import { solveCircuit } from '../src/simulation';
import type { CircuitDocument } from '../src/domain';
const document = JSON.parse(readFileSync('fixtures/FIX-02-series.json','utf8')).document as CircuitDocument;
const compilation = compileCircuit(document), result = solveCircuit(compilation.circuit);
const noop = () => {};
const canvasProps: CanvasProps = {document,selected:[],tool:'probe',placement:null,wireStart:null,onSelect:noop,onMove:noop,onPlace:noop,onEndpoint:noop,onWire:noop,onValue:noop,onSwitch:noop,onBackground:noop};
function panel(red:string,black:string) {
  return renderToStaticMarkup(createElement(MeasurementPanel, {document,compilation,result,active:true,kind:'voltage',onKind:noop,branchId:'',onBranch:noop,onEdit:noop,red,black,activeProbe:'red',onProbes:noop,onActiveProbe:noop,onPreview:noop,children:null}));
}
describe('measurement workspace',()=>{
  it('keeps probe targets accessible while removing value-edit actions from the measurement canvas',()=>{
    const measured=renderToStaticMarkup(createElement(CircuitCanvas,{...canvasProps,readOnly:true}));
    const edited=renderToStaticMarkup(createElement(CircuitCanvas,{...canvasProps,tool:'select'}));
    expect(measured).toContain('aria-label="측정 회로"');
    expect(measured).toContain('aria-label="단자 R1.a"');
    expect(measured).not.toContain('aria-label="R1 값 편집"');
    expect(edited).toContain('aria-label="R1 값 편집"');
  });
  it('keeps recording disabled until both voltage probes are connected',()=>{
    const html=panel('R1.a','');
    expect(html).toContain('연결 대기');
    expect(html).toMatch(/<output[^>]*>— V<\/output>/);
    expect(html).toMatch(/<button[^>]*aria-label="측정값 기록"[^>]*disabled/);
  });
  it('shows the signed physical reading in the prominent result for either probe order',()=>{
    expect(panel('R1.a','R1.b')).toMatch(/<output[^>]*>3.00 V<\/output>/);
    expect(panel('R1.b','R1.a')).toMatch(/<output[^>]*>-3.00 V<\/output>/);
  });
});
