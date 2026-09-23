import { documentMigrator } from '../domain';
import single from '../../fixtures/FIX-01-single-resistor.json';
import series from '../../fixtures/FIX-02-series.json';
import parallel from '../../fixtures/FIX-03-parallel.json';
import mixed from '../../fixtures/FIX-04-series-parallel.json';
import openSwitch from '../../fixtures/FIX-05-open-switch.json';
import bridge from '../../fixtures/FIX-09-balanced-bridge.json';
import referenceShift from '../../fixtures/FIX-10-reference-shift.json';

// The learning menu is curated separately from diagnostic and editing test fixtures.
export const examples = [single, series, parallel, mixed, openSwitch, bridge, referenceShift]
  .map(({ id, title, document }) => ({ id, title, document: documentMigrator.migrate(document) }));
