// 순수 로직 단위 테스트: node --test VelvetTab/tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, defaultPresets, presetSnapshot, SCHEMA_VERSION } from '../js/defaults.js';
import { sanitizeSettings, sanitizeFavorites, sanitizePresets, sanitizeStyle, normalizeUrl, migrate, setPath, getPath } from '../js/storage-manager.js';
import { effectiveStyle, styleVars } from '../js/style-manager.js';
import { formatTime } from '../js/clock.js';
import { formatDate } from '../js/date.js';
import { computeLayout, toNormalized } from '../js/layout-manager.js';
import { ops, exportPresets, importPresets } from '../js/preset-manager.js';
import { classifyUrl, findRoots } from '../js/bookmark-bar.js';

const D = new Date(2026, 10, 18, 15, 7, 9); // 2026-11-18 (수) 15:07:09

test('시계 형식: 24/12시간, 초', () => {
  assert.deepEqual(formatTime(D, { hour12: false, showSeconds: false }), { main: '15:07', seconds: '', period: '' });
  assert.deepEqual(formatTime(D, { hour12: true, showSeconds: true }), { main: '3:07', seconds: '09', period: '오후' });
  assert.equal(formatTime(new Date(2026, 0, 1, 0, 5), { hour12: true }).main, '12:05');
  assert.equal(formatTime(new Date(2026, 0, 1, 0, 5), { hour12: true }).period, '오전');
});

test('날짜 형식: 지시서 예시 4종', () => {
  assert.equal(formatDate(D, { format: 'ko-long' }), '2026년 11월 18일 수요일');
  assert.equal(formatDate(D, { format: 'ko-dots', showWeekday: false }), '2026.11.18');
  assert.equal(formatDate(D, { format: 'ko-long', showYear: false }), '11월 18일 수요일');
  assert.equal(formatDate(D, { format: 'en-short', showYear: false }), 'Wed, Nov 18');
  assert.equal(formatDate(D, { format: 'ko-dots' }), '2026.11.18 (수)');
  assert.equal(formatDate(D, { format: 'en-long' }), 'Wednesday, November 18, 2026');
  assert.equal(formatDate(D, { format: 'ko-long', showWeekday: false }), '2026년 11월 18일');
});

test('설정 검증: 손상/범위 밖/타입 오류는 기본값으로', () => {
  assert.deepEqual(sanitizeSettings(null), defaultSettings());
  assert.deepEqual(sanitizeSettings('garbage'), defaultSettings());
  const s = sanitizeSettings({
    elements: { clock: { visible: 'yes', position: { mode: 'free', x: 5, y: -1, preset: 'nowhere' }, style: { blur: 999, bogus: 1, textColor: 'red' }, options: { align: 'diagonal', hour12: true } } },
    globalStyle: { radius: -10, fontSize: 50 },
    background: { fit: 'stretch', dim: 500 }
  });
  assert.equal(s.elements.clock.visible, true);
  assert.deepEqual(s.elements.clock.position, { mode: 'free', preset: 'top-center', x: 1, y: 0 });
  assert.deepEqual(s.elements.clock.style, { blur: 30 });
  assert.equal(s.elements.clock.options.align, 'center');
  assert.equal(s.elements.clock.options.hour12, true);
  assert.equal(s.globalStyle.radius, 0);
  assert.equal('fontSize' in s.globalStyle, false, '전역에는 fontSize 없음');
  assert.equal(s.background.fit, 'cover');
  assert.equal(s.background.dim, 80);
  assert.deepEqual(s.elements.date, defaultSettings().elements.date, '누락된 요소는 기본값');
});

test('스타일 우선순위: 개별 > 전역 > 대체값', () => {
  const s = defaultSettings();
  s.globalStyle.radius = 7;
  s.globalStyle.blur = 11;
  s.elements.favorites.style.radius = 25;
  const e = effectiveStyle(s, 'favorites');
  assert.equal(e.radius, 25);
  assert.equal(e.blur, 11);
  const v = styleVars({ ...e, bgOpacity: 0, shadow: true, shadowStrength: 50 });
  assert.equal(v['--vt-shadow'], 'none', '배경이 없으면 상자 그림자 대신');
  assert.notEqual(v['--vt-text-shadow'], 'none', '글자 그림자 사용');
  assert.equal(sanitizeStyle({ fontSize: 30 }, false).fontSize, undefined);
});

