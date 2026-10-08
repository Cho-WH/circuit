/** Viewport pixels supplied by renderers; no physics or help copy in this contract. */
export interface ScreenRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ComponentLabelLayout {
  bounds: ScreenRectangle;
  labels: Array<ScreenRectangle & { componentId: string }>;
  /** Optional upper-right symbol anchors for attached controls, independent of label visibility. */
  symbolAnchors?: Array<{ componentId: string; x: number; y: number }>;
  obstacles: ScreenRectangle[];
}
