import { cloneDocument, type CircuitDocument } from '../domain';
export function layoutExample(input: CircuitDocument): CircuitDocument {
  const document = cloneDocument(input);
  if(document.documentId==='ux-wire-editing')return document;
  for (const c of document.components) { c.position = { x: 240 + c.position.x * 1.2, y: 320 + c.position.y * 1.2 }; if (c.type === 'dc-voltage-source') c.rotation = 90; }
  for (const j of document.junctions) j.position = { x: 240 + j.position.x * 1.2, y: 320 + j.position.y * 1.2 };
  const put = (id: string, x: number, y: number) => { const item = [...document.components, ...document.junctions].find(i => i.id === id); if (item) item.position = { x, y }; };
  const route = (id: string, points: [number, number][]) => { const wire = document.wires.find(w => w.id === id); if (wire) wire.waypoints = points.map(([x, y]) => ({ x, y })); };
  if (['fix-01', 'fix-02', 'fix-05', 'fix-10'].includes(document.documentId)) {
    put('V1', 240, 340); put('R1', document.documentId === 'fix-01' ? 540 : document.documentId === 'fix-05' ? 660 : 440, 220); put('R2', 660, 220); put('S1', 440, 220); put('J1', 550, 220);
    const returnId = document.documentId === 'fix-01' ? 'W2' : document.documentId === 'fix-05' ? 'W3' : 'W4';
    route(returnId, [[800, 220], [800, 460], [240, 460]]);
  }
  if (document.documentId === 'fix-03') {
    put('V1', 240, 340); put('R1', 560, 240); put('R2', 560, 440); put('JT', 420, 240); put('JB', 740, 440);
    route('W4', [[740, 240]]); route('W6', [[740, 500], [240, 500]]);
  }
  return document;
}
