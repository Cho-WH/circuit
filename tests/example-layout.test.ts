import { describe, expect, it } from 'vitest';
import { layoutExample } from '../src/app/examples';
import { examples } from '../src/fixtures';
import { cloneDocument } from '../src/domain';
import { componentNotationLayout, componentValue, notationMetrics, compactWirePoints, wireCrossings, wirePoints } from '../src/component-library';
import { compileCircuit } from '../src/connectivity';
import { solveCircuit } from '../src/simulation';

describe('curated learning circuit layouts', () => {
  it('uses subscript notation for numbered names while preserving connection IDs',()=>{
    for(const example of examples)for(const component of example.document.components){
      expect(component.label).toBe(component.id.replace(/^([A-Za-z]+)(\d+)$/, '$1_$2'));
      expect(component.id).not.toContain('_');
    }
  });
  it('offers seven learning examples without diagnostic or connection exercises', () => {
    expect(examples.map(example => example.id)).toEqual(['FIX-01', 'FIX-02', 'FIX-03', 'FIX-04', 'FIX-05', 'FIX-09', 'FIX-10']);
  });

  it.each(examples)('$id preserves electrical meaning and leaves the fixture untouched', example => {
    const original = cloneDocument(example.document);
    const laidOut = layoutExample(example.document);
    const before = compileCircuit(original);
    const after = compileCircuit(laidOut);
    expect(after).toEqual(before);
    expect(solveCircuit(after.circuit)).toEqual(solveCircuit(before.circuit));
    expect(laidOut.referenceNode).toEqual(original.referenceNode);
    expect(example.document).toEqual(original);
    expect(layoutExample(laidOut)).toEqual(laidOut);
  });

  it.each(examples)('$id has orthogonal routes without crossings, doubled wires or symbol collisions', example => {
    const doc = layoutExample(example.document);
    const segments = doc.wires.flatMap(wire => {
      const points = compactWirePoints(wirePoints(doc, wire));
      return points.slice(1).map((b, index) => ({ wire: wire.id, a: points[index], b }));
    });
    expect(wireCrossings(doc)).toEqual([]);
    for (const { a, b, wire } of segments) {
      expect(a.x === b.x || a.y === b.y, wire).toBe(true);
      for (const component of doc.components) {
        const vertical = component.rotation % 180 !== 0;
        const halfWidth = vertical ? 24 : 44, halfHeight = vertical ? 44 : 24;
        const left = component.position.x - halfWidth, right = component.position.x + halfWidth;
        const top = component.position.y - halfHeight, bottom = component.position.y + halfHeight;
        const throughBody = a.y === b.y
          ? a.y > top && a.y < bottom && Math.max(Math.min(a.x, b.x), left) < Math.min(Math.max(a.x, b.x), right)
          : a.x > left && a.x < right && Math.max(Math.min(a.y, b.y), top) < Math.min(Math.max(a.y, b.y), bottom);
        expect(throughBody, wire + ' through ' + component.id).toBe(false);
      }
    }
    for (let i = 0; i < segments.length; i++) for (const other of segments.slice(i + 1)) {
      const first = segments[i];
      const horizontal = first.a.y === first.b.y && other.a.y === other.b.y && first.a.y === other.a.y;
      const vertical = first.a.x === first.b.x && other.a.x === other.b.x && first.a.x === other.a.x;
      if (!horizontal && !vertical) continue;
      const axis = horizontal ? 'x' : 'y';
      const overlap = Math.min(Math.max(first.a[axis], first.b[axis]), Math.max(other.a[axis], other.b[axis]))
        - Math.max(Math.min(first.a[axis], first.b[axis]), Math.min(other.a[axis], other.b[axis]));
      expect(overlap, first.wire + ' overlapping ' + other.wire).toBeLessThanOrEqual(0);
    }
  });

  it.each(examples)('$id keeps enlarged labels clear of wires, symbols and other labels',example=>{
    const doc=layoutExample(example.document);
    const boxes=doc.components.flatMap(c=>{
      const text={label:c.label,value:componentValue(c)},layout=componentNotationLayout(c,text.label,text.value,22.5);
      return (['label','value'] as const).map(part=>{const p=layout[part],m=notationMetrics(text[part],22.5);return {id:c.id+':'+part,x:p.x-(p.anchor==='middle'?m.width/2:0),y:p.y-m.ascent,w:m.width,h:m.ascent+m.descent};});
    });
    const overlap=(a:{x:number;y:number;w:number;h:number},b:{x:number;y:number;w:number;h:number})=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
    for(const [i,box] of boxes.entries()){
      for(const other of boxes.slice(i+1))expect(overlap(box,other),box.id+' / '+other.id).toBe(false);
      for(const c of doc.components){const vertical=c.rotation%180!==0,bodyHeight=c.type==='resistor'||c.type==='resistive-load'?10:24;expect(overlap(box,{x:c.position.x-(vertical?bodyHeight:44),y:c.position.y-(vertical?44:bodyHeight),w:vertical?bodyHeight*2:88,h:vertical?88:bodyHeight*2}),box.id+' / '+c.id).toBe(false);}
      for(const wire of doc.wires){const points=wirePoints(doc,wire);for(let j=1;j<points.length;j++){const a=points[j-1],b=points[j];expect(overlap(box,{x:Math.min(a.x,b.x)-1,y:Math.min(a.y,b.y)-1,w:Math.abs(a.x-b.x)+2,h:Math.abs(a.y-b.y)+2}),box.id+' / '+wire.id).toBe(false);}}
    }
  });

  it('mirrors the parallel branches and source return around one center line', () => {
    const doc = layoutExample(examples.find(example => example.id === 'FIX-03')!.document);
    const [source, first, second] = doc.components;
    expect(first.position.x).toBe(source.position.x);
    expect(second.position.x).toBe(source.position.x);
    expect(first.rotation).toBe(second.rotation);
    expect(source.position.y - second.position.y).toBe(second.position.y - first.position.y);
    for (const [left, right] of [['W1', 'W6'], ['W2', 'W4'], ['W3', 'W5']]) {
      const points = (id: string) => compactWirePoints(wirePoints(doc, doc.wires.find(wire => wire.id === id)!));
      expect(points(left).map(p => ({ x: 2 * source.position.x - p.x, y: p.y }))).toEqual(points(right).reverse());
    }
  });
});
