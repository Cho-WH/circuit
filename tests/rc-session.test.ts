import { describe, it, expect, vi } from 'vitest';
import { RcSession, rcOperationAllowed, rcPlaybackPolicy } from '../src/app/rc-session';
import { createHistory, type Command } from '../src/editor';
import { rcEngine } from '../src/simulation';
import { type RcPlan, type RcPrepareRequest, type RcResult } from '../src/domain';
import * as q from '../src/rational';
import { rcSessionDocument } from './rc-session-fixture';

const voltage = (n: number): Command => ({
  type: 'SetProperties',
  id: 'V',
  properties: { voltageV: q.store(n) },
});
function harness(
  options: {
    initial?: number;
    resistance?: number;
    capacitance?: number;
    reduced?: boolean;
    prepare?: (r: RcPrepareRequest) => RcResult<RcPlan> | Promise<RcResult<RcPlan>>;
    sample?: typeof rcEngine.sample;
  } = {},
) {
  let history = createHistory(
    rcSessionDocument(options.initial, options.resistance, options.capacitance),
  );
  let now = 0;
  const published = vi.fn();
  const session = new RcSession({
    history: () => history,
    publish: (h, s) => {
      history = h;
      published(h, s);
    },
    now: () => now,
    reducedMotion: () => options.reduced ?? false,
    prepare: options.prepare,
    sample: options.sample,
  });
  return {
    session,
    published,
    get history() {
      return history;
    },
    replace: () => {
      history = createHistory(rcSessionDocument());
    },
    time: (ms: number) => {
      now = ms;
    },
    tick: (ms: number) => {
      now = ms;
      session.tick(ms);
    },
  };
}
function deferredPrepare() {
  const jobs: { request: RcPrepareRequest; resolve: (result: RcResult<RcPlan>) => void }[] = [];
  return {
    jobs,
    prepare: (request: RcPrepareRequest) =>
      new Promise<RcResult<RcPlan>>((resolve) => jobs.push({ request, resolve })),
    complete: (i: number) => jobs[i].resolve(rcEngine.prepare(jobs[i].request)),
  };
}

