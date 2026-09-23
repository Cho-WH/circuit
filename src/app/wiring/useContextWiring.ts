import { useEffect, useMemo, useRef, useState } from 'react';
import type { CircuitDocument, Point } from '../../domain';
import { endpointName, wireCrossings } from '../../component-library';
import { previewCommand, type Command } from '../../editor';
import { branchHintEnd, connectionCommands, crossingCommand, endpointTarget, targetKey, wiringTargets, type WireAnchor, type WiringTarget } from './model';

export interface WiringOptions {
  document: CircuitDocument; enabled: boolean; tool: string; selected: string[]; resetKey?: number;
  onSelect: (id: string | null) => void;
  commit?: (commands: readonly Command[]) => boolean;
  onFinish?: () => void;
}
export function useContextWiring(options: WiringOptions) {
  const { document: doc, enabled } = options;
  const [start, setStart] = useState<WireAnchor | null>(null);
  const [hint, setHint] = useState<WiringTarget | null>(null);
  const [choices, setChoices] = useState<WiringTarget[]>([]);
  const [touch, setTouch] = useState(false);
  const [error, setError] = useState('');
  const [pointer, setPointer] = useState<Point>({x:0,y:0});
  const [scale, setScale] = useState(1);
  const toggledPoint = useRef<Point | null>(null);
  const recent = useRef(false);
  const beforeCommit = useRef<Set<string> | null>(null);
  const cancel = () => { setStart(null); setHint(null); setChoices([]); setError(''); recent.current = false; };
  useEffect(() => { cancel(); }, [enabled, options.tool, options.resetKey]);
  useEffect(() => {
    setStart(null); setHint(null); setChoices([]); setError('');
    const before = beforeCommit.current; beforeCommit.current = null;
    const toggled = toggledPoint.current; toggledPoint.current = null;
    if (toggled && enabled) {
      const junction = doc.junctions.find(j=>j.position.x===toggled.x&&j.position.y===toggled.y);
      if (junction) { setHint(endpointTarget(doc,{kind:'junction',id:junction.id})); recent.current=true; return; }
    }
    if (before && enabled) {
      const crossing = wireCrossings(doc).find(c => !before.has(`${c.point.x}:${c.point.y}`));
      if (crossing) { setHint({ kind: 'crossing', crossing, point: crossing.point }); recent.current = true; }
    }
  }, [doc]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, []);
  function commit(commands: readonly Command[]) {
    if (!enabled || !commands.length) return false;
    beforeCommit.current = new Set(wireCrossings(doc).map(c => `${c.point.x}:${c.point.y}`));
    if (!options.commit?.(commands)) { beforeCommit.current = null; setError('이 연결을 만들 수 없습니다. 다른 지점이나 편집 권한을 확인하세요.'); return false; }
    cancel(); options.onFinish?.(); return true;
  }
  function finish(end: WireAnchor) {
    if (!start) return;
    const commands = connectionCommands(doc, start, end);
    if (!commands.length) { cancel(); return; }
    commit(commands);
  }
  function activate(target: WiringTarget, coarse = false) {
    recent.current = false; setTouch(coarse); setChoices([]); setError('');
    if (!start && target.kind !== 'wire') {
      const command = crossingCommand(doc,target);
      if (command && previewCommand(doc,command).ok) {
        toggledPoint.current = target.point;
        if (!commit([command])) toggledPoint.current=null;
        return;
      }
    }
    if (target.kind === 'endpoint') {
      if (start) finish(target);
      else { setStart(target); setHint(target); options.onSelect(null); }
    } else if (target.kind === 'crossing') setHint(target);
    else if (start) { if (coarse && (!hint || targetKey(hint)!==targetKey(target))) setHint(target); else finish(target); }
    else if (hint?.kind === 'wire' && targetKey(hint) === targetKey(target) && options.selected.includes(target.wireId)) {
      setStart(target); setHint(null);
    } else {
      options.onSelect(target.wireId); setHint(coarse ? target : null);
    }
  }
  function tap(p: Point, scale: number, coarse: boolean) {
    if (!enabled) return false;
    setPointer(p); setScale(scale);
    const targets = wiringTargets(doc, p, scale, Boolean(start));
    recent.current = false; setTouch(coarse);
    if (coarse && targets.length > 1) { setChoices(targets); setHint(null); return true; }
    if (targets[0]) { activate(targets[0], coarse); return true; }
    setHint(null); setChoices([]); return false;
  }
  function hover(p: Point, scale: number) {
    if (!enabled || recent.current) return;
    setPointer(p); setScale(scale);
    const target = wiringTargets(doc, p, scale, Boolean(start))[0];
    setHint(target && (target.kind !== 'wire' || start || options.selected.includes(target.wireId)) ? target : null);
  }
  function clearHint() { recent.current = false; setHint(null); setChoices([]); }
  let action: { label: string; run: () => void } | null = null;
  if (hint?.kind === 'wire') action = start ? { label: '여기에 연결', run: () => finish(hint) } : { label: '여기서 가지 뻗기', run: () => { setStart(hint); setHint(null); } };
  const crossing = useMemo(() => {
    if (!hint || hint.kind === 'wire') return null;
    const command = crossingCommand(doc, hint);
    return command && previewCommand(doc, command).ok ? command : null;
  }, [doc, hint ? targetKey(hint) : null]);
  const crossingLabel = !start && crossing ? hint?.kind === 'crossing' ? '비연결' : '연결' : null;
  const branchEnd = hint?.kind === 'wire' && !start ? branchHintEnd(doc,hint,pointer,scale) : null;
  const end = hint && hint.kind !== 'crossing' ? hint.point : null;
  const choiceLabel = (t: WiringTarget) => t.kind === 'endpoint' ? endpointName(doc,t.ref.id) : t.kind === 'wire' ? `도선 ${t.wireId}` : '교차 연결';
  return { start, hint, choices, touch, error, action, crossingLabel, branchEnd, end, cancel, clearHint, activate, tap, hover, setTouch, active: enabled, choiceLabel, focusTarget: (t: WiringTarget) => { setTouch(false); setHint(t); }, selectChoice: (t: WiringTarget) => activate(t, true) };
}
export type ContextWiring = ReturnType<typeof useContextWiring>;
