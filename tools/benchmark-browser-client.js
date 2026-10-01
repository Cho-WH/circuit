// Browser-only observer used by tools/benchmark-browser.mjs; excluded from the application build.
const panel = document.createElement('aside');
panel.style.cssText =
  'position:fixed;right:8px;bottom:8px;z-index:99999;background:#fff;color:#222;border:1px solid #aaa;border-radius:8px;padding:8px;font:12px system-ui;max-width:360px';
panel.innerHTML =
  '<label>검증 이름 <input id="benchmark-label" value="idle" style="width:120px"></label> <button id="benchmark-start">15초 측정</button><div id="benchmark-status">대기</div><details><summary>결과</summary><pre id="benchmark-results" style="max-height:180px;overflow:auto;white-space:pre-wrap"></pre></details>';
document.body.append(panel);
const results = [];
panel.querySelector('button').onclick = () => {
  const button = panel.querySelector('button');
  button.disabled = true;
  const name = panel.querySelector('input').value;
  const intervals = [],
    longTasks = [],
    changes = [];
  let previous = 0,
    start = 0,
    hidden = document.hidden,
    lastValue = '',
    raf;
  const observer = PerformanceObserver.supportedEntryTypes.includes('longtask')
    ? new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          if (entry.startTime >= start) longTasks.push(entry.duration);
      })
    : null;
  const onVisibility = () => {
    hidden ||= document.hidden;
  };
  document.addEventListener('visibilitychange', onVisibility);
  panel.querySelector('#benchmark-status').textContent = '준비 중';
  setTimeout(() => {
    start = performance.now();
    observer?.observe({ type: 'longtask', buffered: false });
    function frame(now) {
      if (previous) intervals.push(now - previous);
      previous = now;
      const value = document.querySelector('.parameter-slider')?.value;
      if (value !== undefined && value !== lastValue) {
        changes.push({ t: now - start, value: Number(value) });
        lastValue = value;
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    panel.querySelector('#benchmark-status').textContent = '측정 중';
    setTimeout(() => {
      cancelAnimationFrame(raf);
      for (const entry of observer?.takeRecords() ?? []) longTasks.push(entry.duration);
      observer?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      intervals.sort((a, b) => a - b);
      const quantile = (p) => intervals[Math.max(0, Math.ceil(intervals.length * p) - 1)] ?? null;
      const result = {
        name,
        userAgent: navigator.userAgent,
        viewport: [innerWidth, innerHeight],
        devicePixelRatio,
        durationMs: performance.now() - start,
        hidden,
        frameCount: intervals.length,
        medianFrameMs: quantile(0.5),
        p95FrameMs: quantile(0.95),
        maxFrameMs: quantile(1),
        framesOver25Ms: intervals.filter((t) => t > 25).length,
        longTaskSupported: !!observer,
        longTasks: longTasks.length,
        maxLongTaskMs: Math.max(0, ...longTasks),
        sliderChanges: changes.length,
        sliderMin: changes.length ? Math.min(...changes.map((c) => c.value)) : null,
        sliderMax: changes.length ? Math.max(...changes.map((c) => c.value)) : null,
      };
      results.push(result);
      panel.querySelector('#benchmark-results').textContent = JSON.stringify(results, null, 2);
      panel.querySelector('#benchmark-status').textContent = `${name}: 완료`;
      button.disabled = false;
    }, 15000);
  }, 1000);
};
