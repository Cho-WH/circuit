import { cloneDocument, type CircuitDocument, type ComponentInstance } from '../domain';

type Placement = readonly [x: number, y: number, rotation: ComponentInstance['rotation']];
interface ExampleLayout {
  components: Record<string, Placement>;
  junctions?: Record<string, readonly [x: number, y: number]>;
  routes: Record<string, readonly (readonly [x: number, y: number])[]>;
}

// Presentation only: keep fixture IDs, endpoint references, values and reference nodes intact.
// Routes are explicit so automatic elbows cannot run through a symbol or double back.
const series: ExampleLayout = {
  components: { V1: [240, 340, 90], R1: [440, 220, 0], R2: [660, 220, 0] },
  junctions: { J1: [550, 220] },
  routes: { W1: [[240, 220]], W4: [[860, 220], [860, 460], [240, 460]] },
};

const layouts: Record<string, ExampleLayout> = {
  'fix-01': {
    components: { V1: [240, 340, 90], R1: [520, 220, 0] },
    routes: { W1: [[240, 220]], W2: [[800, 220], [800, 460], [240, 460]] },
  },
  'fix-02': series,
  'fix-03': {
    // Equal-width horizontal branches, with a centered source on the bottom rail.
    components: { V1: [560, 520, 0], R1: [560, 200, 0], R2: [560, 360, 0] },
    junctions: { JT: [320, 360], JB: [800, 360] },
    routes: {
      W1: [[320, 520]], W2: [[320, 200]], W4: [[800, 200]], W6: [[800, 520]],
    },
  },
  'fix-04': {
    components: { V1: [580, 540, 0], R1: [400, 300, 0], R2: [680, 200, 0], R3: [680, 400, 0] },
    junctions: { JM: [520, 300], JG: [840, 300] },
    routes: {
      W1: [[240, 540], [240, 300]], W3: [[520, 200]], W4: [[520, 400]],
      W5: [[840, 200]], W6: [[840, 400]], W7: [[920, 300], [920, 540]],
    },
  },
  'fix-05': {
    components: { V1: [240, 340, 90], S1: [440, 220, 0], R1: [660, 220, 0] },
    routes: { W1: [[240, 220]], W3: [[860, 220], [860, 460], [240, 460]] },
  },
  'fix-09': {
    // Two matching vertical resistor stacks and a horizontal center bridge.
    components: {
      V1: [240, 360, 90], R1: [480, 280, 90], R2: [480, 440, 90],
      R3: [800, 280, 90], R4: [800, 440, 90], R5: [640, 360, 0],
    },
    junctions: { JT: [480, 200], JB: [480, 520], JL: [480, 360], JR: [800, 360] },
    routes: { W1: [[240, 200]], W6: [[800, 200]], W9: [[800, 520]], W12: [[240, 520]] },
  },
  'fix-10': series,
};

export function layoutExample(input: CircuitDocument): CircuitDocument {
  const document = cloneDocument(input);
  const layout = layouts[document.documentId];
  if (!layout) return document;
  for (const component of document.components) {
    const placement = layout.components[component.id];
    if (!placement) continue;
    const [x, y, rotation] = placement;
    component.position = { x, y };
    component.rotation = rotation;
  }
  for (const junction of document.junctions) {
    const placement = layout.junctions?.[junction.id];
    if (placement) junction.position = { x: placement[0], y: placement[1] };
  }
  for (const wire of document.wires) {
    wire.waypoints = (layout.routes[wire.id] ?? []).map(([x, y]) => ({ x, y }));
  }
  return document;
}
