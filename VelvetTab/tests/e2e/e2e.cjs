// 실제 Google Chrome E2E 테스트 (임시 프로필 사용, 사용자 프로필은 건드리지 않음)
// 실행: PW_CORE=<playwright-core 경로> node tests/e2e/e2e.cjs <결과 폴더>
const { launch, keys, shot, sleep } = require('./lib');
const fs = require('fs');
const path = require('path');

const EXT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'out'));
const PROF = path.join(OUT, 'profile');
const results = [];
let failures = 0;
const consoleErrors = [];
let CUR = null;
const ATTACHED = new WeakSet(); // 실패 시 진단용

function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  console.log(results[results.length - 1]);
  if (!ok) failures++;
}

/* ---------- 테스트 프로필: 북마크바(폴더·하위 폴더·빈 폴더·북마크릿·내부 URL·다수 항목), 기타 북마크 */
function seedProfile() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(PROF, 'Default'), { recursive: true });
  let id = 10;
  const T = '13370000000000000';
  const url = (name, u) => ({ date_added: T, guid: `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`, id: String(id), name, type: 'url', url: u });
  const folder = (name, children = [], fixedId, guid) => ({ children, date_added: T, date_modified: '0', guid: guid || `00000000-0000-4000-9000-${String(++id).padStart(12, '0')}`, id: fixedId || String(++id), name, type: 'folder' });
  const many = Array.from({ length: 14 }, (_, i) => url(`사이트 ${i + 1} 긴 이름 테스트`, `https://example.com/p${i + 1}`));
  const bar = [
    url('Example', 'https://example.com/'),
    folder('업무', [url('IANA', 'https://www.iana.org/'), folder('하위 폴더', [url('깊은 링크', 'https://example.org/deep')]), url('', 'https://example.net/')]),
    folder('빈 폴더', []),
    url('북마크릿', 'javascript:void(0)'),
    url('크롬 설정', 'chrome://settings/'),
    ...many
  ];
  const data = { roots: {
    bookmark_bar: folder('Bookmarks bar', bar, '1', '0bc5d13f-2cba-5d74-951f-3f233fe6c908'),
    other: folder('Other bookmarks', [url('기타 북마크 항목', 'https://example.org/other')], '2', '82b081ec-3dd3-529c-8475-ab6c344590dd'),
    synced: folder('Mobile bookmarks', [], '3', '4cf2e351-0e85-532b-bb37-df045d8f8d0f')
  }, version: 1 };
  fs.writeFileSync(path.join(PROF, 'Default', 'Bookmarks'), JSON.stringify(data));
}

async function setBookmarkBarMode(ctx, re) {
  const st = await ctx.newPage();
  await st.goto('chrome://settings/appearance');
  await sleep(1500);
  const r = await st.evaluate((src) => {
    const rx = new RegExp(src); let found = null;
    const walk = (n) => { if (found) return; if (n.shadowRoot) walk(n.shadowRoot); for (const c of n.children || []) walk(c);
      if (!found && n.tagName === 'SETTINGS-DROPDOWN-MENU' && /북마크바|Bookmarks bar/i.test(n.label || '')) {
        const s = n.shadowRoot.querySelector('select'); const t = [...s.options].find((o) => rx.test(o.textContent));
        s.value = t.value; s.dispatchEvent(new Event('change')); found = t.textContent.trim(); } };
    walk(document.documentElement); return found;
  }, re);
  await sleep(600);
  await st.close();
  return r;
}

async function openNewTab(s) {
  const before = s.ctx.pages().length;
  const k = keys(s.proc.pid, '^t');
  for (let i = 0; i < 30 && s.ctx.pages().length === before; i++) await sleep(100);
  const pg = s.ctx.pages()[s.ctx.pages().length - 1];
  pg.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); if (m.text().includes('vt-debug')) console.log('   ', m.text()); });
  pg.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  CUR = pg;
  await pg.waitForSelector('body.vt-ready', { timeout: 5000 });
  await sleep(300);
  return { pg, k };
}

async function setWindow(pg, width, height) {
  const cdp = await pg.context().newCDPSession(pg);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width, height } });
  await cdp.detach();
  await sleep(500);
}

