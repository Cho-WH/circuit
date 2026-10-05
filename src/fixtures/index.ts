import { requireDocument } from '../domain';
import single from '../../fixtures/FIX-01-single-resistor.json';
import series from '../../fixtures/FIX-02-series.json';
import parallel from '../../fixtures/FIX-03-parallel.json';
import mixed from '../../fixtures/FIX-04-series-parallel.json';
import openSwitch from '../../fixtures/FIX-05-open-switch.json';
import bridge from '../../fixtures/FIX-09-balanced-bridge.json';
import referenceShift from '../../fixtures/FIX-10-reference-shift.json';
import variableDivider from '../../fixtures/FIX-11-variable-divider.json';
import variableParallel from '../../fixtures/FIX-12-variable-parallel.json';
import forwardDiode from '../../fixtures/FIX-13-forward-diode.json';

// The learning menu is curated separately from diagnostic and editing test fixtures.
export const examples = [single, series, parallel, mixed, openSwitch, variableDivider, variableParallel, bridge, referenceShift, forwardDiode]
  .map(({ id, title, document }) => {
    const example=requireDocument(document);
    for(const component of example.components)component.label=component.label.replace(/^([A-Za-z]+)(\d+)$/, '$1_$2');
    return {id,title,document:example};
  });
