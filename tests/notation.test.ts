import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseQuantity, notationTokens, storedFraction, symbolGlyphs } from '../src/notation';
import { htmlNotation, formatQuantity, componentValueInput, componentPresentation, svgNotation } from '../src/component-library';
import { validateDocument } from '../src/domain';
import { createHistory, executeCommand, executeCommands, undo, redo } from '../src/editor';
import { serializeDocument, parseDocument } from '../src/persistence';
import { createSvgExport } from '../src/export';
import { compileCircuit } from '../src/connectivity';
import { solveCircuit } from '../src/simulation';

describe('explicit fraction notation',()=>{
  it('saves names with subscript syntax and applies name/value as one undoable, policy-checked edit',()=>{
    const checked=validateDocument(JSON.parse(readFileSync('fixtures/FIX-01-single-resistor.json','utf8')).document);if(!checked.ok)throw new Error('fixture');
    const initial=createHistory(checked.document);
    const commands=[{type:'SetLabel',id:'R1',label:'R_1'},{type:'SetProperties',id:'R1',properties:{resistanceOhm:.75,resistanceOhmFraction:'3/4'}}] as const;
    const changed=executeCommands(initial,commands);if(!changed.ok)throw new Error('edit');
    expect(changed.history.past).toHaveLength(1);expect(undo(changed.history).present).toEqual(initial.present);expect(redo(undo(changed.history)).present).toEqual(changed.history.present);
    const loaded=parseDocument(serializeDocument(changed.history.present));expect(loaded.ok&&loaded.document.components.find(c=>c.id==='R1')!.label).toBe('R_1');
    expect(createSvgExport(changed.history.present).content).toContain('data-notation="subscript"');
    const restricted=structuredClone(initial.present);restricted.activity={allowedCommands:['SetLabel'],revealSteps:[]};const restrictedHistory=createHistory(restricted);
    expect(executeCommands(restrictedHistory,commands).ok).toBe(false);expect(restrictedHistory.present.components.find(c=>c.id==='R1')!.label).toBe('R1');
  });
  it('renders numeric and grouped subscripts without modifying the input syntax',()=>{
    expect(notationTokens('R_1')).toEqual([{kind:'text',text:'R'},{kind:'subscript',text:'1'}]);
    expect(notationTokens('R_{eq}')).toEqual([{kind:'text',text:'R'},{kind:'subscript',text:'eq'}]);
    expect(notationTokens('R_')).toEqual([{kind:'text',text:'R_'}]);
    expect(notationTokens('R_{')).toEqual([{kind:'text',text:'R_{'}]);
    expect(htmlNotation('R_1',true)).toBe('𝑅<sub>1</sub>');
    const svg=svgNotation('R_1',{x:0,y:0,fontSize:20,symbol:true});
    expect(svg).toContain('data-notation="subscript"');expect(svg).toContain('y="5.6000000000000005"');expect(svg).toContain('font-size="14"');
    expect(htmlNotation('R_{<script>}',true)).not.toContain('<script>');
  });
  it('italicizes symbols while leaving digits and quantity units upright',()=>{
    expect(symbolGlyphs('R1')).toBe('𝑅1');expect(symbolGlyphs('I = 3/4 A')).toBe('𝐼 = 3/4 A');expect(symbolGlyphs('3/4 Ω')).toBe('3/4 Ω');
    expect(svgNotation('R1',{x:0,y:0,fontSize:16,symbol:true})).toContain('𝑅1');
    expect(svgNotation('3/4 V',{x:0,y:0,fontSize:16})).toContain(' V</text>');
  });
  it('shows only necessary decimal places and full-size fraction digits',()=>{
    expect(formatQuantity(9,'V')).toBe('9 V');expect(formatQuantity(1.23456,'V')).toBe('1.23 V');expect(formatQuantity(1.5,'V')).toBe('1.5 V');
    const svg=svgNotation('3/4 V',{x:0,y:0,fontSize:16});
    expect([...svg.matchAll(/font-size="([^"]+)"/g)].map(m=>m[1])).toEqual(['16','16','16']);
  });
  it.each([
    ['3/4','Ω',.75,'3/4'],['3/4 kΩ','Ω',750,'3/4 k'],['-3/4 V','V',-.75,'-3/4'],
    ['3/-4','V',-.75,'-3/4'],['-3/-4','Ω',.75,'3/4'],['1.5/2','V',.75,'1.5/2'],
    ['1e3/2 mA','A',.5,'1000/2 m'],['0/3','Ω',0,'0/3'],
  ] as const)('parses %s', (text,unit,value,fraction)=>expect(parseQuantity(text,unit)).toEqual({value,fraction}));
  it.each(['3/0','3/-0','3/','1/2/3','NaN','Infinity','1e999/2','-3/4','3/4 V'])('rejects invalid resistance %s',text=>expect(parseQuantity(text,'Ω')).toBeNull());
  it('leaves decimals and invalid text alone and recognizes adjacent units',()=>{
    expect(parseQuantity('0.75','Ω')).toEqual({value:.75});
    expect(notationTokens('3/4V')).toEqual([{kind:'fraction',numerator:'3',denominator:'4'},{kind:'text',text:'V'}]);
    expect(notationTokens('2026/9/23, 1/0, 0.75')).toEqual([{kind:'text',text:'2026/9/23, 1/0, 0.75'}]);
    expect(svgNotation('<& 3/4',{x:0,y:0,fontSize:16})).toContain('&lt;&amp;');
  });
  it('preserves written fractions through save, undo and output without changing the calculation',()=>{
    const checked=validateDocument(JSON.parse(readFileSync('fixtures/FIX-01-single-resistor.json','utf8')).document);
    if(!checked.ok)throw new Error('fixture');
    const initial=createHistory(checked.document);
    const changed=executeCommand(initial,{type:'SetProperties',id:'R1',properties:{resistanceOhm:.75,resistanceOhmFraction:'3/4'}});
    if(!changed.ok)throw new Error('edit');
    const doc=changed.history.present,r=doc.components.find(c=>c.id==='R1')!;
    expect(componentValueInput(r)).toBe('3/4');
    expect(componentPresentation(r).value).toBe('3/4 Ω');
    const loaded=parseDocument(serializeDocument(doc));
    expect(loaded.ok&&loaded.document).toEqual(doc);
    expect(redo(undo(changed.history)).present).toEqual(doc);
    const decimal=executeCommand(changed.history,{type:'SetProperties',id:'R1',properties:{resistanceOhm:.5}});
    if(!decimal.ok)throw new Error('decimal edit');
    expect(decimal.history.present.components.find(c=>c.id==='R1')!.properties.resistanceOhmFraction).toBeUndefined();
    expect(storedFraction({resistanceOhm:1,resistanceOhmFraction:'3/4'},'resistanceOhm','Ω')).toBeUndefined();
    const numeric=structuredClone(doc);delete numeric.components.find(c=>c.id==='R1')!.properties.resistanceOhmFraction;
    expect(solveCircuit(compileCircuit(doc).circuit)).toEqual(solveCircuit(compileCircuit(numeric).circuit));
    const source=doc.components.find(c=>c.type==='dc-voltage-source')!;
    source.properties.voltageV=.75;source.properties.voltageVFraction='3/4';
    r.properties.answerText='2/3 Ω';r.properties.answerDisplay='custom';
    doc.annotations.push({id:'fraction-note',kind:'note',content:'I = 5/6 A',anchor:null,position:{x:1200,y:900},visibility:'always'});
    const output=createSvgExport(doc);
    expect(output.svg).toContain('aria-label="2/3"');expect(output.svg).toContain('aria-label="5/6"');
    expect(output.bounds.y+output.bounds.height).toBeGreaterThan(912);
    const floor=createSvgExport(doc,{circuitOnly:true}).content;
    expect(floor).toContain('aria-label="3/4"');expect(floor).not.toContain('aria-label="2/3"');expect(floor).not.toContain('NaN');
  });
});