test('URL 정규화', () => {
  assert.equal(normalizeUrl('naver.com'), 'https://naver.com/');
  assert.equal(normalizeUrl('http://a.b/c?d=1'), 'http://a.b/c?d=1');
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('file:///C:/x'), null);
  assert.equal(normalizeUrl(''), null);
  assert.equal(normalizeUrl('   '), null);
});

test('즐겨찾기 검증: 잘못된 URL 제거, 중복 id 재발급, 아이콘 값 제한', () => {
  const f = sanitizeFavorites({ items: [
    { id: 'a', title: 'A', url: 'a.com' },
    { id: 'a', title: 'B', url: 'https://b.com', icon: { type: 'image', value: 'data:text/html,evil' } },
    { id: 'c', title: 'C', url: 'javascript:1' },
    'junk'
  ] });
  assert.equal(f.items.length, 2);
  assert.notEqual(f.items[0].id, f.items[1].id);
  assert.equal(f.items[1].icon.type, 'auto');
});

test('배치: 프리셋 위치 + 같은 위치는 세로로 쌓임 + 화면 안으로 제한', () => {
  const area = { x: 0, y: 34, w: 1000, h: 600 };
  const pos = (p) => ({ mode: 'preset', preset: p, x: 0.5, y: 0.5 });
  const out = computeLayout(area, [
    { key: 'clock', w: 300, h: 100, position: pos('top-center') },
    { key: 'date', w: 200, h: 30, position: pos('top-center') },
    { key: 'favorites', w: 400, h: 80, position: pos('bottom-right') }
  ]);
  assert.equal(out.clock.left, 350);
  assert.equal(out.date.left, 400);
  assert.ok(out.date.top >= out.clock.top + 100, '날짜는 시계 아래');
  assert.ok(out.favorites.left + 400 <= 1000 && out.favorites.top + 80 <= 634);
  const free = computeLayout(area, [{ key: 'clock', w: 300, h: 100, position: { mode: 'free', x: 1, y: 1 } }]);
  assert.equal(free.clock.left, 700, '오른쪽 밖으로 나가지 않음');
  assert.equal(free.clock.top, 534, '아래쪽 밖으로 나가지 않음');
});

test('배치: 정규화 좌표 왕복 + 해상도 변경 시 비율 유지', () => {
  const a1 = { x: 0, y: 0, w: 1000, h: 800 };
  const n = toNormalized(200, 300, 100, 50, a1, 'center');
  assert.deepEqual(n, { x: 0.25, y: 0.4063 });
  const back = computeLayout(a1, [{ key: 'k', w: 100, h: 50, align: 'center', position: { mode: 'free', ...n } }]);
  assert.deepEqual(back.k, { left: 200, top: 300 });
  const a2 = { x: 0, y: 0, w: 2000, h: 1600 };
  const big = computeLayout(a2, [{ key: 'k', w: 100, h: 50, align: 'center', position: { mode: 'free', ...n } }]);
  assert.equal(big.k.left + 50, 500, '중심이 가로 25% 유지');
});

test('프리셋: 생성/적용/이름변경/복제/삭제/기본 지정, 배경은 제외', () => {
  const s = defaultSettings();
  const p = defaultPresets();
  s.elements.clock.options.hour12 = true;
  s.background.dim = 40;
  const id = ops.create(s, p, '  내 프리셋  ');
  assert.equal(p.items.find((x) => x.id === id).name, '내 프리셋');
  assert.equal('background' in p.items.find((x) => x.id === id).data, false);
  assert.equal(ops.isModified(s, p), false);
  ops.apply(s, p, 'builtin-dark');
  assert.equal(s.background.dim, 40, '프리셋 적용 시 배경 설정 유지');
  assert.equal(s.elements.clock.options.hour12, false);
  ops.apply(s, p, id);
  assert.equal(s.elements.clock.options.hour12, true);
  assert.equal(ops.rename(p, 'builtin-glass', 'x'), false, '기본 제공은 이름 변경 불가');
  const dup = ops.duplicate(p, id);
  assert.equal(p.items.find((x) => x.id === dup).name, '내 프리셋 사본');
  ops.setDefault(p, dup);
  assert.equal(ops.remove(p, 'builtin-minimal'), false);
  ops.remove(p, dup);
  assert.equal(p.defaultId, 'builtin-glass', '기본 프리셋 삭제 시 Glass 로 복귀');
  s.globalStyle.blur = 3;
  assert.equal(ops.isModified(s, p), true);
});