// 저장은 250ms 디바운스 → 충분히 기다린 뒤 읽는다
const storage = async (pg) => { await sleep(450); return pg.evaluate(() => chrome.storage.local.get(null)); };
const imgB64 = (pg, type, color) => pg.evaluate(async ([t, c]) => {
  const cv = new OffscreenCanvas(1600, 900); const x = cv.getContext('2d');
  const g = x.createLinearGradient(0, 0, 1600, 900); g.addColorStop(0, c); g.addColorStop(1, '#101820');
  x.fillStyle = g; x.fillRect(0, 0, 1600, 900);
  x.fillStyle = 'rgba(255,255,255,.25)'; x.beginPath(); x.arc(1150, 280, 140, 0, 7); x.fill();
  const b = await cv.convertToBlob({ type: t, quality: 0.9 });
  const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (const v of u) s += String.fromCharCode(v); return btoa(s);
}, [type, color]);

async function panelTab(pg, tab) {
  if (!(await pg.$('.vt-panel.is-open'))) { await pg.click('#vt-settings-btn'); await pg.waitForSelector('.vt-panel.is-open'); await sleep(300); }
  await pg.click(`#vt-tab-${tab}`);
  await sleep(150);
}

(async () => {
  seedProfile();
  let s = await launch(PROF, 9360);
  check('Chrome 실행', true, `버전 ${s.browser.version()}`);
  check('북마크바 설정: 새 탭 페이지에만 표시', /새 탭/.test(await setBookmarkBarMode(s.ctx, '새 탭 페이지에만') || ''));
  const loaded = await s.send('Extensions.loadUnpacked', { path: EXT });
  check('확장 프로그램 설치', !!(loaded.result && loaded.result.id), JSON.stringify(loaded.result || loaded.error));

  /* ---------------- 1. 새 탭 교체 */
  let { pg, k } = await openNewTab(s);
  check('Ctrl+T 실제 키 입력', /SENT/.test(k), k);
  check('새 탭이 확장 페이지로 교체', pg.url().endsWith('/newtab.html'), pg.url());
  const txt = await pg.evaluate(() => document.body.innerText);
  check('Google 로고/검색창 없음', !/Google/.test(txt) && !(await pg.$('input[type=search], input[name=q]')));
  const vh = await pg.evaluate(() => innerHeight);
  shot(s.proc.pid, path.join(OUT, '01-newtab-window.png'));
  await pg.screenshot({ path: path.join(OUT, '01-newtab.png') });

  /* ---------------- 2. 시계·날짜 */
  const clockText = await pg.textContent('#vt-clock');
  check('시계 표시 (HH:MM)', /^\d{2}:\d{2}$/.test(clockText.trim()), clockText);
  const expectDate = await pg.evaluate(() => { const d = new Date(); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]}요일`; });
  check('날짜·요일 표시 (한국어)', (await pg.textContent('#vt-date')) === expectDate, await pg.textContent('#vt-date'));
  const box = async (sel) => pg.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2 }; });
  const cb = await box('#vt-clock');
  const db = await box('#vt-date');
  const W = await pg.evaluate(() => innerWidth);
  check('기본 배치: 시계 상단 중앙', Math.abs(cb.cx - W / 2) < 2 && cb.y < vh * 0.35, JSON.stringify(cb));
  check('기본 배치: 날짜는 시계 바로 아래', db.y >= cb.y + cb.h && db.y - (cb.y + cb.h) < 12 && Math.abs(db.cx - W / 2) < 2);
  const fb = await box('#vt-favorites');
  check('기본 배치: 즐겨찾기 하단', fb.y + fb.h > vh * 0.8, JSON.stringify(fb));

  // 초 표시 → 1초 단위 갱신 확인
  await panelTab(pg, 'elements');
  await pg.click('[aria-label="초 표시"]');
  await sleep(200);
  const t1 = await pg.textContent('#vt-clock');
  await sleep(1100);
  const t2 = await pg.textContent('#vt-clock');
  check('초 표시 + 1초 단위 갱신', /:\d{2}$/.test(t2) && t1 !== t2, `${t1} → ${t2}`);
  await pg.click('#vt-panel-body .vt-seg button:has-text("12시간")');
  await sleep(150);
  check('12시간 형식', /^(오전|오후)/.test((await pg.textContent('#vt-clock')).trim()), await pg.textContent('#vt-clock'));
  await pg.click('#vt-panel-body .vt-seg button:has-text("24시간")');
  await pg.click('[aria-label="초 표시"]');

  /* ---------------- 3. 요소 표시/숨김 */
  await pg.click('[aria-label="시계 표시"]');
  await sleep(150);
  check('시계 숨김', await pg.$eval('#vt-clock', (e) => e.hidden));
  await pg.click('[aria-label="시계 표시"]');
  await pg.click('[aria-label="날짜 표시"]');
  await sleep(150);
  check('날짜 숨김', await pg.$eval('#vt-date', (e) => e.hidden));
  await pg.click('[aria-label="날짜 표시"]');
  await pg.click('[aria-label="북마크바 표시"]');
  await sleep(150);
  check('북마크바 숨김', await pg.$eval('#vt-bookmarks', (e) => e.hidden));
  await pg.click('[aria-label="북마크바 표시"]');
  await sleep(300);
  const stAfter = await storage(pg);
  check('표시 설정 저장 (chrome.storage.local)', stAfter['vt.settings'].elements.clock.visible === true && stAfter['vt.meta'].schemaVersion === 1);

  /* ---------------- 4. 북마크바 */
  await pg.keyboard.press('Escape');
  await sleep(400);
  const bm = await pg.evaluate(() => {
    const items = [...document.querySelectorAll('#vt-bookmarks .vt-bm-items > .vt-bm-item')];
    return { total: items.length, visible: items.filter((i) => !i.classList.contains('is-overflow')).length, chevron: !document.querySelector('.vt-bm-chevron').hidden,
      other: !document.querySelector('.vt-bm-other').hidden, names: items.slice(0, 5).map((i) => i.textContent.trim()), disabled: items.filter((i) => i.classList.contains('is-disabled')).length,
      height: document.getElementById('vt-bookmarks').offsetHeight };
  });
  check('북마크바: 순서·이름 유지', bm.total === 19 && bm.names.join('|') === 'Example|업무|빈 폴더|북마크릿|크롬 설정', bm.names.join('|'));
  check('북마크바: 화면 너비 초과 시 » 오버플로', bm.chevron && bm.visible < bm.total, `${bm.visible}/${bm.total}`);
  check("북마크바: '모든 북마크' 폴더", bm.other);
  check('북마크바: 북마크릿은 비활성 처리', bm.disabled === 1);
  check('북마크바: 낮은 높이 (34px)', bm.height === 34, String(bm.height));
  await pg.click('.vt-bm-folder:has-text("업무")');
  await sleep(200);
  const m1 = await pg.$$eval('.vt-menu[data-level="0"] .vt-menu-item', (els) => els.map((e) => e.textContent.trim()));
  check('폴더 클릭 → 하위 항목 팝업', m1.join('|') === 'IANA|하위 폴더|https://example.net/', m1.join('|'));
  await pg.hover('.vt-menu .vt-bm-folder:has-text("하위 폴더")');
  await sleep(450);
  const m2 = await pg.$$eval('.vt-menu[data-level="1"] .vt-menu-item', (els) => els.map((e) => e.textContent.trim()));
  check('하위 폴더 중첩 메뉴', m2.join('|') === '깊은 링크', m2.join('|'));
  await pg.screenshot({ path: path.join(OUT, '02-bookmark-menu.png') });
  await pg.hover('.vt-bm-folder:has-text("빈 폴더")');
  await sleep(250);
  check('메뉴 열린 상태에서 다른 폴더 hover 전환 + 빈 폴더 처리', (await pg.textContent('.vt-menu[data-level="0"]')).includes('(비어 있음)'));
  await pg.keyboard.press('Escape');
  await pg.click('.vt-bm-chevron');
  await sleep(200);
  const ov = await pg.$$eval('.vt-menu .vt-menu-item', (els) => els.length);
  check('» 메뉴에 숨겨진 항목 표시', ov === bm.total - bm.visible, String(ov));
  await pg.keyboard.press('Escape');
  const favImg = await pg.$eval('#vt-bookmarks a.vt-bm-link img', (i) => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 }));
  check('파비콘 표시 (chrome-extension://…/_favicon)', /_favicon\/\?pageUrl=/.test(favImg.src) && favImg.ok, favImg.src.slice(0, 80));
  // 실시간 반영 (테스트 하네스가 테스트 프로필에서 북마크를 추가 — 확장 코드는 읽기 전용)
  await pg.evaluate(() => chrome.bookmarks.create({ parentId: '1', index: 0, title: '실시간 추가', url: 'https://example.com/live' }));
  await sleep(500);
  check('북마크 추가 실시간 반영', (await pg.textContent('#vt-bookmarks .vt-bm-items > .vt-bm-item')).trim() === '실시간 추가');
  await pg.evaluate(async () => { const r = await chrome.bookmarks.search({ title: '실시간 추가' }); await chrome.bookmarks.remove(r[0].id); });
  await sleep(500);
  check('북마크 삭제 실시간 반영', (await pg.textContent('#vt-bookmarks .vt-bm-items > .vt-bm-item')).trim() === 'Example');
  // 클릭으로 열기
  const [nav] = await Promise.all([pg.waitForNavigation({ timeout: 8000 }).catch(() => null), pg.click('#vt-bookmarks a.vt-bm-link:has-text("Example")')]);
  check('북마크 클릭 → 페이지 열기', pg.url().startsWith('https://example.com'), pg.url());
  const webVh = await pg.evaluate(() => innerHeight);
  await pg.close();

  ({ pg } = await openNewTab(s));

  /* ---------------- 5. 자유 드래그 */
  await panelTab(pg, 'layout');
  await pg.click('button:has-text("편집 모드 시작")');
  await sleep(250);
  check('편집 모드 진입 (패널 숨김, 편집 막대 표시)', await pg.$eval('#vt-editbar', (e) => !e.hidden) && !(await pg.$('.vt-panel.is-open')));
  const c0 = await box('#vt-clock');
  await pg.mouse.move(c0.x + c0.w / 2, c0.y + c0.h / 2);
  await pg.mouse.down();
  await pg.mouse.move(c0.x + c0.w / 2 - 200, c0.y + c0.h / 2 + 150, { steps: 8 });
  const badge = await pg.$eval('.vt-drag-badge', (e) => (e.hidden ? '' : e.textContent));
  await pg.mouse.up();
  await sleep(400);
  const c1 = await box('#vt-clock');
  check('드래그로 이동 + 좌표 표시', Math.abs(c1.x - (c0.x - 200)) < 3 && Math.abs(c1.y - (c0.y + 150)) < 3 && /X \d+% · Y \d+%/.test(badge), `${badge}`);
  let st = await storage(pg);
  const p1 = st['vt.settings'].elements.clock.position;
  check('드롭 시 정규화 좌표 저장', p1.mode === 'free' && p1.x > 0 && p1.x < 1 && p1.y > 0 && p1.y < 1, JSON.stringify(p1));
  // 화면 밖으로 끌기
  await pg.mouse.move(c1.x + 20, c1.y + 20);
  await pg.mouse.down();
  await pg.mouse.move(-500, -500, { steps: 5 });
  await pg.mouse.up();
  await sleep(300);
  const c2 = await box('#vt-clock');
  const bbH = await pg.$eval('#vt-bookmarks', (e) => e.offsetHeight);
  check('화면 밖 이탈 방지', c2.x >= 0 && c2.y >= bbH, JSON.stringify(c2));
  // 날짜 위로 겹치게
  const d0 = await box('#vt-date');
  await pg.mouse.move(c2.x + c2.w / 2, c2.y + c2.h / 2);
  await pg.mouse.down();
  await pg.mouse.move(d0.cx, d0.y + d0.h / 2, { steps: 6 });
  const overlap = await pg.$eval('#vt-clock', (e) => e.classList.contains('is-overlap'));
  await pg.mouse.up();
  check('겹침 시각적 구분', overlap);
  await pg.screenshot({ path: path.join(OUT, '03-edit-mode.png') });
  // 편집 모드가 아닐 때는 움직이지 않음
  await pg.click('#vt-editbar [data-act="done"]');
  await sleep(500);
  if (await pg.$('.vt-panel.is-open')) { await pg.keyboard.press('Escape'); await sleep(400); }
  const before = await box('#vt-clock');
  await pg.mouse.move(before.x + 10, before.y + 10);
  await pg.mouse.down();
  await pg.mouse.move(before.x + 300, before.y + 200, { steps: 5 });
  await pg.mouse.up();
  const after = await box('#vt-clock');
  check('일반 모드에서는 이동 안 됨', before.x === after.x && before.y === after.y);

  /* ---------------- 6. 해상도 변경 시 배치 유지 */
  const ratio = async () => pg.evaluate(() => { const r = document.getElementById('vt-clock').getBoundingClientRect(); const top = document.getElementById('vt-bookmarks').offsetHeight; return { x: (r.x + r.width / 2) / innerWidth, y: (r.y + r.height / 2 - top) / (innerHeight - top) }; });
  const r0 = await ratio();
  await setWindow(pg, 1500, 950);
  const r1 = await ratio();
  await setWindow(pg, 1100, 760);
  check('창 크기 변경 시 상대 위치 유지', Math.abs(r0.x - r1.x) < 0.02 && Math.abs(r0.y - r1.y) < 0.02, `${r0.x.toFixed(3)},${r0.y.toFixed(3)} → ${r1.x.toFixed(3)},${r1.y.toFixed(3)}`);

  /* ---------------- 7. 위치 프리셋 + 기본 배치 복원 */
  await panelTab(pg, 'layout');
  await pg.click('.vt-card:has(.vt-card-title:text-is("즐겨찾기")) .vt-posgrid button[aria-label="상단 우측"]');
  await sleep(300);
  const fr = await box('#vt-favorites');
  check('위치 프리셋 선택 (즐겨찾기 → 상단 우측)', fr.x + fr.w > W - 60 && fr.y < 200, JSON.stringify(fr));
  await pg.click('.vt-panel button:has-text("기본 배치 복원")');
  await pg.click('button:has-text("한 번 더 누르면 복원")');
  await sleep(300);
  const cr = await box('#vt-clock');
  st = await storage(pg);
  check('기본 배치 복원', Math.abs(cr.cx - W / 2) < 2 && st['vt.settings'].elements.clock.position.mode === 'preset');

  /* ---------------- 8. 글래스 디자인 */
  await panelTab(pg, 'design');
  const setRange = async (label, v) => { await pg.$eval(`.vt-panel input[aria-label="${label}"]`, (e, val) => { e.value = val; e.dispatchEvent(new Event('input', { bubbles: true })); }, v); };
  await setRange('블러 강도', 24);
  await setRange('모서리 둥글기', 6);
  await sleep(350);
  const fav = await pg.$eval('#vt-favorites', (e) => ({ blur: getComputedStyle(e).backdropFilter, radius: getComputedStyle(e).borderTopLeftRadius }));
  check('전역 디자인 즉시 반영', /blur\(24px\)/.test(fav.blur) && fav.radius === '6px', JSON.stringify(fav));
  await pg.click('.vt-panel .vt-seg button:has-text("즐겨찾기")');
  await setRange('모서리 둥글기', 28);
  await sleep(350);
  const fav2 = await pg.$eval('#vt-favorites', (e) => getComputedStyle(e).borderTopLeftRadius);
  const bar2 = await pg.$eval('#vt-bookmarks', (e) => getComputedStyle(e).backdropFilter);
  check('개별 설정이 전역보다 우선', fav2 === '28px', fav2);
  check('개별 설정 표시(●)', !!(await pg.$('.vt-row[data-prop="radius"] .vt-mark')));
  await pg.click('.vt-row[data-prop="radius"] .vt-row-reset');
  await sleep(350);
  check('개별 → 전역 값으로 되돌리기', (await pg.$eval('#vt-favorites', (e) => getComputedStyle(e).borderTopLeftRadius)) === '6px');
  await pg.screenshot({ path: path.join(OUT, '03b-panel-design.png') });
  check('북마크바도 글래스 설정과 연동', /blur\(18px\)/.test(bar2), bar2);

  /* ---------------- 9. 배경화면 */
  await panelTab(pg, 'background');
  const upload = async (name, mime, b64) => pg.setInputFiles('.vt-panel input[type=file]', { name, mimeType: mime, buffer: Buffer.from(b64, 'base64') });
  await upload('photo.jpg', 'image/jpeg', await imgB64(pg, 'image/jpeg', '#3b6ea8'));
  await sleep(600);
  check('JPG 선택 → 즉시 미리보기 (저장 전)', /blob:/.test(await pg.$eval('#vt-bg', (e) => e.style.backgroundImage)) && /미리보기/.test(await pg.textContent('.vt-panel .vt-status')));
  await pg.click('.vt-panel button:text-is("적용")');
  await sleep(700);
  const idb = () => pg.evaluate(() => new Promise((res) => { const r = indexedDB.open('VelvetTab'); r.onsuccess = () => { const t = r.result.transaction(['images', 'meta']); const out = {}; t.objectStore('meta').get('background').onsuccess = (e) => { out.meta = e.target.result; }; t.objectStore('images').count().onsuccess = (e) => { out.count = e.target.result; }; t.oncomplete = () => { r.result.close(); res(out); }; }; }));
  let db1 = await idb();
  check('JPG 적용 → IndexedDB 저장', db1.count === 1 && db1.meta.type === 'image/jpeg' && db1.meta.width === 1600, JSON.stringify(db1.meta));
  await upload('photo.png', 'image/png', await imgB64(pg, 'image/png', '#a8573b'));
  await sleep(500);
  await pg.click('.vt-panel button:text-is("적용")');
  await sleep(600);
  db1 = await idb();
  check('PNG 교체 (중복 없이 1개)', db1.count === 1 && db1.meta.type === 'image/png');
  await upload('photo.webp', 'image/webp', await imgB64(pg, 'image/webp', '#4a8a5c'));
  await sleep(500);
  await pg.click('.vt-panel button:text-is("적용")');
  await sleep(600);
  db1 = await idb();
  check('WebP 교체', db1.count === 1 && db1.meta.type === 'image/webp');
  await upload('fake.jpg', 'image/jpeg', Buffer.from('this is not an image').toString('base64'));
  await sleep(400);
  check('손상/가짜 이미지 거부', /JPG, PNG, WebP/.test(await pg.textContent('.vt-panel .vt-status')) && (await idb()).meta.type === 'image/webp');
  await pg.click('.vt-panel .vt-seg button:has-text("맞추기")');
  await sleep(150);
  check('표시 방식: Contain', (await pg.$eval('#vt-bg', (e) => e.style.backgroundSize)) === 'contain');
  await pg.click('.vt-panel .vt-seg button:has-text("사용자 지정")');
  await sleep(150);
  await setRange('가로 위치', 20);
  await sleep(100);
  check('표시 방식: 사용자 지정 위치', (await pg.$eval('#vt-bg', (e) => e.style.backgroundPosition)) === '20% 50%');
  await pg.click('.vt-panel .vt-seg button:has-text("채우기")');
  await pg.keyboard.press('Escape');
  await sleep(400);
  await pg.screenshot({ path: path.join(OUT, '04-with-background.png') });

  /* ---------------- 10. 즐겨찾기 CRUD */
  await panelTab(pg, 'favorites');
  const addFav = async (name, u) => {
    await pg.click('.vt-panel button:has-text("+ 즐겨찾기 추가")');
    await pg.fill('.vt-panel input[aria-label="이름"]', name);
    await pg.fill('.vt-panel input[aria-label="URL"]', u);
    await pg.click('.vt-panel button:text-is("저장")');
    await sleep(200);
  };
  await addFav('Example', 'example.com');
  await addFav('IANA', 'https://www.iana.org');
  await addFav('Org', 'example.org');
  await pg.click('.vt-panel button:has-text("+ 즐겨찾기 추가")');
  await pg.fill('.vt-panel input[aria-label="URL"]', 'javascript:alert(1)');
  await pg.click('.vt-panel button:text-is("저장")');
  check('잘못된 URL 거부', /올바른 웹 주소/.test(await pg.textContent('.vt-panel .vt-status')));
  await pg.click('.vt-panel button:text-is("취소")');
  let favs = await pg.$$eval('#vt-favorites .vt-fav', (els) => els.map((e) => [e.textContent.trim(), e.getAttribute('href')]));
  check('즐겨찾기 추가 + 화면 표시', favs.length === 3 && favs[0][1] === 'https://example.com/', JSON.stringify(favs));
  await pg.click('.vt-fav-row:has(strong:text-is("IANA")) button[title="편집"]');
  await pg.fill('.vt-panel input[aria-label="이름"]', 'IANA 수정');
  await pg.selectOption('.vt-panel select[aria-label="아이콘 종류"]', 'emoji');
  await pg.fill('.vt-panel input[aria-label="아이콘 글자"]', '🌐');
  await pg.click('.vt-panel button:text-is("저장")');
  await sleep(200);
  check('이름 변경 + 아이콘 설정(이모지)', (await pg.textContent('#vt-favorites')).includes('IANA 수정') && (await pg.textContent('#vt-favorites .vt-fav-icon.is-emoji')) === '🌐');
  await pg.dragAndDrop('.vt-fav-row:has(strong:text-is("Org"))', '.vt-fav-row:has(strong:text-is("Example"))');
  await sleep(300);
  favs = await pg.$$eval('#vt-favorites .vt-fav-label', (els) => els.map((e) => e.textContent));
  check('드래그 정렬', favs[0] === 'Org', favs.join(','));
  await pg.click('.vt-fav-row:has(strong:text-is("Example")) button[title="숨기기"]');
  await sleep(200);
  check('개별 숨김', !(await pg.textContent('#vt-favorites')).includes('Example'));
  await pg.click('.vt-fav-row:has(strong:text-is("Example")) button[title="표시"]');
  await pg.click('.vt-fav-row:has(strong:text-is("Org")) button:text-is("삭제")');
  await pg.click('.vt-fav-row:has(strong:text-is("Org")) button:text-is("확인")');
  await sleep(200);
  favs = await pg.$$eval('#vt-favorites .vt-fav-label', (els) => els.map((e) => e.textContent));
  check('삭제 (두 번 확인)', favs.join(',') === 'Example,IANA 수정', favs.join(','));
  await panelTab(pg, 'elements');
  await pg.click('.vt-card:has(.vt-card-title:text-is("즐겨찾기")) .vt-seg button:has-text("아이콘만")');
  await sleep(150);
  check('아이콘만 표시 모드', await pg.$eval('#vt-favorites .vt-fav-label', (e) => getComputedStyle(e).display === 'none'));
  await pg.click('.vt-card:has(.vt-card-title:text-is("즐겨찾기")) .vt-seg button:has-text("아이콘+이름")');

  /* ---------------- 11. 프리셋 */
  await panelTab(pg, 'presets');
  await pg.fill('.vt-panel input[aria-label="새 프리셋 이름"]', '내 설정');
  await pg.click('.vt-panel .vt-inline button:text-is("저장")');
  await sleep(300);
  await pg.screenshot({ path: path.join(OUT, '06-panel-presets.png') });
  await sleep(200);
  st = await storage(pg);
  const mine = st['vt.presets'].items.find((p) => p.name === '내 설정');
  check('프리셋 저장 (JSON)', !!mine && st['vt.presets'].activeId === mine.id && !('background' in mine.data));
  const bgBefore = await pg.$eval('#vt-bg', (e) => e.style.backgroundImage);
  await pg.click('.vt-preset:has-text("Dark") button:text-is("적용")');
  await sleep(300);
  st = await storage(pg);
  check('프리셋 적용 (Dark)', st['vt.settings'].globalStyle.bgColor === '#0b0b0f');
  check('프리셋 변경 시 배경화면 유지', (await pg.$eval('#vt-bg', (e) => e.style.backgroundImage)) === bgBefore);
  await pg.click('.vt-preset:has-text("내 설정") button:text-is("적용")');
  await sleep(200);
  st = await storage(pg);
  check('저장한 프리셋 복원', st['vt.settings'].globalStyle.blur === 24);
  await pg.click('.vt-preset:has-text("내 설정") button:text-is("이름 변경")');
  await pg.fill('.vt-preset input[aria-label="프리셋 이름"]', '내 설정 2');
  await pg.keyboard.press('Enter');
  await sleep(200);
  await pg.click('.vt-preset:has-text("내 설정 2") button:text-is("복제")');
  await pg.click('.vt-preset:has-text("내 설정 2 사본") button:text-is("기본으로")');
  await sleep(200);
  st = await storage(pg);
  const copy = st['vt.presets'].items.find((p) => p.name === '내 설정 2 사본');
  check('이름 변경·복제·기본 지정', !!copy && st['vt.presets'].defaultId === copy.id);
  await pg.click('.vt-preset:has-text("내 설정 2 사본") button:text-is("삭제")');
  await pg.click('.vt-preset:has-text("내 설정 2 사본") button:text-is("확인")');
  await sleep(300);
  st = await storage(pg);
  check('프리셋 삭제', !st['vt.presets'].items.some((p) => p.name === '내 설정 2 사본') && st['vt.presets'].defaultId === 'builtin-glass');
  await pg.click('#vt-tab-elements');
  await pg.click('[aria-label="초 표시"]'); // 재시작 확인용 설정
  await sleep(100);

  // ESC / 바깥 클릭으로 닫기
  await pg.keyboard.press('Escape');
  await sleep(400);
  check('ESC로 패널 닫기', !(await pg.$('.vt-panel.is-open')));
  await pg.click('#vt-settings-btn');
  await sleep(400);
  await pg.mouse.click(200, 400);
  await sleep(400);
  check('바깥 클릭으로 패널 닫기', !(await pg.$('.vt-panel.is-open')));
  await sleep(500);
  const snapshot = await storage(pg);

  /* ---------------- 12. 브라우저 재시작 */
  await s.send('Browser.close');
  await sleep(3000);
  s = await launch(PROF, 9361);
  const re = await s.send('Extensions.loadUnpacked', { path: EXT }); // CDP 로 로드한 확장은 재시작 시 다시 로드 필요 (같은 경로 → 같은 ID)
  check('재시작 후 같은 확장 ID', re.result && re.result.id === loaded.result.id);
  ({ pg } = await openNewTab(s));
  await sleep(800);
  const st2 = await storage(pg);
  check('재시작 후 설정·프리셋·즐겨찾기 유지', JSON.stringify(st2['vt.settings']) === JSON.stringify(snapshot['vt.settings']) && JSON.stringify(st2['vt.favorites']) === JSON.stringify(snapshot['vt.favorites']) && JSON.stringify(st2['vt.presets']) === JSON.stringify(snapshot['vt.presets']));
  check('재시작 후 배경화면 유지 (IndexedDB)', /blob:/.test(await pg.$eval('#vt-bg', (e) => e.style.backgroundImage)) && (await idb()).meta.type === 'image/webp');
  check('재시작 후 화면 반영 (초 표시)', /^\d{2}:\d{2}:\d{2}$/.test((await pg.textContent('#vt-clock')).trim()));
  const ntpVh = await pg.evaluate(() => innerHeight);
  shot(s.proc.pid, path.join(OUT, '05-after-restart-window.png'));

  /* ---------------- 13. 확장 프로그램 재로드 (업데이트 상황) */
  const rl = await s.send('Extensions.loadUnpacked', { path: EXT });
  ({ pg } = await openNewTab(s));
  await sleep(600);
  check('확장 재로드 후 설정 유지', JSON.stringify((await storage(pg))['vt.settings']) === JSON.stringify(snapshot['vt.settings']), JSON.stringify(rl.result || rl.error));

  /* ---------------- 14. 데이터 손상 대응 */
  await pg.evaluate(async () => {
    await chrome.storage.local.set({ 'vt.settings': 'garbage', 'vt.favorites': { items: 'x' } });
    await new Promise((res) => { const r = indexedDB.open('VelvetTab'); r.onsuccess = () => { const t = r.result.transaction(['images'], 'readwrite'); t.objectStore('images').put(new Blob(['corrupted bytes'], { type: 'image/png' }), 'background'); t.oncomplete = () => { r.result.close(); res(); }; }; });
  });
  const errsBefore = consoleErrors.length;
  ({ pg } = await openNewTab(s));
  await sleep(800);
  const st3 = await storage(pg);
  check('손상된 설정 → 기본값 복구 + 백업', typeof st3['vt.settings'] === 'object' && st3['vt.settings'].elements.clock.visible === true && st3['vt.backup'] && st3['vt.backup'].values.settings === 'garbage');
  check('손상된 즐겨찾기 → 빈 목록', Array.isArray(st3['vt.favorites'].items) && st3['vt.favorites'].items.length === 0);
  check('손상된 배경 이미지 → 오류 없이 기본 배경 + 데이터 정리', !(await pg.$eval('#vt-bg', (e) => e.classList.contains('has-image'))) && (await idb()).count === 0);
  check('손상 처리 중 페이지 오류 없음', consoleErrors.slice(errsBefore).filter((e) => /pageerror/.test(e)).length === 0, consoleErrors.slice(errsBefore).join(' / '));

  /* ---------------- 15. Chrome 기본 북마크바 호환성 (재확인) */
  check('[호환성] 확장 새 탭: Chrome 기본 북마크바 표시 안 됨 (재현)', vh === 610 && ntpVh === 610, `innerHeight ${vh}/${ntpVh} (막대 표시 시 ${610 - 34})`);
  check('[호환성] 일반 웹사이트: Chrome 기본 북마크바 숨김 유지', webVh === 667, `innerHeight ${webVh}`);

  /* ---------------- 권한 */
  const mf = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  check('권한 최소화', JSON.stringify(mf.permissions) === '["storage","bookmarks","favicon"]' && !mf.host_permissions && !mf.background, mf.permissions.join(','));
  check('콘솔 오류 없음', consoleErrors.length === 0, consoleErrors.join(' / '));

  await s.send('Browser.close');
  const summary = `${results.length - failures}/${results.length} 통과`;
  fs.writeFileSync(path.join(OUT, 'results.txt'), results.join('\n') + `\n\n${summary}\n`);
  console.log('\n' + summary);
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error(e);
  if (CUR) { try { await CUR.screenshot({ path: path.join(OUT, 'crash.png') }); console.error('PANEL:', await CUR.evaluate(() => { const p = document.querySelector('.vt-panel'); return p ? p.className + ' | tab=' + (document.querySelector('[role=tab][aria-selected=true]')||{}).textContent + ' | ' + p.innerText.slice(0, 400) : 'none'; })); } catch (x) { console.error(x.message); } } fs.writeFileSync(path.join(OUT, 'results.txt'), results.join('\n') + '\n\nCRASH: ' + e.stack); process.exit(2); });
