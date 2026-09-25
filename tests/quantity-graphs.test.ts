import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateDocument } from '../src/domain';
import { compileCircuit } from '../src/connectivity';
import { solveCircuit } from '../src/simulation';
import { suggestPaths } from '../src/visualization';
import { PotentialGraph } from '../src/app/PotentialGraph';
import { SvgNotation } from '../src/app/Notation';

describe('quantity graph presentation', () => {
  it('shows millivolts and the real renamed component in a path graph', () => {
    const checked = validateDocument(
      JSON.parse(readFileSync('fixtures/FIX-01-single-resistor.json', 'utf8')).document,
    );
    if (!checked.ok) throw Error('fixture');
    const document = checked.document;
    document.components.find((c) => c.type === 'dc-voltage-source')!.properties.voltageV = 0.003;
    document.components.find((c) => c.id === 'R1')!.label = '부하';
    const circuit = compileCircuit(document).circuit,
      result = solveCircuit(circuit),
      path = suggestPaths(circuit)[0];
    const markup = renderToStaticMarkup(
      createElement(PotentialGraph, { document, path, result, hovered: null, onHover: () => {} }),
    );
    expect(markup).toContain('>mV</text>');
    expect(markup).toContain('>3</text>');
    expect(markup).toContain('부하 전위 변화');
    expect(markup).not.toContain('R1 전위 변화');
  });
  it('uses the same automatic equation italics in the direct SVG text path', () => {
    const markup = renderToStaticMarkup(
      createElement(SvgNotation, { text: 'I = 2 A', x: 0, y: 0 }),
    );
    expect(markup).toContain('𝐼 = 2 A');
  });
});
