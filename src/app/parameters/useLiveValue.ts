import { flushSync } from 'react-dom';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Automatic electrical updates share stable component order, independent of
// the order in which playback was clicked. Manual gestures keep their own frame.
let automaticFrame = 0, nextAutomaticId = -1;
const automaticJobs = new Map<number, { key: string; run: FrameRequestCallback }>();
function requestAutomaticFrame(key: string, run: FrameRequestCallback) {
  const id = nextAutomaticId--;
  automaticJobs.set(id, { key, run });
  if (!automaticFrame) automaticFrame = requestAnimationFrame(now => {
    automaticFrame = 0;
    const jobs = [...automaticJobs].sort((a,b) => a[1].key < b[1].key ? -1 : a[1].key > b[1].key ? 1 : 0);
    for (const [id, job] of jobs) {
      if (!automaticJobs.delete(id)) continue;
      job.run(now);
    }
  });
  return id;
}
function cancelLiveFrame(id: number) {
  if (id >= 0) { cancelAnimationFrame(id); return; }
  automaticJobs.delete(id);
  if (!automaticJobs.size) { cancelAnimationFrame(automaticFrame); automaticFrame = 0; }
}

/** One latest value per frame; the same gesture token groups validated document edits. */
export function useLiveValue(
  value: number,
  min: number,
  max: number,
  onChange: (value: number, group?: object) => boolean | 'stop',
  options: { inspectIntermediate?: boolean; stopEpoch?: number; disabled?: boolean; orderKey?: string } = {},
) {
  const [displayed, setDisplayed] = useState(value);
  const [running, setRunning] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [failed, setFailed] = useState(false);
  const latest = useRef({ value, min, max, onChange, options });
  latest.current = { value, min, max, onChange, options };
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
    if (ok === false) {
      s.expected = previous;
      setDisplayed(previous);
      setFailed(true);
    }
    if (ok === 'stop') setDisplayed(next);
    return ok;
  }
  function finish() {
    const s = state.current;
    cancelLiveFrame(s.frame);
    s.frame = 0;
    s.auto = false;
    if (s.pending !== null) apply(s.pending);
    s.group = null;
    setRunning(false);
    setAdjusting(false);
  }
  function change(next: number) {
    if (latest.current.options.disabled) return;
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
          if (s.pending !== null && apply(s.pending) !== true) finish();
        }),
      );
  }
  function start() {
    if (latest.current.options.disabled) return;
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
        // The clock is approximate; only integer positions become physical inputs.
        const next =
          s.position === min || s.position === max
            ? s.position
            : Math.max(min, Math.min(max, Math.round(s.position)));
        let ok: boolean | 'stop' = true;
        flushSync(() => {
          if (latest.current.options.inspectIntermediate) {
            // Inspect at most 16 logical positions per frame. If playback outruns
            // calculation, keep its remaining distance for the next frame.
            let remaining = 16;
            while (s.expected !== next && remaining-- > 0 && s.auto) {
              const direction = next > s.expected ? 1 : -1;
              const step = direction > 0 ? Math.min(next, Math.floor(s.expected) + 1) : Math.max(next, Math.ceil(s.expected) - 1);
              ok = apply(step);
              if (ok !== true) break;
            }
            setDisplayed(s.expected);
          } else { setDisplayed(next); ok = apply(next); }
        });
        if (ok !== true || !s.auto) {
          finish();
          return;
        }
      }
      s.frame = requestAutomaticFrame(latest.current.options.orderKey ?? '', tick);
    };
    s.frame = requestAutomaticFrame(latest.current.options.orderKey ?? '', tick);
  }

  useLayoutEffect(() => {
    const s = state.current;
    if (value !== s.expected) {
      // Undo, file replacement, or another editor owns this value now.
      cancelLiveFrame(s.frame);
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
  useLayoutEffect(() => {
    const s = state.current;
    cancelLiveFrame(s.frame);
    s.frame = 0; s.auto = false; s.pending = null; s.group = null;
    setDisplayed(s.expected); setRunning(false); setAdjusting(false);
  }, [options.stopEpoch, options.disabled]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) finish();
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      cancelLiveFrame(state.current.frame);
      document.removeEventListener('visibilitychange', hide);
    };
  }, []);
  return { displayed, running, adjusting, failed, change, finish, start };
}