describe('RC session transaction and playback', () => {
  it.each([
    [0, 1, false],
    [0.499, 0.499, false],
    [0.5, 1, false],
    [4.999, 1, false],
    [5, 1, true],
    [1e100, 1, true],
  ])('classifies physical T=%s without rounding across boundaries', (t, speed, longPlayback) => {
    expect(rcPlaybackPolicy(Number(t))).toEqual({ speed, longPlayback });
  });
  it('uses the actual modal frame and never creates history during playback', async () => {
    const h = harness();
    const original = h.history;
    await h.session.enter();
    expect(h.session.state?.phase).toBe('running');
    h.tick(1000);
    expect(q.toNumber(h.session.state!.frame!.componentVoltages.C)).toBeCloseTo(
      10 * (1 - Math.exp(-1)),
      10,
    );
    expect(h.history).toBe(original);
    h.tick(7000);
    expect(h.session.state?.phase).toBe('settling');
    expect(h.session.canRecord()).toBe(false);
    h.tick(7100);
    expect(h.session.state!.seconds).toBeGreaterThan(
      h.session.state!.plan!.summary.settlingTimeSeconds,
    );
    h.tick(7200);
    expect(h.session.state?.phase).toBe('equilibrium');
    expect(h.session.state?.frame?.context.time).toEqual({ kind: 'equilibrium' });
    expect(q.equal(h.session.state!.frame!.capacitorState[0].voltageV, 10)).toBe(true);
    expect(h.history).toBe(original);
  });
  it('pauses exactly, changes speed without jumping and resumes from that time', async () => {
    const h = harness();
    await h.session.enter();
    h.time(1000);
    h.session.setSpeed(2);
    expect(h.session.state?.seconds).toBe(1);
    h.tick(1500);
    expect(h.session.state?.seconds).toBe(2);
    h.session.pause();
    const frame = h.session.state!.frame;
    h.time(5000);
    h.session.setSpeed(5);
    h.tick(6000);
    expect(h.session.state?.frame).toBe(frame);
    expect(h.session.canRecord()).toBe(true);
    h.session.resume();
    h.tick(6200);
    expect(h.session.state?.seconds).toBe(3);
  });
  it('auto pauses on hidden and keeps hidden preparation paused until explicit resume', async () => {
    const d = deferredPrepare();
    const h = harness({ prepare: d.prepare });
    const entering = h.session.enter();
    await Promise.resolve();
    h.session.visibility(true);
    d.complete(0);
    await entering;
    expect(h.session.state?.phase).toBe('paused');
    h.tick(9000);
    h.session.resume();
    expect(h.session.state?.phase).toBe('paused');
    h.session.visibility(false);
    expect(h.session.state?.phase).toBe('paused');
    h.session.resume();
    h.tick(10000);
    expect(h.session.state?.seconds).toBe(1);
    h.session.visibility(true);
    h.tick(20000);
    h.session.visibility(false);
    expect(h.session.state?.seconds).toBe(1);
    expect(h.session.state?.phase).toBe('paused');
  });
  it('shows a short response for one screen second and skips an already exact equilibrium', async () => {
    const h = harness({ resistance: 1 });
    await h.session.enter();
    expect(h.session.state!.speed).toBeLessThan(0.5);
    h.tick(999);
    expect(h.session.state?.phase).toBe('running');
    h.tick(1000);
    expect(h.session.state?.phase).toBe('settling');
    const eq = harness({ initial: 10 });
    await eq.session.enter();
    expect(eq.session.state?.phase).toBe('equilibrium');
    expect(eq.history.past).toHaveLength(0);
  });
  it('distinguishes a subthreshold nonzero change from exact equilibrium', async () => {
    const h = harness({ initial: 9.99999999 });
    await h.session.enter();
    expect(h.session.state?.plan?.summary.settlingTimeSeconds).toBe(0);
    expect(h.session.state?.phase).toBe('settling');
    h.tick(200);
    expect(h.session.state?.phase).toBe('equilibrium');
  });
  it.each([30, 60])(
    'normal completion and paused skip at %s fps have identical next operation state',
    async (fps) => {
      const normal = harness(),
        skipped = harness();
      await normal.session.enter();
      await skipped.session.enter();
      for (let i = 1; i <= fps * 8; i++) normal.tick((i * 1000) / fps);
      skipped.tick(100);
      skipped.session.pause();
      skipped.session.skip();
      skipped.tick(300);
      expect(skipped.session.state!.frame).toEqual(normal.session.state!.frame);
      expect((await normal.session.apply(voltage(5))).ok).toBe(true);
      expect((await skipped.session.apply(voltage(5))).ok).toBe(true);
      expect(skipped.session.state!.frame).toEqual(normal.session.state!.frame);
      expect(normal.session.state!.speed).toBe(1);
      expect(q.equal(normal.session.state!.frame!.capacitorState[0].voltageV, 10)).toBe(true);
    },
  );
  it('reduced motion uses the same exact equilibrium without a finite-time disguise', async () => {
    const h = harness({ reduced: true });
    await h.session.enter();
    h.session.skip();
    expect(h.session.state?.phase).toBe('equilibrium');
    expect(h.session.state?.frame?.context.time.kind).toBe('equilibrium');
  });
  it('prepares one candidate, discards extra clicks, and commits document+frame once', async () => {
    const d = deferredPrepare();
    const h = harness({ initial: 10, prepare: d.prepare });
    const enter = h.session.enter();
    await Promise.resolve();
    d.complete(0);
    await enter;
    const before = h.history;
    const frame = h.session.state!.frame;
    const apply = h.session.apply(voltage(5));
    expect(h.session.state?.phase).toBe('preparing');
    expect(h.history).toBe(before);
    expect(h.session.state?.frame).toBe(frame);
    expect((await h.session.apply(voltage(2))).ok).toBe(false);
    d.complete(1);
    expect((await apply).ok).toBe(true);
    expect(h.history.past).toHaveLength(1);
    expect(h.session.state?.operationIndex).toBe(1);
    expect(h.history.present.components[0].properties.voltageV).toEqual(q.store(5));
    expect(h.session.state?.frame?.context.operationIndex).toBe(1);
    expect(d.jobs).toHaveLength(2);
  });
  it('rejects an impulse candidate without changing equilibrium or undo history', async () => {
    const h = harness({ initial: 10 });
    await h.session.enter();
    const before = h.history,
      frame = h.session.state!.frame;
    const result = await h.session.apply({
      type: 'SetProperties',
      id: 'S',
      properties: { state: 'closed' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe('RC_IMPULSE_REQUIRED');
    expect(h.history).toBe(before);
    expect(h.session.state?.frame).toBe(frame);
    expect(h.session.state?.phase).toBe('equilibrium');
    expect((await h.session.apply(voltage(5))).ok).toBe(true);
  });
  it.each(['exit', 'replace', 'restart'] as const)(
    'invalidates a delayed candidate on %s',
    async (action) => {
      const d = deferredPrepare();
      const h = harness({ initial: 10, prepare: d.prepare });
      const enter = h.session.enter();
      await Promise.resolve();
      d.complete(0);
      await enter;
      const apply = h.session.apply(voltage(5));
      await Promise.resolve();
      let restart: Promise<unknown> | undefined;
      if (action === 'exit') h.session.cancel();
      if (action === 'replace') {
        h.session.cancel();
        h.replace();
      }
      if (action === 'restart') {
        restart = h.session.restart();
        await Promise.resolve();
        d.complete(2);
        await restart;
      }
      const history = h.history,
        state = h.session.state;
      d.complete(1);
      expect((await apply).ok).toBe(false);
      expect(h.history).toBe(history);
      expect(h.session.state).toBe(state);
    },
  );
  it('rejects a changed history even without a cancel notification', async () => {
    const d = deferredPrepare();
    const h = harness({ prepare: d.prepare });
    const enter = h.session.enter();
    await Promise.resolve();
    h.replace();
    d.complete(0);
    expect((await enter).ok).toBe(false);
    expect(h.history.past).toHaveLength(0);
  });
  it('does not accept a stale electrical revision or changed permissions on the same history object', async () => {
    const d = deferredPrepare();
    const h = harness({ initial: 10, prepare: d.prepare });
    const enter = h.session.enter();
    await Promise.resolve();
    d.complete(0);
    await enter;
    const applying = h.session.apply(voltage(5));
    await Promise.resolve();
    h.history.present.activity = { allowedCommands: ['SetLabel'], revealSteps: [] };
    d.complete(1);
    expect((await applying).ok).toBe(false);
    expect(h.history.present.components[0].properties.voltageV).toEqual(q.store(10));
    expect(h.history.past).toHaveLength(0);
  });
  it('keeps an unsupported initial document intact and allows restart after a failed prepare', async () => {
    const h = harness({ resistance: 0 });
    const before = h.history;
    expect((await h.session.enter()).ok).toBe(false);
    expect(h.session.state?.phase).toBe('error');
    expect(h.session.state?.frame).toBeNull();
    expect(h.history).toBe(before);
    expect(h.session.canRecord()).toBe(false);
    expect((await h.session.restart()).ok).toBe(false);
    expect(h.history).toBe(before);
  });
  it('rejects an unverified first candidate frame before document or history is committed', async () => {
    let fail = false;
    const h = harness({
      initial: 10,
      sample: (plan, time) =>
        fail && time.kind === 'finite'
          ? {
              ok: false,
              diagnostics: [
                {
                  code: 'RC_NUMERICAL_UNVERIFIED',
                  severity: 'error',
                  affectedIds: [],
                  parameters: {},
                  suggestedActions: [],
                },
              ],
            }
          : rcEngine.sample(plan, time),
    });
    await h.session.enter();
    const before = h.history,
      frame = h.session.state!.frame;
    fail = true;
    expect((await h.session.apply(voltage(5))).ok).toBe(false);
    expect(h.session.state?.phase).toBe('equilibrium');
    expect(h.session.state?.frame).toBe(frame);
    expect(h.history).toBe(before);
  });
  it('changing resistance at equilibrium has no invented charging animation', async () => {
    const h = harness({ initial: 10 });
    await h.session.enter();
    expect(
      (
        await h.session.apply({
          type: 'SetProperties',
          id: 'R',
          properties: { resistanceOhm: q.store(20000) },
        })
      ).ok,
    ).toBe(true);
    expect(h.session.state?.phase).toBe('equilibrium');
    expect(h.history.past).toHaveLength(1);
    expect(h.session.state?.frame?.context.time.kind).toBe('equilibrium');
  });
  it('restores exact entry properties in one step and creates no repeated reset history', async () => {
    const h = harness({ initial: 10 });
    const entry = h.history.present;
    await h.session.enter();
    await h.session.apply({
      type: 'SetProperties',
      id: 'V',
      properties: { voltageV: q.store(5), voltageVFraction: '5/1' },
    });
    await h.session.restart();
    expect(h.history.present).toEqual(entry);
    expect(h.history.past).toHaveLength(2);
    expect(h.session.state?.operationIndex).toBe(0);
    await h.session.restart();
    expect(h.history.past).toHaveLength(2);
  });
  it('blocks physical/model/presentation bypasses and respects activity permissions', async () => {
    const h = harness({ initial: 10 });
    await h.session.enter();
    const commands: Command[] = [
      { type: 'SetProperties', id: 'C', properties: { initialVoltageV: q.store(2) } },
      { type: 'SetProperties', id: 'C', properties: { capacitanceF: q.store(0.2) } },
      { type: 'SetProperties', id: 'V', properties: { voltageV: q.store(5), sourceKind: 'fixed' } },
      { type: 'SetLabel', id: 'R', label: 'changed' },
      { type: 'SetReference', endpoint: null },
      { type: 'DeleteElements', ids: ['R'] },
    ];
    for (const command of commands) expect((await h.session.apply(command)).ok).toBe(false);
    h.history.present.activity = { allowedCommands: ['SetLabel'], revealSteps: [] };
    expect((await h.session.apply(voltage(5))).ok).toBe(false);
    expect(h.history.past).toHaveLength(0);
    const fixed = rcSessionDocument();
    delete fixed.components[0].properties.sourceKind;
    expect(rcOperationAllowed(fixed, voltage(5))).toBe(false);
  });
  it('retains the last valid frame and locks after a sample failure; rejects before commit at t=0', async () => {
    let fail = false;
    const h = harness({
      sample: (plan, time) =>
        fail
          ? {
              ok: false,
              diagnostics: [
                {
                  code: 'RC_NUMERICAL_UNVERIFIED',
                  severity: 'error',
                  affectedIds: [],
                  parameters: {},
                  suggestedActions: [],
                },
              ],
            }
          : rcEngine.sample(plan, time),
    });
    await h.session.enter();
    const before = h.history,
      frame = h.session.state!.frame;
    fail = true;
    h.tick(1000);
    expect(h.session.state?.phase).toBe('error');
    expect(h.session.state?.frame).toBe(frame);
    expect(h.session.canRecord()).toBe(false);
    expect((await h.session.apply(voltage(5))).ok).toBe(false);
    expect(h.history).toBe(before);
    await h.session.restart();
    expect(h.history).toBe(before);
    fail = false;
    await h.session.restart();
    expect(h.session.state?.phase).toBe('running');
  });
});