test('프리셋 JSON 내보내기/가져오기 + 검증', () => {
  const s = defaultSettings();
  const p = defaultPresets();
  ops.create(s, p, 'A');
  const json = exportPresets(p);
  const { merged, count } = importPresets(p, json);
  assert.equal(count, 2); // Custom + A
  assert.throws(() => importPresets(p, '{"foo":1}'));
  const bad = sanitizePresets({ items: [{ id: 'x', name: 'X', data: 'broken' }], defaultId: 'nope', activeId: 'x' });
  assert.equal(bad.defaultId, 'builtin-glass');
  assert.deepEqual(bad.items.find((i) => i.id === 'x').data.elements, presetSnapshot(defaultSettings()).elements);
  assert.ok(merged.items.length > p.items.length);
});

test('마이그레이션: 버전 없음 → 현재, 더 새로운 버전은 보존', () => {
  const m = migrate({ settings: { a: 1 } });
  assert.equal(m.from, 0);
  assert.equal(m.to, SCHEMA_VERSION);
  const n = migrate({ meta: { schemaVersion: SCHEMA_VERSION + 5 } });
  assert.equal(n.newer, true);
});

test('경로 유틸', () => {
  const o = {};
  setPath(o, 'a.b.c', 1);
  assert.equal(getPath(o, 'a.b.c'), 1);
  setPath(o, 'a.b.c', undefined);
  assert.deepEqual(o, { a: { b: {} } });
});

test('북마크 URL 분류 / 루트 찾기', () => {
  assert.equal(classifyUrl('https://x.com'), 'web');
  assert.equal(classifyUrl('chrome://settings'), 'internal');
  assert.equal(classifyUrl('javascript:void(0)'), 'bookmarklet');
  assert.equal(classifyUrl('not a url'), 'invalid');
  const r = findRoots([{ children: [{ id: '1', title: 'Bar', children: [] }, { id: '2', folderType: 'other', children: [] }] }]);
  assert.equal(r.bar.id, '1');
  assert.equal(r.other.id, '2');
});

test('Store: 늦게 도착한 자기 저장 메아리가 최신 편집을 되돌리지 않음 / 다른 탭 변경은 반영', async () => {
  const { Store } = await import('../js/storage-manager.js');
  const area = {};
  const listeners = new Set();
  const queued = [];
  // 실제 Chrome 처럼 객체 키를 정렬해서 돌려준다
  const sorted = (v) => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v;
  globalThis.chrome = { storage: {
    local: {
      async get(keys) { const o = {}; for (const k of [].concat(keys)) if (k in area) o[k] = structuredClone(area[k]); return o; },
      async set(obj) { for (const [k, v] of Object.entries(obj)) { area[k] = sorted(v); queued.push({ [k]: { newValue: sorted(v) } }); } }
    },
    onChanged: { addListener: (f) => listeners.add(f), removeListener: (f) => listeners.delete(f) }
  } };
  const deliver = () => { while (queued.length) { const c = queued.shift(); listeners.forEach((f) => f(c, 'local')); } };
  const store = await new Store().load();
  deliver();
  store.mutate('favorites', (f) => { f.items.push({ id: 'a', title: 'A', url: 'https://a.com/', hidden: false, icon: { type: 'auto', value: '', color: '#5b6b8c' } }); });
  await store.save('favorites');                  // v1 저장, 메아리는 아직 도착 전
  store.mutate('favorites', (f) => { f.items[0].hidden = true; });
  await store.save('favorites');                  // v2 저장
  deliver();                                      // v1, v2 메아리가 뒤늦게 도착
  assert.equal(store.favorites.items[0].hidden, true, '최신 값 유지');
  // 다른 탭에서 바꾼 값은 반영
  listeners.forEach((f) => f({ 'vt.favorites': { newValue: { items: [] } } }, 'local'));
  assert.equal(store.favorites.items.length, 0);
  store.destroy();
  delete globalThis.chrome;
});
