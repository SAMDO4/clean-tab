// 시계: 1초 단위 갱신, 바뀐 글자만 교체 (전체 DOM 재렌더링 없음)

const pad2 = (n) => String(n).padStart(2, '0');

/** @returns {{main:string, seconds:string, period:string}} */
export function formatTime(date, { hour12 = false, showSeconds = false } = {}) {
  let h = date.getHours();
  let period = '';
  if (hour12) {
    period = h < 12 ? '오전' : '오후';
    h = h % 12 || 12;
  }
  const main = `${hour12 ? h : pad2(h)}:${pad2(date.getMinutes())}`;
  return { main, seconds: showSeconds ? pad2(date.getSeconds()) : '', period };
}

export function createClock(root) {
  root.textContent = '';
  const period = document.createElement('span');
  period.className = 'vt-clock-period';
  const main = document.createElement('span');
  main.className = 'vt-clock-main';
  const sec = document.createElement('span');
  sec.className = 'vt-clock-sec';
  root.append(period, main, sec);
  let opts = { hour12: false, showSeconds: false };
  let last = { main: '', seconds: '', period: '' };

  function render(now = new Date()) {
    const t = formatTime(now, opts);
    if (t.main !== last.main) main.textContent = t.main;
    if (t.seconds !== last.seconds) { sec.textContent = t.seconds ? `:${t.seconds}` : ''; sec.hidden = !t.seconds; }
    if (t.period !== last.period) { period.textContent = t.period; period.hidden = !t.period; }
    const sizeChanged = t.main.length !== last.main.length || !!t.seconds !== !!last.seconds || t.period !== last.period;
    last = t;
    return sizeChanged; // 너비가 바뀔 수 있으면 true → 레이아웃 재계산
  }

  return {
    setOptions(o) { opts = { hour12: !!o.hour12, showSeconds: !!o.showSeconds }; last = { main: '', seconds: '', period: '' }; render(); },
    render
  };
}

/**
 * 초 경계에 맞춘 단일 타이머. 시계·날짜가 공유한다.
 * @param {(now: Date) => void} cb
 */
export function startTicker(cb) {
  let timer = 0;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    const now = new Date();
    cb(now);
    timer = setTimeout(tick, 1000 - now.getMilliseconds() + 8);
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') { clearTimeout(timer); tick(); }
  };
  document.addEventListener('visibilitychange', onVisible);
  tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
