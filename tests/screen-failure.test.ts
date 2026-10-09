// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { ErrorBoundary } from '../src/app/ErrorBoundary';
import * as canvas from '../src/app/CircuitCanvas';
import * as simulation from '../src/simulation';
import * as measurement from '../src/measurement';
import * as visualization from '../src/visualization';
import { analyze } from '../src/app/analyze';
import { runScreenStage, screenFailure, screenFailureReport } from '../src/app/screen-failure';
import { QUICK_START_SEEN_KEY } from '../src/app/useQuickStart';
import { saveLocal } from '../src/persistence';
import { channelStorageKey, releaseChannel } from '../src/release';
import { examples } from '../src/fixtures';
import { requireDocument } from '../src/domain';
import shortCircuit from '../fixtures/FIX-06-source-short.json';

let host: HTMLDivElement, root: Root;
const saveKey = channelStorageKey('edu-circuit:auto:v1');
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem(QUICK_START_SEEN_KEY, 'true');
  saveLocal(examples[1].document);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host, { onCaughtError: vi.fn() });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const render = (children: ReactNode = createElement(App)) =>
  act(async () => root.render(createElement(ErrorBoundary, { children })));
const report = () =>
  JSON.parse(host.querySelector<HTMLTextAreaElement>('[aria-label="화면 오류 정보"]')!.value);
const fail = () => {
  throw new TypeError('private circuit https://example.test/?token=secret');
};

it.each([
  ['calculation', () => vi.spyOn(simulation, 'analyzeOperatingCircuit').mockImplementation(fail)],
  ['preparation', () => vi.spyOn(measurement, 'probeVoltage').mockImplementation(fail)],
  ['preparation', () => vi.spyOn(visualization, 'buildPotentialModel').mockImplementation(fail)],
  ['render', () => vi.spyOn(canvas, 'CircuitCanvas').mockImplementation(fail)],
] as const)(
  'reports %s on a real screen update without replacing the saved circuit',
  async (stage, inject) => {
    await render();
    expect(host.querySelector('.circuit-canvas')).not.toBeNull();
    const saved = localStorage.getItem(saveKey);
    inject();
    const title = host.querySelector<HTMLInputElement>('[aria-label="회로 제목"]')!;
    await act(async () => {
      title.value = 'changed title';
      title.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(report()).toMatchObject({ stage, errorType: 'TypeError' });
    expect(host.querySelector('.circuit-canvas')).toBeNull();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(localStorage.getItem(saveKey)).toBe(saved);
  },
);

it('keeps an inner calculation failure when computing display scales', () => {
  vi.spyOn(simulation, 'analyzeOperatingCircuit').mockImplementation(fail);
  expect.assertions(1);
  try {
    runScreenStage('preparation', () => analyze(examples[1].document));
  } catch (error) {
    expect(screenFailure(error)).toEqual({ stage: 'calculation', errorType: 'TypeError' });
  }
});

it('keeps a short-circuit operating warning in the workspace instead of the failure screen', async () => {
  const doc = requireDocument(shortCircuit.document);
  expect(analyze(doc).assessment.status).toBe('damage');
  saveLocal(doc);
  await render();
  expect(host.querySelector('.circuit-canvas')).not.toBeNull();
  expect(host.querySelector('[aria-label="화면 오류 정보"]')).toBeNull();
});

it('classifies an untagged layout effect exception as screen preparation/rendering', async () => {
  function BrokenLayout() {
    useLayoutEffect(fail, []);
    return null;
  }
  await render(createElement(BrokenLayout));
  expect(report()).toMatchObject({ stage: 'render', errorType: 'TypeError' });
});

it('copies only stage and build metadata, excluding exception contents and untrusted names', async () => {
  await render(createElement(fail));
  await act(async () => {
    const details = host.querySelector('details')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
  const button = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === '오류 정보 복사',
  )!;
  await act(async () => button.click());
  expect(copy).toHaveBeenCalledTimes(1);
  expect(JSON.parse(copy.mock.calls[0][0])).toMatchObject({
    feature: 'screen',
    stage: 'render',
    errorType: 'TypeError',
    channel: releaseChannel(),
    build: expect.any(String),
  });
  expect(copy.mock.calls[0][0]).not.toMatch(/private|secret|example\.test|stack|cause/);
  const error = new Error('private');
  error.name = 'private title';
  expect(screenFailureReport(screenFailure(error))).not.toContain('private');
});
