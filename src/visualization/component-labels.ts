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
  obstacles: ScreenRectangle[];
}
