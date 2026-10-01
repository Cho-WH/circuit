const fadeMs = 160;
const settleMs = 300;

/** Visibility of the whole train, independent of particle motion and camera reflow. */
export function createMarkVisibility(
  layer: SVGGElement,
  reset: () => void,
  sync: () => void,
) {
  let suppressed = false, hidden = false, held = false;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  layer.dataset.flowMarks = '';
  layer.style.opacity = '1';
  return {
    get suppressed() { return suppressed; },
    get hidden() { return hidden; },
    update(changed: boolean, hold: boolean, immediate: boolean) {
      const released = held && !hold;
      held = hold;
      if (!changed && !hold && !released) return;
      layer.style.transition = immediate ? 'none' : `opacity ${fadeMs}ms linear`;
      layer.style.opacity = '0';
      if (!suppressed || (immediate && !hidden)) {
        suppressed = true;
        clearTimeout(fadeTimer);
        if (immediate) hidden = true;
        else fadeTimer = setTimeout(() => { hidden = true; sync(); }, fadeMs);
      }
      clearTimeout(settleTimer);
      if (!hold) settleTimer = setTimeout(() => {
        // The layer is fully transparent: establish the latest spacing without moving visible dots.
        reset();
        suppressed = false;
        hidden = false;
        layer.style.opacity = '1';
        sync();
      }, settleMs);
    },
    dispose() {
      clearTimeout(fadeTimer);
      clearTimeout(settleTimer);
    },
  };
}
