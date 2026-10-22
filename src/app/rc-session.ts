import {
  cloneDocument,
  diagnostic,
  rcPolicy,
  type CircuitDocument,
  type Diagnostic,
  type RcFrame,
  type RcPlan,
  type RcPrepareRequest,
  type RcResult,
} from '../domain';
import { compileCircuit } from '../connectivity';
import { adjustableParameter } from '../component-library';
import { executeCommands, type Command, type ExecuteCommandResult, type History } from '../editor';
import { rcEngine, rcCircuitRevision, rcInitialState } from '../simulation';
import * as q from '../rational';

export type RcPhase = 'preparing' | 'running' | 'paused' | 'settling' | 'equilibrium' | 'error';
export interface RcSessionState {
  phase: RcPhase;
  /** Local reset identity for drafts; never persisted or used as a physical time. */
  experimentEpoch: number;
  plan: RcPlan | null;
  frame: RcFrame | null;
  seconds: number;
  speed: number;
  longPlayback: boolean;
  operationIndex: number;
  diagnostics: Diagnostic[];
}
export const rcSpeeds = [1, 2, 5, 10, 50, 100] as const;
export const hasCapacitor = (doc: CircuitDocument) =>
  doc.components.some((c) => c.type === 'capacitor');
export const rcPlaybackPolicy = (seconds: number) => ({
  speed: seconds > 0 && seconds < 0.5 ? seconds : 1,
  longPlayback: seconds >= 5,
});
const denied = (reason: string): ExecuteCommandResult => ({
  ok: false,
  diagnostics: [diagnostic('COMMAND_NOT_ALLOWED', [], 'error', { reason })],
});

/** The only analysis mutations: one switch or one adjustable electrical value.
 * Range, C, initial voltage, topology, reference and presentation remain fixed. */
export function rcOperationAllowed(doc: CircuitDocument, command: Command): boolean {
  if (command.type !== 'SetProperties') return false;
  const c = doc.components.find((c) => c.id === command.id);
  if (!c) return false;
  const property =
    c.type === 'switch'
      ? 'state'
      : c.type === 'resistor'
        ? 'resistanceOhm'
        : adjustableParameter(c)?.property;
  return (
    !!property &&
    Object.hasOwn(command.properties, property) &&
    Object.keys(command.properties).every(
      (key) => key === property || (property !== 'state' && key === property + 'Fraction'),
    )
  );
}

interface Dependencies {
  history: () => History;
  publish: (history: History, state: RcSessionState | null) => void;
  /** App-side async seam. Engine handles stay on this side of the boundary. */
  prepare?: (request: RcPrepareRequest) => RcResult<RcPlan> | Promise<RcResult<RcPlan>>;
  sample?: typeof rcEngine.sample;
  now: () => number;
  reducedMotion: () => boolean;
}

/** Runtime-only transaction and clock. All physical evaluation uses the public engine. */
export class RcSession {
  state: RcSessionState | null = null;
  private entry: CircuitDocument | null = null;
  private generation = 0;
  private anchorMs = 0;
  private anchorSeconds = 0;
  private settlingMs = 0;
  private settlingSeconds = 0;
  private hidden = false;
  private experimentEpoch = 0;
  constructor(private readonly deps: Dependencies) {}

  private emit(state: RcSessionState | null, history = this.deps.history()) {
    this.state = state;
    this.deps.publish(history, state);
  }
  cancel() {
    ++this.generation;
    this.entry = null;
    this.emit(null);
  }
  enter(): Promise<ExecuteCommandResult> {
    ++this.generation;
    this.entry = cloneDocument(this.deps.history().present);
    return this.prepare([], 'initial');
  }
  apply(command: Command): Promise<ExecuteCommandResult> {
    if (
      this.state?.phase !== 'equilibrium' ||
      !rcOperationAllowed(this.deps.history().present, command)
    )
      return Promise.resolve(denied('rc-locked'));
    return this.prepare([command], 'operation');
  }
  restart(): Promise<ExecuteCommandResult> {
    if (!this.entry) return Promise.resolve(denied('rc-inactive'));
    // Only properties could have changed through apply. Restore through the same
    // permission-checked command batch; never bypass activity permissions with ReplaceDocument.
    const commands: Command[] = [];
    for (const original of this.entry.components) {
      const current = this.deps.history().present.components.find((c) => c.id === original.id);
      if (!current) return Promise.resolve(denied('rc-document-changed'));
      if (JSON.stringify(current.properties) !== JSON.stringify(original.properties)) {
        const properties = { ...original.properties };
        // Added fraction hints use the editor's empty-string representation.
        for (const key of Object.keys(current.properties))
          if (!(key in properties) && key.endsWith('Fraction')) properties[key] = '';
        commands.push({ type: 'SetProperties', id: original.id, properties });
      }
    }
    return this.prepare(commands, 'initial', this.entry);
  }

