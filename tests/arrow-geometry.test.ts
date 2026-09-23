import { describe, it, expect } from 'vitest';
import { arrowGeometry, arrowStyle, notationMetrics } from '../src/component-library';
import { emptyDocument, validateDocument, type Annotation } from '../src/domain';
import { createSvgExport } from '../src/export';
import { outputMoveCommand } from '../src/app/OutputCanvas';
import { createHistory, executeCommand, undo, redo } from '../src/editor';
import { serializeDocument, parseDocument } from '../src/persistence';
const annotation:Annotation={id:'arrow',kind:'arrow',anchor:null,position:{x:20,y:30},content:'2I',visibility:'always',arrow:{shape:'corner',length:80,legLength:40,rotation:90,reversed:false}};
describe('output arrow geometry',()=>{
  it('rotates the entire right-angle path and reverses only the direction',()=>{
    const g=arrowGeometry(annotation,annotation.position!);
    expect(g.points[1].x).toBeCloseTo(20);expect(g.points[1].y).toBeCloseTo(110);
    expect(g.points[2].x).toBeCloseTo(-20);expect(g.points[2].y).toBeCloseTo(110);
    const reverse=arrowGeometry({...annotation,arrow:{...annotation.arrow!,reversed:true}},annotation.position!);
    expect(reverse.path).toBe(g.path);expect(reverse.head).not.toBe(g.head);
    const a=g.points[1],b=g.points[2],c=g.points[0];expect((a.x-c.x)*(b.x-a.x)+(a.y-c.y)*(b.y-a.y)).toBeCloseTo(0);
  });
  it('retains legacy v2 arrows and input without mutating them',()=>{
    const input={...emptyDocument(),version:2,annotations:[{...annotation,arrow:undefined,end:{x:80,y:110}}]};delete input.annotations[0].arrow;
    const before=JSON.stringify(input),checked=validateDocument(input);expect(checked.ok).toBe(true);if(!checked.ok)return;
    expect(checked.document.version).toBe(4);expect(JSON.stringify(input)).toBe(before);
    const style=arrowStyle(checked.document.annotations[0],{x:20,y:30});expect(style.length).toBe(100);
    const g=arrowGeometry(checked.document.annotations[0],{x:20,y:30});expect(g.points[1].x).toBeCloseTo(80);expect(g.points[1].y).toBeCloseTo(110);
  });
  it('moves rigidly, survives save and undo and includes the full corner in export bounds',()=>{
    const doc=emptyDocument();doc.annotations=[annotation];
    const changed=executeCommand(createHistory(doc),outputMoveCommand(doc,{id:'arrow',part:'annotation'},{x:15,y:25})!);expect(changed.ok).toBe(true);if(!changed.ok)return;
    const next=changed.history.present;expect(next.annotations[0].arrow).toEqual(annotation.arrow);expect(next.annotations[0].position).toEqual({x:35,y:55});
    expect(parseDocument(serializeDocument(next))).toEqual({ok:true,document:next});expect(undo(changed.history).present).toEqual(doc);expect(redo(undo(changed.history)).present).toEqual(next);
    const exported=createSvgExport(doc);for(const p of arrowGeometry(annotation,annotation.position!).points){expect(p.x).toBeGreaterThan(exported.bounds.x);expect(p.x).toBeLessThan(exported.bounds.x+exported.bounds.width);expect(p.y).toBeGreaterThan(exported.bounds.y);expect(p.y).toBeLessThan(exported.bounds.y+exported.bounds.height);}
    expect(exported.content).toContain('2𝐼');expect(createSvgExport(doc,{circuitOnly:true}).content).not.toContain('2𝐼');
  });
});

it('keeps equal label clearance above and below a horizontal arrow',()=>{
  const doc=emptyDocument();
  const baseline=(rotation:number)=>{
    doc.annotations=[{...annotation,content:'2I_1',arrow:{...annotation.arrow!,shape:'straight',rotation}}];
    const content=createSvgExport(doc).content;
    return Number(content.match(/<text[^>]* y="([^"]+)"/)![1]);
  };
  const metrics=notationMetrics('2I_1',24);
  const upperGap=30-(baseline(0)+metrics.descent);
  const lowerGap=baseline(180)-metrics.ascent-30;
  expect(upperGap).toBeCloseTo(lowerGap);expect(upperGap).toBeCloseTo(15);
});

it('edits and moves arrow name and value independently without moving the arrow',()=>{
  const doc=emptyDocument();doc.annotations=[{...annotation,presentation:{labelText:'2I_1',labelDisplay:'custom',answerText:'3/4 A',answerDisplay:'custom'}}];
  const initial=createHistory(doc);
  const changed=executeCommand(initial,outputMoveCommand(doc,{id:'arrow',part:'value'},{x:700,y:600})!);expect(changed.ok).toBe(true);if(!changed.ok)return;
  const next=changed.history.present,a=next.annotations[0];
  expect(a.position).toEqual(annotation.position);expect(a.arrow).toEqual(annotation.arrow);expect(a.presentation).toMatchObject({answerOffsetX:700,answerOffsetY:600});expect(a.presentation?.labelOffsetX).toBeUndefined();
  expect(undo(changed.history).present).toEqual(doc);expect(parseDocument(serializeDocument(next))).toEqual({ok:true,document:next});
  const output=createSvgExport(next);expect(output.content).toContain('data-output-part="value"');expect(output.content).toContain('aria-label="3/4"');expect(output.content).toContain(' A</text>');expect(output.content).toContain('2𝐼');expect(output.bounds.x+output.bounds.width).toBeGreaterThan(650);
  a.presentation={...a.presentation,answerVisible:false,labelBlank:true};const hidden=createSvgExport(next).content;expect(hidden).not.toContain('aria-label="3/4"');expect(hidden).not.toContain('2𝐼');expect(hidden).toContain('data-output-part="label"');
});
it('migrates v3 arrows without changing their original name or geometry',()=>{
  const input={...emptyDocument(),version:3,annotations:[annotation]},before=JSON.stringify(input);
  const checked=validateDocument(input);expect(checked.ok).toBe(true);if(!checked.ok)return;
  expect(checked.document.annotations).toEqual(input.annotations);expect(JSON.stringify(input)).toBe(before);expect(checked.document.version).toBe(4);
});
