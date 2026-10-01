import { flushSync } from 'react-dom';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** One latest value per frame; the same gesture token groups validated document edits. */
export function useLiveValue(
  value: number,
  min: number,
  max: number,
  onChange: (value: number, group?: object) => boolean,
) {
  const [displayed, setDisplayed] = useState(value);
  const [running, setRunning] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [failed, setFailed] = useState(false);
  const latest = useRef({ value, min, max, onChange });
  latest.current = { value, min, max, onChange };
  const state = useRef({
    frame: 0,
    pending: null as number | null,
    expected: value,
    group: null as object | null,
    auto: false,
    position: value,
    direction: 1,
    time: 0,
    pause: 0,
  });

  function apply(next: number) {
    const s = state.current;
    s.pending = null;
    if (next === s.expected) return true;
    const previous = s.expected;
    s.expected = next;
    const ok = latest.current.onChange(next, s.group ?? undefined);
    if (!ok) {
      s.expected = previous;
      setDisplayed(previous);
      setFailed(true);
    }
    return ok;
  }
  function finish() {
    const s = state.current;
    cancelAnimationFrame(s.frame);
    s.frame = 0;
    s.auto = false;
    if (s.pending !== null) apply(s.pending);
    s.group = null;
    setRunning(false);
    setAdjusting(false);
  }
  function change(next: number) {
    const s = state.current;
    if (s.auto) finish();
    s.group ??= {};
    s.pending = next;
    setAdjusting(true);
    setDisplayed(next);
    setFailed(false);
    if (!s.frame)
      s.frame = requestAnimationFrame(() =>
        flushSync(() => {
          s.frame = 0;
          if (s.pending !== null && !apply(s.pending)) finish();
        }),
      );
  }
  function start() {
    finish();
    const s = state.current;
    s.group = {};
    s.auto = true;
    s.position = Math.max(min, Math.min(max, s.expected));
    s.direction = s.position >= max ? -1 : s.position <= min ? 1 : s.direction;
    s.time = 0;
    s.pause = 0;
    setRunning(true);
    setAdjusting(true);
    setFailed(false);
    const tick = (now: number) => {
      s.frame = 0;
      if (!s.auto) return;
      const dt = s.time ? Math.min(100, now - s.time) : 0;
      s.time = now;
      if (s.pause > 0) s.pause -= dt;
      else {
        const { min, max } = latest.current;
        s.position = Math.max(
          min,
          Math.min(max, s.position + s.direction * (max - min) * (dt / 8000)),
        );
        if ((s.direction > 0 && s.position === max) || (s.direction < 0 && s.position === min)) {
          s.direction *= -1;
          s.pause = 650;
        }
        // Generated values have readable precision; preserve exact range endpoints.
        const next =
          s.position === min || s.position === max
            ? s.position
            : Math.max(min, Math.min(max, Number(s.position.toPrecision(6))));
        let ok = true;
        flushSync(() => {
          setDisplayed(next);
          ok = apply(next);
        });
        if (!ok) {
          finish();
          return;
        }
      }
      s.frame = requestAnimationFrame(tick);
    };
    s.frame = requestAnimationFrame(tick);
  }

  useLayoutEffect(() => {
    const s = state.current;
    if (value !== s.expected) {
      // Undo, file replacement, or another editor owns this value now.
      cancelAnimationFrame(s.frame);
      s.frame = 0;
      s.pending = null;
      s.group = null;
      s.auto = false;
      s.expected = value;
      setRunning(false);
      setAdjusting(false);
    }
    if (s.pending === null) setDisplayed(value);
  }, [value]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) finish();
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      cancelAnimationFrame(state.current.frame);
      document.removeEventListener('visibilitychange', hide);
    };
  }, []);
  return { displayed, running, adjusting, failed, change, finish, start };
}