  private async prepare(
    commands: readonly Command[],
    transition: 'initial' | 'operation',
    restore?: CircuitDocument,
  ): Promise<ExecuteCommandResult> {
    const previous = this.state;
    const base = this.deps.history();
    const baseDocument = JSON.stringify(base.present);
    const candidate = commands.length
      ? executeCommands(base, commands)
      : { ok: true as const, history: base };
    if (!candidate.ok) return candidate;
    // Permission-checked property restoration also removes optional fraction hints
    // absent on entry, rather than retaining newly added empty fields in the snapshot.
    if (restore && candidate.history !== base)
      candidate.history = { ...candidate.history, present: cloneDocument(restore) };
    if (transition === 'operation' && candidate.history === base) return candidate;
    const requestId = ++this.generation;
    this.emit({
      phase: 'preparing',
      experimentEpoch: previous?.experimentEpoch ?? this.experimentEpoch,
      plan: previous?.plan ?? null,
      frame: previous?.frame ?? null,
      seconds: previous?.seconds ?? 0,
      speed: previous?.speed ?? 1,
      longPlayback: previous?.longPlayback ?? false,
      operationIndex: previous?.operationIndex ?? 0,
      diagnostics: [],
    });
    const fresh = () =>
      requestId === this.generation &&
      this.deps.history() === base &&
      JSON.stringify(base.present) === baseDocument;
    const fail = (diagnostics: Diagnostic[]): ExecuteCommandResult => {
      if (fresh())
        this.emit(
          previous?.phase === 'equilibrium'
            ? { ...previous, diagnostics }
            : { ...this.state!, phase: 'error', diagnostics },
        );
      return { ok: false, diagnostics };
    };
    try {
      // Yield once: Preparing is already authoritative for same-event repeated clicks.
      await Promise.resolve();
      if (!fresh()) return denied('rc-cancelled');
      const compilation = compileCircuit(candidate.history.present);
      if (compilation.diagnostics.some((d) => d.severity === 'error'))
        return fail(compilation.diagnostics);
      const circuit = compilation.circuit;
      const prepared = await (this.deps.prepare ?? rcEngine.prepare)({
        circuit,
        circuitRevision: rcCircuitRevision(circuit),
        initialState:
          transition === 'initial'
            ? rcInitialState(circuit)
            : previous!.plan!.summary.equilibriumState,
        operationIndex: transition === 'initial' ? 0 : previous!.operationIndex + 1,
        transition,
        policy: rcPolicy,
      });
      if (!fresh()) return denied('rc-cancelled');
      if (!prepared.ok) return fail(prepared.diagnostics);
      const plan = prepared.value;
      const sample = this.deps.sample ?? rcEngine.sample;
      const first = sample(plan, { kind: 'finite', seconds: 0 });
      if (!first.ok) return fail(first.diagnostics);
      const equilibrium = sample(plan, { kind: 'equilibrium' });
      if (!equilibrium.ok) return fail(equilibrium.diagnostics);
      // Exact state equality, not the tolerance's T=0, means already at equilibrium.
      const already = plan.summary.initialState.every(
        (s, i) =>
          s.componentId === plan.summary.equilibriumState[i]?.componentId &&
          q.equal(s.voltageV, plan.summary.equilibriumState[i].voltageV),
      );
      // Re-run command authorization at the commit boundary. History identity also
      // rejects replacements, even with identical electrical revision strings.
      const accepted = commands.length ? executeCommands(base, commands) : candidate;
      if (!accepted.ok) return fail(accepted.diagnostics);
      if (restore && accepted.history !== base)
        accepted.history = { ...accepted.history, present: cloneDocument(restore) };
      if (!fresh()) return denied('rc-cancelled');
      const now = this.deps.now();
      this.anchorMs = now;
      this.anchorSeconds = 0;
      this.emit(
        {
          phase: already ? 'equilibrium' : this.hidden ? 'paused' : 'running',
          experimentEpoch: transition === 'initial' ? ++this.experimentEpoch : this.experimentEpoch,
          plan,
          frame: already ? equilibrium.value : first.value,
          seconds: 0,
          ...rcPlaybackPolicy(plan.summary.settlingTimeSeconds),
          operationIndex: plan.summary.operationIndex,
          diagnostics: prepared.diagnostics,
        },
        accepted.history,
      );
      if (!already && plan.summary.settlingTimeSeconds === 0) this.settle(now);
      return accepted;
    } catch {
      if (!fresh()) return denied('rc-cancelled');
      return fail([
        diagnostic('RC_NUMERICAL_UNVERIFIED', [], 'error', { reason: 'session-evaluation' }),
      ]);
    }
  }

  private sample(seconds: number | 'equilibrium'): boolean {
    const state = this.state;
    if (!state?.plan) return false;
    const result = (this.deps.sample ?? rcEngine.sample)(
      state.plan,
      seconds === 'equilibrium' ? { kind: 'equilibrium' } : { kind: 'finite', seconds },
    );
    if (!result.ok) {
      this.emit({ ...state, phase: 'error', diagnostics: result.diagnostics });
      return false;
    }
    this.emit({
      ...state,
      frame: result.value,
      ...(seconds === 'equilibrium' ? { phase: 'equilibrium' as const } : { seconds }),
    });
    return true;
  }
  tick(now: number) {
    const state = this.state;
    if (!state?.plan || !Number.isFinite(now)) return;
    if (state.phase === 'running') {
      const target = state.plan.summary.settlingTimeSeconds;
      const seconds = Math.min(
        target,
        this.anchorSeconds + (Math.max(0, now - this.anchorMs) / 1000) * state.speed,
      );
      if (!this.sample(seconds)) return;
      if (seconds >= target) this.settle(now);
    } else if (state.phase === 'settling') {
      const u = Math.max(0, now - this.settlingMs) / 200;
      if (u >= 1 || this.deps.reducedMotion()) {
        this.sample('equilibrium');
        return;
      }
      const tau = state.plan.summary.slowestTimeConstantSeconds ?? 0;
      const time = this.settlingSeconds + tau * (u / (1 - u));
      // Do not manufacture Infinity or hide a numerical failure as stabilization.
      if (!Number.isFinite(time)) {
        this.emit({
          ...state,
          phase: 'error',
          diagnostics: [
            diagnostic('RC_NUMERICAL_UNVERIFIED', [], 'error', { reason: 'tail-time' }),
          ],
        });
      } else this.sample(time);
    }
  }
  private settle(now: number) {
    if (!this.state) return;
    this.settlingMs = now;
    this.settlingSeconds = this.state.seconds;
    this.emit({ ...this.state, phase: 'settling' });
    if (this.deps.reducedMotion()) this.sample('equilibrium');
  }
  pause() {
    if (this.state?.phase !== 'running') return;
    this.tick(this.deps.now());
    if (this.state?.phase === 'running') this.emit({ ...this.state, phase: 'paused' });
  }
  resume() {
    if (this.hidden || this.state?.phase !== 'paused') return;
    this.anchorMs = this.deps.now();
    this.anchorSeconds = this.state.seconds;
    this.emit({ ...this.state, phase: 'running' });
  }
  setSpeed(speed: number) {
    if (
      !this.state?.longPlayback ||
      !rcSpeeds.some((value) => value === speed) ||
      !['running', 'paused'].includes(this.state.phase)
    )
      return;
    const now = this.deps.now();
    if (this.state.phase === 'running') this.tick(now);
    if (!this.state || !['running', 'paused'].includes(this.state.phase)) return;
    this.anchorMs = now;
    this.anchorSeconds = this.state.seconds;
    this.emit({ ...this.state, speed });
  }
  skip() {
    if (!this.state?.longPlayback || !['running', 'paused'].includes(this.state.phase)) return;
    if (this.state.phase === 'running') this.tick(this.deps.now());
    if (this.state && ['running', 'paused'].includes(this.state.phase))
      this.settle(this.deps.now());
  }
  visibility(hidden: boolean) {
    if (hidden) this.pause();
    this.hidden = hidden;
  }
  canRecord() {
    return this.state?.phase === 'paused' || this.state?.phase === 'equilibrium';
  }
}
