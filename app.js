import { db } from './db.js';
import { DEFAULT_CHECKLISTS, parseChecklist } from './checklists.js';
import { TRAIN_TYPES, TYPE_ICON, LEVELS, MODULES, levelFromHours, proposePlan, lastDoneMap, splitByType } from './training.js';
import { getGuide, youtubeSearchUrl } from './guides.js';

const APP_VERSION = '1.3.0';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const view = $('#view');

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const selected = c => (c ? 'selected' : '');
const checked = c => (c ? 'checked' : '');

const SPECIFIC = ['空港等周辺', '高度150m以上', '人口集中地区(DID)上空', '夜間', '目視外', '人・物件から30m未満', '催し場所上空', '危険物輸送', '物件投下'];
const PURPOSES = ['訓練', '試験対策', '空撮', '点検', '測量', '趣味', 'その他'];
const DOC_TYPES = ['機体登録', '許可・承認', '技能証明', '保険', 'その他'];
const AIRCRAFT_TYPES = ['マルチコプター', '回転翼航空機（ヘリコプター）', '飛行機', 'その他'];
const CERT_TYPES = ['なし', '第一種機体認証', '第二種機体認証'];
const LIMITS = ['目視内限定の解除', '昼間限定の解除', '25kg未満限定の解除'];
const DIPS_URL = 'https://www.ossportal.dips.mlit.go.jp/portal/top/';

// ---------- 日時の表示 ----------
const pad = n => String(n).padStart(2, '0');
function parseDate(v) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); }
  return new Date(v);
}
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const fmtDate = v => { if (!v) return ''; const d = parseDate(v); return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`; };
const fmtTime = v => { if (!v) return ''; const d = new Date(v); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const toLocalInput = v => { const d = v ? new Date(v) : new Date(); return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocalInput = s => new Date(s).toISOString();
// 入力欄（分単位）を変更していなければ、秒まで含む元の時刻を使う
const pickTime = (inputVal, orig) => (orig && inputVal === toLocalInput(orig) ? orig : fromLocalInput(inputVal));
function fmtDur(sec) {
  const tm = Math.round((sec || 0) / 60);
  const h = Math.floor(tm / 60), m = tm % 60;
  return h ? `${h}時間${pad(m)}分` : `${m}分`;
}
function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  return `${Math.floor(sec / 3600)}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`;
}
function daysUntil(dateStr) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((parseDate(dateStr) - t) / 86400000);
}

// ---------- 設定値 ----------
async function getSetting(key, def) { const r = await db.get('settings', key); return r === undefined ? def : r.value; }
async function setSetting(key, value) { await db.put('settings', { id: key, value }); }

async function getChecklists() {
  const stored = await getSetting('checklists', []);
  return DEFAULT_CHECKLISTS.map(d => stored.find(s => s.id === d.id) || d)
    .concat(stored.filter(s => !DEFAULT_CHECKLISTS.some(d => d.id === s.id)));
}

// ---------- 共通部品 ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
}

function readForm(form) {
  const fd = new FormData(form);
  const o = Object.fromEntries(fd);
  o.specific = fd.getAll('specific');
  return o;
}

function aircraftLabel(a) { return a ? `${a.name}${a.regNo ? `（${a.regNo}）` : ''}` : '（機体なし）'; }

function aircraftOptions(list, sel, { includeNone = false, includeAll = false } = {}) {
  let html = includeAll ? `<option value="">すべての機体</option>` : '';
  if (includeNone) html += `<option value="">（指定なし）</option>`;
  return html + list.filter(a => !a.retired || a.id === sel)
    .map(a => `<option value="${a.id}" ${selected(a.id === sel)}>${esc(aircraftLabel(a))}</option>`).join('');
}

function specificChips(sel = []) {
  return `<div class="chips">${SPECIFIC.map(s =>
    `<label class="chip"><input type="checkbox" name="specific" value="${esc(s)}" ${checked(sel.includes(s))}>${esc(s)}</label>`).join('')}</div>`;
}

function defectFields(d, pilotName) {
  return `
    <label class="chk"><input type="checkbox" name="hasDefect" ${checked(d)}><span>不具合あり</span></label>
    <div id="defectBox" ${d ? '' : 'hidden'}>
      <label class="f"><span>発生年月日</span><input type="date" name="defectDate" value="${esc(d?.date || todayStr())}"></label>
      <label class="f"><span>不具合事項</span><textarea name="defectContent">${esc(d?.content)}</textarea></label>
      <label class="f"><span>処置</span><textarea name="defectAction">${esc(d?.action)}</textarea></label>
      <label class="f"><span>確認者</span><input name="defectConfirmer" value="${esc(d?.confirmer ?? pilotName ?? '')}"></label>
    </div>`;
}
function bindDefect(form) {
  form.hasDefect.addEventListener('change', () => { $('#defectBox', form).hidden = !form.hasDefect.checked; });
}
function readDefect(o) {
  if (!o.hasDefect) return null;
  return { date: o.defectDate, content: o.defectContent || '', action: o.defectAction || '', confirmer: o.defectConfirmer || '' };
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('この端末では位置情報が使えません'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
      e => reject(new Error(e.code === 1
        ? '位置情報が許可されていません（iPhone の「設定」→「プライバシーとセキュリティ」→「位置情報サービス」で許可）'
        : '現在地を取得できませんでした')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });
}

async function reverseGeocode(lat, lon) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=ja&zoom=17`);
    const j = await r.json();
    const a = j.address || {};
    const parts = [a.province || a.state, a.city || a.town || a.village || a.county, a.suburb || a.quarter || a.neighbourhood || a.hamlet];
    return parts.filter(Boolean).join(' ') || j.display_name || '';
  } catch { return ''; }
}

// GPS ボタンの共通処理
function bindGps(btn, form, info) {
  btn.addEventListener('click', async () => {
    info.textContent = '取得中…';
    try {
      const p = await getPosition();
      form.lat.value = p.lat.toFixed(6); form.lon.value = p.lon.toFixed(6);
      info.textContent = `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}（誤差 約${Math.round(p.acc)}m）`;
      const name = await reverseGeocode(p.lat, p.lon);
      const place = form.takeoffPlace || form.place;
      if (place && name && !place.value) place.value = name;
    } catch (e) { info.textContent = e.message; }
  });
}

async function shareOrDownload(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const file = new File([blob], filename, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function totalSecOf(aircraft, flights, until) {
  return (Number(aircraft?.baseMinutes) || 0) * 60 + flights
    .filter(f => f.aircraftId === aircraft?.id && (!until || f.takeoffAt <= until))
    .reduce((s, f) => s + (Number(f.durationSec) || 0), 0);
}

// 操縦者としての総飛行時間＝アプリ使用前の時間＋アプリの飛行記録＋手入力で追加した時間
function pilotHours(pilot, flights, extras) {
  const base = (Number(pilot?.baseMinutes) || 0) * 60;
  const app = flights.reduce((s, f) => s + (Number(f.durationSec) || 0), 0);
  const extra = (extras || []).reduce((s, x) => s + (Number(x.minutes) || 0) * 60, 0);
  return { base, app, extra, total: base + app + extra };
}

function docStatus(d) {
  if (!d.expiresAt) return { cls: '', label: '期限なし', days: null };
  const days = daysUntil(d.expiresAt);
  if (days < 0) return { cls: 'danger', label: `期限切れ（${-days}日前）`, days };
  if (days <= 30) return { cls: 'warn', label: `あと${days}日`, days };
  return { cls: 'ok', label: `あと${days}日`, days };
}

// ---------- 有効期限のお知らせ ----------
// 何日前から知らせるか（設定で変更できる）
const ALERT_DEFAULTS = { license: 180, cert: 90, reg: 60, doc: 60 };
const ALERT_LABELS = { license: '技能証明', cert: '機体認証', reg: '機体登録', doc: 'その他の書類（許可・保険など）' };
const ALERT_HINTS = {
  license: '更新には講習の修了や身体適性の確認が必要です。手続きに時間がかかるので早めに準備してください。',
  cert: '機体認証の更新には検査が必要です。早めに準備してください。',
  reg: '機体登録の更新は DIPS 2.0 から行えます。',
  doc: '',
};

// 操縦者・機体・書類から、期限のある項目をすべて集める
function collectDeadlines(pilot, aircraft, docs) {
  const out = [];
  if (pilot?.licenseExpires) {
    out.push({ kind: 'license', title: `技能証明（${pilot.licenseClass && pilot.licenseClass !== 'なし' ? pilot.licenseClass : '区分未設定'}）`,
      number: pilot.licenseNo, date: pilot.licenseExpires, href: '#/settings', uid: 'pilot-license' });
  }
  for (const a of aircraft.filter(x => !x.retired)) {
    if (a.regExpires) out.push({ kind: 'reg', title: `機体登録：${a.name}`, number: a.regNo, date: a.regExpires, href: `#/aircraft/${a.id}`, uid: `${a.id}-reg` });
    if (a.certExpires && a.certType && a.certType !== 'なし') {
      out.push({ kind: 'cert', title: `${a.certType}：${a.name}`, number: a.certNo, date: a.certExpires, href: `#/aircraft/${a.id}`, uid: `${a.id}-cert` });
    }
  }
  for (const d of docs.filter(x => x.expiresAt)) {
    const kind = d.type === '技能証明' ? 'license' : d.type === '機体登録' ? 'reg' : 'doc';
    out.push({ kind, title: `${d.type}：${d.name || ''}`, number: d.number, date: d.expiresAt, href: `#/doc/${d.id}`, uid: d.id });
  }
  return out.map(x => ({ ...x, st: docStatus({ expiresAt: x.date }) })).sort((a, b) => a.st.days - b.st.days);
}

function deadlineCard(x) {
  return `<a class="card ${x.st.cls === 'ok' ? '' : x.st.cls}" href="${x.href}" style="display:block;color:inherit;text-decoration:none">
    <b>${esc(x.title)}</b><br><span class="muted">有効期限 ${fmtDate(x.date)}（${x.st.label}）</span>
    ${ALERT_HINTS[x.kind] ? `<br><span class="muted small">${ALERT_HINTS[x.kind]}</span>` : ''}</a>`;
}

// ---------- 画面の切り替え ----------
const ROUTES = {
  home: { title: '飛行日誌', fn: viewHome },
  flight: { title: '飛行', fn: viewFlight },
  map: { title: '地図・天気', fn: viewMap, full: true },
  check: { title: '点検', fn: viewCheck },
  records: { title: '記録', fn: viewRecords },
  settings: { title: '機体・書類・設定', fn: viewSettings, tab: '-', back: true },
  hours: { title: '総飛行時間', fn: viewHours, tab: '-', back: true },
  guides: { title: '訓練科目の解説', fn: viewGuides, tab: 'train', back: true },
  aircraft: { title: '機体', fn: viewAircraftEdit, tab: '-', back: true },
  doc: { title: '書類・期限', fn: viewDocEdit, tab: '-', back: true },
  checklist: { title: 'チェックリスト編集', fn: viewChecklistEdit, tab: '-', back: true },
  train: { title: '訓練', fn: viewTrain },
  'train-edit': { title: '訓練記録', fn: viewTrainEdit, tab: 'train', back: true },
  'flight-edit': { title: '飛行記録', fn: viewFlightEdit, tab: 'records', back: true },
  inspection: { title: '点検記録', fn: viewInspection, tab: 'records', back: true },
  maint: { title: '点検整備記録', fn: viewMaintEdit, tab: 'records', back: true },
  print: { title: '印刷・PDF', fn: viewPrint, tab: 'records', back: true },
};

let cleanup = null;
async function render() {
  if (cleanup) { try { cleanup(); } catch { /* 無視 */ } cleanup = null; }
  const [name = 'home', ...args] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const route = ROUTES[name] || ROUTES.home;
  const tab = route.tab || name;
  $$('#tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
  $('#backBtn').hidden = !route.back;
  $('#title').textContent = route.title;
  view.className = route.full ? 'full' : '';
  view.innerHTML = '';
  window.scrollTo(0, 0);
  try {
    cleanup = (await route.fn(...args)) || null;
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card danger">エラーが発生しました：${esc(e.message)}</div>`;
  }
}
const setTitle = t => { $('#title').textContent = t; };
const go = hash => { if (location.hash === hash) render(); else location.hash = hash; };

// =====================================================================
// ホーム
// =====================================================================
async function viewHome() {
  const [aircraft, flights, docs, active, activeCheck, lastBackup, pilot, alertDays, trainings, activeTraining] = await Promise.all([
    db.all('aircraft'), db.all('flights'), db.all('documents'),
    getSetting('activeFlight', null), getSetting('activeCheck', null), getSetting('lastBackup', null),
    getSetting('pilot', {}), getSetting('alertDays', ALERT_DEFAULTS), db.all('trainings'), getSetting('activeTraining', null)]);
  const monthTrain = trainings.filter(t => (t.date || '').startsWith(todayStr().slice(0, 7)));
  const monthTrainByType = sumByType(monthTrain);

  const ym = todayStr().slice(0, 7);
  const month = flights.filter(f => (f.date || '').startsWith(ym));
  const monthSec = month.reduce((s, f) => s + (f.durationSec || 0), 0);
  const totalSec = pilotHours(pilot, flights, await getSetting('extraHours', [])).total;
  const alerts = collectDeadlines(pilot, aircraft, docs).filter(x => x.st.days <= (alertDays[x.kind] ?? ALERT_DEFAULTS[x.kind]));
  const recent = [...flights].sort((a, b) => (b.takeoffAt || '').localeCompare(a.takeoffAt || '')).slice(0, 5);
  const acMap = Object.fromEntries(aircraft.map(a => [a.id, a]));
  const backupDays = lastBackup ? -daysUntil(lastBackup.slice(0, 10)) : null;

  view.innerHTML = `
    ${active ? `<a class="card ${active.landingAt ? 'warn' : 'ok'}" href="#/flight" style="display:block;color:inherit;text-decoration:none">
      <b>${active.landingAt ? '着陸済み：記録を保存してください' : '飛行中'}</b><br>
      <span class="muted">${esc(aircraftLabel(acMap[active.aircraftId]))}・離陸 ${fmtTime(active.takeoffAt)}</span></a>` : ''}
    ${activeTraining ? `<a class="card ok" href="#/train" style="display:block;color:inherit;text-decoration:none"><b>${activeTraining.endedAt ? '訓練終了：記録を保存してください' : '訓練中'}</b><br><span class="muted">${esc((activeTraining.types || []).join('・'))}・開始 ${fmtTime(activeTraining.startedAt)}</span></a>` : ''}
    ${activeCheck ? `<a class="card warn" href="#/check" style="display:block;color:inherit;text-decoration:none"><b>点検の途中です</b><br><span class="muted">タップして続ける</span></a>` : ''}
    ${!aircraft.length ? `<div class="card warn"><b>はじめに機体を登録しましょう</b>
      <p class="muted">飛行日誌は機体ごとに作成します。</p>
      <a class="btn primary block" href="#/aircraft/new">機体を登録する</a></div>` : ''}
    ${alerts.map(deadlineCard).join('')}
    ${backupDays === null || backupDays > 30 ? `<a class="card" href="#/settings" style="display:block;color:inherit;text-decoration:none">
      <b>バックアップ</b><br><span class="muted">${backupDays === null ? 'まだバックアップを取っていません' : `前回から${backupDays}日経っています`}。設定から書き出せます。</span></a>` : ''}

    <div class="grid3">
      <div class="card stat"><div class="v">${month.length}</div><div class="l">今月の飛行</div></div>
      <div class="card stat"><div class="v">${fmtDur(monthSec)}</div><div class="l">今月の飛行時間</div></div>
      <a class="card stat" href="#/hours" style="color:inherit;text-decoration:none"><div class="v">${fmtDur(totalSec)}</div><div class="l">総飛行時間 ›</div></a>
    </div>
    <a class="card" href="#/train" style="display:block;color:inherit;text-decoration:none">
      <b>今月の訓練 ${fmtDur(monthTrain.reduce((s, t) => s + (t.durationSec || 0), 0))}</b>（${monthTrain.length}回）<br>
      <span class="muted small">${TRAIN_TYPES.map(t => `${TYPE_ICON[t]} ${t} ${fmtDur(monthTrainByType[t] || 0)}`).join('　')}</span></a>

    <div class="grid2">
      <a class="btn primary" href="#/flight">✈ 飛行を記録</a>
      <a class="btn" href="#/check">☑ 点検する</a>
      <a class="btn" href="#/train">🎓 訓練</a>
      <a class="btn" href="#/map">◎ 地図・天気</a>
      <a class="btn" href="#/records">☰ 記録</a>
      <a class="btn" href="${DIPS_URL}" target="_blank" rel="noopener">DIPS 2.0 ↗</a>
    </div>

    <h2>最近の飛行</h2>
    <div class="card">${recent.length ? `<ul class="list">${recent.map(f => flightRow(f, acMap)).join('')}</ul>` : '<p class="muted">まだ記録がありません</p>'}</div>
    ${aircraft.length ? `<h2>機体ごとの総飛行時間</h2><div class="card"><ul class="list">${aircraft.filter(a => !a.retired).map(a =>
      `<li><a href="#/aircraft/${a.id}"><div class="main">${esc(aircraftLabel(a))}</div><div>${fmtDur(totalSecOf(a, flights))}</div><span class="chev">›</span></a></li>`).join('')}</ul></div>` : ''}
  `;
}

function flightRow(f, acMap) {
  return `<li><a href="#/flight-edit/${f.id}"><div class="main">
    <div>${fmtDate(f.date)} ${fmtTime(f.takeoffAt)}–${fmtTime(f.landingAt)}　<b>${fmtDur(f.durationSec)}</b></div>
    <div class="sub">${esc(aircraftLabel(acMap[f.aircraftId]))}・${esc(f.takeoffPlace || '場所未入力')}</div>
    <div>${(f.specific || []).map(s => `<span class="tag">${esc(s)}</span>`).join('')}${f.defect ? '<span class="tag danger">不具合</span>' : ''}</div>
  </div><span class="chev">›</span></a></li>`;
}

// =====================================================================
// 飛行（ストップウォッチ）
// =====================================================================
async function viewFlight() {
  const active = await getSetting('activeFlight', null);
  if (active && active.landingAt) return flightLanding(active);
  if (active) return flightActive(active);
  return flightStart();
}

async function flightStart() {
  const [aircraft, docs, pilot, prefs, pending, inspections] = await Promise.all([
    db.all('aircraft'), db.all('documents'), getSetting('pilot', {}), getSetting('lastFlightPrefs', {}),
    getSetting('pendingPlace', null), db.all('inspections')]);
  if (!aircraft.filter(a => !a.retired).length) {
    view.innerHTML = `<div class="card warn"><b>機体が登録されていません</b><p class="muted">先に機体を登録してください。</p>
      <a class="btn primary block" href="#/aircraft/new">機体を登録する</a></div>`;
    return;
  }
  if (pending) await setSetting('pendingPlace', null);
  const permits = docs.filter(d => d.type === '許可・承認' && d.number);

  view.innerHTML = `
  <form id="f">
    <div class="card">
      <label class="f"><span>機体</span><select name="aircraftId">${aircraftOptions(aircraft, prefs.aircraftId)}</select></label>
      <label class="f"><span>飛行させた者</span><input name="pilot" value="${esc(pilot.name || '')}"></label>
      <label class="f"><span>飛行目的</span><select name="purpose">${PURPOSES.map(p => `<option ${selected(p === prefs.purpose)}>${p}</option>`).join('')}</select></label>
      <div class="f"><span class="muted small">特定飛行（該当するもの）</span>${specificChips(prefs.specific)}</div>
      <label class="f"><span>許可・承認番号（特定飛行の場合）</span>
        <input name="permitNo" list="permitList" value="${esc(prefs.permitNo || '')}">
        <datalist id="permitList">${permits.map(d => `<option value="${esc(d.number)}">${esc(d.name || '')}</option>`).join('')}</datalist></label>
    </div>
    <div class="card">
      <label class="f"><span>離陸場所</span><input name="takeoffPlace" value="${esc(pending?.name || '')}" placeholder="例：〇〇市 〇〇河川敷"></label>
      <input type="hidden" name="lat" value="${esc(pending?.lat ?? '')}"><input type="hidden" name="lon" value="${esc(pending?.lon ?? '')}">
      <button type="button" class="btn sm" id="gps">📍 現在地を取得</button>
      <span id="gpsInfo" class="muted small">${pending ? `${Number(pending.lat).toFixed(5)}, ${Number(pending.lon).toFixed(5)}` : ''}</span>
    </div>
    <div id="preStatus"></div>
    <button class="btn big takeoff block" type="submit">離陸</button>
  </form>
  <a class="btn block" href="#/flight-edit/new">記録を手入力で追加</a>`;

  const form = $('#f');
  bindGps($('#gps'), form, $('#gpsInfo'));
  if (!pending) $('#gps').click();

  const showPre = () => {
    const done = inspections.some(i => i.date === todayStr() && i.aircraftId === form.aircraftId.value && i.templates?.includes('pre'));
    $('#preStatus').innerHTML = done
      ? `<div class="card ok">今日の飛行前点検：実施済み</div>`
      : `<div class="card warn">今日の飛行前点検がまだです　<a class="btn sm" href="#/check" id="toCheck">点検へ</a></div>`;
    const tc = $('#toCheck');
    if (tc) tc.addEventListener('click', () => setSetting('checkPreset', { templates: ['pre'], aircraftId: form.aircraftId.value }));
  };
  form.aircraftId.addEventListener('change', showPre);
  showPre();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const o = readForm(form);
    const active = {
      aircraftId: o.aircraftId, pilot: o.pilot, purpose: o.purpose, specific: o.specific, permitNo: o.permitNo,
      takeoffPlace: o.takeoffPlace, lat: o.lat ? Number(o.lat) : null, lon: o.lon ? Number(o.lon) : null,
      takeoffAt: new Date().toISOString(),
    };
    await setSetting('activeFlight', active);
    await setSetting('lastFlightPrefs', { aircraftId: o.aircraftId, purpose: o.purpose, specific: o.specific, permitNo: o.permitNo });
    if (o.pilot) { const p = await getSetting('pilot', {}); if (!p.name) await setSetting('pilot', { ...p, name: o.pilot }); }
    render();
    // 離陸時の天気を記録しておく（通信できないときは省略）
    if (active.lat != null) {
      fetchWeather(active.lat, active.lon).then(async w => {
        const cur = await getSetting('activeFlight', null);
        if (cur && cur.takeoffAt === active.takeoffAt) {
          cur.weather = { temp: w.current.temperature_2m, wind: w.current.wind_speed_10m, gust: w.current.wind_gusts_10m, dir: w.current.wind_direction_10m, code: w.current.weather_code };
          await setSetting('activeFlight', cur);
        }
      }).catch(() => {});
    }
  });
}

async function flightActive(active) {
  const ac = await db.get('aircraft', active.aircraftId);
  view.innerHTML = `
    <div class="card">
      <div class="muted small">飛行中</div>
      <div class="timer" id="timer">0:00:00</div>
      <dl class="kv">
        <dt>機体</dt><dd>${esc(aircraftLabel(ac))}</dd>
        <dt>離陸時刻</dt><dd>${fmtTime(active.takeoffAt)}</dd>
        <dt>離陸場所</dt><dd>${esc(active.takeoffPlace || '—')}</dd>
        ${active.specific?.length ? `<dt>特定飛行</dt><dd>${esc(active.specific.join('、'))}</dd>` : ''}
      </dl>
    </div>
    <button class="btn big land block" id="land">着陸</button>
    <div class="btn-row"><button class="btn sm danger" id="cancel">取り消し（記録しない）</button></div>`;
  const start = new Date(active.takeoffAt).getTime();
  const tick = () => { $('#timer').textContent = fmtClock((Date.now() - start) / 1000); };
  tick();
  const iv = setInterval(tick, 1000);
  $('#land').addEventListener('click', async () => {
    active.landingAt = new Date().toISOString();
    await setSetting('activeFlight', active);
    render();
  });
  $('#cancel').addEventListener('click', async () => {
    if (!confirm('この飛行を記録せずに取り消しますか？')) return;
    await setSetting('activeFlight', null);
    render();
  });
  return () => clearInterval(iv);
}

async function flightLanding(active) {
  const pilot = await getSetting('pilot', {});
  view.innerHTML = `
  <form id="f">
    <div class="card ok"><b>着陸しました</b>　飛行時間 <b id="dur"></b></div>
    <div class="card">
      <label class="f"><span>離陸時刻</span><input type="datetime-local" name="takeoffAt" value="${toLocalInput(active.takeoffAt)}"></label>
      <label class="f"><span>着陸時刻</span><input type="datetime-local" name="landingAt" value="${toLocalInput(active.landingAt)}"></label>
      <label class="f"><span>着陸場所</span><input name="landingPlace" value="${esc(active.takeoffPlace || '')}"></label>
    </div>
    <div class="card">
      <label class="f"><span>飛行の安全に影響のあった事項</span><textarea name="safetyNotes" placeholder="なし（ヒヤリハット等があれば記入）"></textarea></label>
      ${defectFields(null, active.pilot || pilot.name)}
      <label class="f"><span>メモ</span><textarea name="memo"></textarea></label>
    </div>
    <button class="btn primary block" type="submit">記録を保存</button>
    <button class="btn block" type="button" id="resume">着陸を取り消して飛行中に戻る</button>
  </form>`;
  const form = $('#f');
  bindDefect(form);
  const showDur = () => { $('#dur').textContent = fmtDur((new Date(pickTime(form.landingAt.value, active.landingAt)) - new Date(pickTime(form.takeoffAt.value, active.takeoffAt))) / 1000); };
  form.takeoffAt.addEventListener('change', showDur); form.landingAt.addEventListener('change', showDur); showDur();
  $('#resume').addEventListener('click', async () => { delete active.landingAt; await setSetting('activeFlight', active); render(); });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const o = readForm(form);
    const takeoffAt = pickTime(o.takeoffAt, active.takeoffAt), landingAt = pickTime(o.landingAt, active.landingAt);
    const durationSec = Math.round((new Date(landingAt) - new Date(takeoffAt)) / 1000);
    if (durationSec <= 0) { alert('着陸時刻が離陸時刻より前になっています'); return; }
    const flight = {
      date: ymd(new Date(takeoffAt)), aircraftId: active.aircraftId, pilot: active.pilot, purpose: active.purpose,
      specific: active.specific || [], permitNo: active.permitNo, takeoffPlace: active.takeoffPlace, landingPlace: o.landingPlace,
      takeoffAt, landingAt, durationSec, lat: active.lat, lon: active.lon, weather: active.weather || null,
      safetyNotes: o.safetyNotes, defect: readDefect(o), memo: o.memo,
    };
    await db.put('flights', flight);
    await setSetting('activeFlight', null);
    flightDone(flight);
  });
}

function flightDone(flight) {
  view.innerHTML = `
    <div class="card ok"><b>保存しました</b><br>飛行時間 ${fmtDur(flight.durationSec)}</div>
    <button class="btn primary block" id="next">続けて次の飛行（同じ設定）</button>
    <button class="btn block" id="post">飛行後点検をする</button>
    <a class="btn block" href="#/flight-edit/${flight.id}">保存した記録を見る</a>
    <a class="btn block" href="#/home">ホームへ</a>`;
  $('#next').addEventListener('click', async () => {
    await setSetting('pendingPlace', { name: flight.landingPlace || flight.takeoffPlace, lat: flight.lat, lon: flight.lon });
    render();
  });
  $('#post').addEventListener('click', async () => {
    await setSetting('checkPreset', { templates: ['post'], aircraftId: flight.aircraftId, place: flight.landingPlace });
    go('#/check');
  });
}

// =====================================================================
// 飛行記録の編集
// =====================================================================
async function viewFlightEdit(id) {
  const isNew = id === 'new';
  const [aircraft, pilot, prefs] = await Promise.all([db.all('aircraft'), getSetting('pilot', {}), getSetting('lastFlightPrefs', {})]);
  const now = new Date().toISOString();
  const f = isNew
    ? { aircraftId: prefs.aircraftId, pilot: pilot.name, purpose: prefs.purpose, specific: [], takeoffAt: new Date(Date.now() - 600000).toISOString(), landingAt: now }
    : await db.get('flights', id);
  if (!f) { view.innerHTML = '<div class="card">記録が見つかりません</div>'; return; }
  setTitle(isNew ? '飛行記録を追加' : '飛行記録');

  view.innerHTML = `
  <form id="f">
    <div class="card">
      <label class="f"><span>機体</span><select name="aircraftId">${aircraftOptions(aircraft, f.aircraftId)}</select></label>
      <label class="f"><span>飛行させた者</span><input name="pilot" value="${esc(f.pilot)}"></label>
      <label class="f"><span>飛行目的</span><select name="purpose">${PURPOSES.map(p => `<option ${selected(p === f.purpose)}>${p}</option>`).join('')}</select></label>
      <div class="f"><span class="muted small">特定飛行</span>${specificChips(f.specific)}</div>
      <label class="f"><span>許可・承認番号</span><input name="permitNo" value="${esc(f.permitNo)}"></label>
    </div>
    <div class="card">
      <label class="f"><span>離陸場所</span><input name="takeoffPlace" value="${esc(f.takeoffPlace)}"></label>
      <label class="f"><span>離陸時刻</span><input type="datetime-local" name="takeoffAt" value="${toLocalInput(f.takeoffAt)}"></label>
      <label class="f"><span>着陸場所</span><input name="landingPlace" value="${esc(f.landingPlace)}"></label>
      <label class="f"><span>着陸時刻</span><input type="datetime-local" name="landingAt" value="${toLocalInput(f.landingAt)}"></label>
      <p>飛行時間：<b id="dur"></b></p>
      ${f.lat != null ? `<p class="muted small">位置 ${Number(f.lat).toFixed(5)}, ${Number(f.lon).toFixed(5)}</p>` : ''}
      ${f.weather ? `<p class="muted small">離陸時の天気：${wxLabel(f.weather.code)} ${f.weather.temp}℃ 風 ${f.weather.wind}m/s（突風 ${f.weather.gust}m/s）</p>` : ''}
    </div>
    <div class="card">
      <label class="f"><span>飛行の安全に影響のあった事項</span><textarea name="safetyNotes">${esc(f.safetyNotes)}</textarea></label>
      ${defectFields(f.defect, f.pilot)}
      <label class="f"><span>メモ</span><textarea name="memo">${esc(f.memo)}</textarea></label>
    </div>
    <button class="btn primary block" type="submit">保存</button>
    ${isNew ? '' : '<button class="btn danger block" type="button" id="del">削除</button>'}
  </form>`;
  const form = $('#f');
  bindDefect(form);
  const showDur = () => { $('#dur').textContent = fmtDur((new Date(pickTime(form.landingAt.value, f.landingAt)) - new Date(pickTime(form.takeoffAt.value, f.takeoffAt))) / 1000); };
  form.takeoffAt.addEventListener('change', showDur); form.landingAt.addEventListener('change', showDur); showDur();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const o = readForm(form);
    if (!o.aircraftId) { alert('機体を選んでください'); return; }
    const takeoffAt = pickTime(o.takeoffAt, isNew ? null : f.takeoffAt), landingAt = pickTime(o.landingAt, isNew ? null : f.landingAt);
    const durationSec = Math.round((new Date(landingAt) - new Date(takeoffAt)) / 1000);
    if (durationSec <= 0) { alert('着陸時刻が離陸時刻より前になっています'); return; }
    Object.assign(f, {
      aircraftId: o.aircraftId, pilot: o.pilot, purpose: o.purpose, specific: o.specific, permitNo: o.permitNo,
      takeoffPlace: o.takeoffPlace, landingPlace: o.landingPlace, takeoffAt, landingAt, durationSec,
      date: ymd(new Date(takeoffAt)), safetyNotes: o.safetyNotes, defect: readDefect(o), memo: o.memo,
    });
    await db.put('flights', f);
    toast('保存しました');
    history.back();
  });
  $('#del')?.addEventListener('click', async () => {
    if (!confirm('この飛行記録を削除しますか？（元に戻せません）')) return;
    await db.remove('flights', f.id);
    toast('削除しました');
    history.back();
  });
}

// =====================================================================
// 点検（チェックリスト）
// =====================================================================
async function viewCheck() {
  const active = await getSetting('activeCheck', null);
  if (active) return checkRun(active);
  return checkSetup();
}

// 「基本」ボタンは選択を置き換え、「＋限定」ボタンはその項目を追加・解除する
const CHECK_PRESETS = [
  { label: '二等 飛行前', tpl: ['pre', 'exam2'] },
  { label: '一等 飛行前', tpl: ['pre', 'exam2', 'exam1'] },
  { label: '飛行後', tpl: ['post'] },
  { label: '＋目視外', add: 'bvlos' },
  { label: '＋夜間', add: 'night' },
  { label: '＋25kg以上', add: 'heavy' },
];

async function checkSetup() {
  const [lists, aircraft, pilot, preset, prefs] = await Promise.all([
    getChecklists(), db.all('aircraft'), getSetting('pilot', {}), getSetting('checkPreset', null), getSetting('lastFlightPrefs', {})]);
  if (preset) await setSetting('checkPreset', null);
  const sel = preset?.templates || (pilot.targetClass === '一等' || pilot.licenseClass === '一等' ? ['pre', 'exam2', 'exam1'] : ['pre']);
  view.innerHTML = `
  <form id="f">
    <div class="card">
      <div class="muted small">よく使う組み合わせ</div>
      <div class="chips" style="margin:6px 0 10px">${CHECK_PRESETS.map((p, i) => `<button type="button" class="btn sm" data-preset="${i}">${p.label}</button>`).join('')}</div>
      <div class="muted small">点検するチェックリスト</div>
      ${lists.map(l => `<label class="chk"><input type="checkbox" name="tpl" value="${esc(l.id)}" ${checked(sel.includes(l.id))}>
        <span>${esc(l.name)}<br><span class="muted small">${esc(l.note || '')}（${parseChecklist(l.text).reduce((s, x) => s + x.items.length, 0)}項目）</span></span></label>`).join('')}
    </div>
    <div class="card">
      <label class="f"><span>機体</span><select name="aircraftId">${aircraftOptions(aircraft, preset?.aircraftId || prefs.aircraftId, { includeNone: true })}</select></label>
      <label class="f"><span>点検場所</span><input name="place" value="${esc(preset?.place || '')}"></label>
      <input type="hidden" name="lat"><input type="hidden" name="lon">
      <button type="button" class="btn sm" id="gps">📍 現在地を取得</button> <span id="gpsInfo" class="muted small"></span>
      <label class="f"><span>実施者</span><input name="inspector" value="${esc(pilot.name || '')}"></label>
    </div>
    <button class="btn primary block" type="submit">点検をはじめる</button>
    <a class="btn block" href="#/records/inspections">過去の点検記録</a>
    <p class="muted small">チェックリストの項目は「⚙ 設定 → 点検チェックリスト」で変更できます。試験項目はスクールの教材・実施細則に合わせて調整してください。</p>
  </form>`;
  const form = $('#f');
  bindGps($('#gps'), form, $('#gpsInfo'));
  $$('[data-preset]').forEach(b => b.addEventListener('click', () => {
    const p = CHECK_PRESETS[b.dataset.preset];
    $$('input[name=tpl]', form).forEach(c => {
      if (p.tpl) c.checked = p.tpl.includes(c.value);
      else if (c.value === p.add) c.checked = !c.checked;
    });
  }));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const templates = fd.getAll('tpl');
    if (!templates.length) { alert('チェックリストを1つ以上選んでください'); return; }
    await setSetting('activeCheck', {
      templates, aircraftId: fd.get('aircraftId'), place: fd.get('place'), inspector: fd.get('inspector'),
      startedAt: new Date().toISOString(), results: {}, notes: '',
    });
    render();
  });
}

async function checkRun(active) {
  const lists = (await getChecklists()).filter(l => active.templates.includes(l.id));
  const ac = active.aircraftId ? await db.get('aircraft', active.aircraftId) : null;
  const all = [];
  const body = lists.map(l => {
    const secs = parseChecklist(l.text);
    return `<h2>${esc(l.name)}</h2>` + secs.map((s, si) => `
      <div class="card">${s.title ? `<h3 style="margin-top:0">${esc(s.title)}</h3>` : ''}
      ${s.items.map((it, ii) => {
        const k = `${l.id}|${si}|${ii}`;
        all.push({ k, tpl: l.id, tplName: l.name, section: s.title, item: it });
        const r = active.results[k];
        return `<div class="chk"><button type="button" class="tri ${r || ''}" data-k="${esc(k)}">${triIcon(r)}</button><span>${esc(it)}</span></div>`;
      }).join('')}</div>`).join('');
  }).join('');

  view.innerHTML = `
    <div class="check-head card">
      <div><b id="prog"></b>　<span class="muted small">経過 <span id="elapsed"></span></span></div>
      <div class="muted small">${esc(aircraftLabel(ac))}・${esc(active.place || '')}　タップ：未 → 正常 ✓ → 異常 ✕</div>
    </div>
    ${body}
    <div class="card">
      <label class="f"><span>特記事項</span><textarea id="notes">${esc(active.notes)}</textarea></label>
    </div>
    <button class="btn block" id="allOk">未確認を「正常」にする</button>
    <button class="btn primary block" id="save">保存して終了</button>
    <button class="btn danger block" id="abort">中止（保存しない）</button>`;

  const prog = () => {
    const done = all.filter(a => active.results[a.k]).length;
    const ng = all.filter(a => active.results[a.k] === 'ng').length;
    $('#prog').textContent = `${done} / ${all.length} 項目${ng ? `（異常 ${ng}）` : ''}`;
  };
  prog();
  const start = new Date(active.startedAt).getTime();
  const tick = () => { $('#elapsed').textContent = fmtClock((Date.now() - start) / 1000); };
  tick();
  const iv = setInterval(tick, 1000);

  view.addEventListener('click', onTri);
  async function onTri(e) {
    const b = e.target.closest('.tri');
    if (!b) return;
    const next = { undefined: 'ok', ok: 'ng', ng: undefined }[active.results[b.dataset.k]];
    if (next) active.results[b.dataset.k] = next; else delete active.results[b.dataset.k];
    b.className = `tri ${next || ''}`; b.textContent = triIcon(next);
    prog();
    await setSetting('activeCheck', active);
  }
  $('#notes').addEventListener('change', async e => { active.notes = e.target.value; await setSetting('activeCheck', active); });
  $('#allOk').addEventListener('click', async () => {
    all.forEach(a => { if (!active.results[a.k]) active.results[a.k] = 'ok'; });
    await setSetting('activeCheck', active);
    render();
  });
  $('#abort').addEventListener('click', async () => {
    if (!confirm('点検を中止しますか？（記録は保存されません）')) return;
    await setSetting('activeCheck', null); render();
  });
  $('#save').addEventListener('click', async () => {
    active.notes = $('#notes').value;
    const none = all.filter(a => !active.results[a.k]).length;
    if (none && !confirm(`未確認の項目が ${none} 件あります。このまま保存しますか？`)) return;
    const results = all.map(a => ({ tpl: a.tpl, tplName: a.tplName, section: a.section, item: a.item, result: active.results[a.k] || 'none' }));
    const rec = {
      date: ymd(new Date(active.startedAt)), startedAt: active.startedAt, finishedAt: new Date().toISOString(),
      elapsedSec: Math.round((Date.now() - start) / 1000), aircraftId: active.aircraftId, place: active.place,
      inspector: active.inspector, templates: active.templates, templateNames: lists.map(l => l.name),
      results, ngCount: results.filter(r => r.result === 'ng').length, noneCount: none, notes: active.notes,
    };
    await db.put('inspections', rec);
    await setSetting('activeCheck', null);
    toast('点検記録を保存しました');
    go(`#/inspection/${rec.id}`);
  });
  return () => { clearInterval(iv); view.removeEventListener('click', onTri); };
}
const triIcon = r => (r === 'ok' ? '✓' : r === 'ng' ? '✕' : '未');

async function viewInspection(id) {
  const r = await db.get('inspections', id);
  if (!r) { view.innerHTML = '<div class="card">記録が見つかりません</div>'; return; }
  const ac = r.aircraftId ? await db.get('aircraft', r.aircraftId) : null;
  let lastSec = null;
  const items = r.results.map(x => {
    const head = x.tplName + (x.section ? ` / ${x.section}` : '');
    const h = head !== lastSec ? `<h3>${esc(head)}</h3>` : '';
    lastSec = head;
    return `${h}<div class="chk"><span class="tri ${x.result === 'none' ? '' : x.result}">${triIcon(x.result === 'none' ? undefined : x.result)}</span><span>${esc(x.item)}</span></div>`;
  }).join('');
  view.innerHTML = `
    <div class="card ${r.ngCount ? 'danger' : r.noneCount ? 'warn' : 'ok'}">
      <b>${r.ngCount ? `異常 ${r.ngCount} 件` : r.noneCount ? `未確認 ${r.noneCount} 件` : '全項目 正常'}</b>
    </div>
    <div class="card"><dl class="kv">
      <dt>実施日</dt><dd>${fmtDate(r.date)} ${fmtTime(r.startedAt)}</dd>
      <dt>所要時間</dt><dd>${fmtClock(r.elapsedSec || 0)}</dd>
      <dt>機体</dt><dd>${esc(aircraftLabel(ac))}</dd>
      <dt>場所</dt><dd>${esc(r.place || '—')}</dd>
      <dt>実施者</dt><dd>${esc(r.inspector || '—')}</dd>
      <dt>内容</dt><dd>${esc(r.templateNames.join('、'))}</dd>
    </dl></div>
    <div class="card">${items}</div>
    <div class="card"><label class="f"><span>特記事項</span><textarea id="notes">${esc(r.notes)}</textarea></label>
      <button class="btn sm" id="saveNotes">特記事項を保存</button></div>
    <button class="btn danger block" id="del">削除</button>`;
  $('#saveNotes').addEventListener('click', async () => { r.notes = $('#notes').value; await db.put('inspections', r); toast('保存しました'); });
  $('#del').addEventListener('click', async () => {
    if (!confirm('この点検記録を削除しますか？')) return;
    await db.remove('inspections', r.id); history.back();
  });
}

// =====================================================================
// 記録一覧
// =====================================================================
let recFilter = '';
async function viewRecords(kind = 'flights') {
  const [aircraft, flights, inspections, maint, trainings] = await Promise.all([
    db.all('aircraft'), db.all('flights'), db.all('inspections'), db.all('maintenance'), db.all('trainings')]);
  const acMap = Object.fromEntries(aircraft.map(a => [a.id, a]));
  const flt = x => !recFilter || x.aircraftId === recFilter;
  let list = '', summary = '', addHref = '';
  if (kind === 'flights') {
    const fs = flights.filter(flt).sort((a, b) => (b.takeoffAt || '').localeCompare(a.takeoffAt || ''));
    summary = `${fs.length} 件・合計 ${fmtDur(fs.reduce((s, f) => s + (f.durationSec || 0), 0))}`;
    list = fs.map(f => flightRow(f, acMap)).join('');
    addHref = '#/flight-edit/new';
  } else if (kind === 'inspections') {
    const is = inspections.filter(flt).sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
    summary = `${is.length} 件`;
    list = is.map(r => `<li><a href="#/inspection/${r.id}"><div class="main">
      <div>${fmtDate(r.date)} ${fmtTime(r.startedAt)}　${r.ngCount ? `<span class="tag danger">異常${r.ngCount}</span>` : r.noneCount ? `<span class="tag warn">未確認${r.noneCount}</span>` : '<span class="tag ok">正常</span>'}</div>
      <div class="sub">${esc(r.templateNames.join('、'))}</div>
      <div class="sub">${esc(aircraftLabel(acMap[r.aircraftId]))}</div></div><span class="chev">›</span></a></li>`).join('');
    addHref = '#/check';
  } else if (kind === 'trainings') {
    const ts = trainings.filter(flt).sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
    const by = sumByType(ts);
    summary = `${ts.length} 件・合計 ${fmtDur(ts.reduce((s, t) => s + (t.durationSec || 0), 0))}（${TRAIN_TYPES.map(t => `${t} ${fmtDur(by[t] || 0)}`).join('・')}）`;
    list = ts.map(trainRow).join('');
    addHref = '#/train-edit/new';
  } else {
    const ms = maint.filter(flt).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    summary = `${ms.length} 件`;
    list = ms.map(m => `<li><a href="#/maint/${m.id}"><div class="main">
      <div>${fmtDate(m.date)}　${esc(m.reason || '')}</div>
      <div class="sub">${esc((m.content || '').slice(0, 40))}</div>
      <div class="sub">${esc(aircraftLabel(acMap[m.aircraftId]))}</div></div><span class="chev">›</span></a></li>`).join('');
    addHref = '#/maint/new';
  }
  view.innerHTML = `
    <div class="seg">
      <button data-k="flights" class="${kind === 'flights' ? 'on' : ''}">飛行記録</button>
      <button data-k="inspections" class="${kind === 'inspections' ? 'on' : ''}">日常点検</button>
      <button data-k="maint" class="${kind === 'maint' ? 'on' : ''}">点検整備</button>
      <button data-k="trainings" class="${kind === 'trainings' ? 'on' : ''}">訓練</button>
    </div>
    <select id="acf">${aircraftOptions(aircraft, recFilter, { includeAll: true })}</select>
    <div class="btn-row"><a class="btn" href="${addHref}">＋ 追加</a><a class="btn" href="#/print">🖨 印刷・PDF</a></div>
    <p class="muted small">${summary}</p>
    <div class="card">${list ? `<ul class="list">${list}</ul>` : '<p class="muted">記録がありません</p>'}</div>`;
  $$('.seg button').forEach(b => b.addEventListener('click', () => go(`#/records/${b.dataset.k}`)));
  $('#acf').addEventListener('change', e => { recFilter = e.target.value; render(); });
}

async function viewMaintEdit(id) {
  const isNew = id === 'new';
  const [aircraft, flights, pilot, prefs] = await Promise.all([db.all('aircraft'), db.all('flights'), getSetting('pilot', {}), getSetting('lastFlightPrefs', {})]);
  const m = isNew ? { date: todayStr(), aircraftId: recFilter || prefs.aircraftId, worker: pilot.name } : await db.get('maintenance', id);
  if (!m) { view.innerHTML = '<div class="card">記録が見つかりません</div>'; return; }
  setTitle(isNew ? '点検整備記録を追加' : '点検整備記録');
  view.innerHTML = `
  <form id="f"><div class="card">
    <label class="f"><span>機体</span><select name="aircraftId">${aircraftOptions(aircraft, m.aircraftId)}</select></label>
    <label class="f"><span>実施年月日</span><input type="date" name="date" value="${esc(m.date)}"></label>
    <p class="muted small">その時点の総飛行時間：<span id="tt"></span></p>
    <label class="f"><span>実施理由</span><select name="reason">${['定期点検', '修理', '改造', '整備', '部品交換', 'その他'].map(r => `<option ${selected(r === m.reason)}>${r}</option>`).join('')}</select></label>
    <label class="f"><span>点検・修理・改造・整備の内容</span><textarea name="content">${esc(m.content)}</textarea></label>
    <label class="f"><span>実施場所</span><input name="place" value="${esc(m.place)}"></label>
    <label class="f"><span>実施者</span><input name="worker" value="${esc(m.worker)}"></label>
    <label class="f"><span>備考</span><textarea name="memo">${esc(m.memo)}</textarea></label>
  </div>
  <button class="btn primary block" type="submit">保存</button>
  ${isNew ? '' : '<button class="btn danger block" type="button" id="del">削除</button>'}</form>`;
  const form = $('#f');
  const showTT = () => {
    const ac = aircraft.find(a => a.id === form.aircraftId.value);
    const until = new Date(parseDate(form.date.value).getTime() + 86400000).toISOString();
    $('#tt').textContent = ac ? fmtDur(totalSecOf(ac, flights, until)) : '—';
  };
  form.aircraftId.addEventListener('change', showTT); form.date.addEventListener('change', showTT); showTT();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const o = Object.fromEntries(new FormData(form));
    const ac = aircraft.find(a => a.id === o.aircraftId);
    const until = new Date(parseDate(o.date).getTime() + 86400000).toISOString();
    Object.assign(m, o, { totalSecAt: totalSecOf(ac, flights, until) });
    await db.put('maintenance', m); toast('保存しました'); history.back();
  });
  $('#del')?.addEventListener('click', async () => {
    if (!confirm('この記録を削除しますか？')) return;
    await db.remove('maintenance', m.id); history.back();
  });
}

// =====================================================================
// 印刷（飛行日誌の様式で PDF 保存）
// =====================================================================
async function viewPrint() {
  const aircraft = await db.all('aircraft');
  const d = new Date(); d.setMonth(d.getMonth() - 1);
  view.innerHTML = `
  <form id="f"><div class="card">
    <label class="f"><span>機体</span><select name="aircraftId">${aircraftOptions(aircraft, recFilter, { includeAll: true })}</select></label>
    <div class="grid2">
      <label class="f"><span>開始日</span><input type="date" name="from" value="${ymd(d)}"></label>
      <label class="f"><span>終了日</span><input type="date" name="to" value="${todayStr()}"></label>
    </div>
    <label class="chk"><input type="checkbox" name="flights" checked><span>飛行記録</span></label>
    <label class="chk"><input type="checkbox" name="inspections" checked><span>日常点検記録</span></label>
    <label class="chk"><input type="checkbox" name="maint" checked><span>点検整備記録</span></label>
    <label class="chk"><input type="checkbox" name="trainings"><span>訓練記録（機体に関係なく全件）</span></label>
  </div>
  <button class="btn primary block" type="submit">印刷・PDF保存</button></form>
  <div class="card muted small">
    <b>iPhone で PDF にする方法</b><br>
    印刷画面が開いたら、右上の共有ボタン（□↑）→「"ファイル"に保存」を選ぶと PDF として保存できます。
    立入検査等で提示を求められたときにも使えます。
  </div>`;
  $('#f').addEventListener('submit', async e => {
    e.preventDefault();
    const o = Object.fromEntries(new FormData(e.target));
    $('#print-area').innerHTML = await buildPrint(o);
    window.print();
  });
}

async function buildPrint(o) {
  const [aircraft, flights, inspections, maint] = await Promise.all([db.all('aircraft'), db.all('flights'), db.all('inspections'), db.all('maintenance')]);
  const targets = o.aircraftId ? aircraft.filter(a => a.id === o.aircraftId) : aircraft.filter(a => !a.retired);
  const inRange = date => (!o.from || date >= o.from) && (!o.to || date <= o.to);
  const t = esc;
  let html = '';
  targets.forEach((ac, idx) => {
    const head = `<p>登録記号：${t(ac.regNo || '')}　機体：${t(ac.name)}　製造者：${t(ac.maker || '')}　型式：${t(ac.model || '')}　製造番号：${t(ac.serial || '')}</p>`;
    let first = true;
    const section = title => { const cls = first && idx === 0 ? '' : ' class="pb"'; first = false; return `<h1${cls}>${title}</h1>${head}`; };
    if (o.flights) {
      const fs = flights.filter(f => f.aircraftId === ac.id).sort((a, b) => a.takeoffAt.localeCompare(b.takeoffAt));
      let cum = (Number(ac.baseMinutes) || 0) * 60;
      const rows = [];
      for (const f of fs) {
        cum += f.durationSec || 0;
        if (!inRange(f.date)) continue;
        rows.push(`<tr><td>${fmtDate(f.date)}</td><td>${t(f.pilot)}</td>
          <td>${t(f.purpose)}${f.specific?.length ? `<br>特定飛行：${t(f.specific.join('、'))}` : ''}${f.permitNo ? `<br>許可承認番号：${t(f.permitNo)}` : ''}</td>
          <td>${t(f.takeoffPlace)}</td><td>${fmtTime(f.takeoffAt)}</td><td>${t(f.landingPlace)}</td><td>${fmtTime(f.landingAt)}</td>
          <td>${fmtDur(f.durationSec)}</td><td>${fmtDur(cum)}</td><td>${t(f.safetyNotes || 'なし')}</td>
          <td>${f.defect ? `${fmtDate(f.defect.date)}<br>${t(f.defect.content)}` : 'なし'}</td>
          <td>${f.defect ? `${t(f.defect.action)}<br>確認者：${t(f.defect.confirmer)}` : ''}</td></tr>`);
      }
      html += `${section('飛行記録')}<table><thead><tr><th>飛行年月日</th><th>飛行させた者の氏名</th><th>飛行概要</th><th>離陸場所</th><th>離陸時刻</th>
        <th>着陸場所</th><th>着陸時刻</th><th>飛行時間</th><th>総飛行時間</th><th>飛行の安全に影響のあった事項</th><th>不具合事項</th><th>処置・確認</th></tr></thead>
        <tbody>${rows.join('') || '<tr><td colspan="12">該当なし</td></tr>'}</tbody></table>`;
    }
    if (o.inspections) {
      const is = inspections.filter(r => r.aircraftId === ac.id && inRange(r.date)).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      html += `${section('日常点検記録')}<table><thead><tr><th>実施年月日</th><th>点検場所</th><th>実施者</th><th>点検の種類</th><th>点検項目と結果</th><th>特記事項</th></tr></thead><tbody>
        ${is.map(r => `<tr><td>${fmtDate(r.date)}<br>${fmtTime(r.startedAt)}</td><td>${t(r.place)}</td><td>${t(r.inspector)}</td><td>${t(r.templateNames.join('、'))}</td>
          <td>${r.results.map(x => `${t(x.item.split('：')[0])}：${x.result === 'ok' ? '正常' : x.result === 'ng' ? '<b>異常</b>' : '未確認'}`).join(' ／ ')}</td>
          <td>${t(r.notes)}</td></tr>`).join('') || '<tr><td colspan="6">該当なし</td></tr>'}</tbody></table>`;
    }
    if (o.maint) {
      const ms = maint.filter(m => m.aircraftId === ac.id && inRange(m.date)).sort((a, b) => a.date.localeCompare(b.date));
      html += `${section('点検整備記録')}<table><thead><tr><th>実施年月日</th><th>総飛行時間</th><th>点検・修理・改造・整備の内容</th><th>実施理由</th><th>実施場所</th><th>実施者</th><th>備考</th></tr></thead><tbody>
        ${ms.map(m => `<tr><td>${fmtDate(m.date)}</td><td>${fmtDur(m.totalSecAt)}</td><td>${t(m.content)}</td><td>${t(m.reason)}</td><td>${t(m.place)}</td><td>${t(m.worker)}</td><td>${t(m.memo)}</td></tr>`).join('')
          || '<tr><td colspan="7">該当なし</td></tr>'}</tbody></table>`;
    }
  });
  if (o.trainings) {
    const ts = (await db.all('trainings')).filter(x => inRange(x.date)).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const acMap = Object.fromEntries(aircraft.map(a => [a.id, a]));
    html += `<h1${html ? ' class="pb"' : ''}>訓練記録</h1><table><thead><tr><th>実施日</th><th>時間</th><th>訓練時間</th><th>種目</th><th>機体</th><th>実施した内容</th><th>評価</th><th>メモ</th></tr></thead><tbody>
      ${ts.map(x => `<tr><td>${fmtDate(x.date)}</td><td>${fmtTime(x.startedAt)}–${fmtTime(x.endedAt)}</td><td>${fmtDur(x.durationSec)}</td>
        <td>${t((x.types || []).join('・'))}</td><td>${t(x.aircraftId ? aircraftLabel(acMap[x.aircraftId]) : '')}</td>
        <td>${t((x.items || []).filter(i => i.done && i.type !== '休憩').map(i => i.title).join('／'))}</td><td>${t(x.rating)}</td><td>${t(x.memo)}</td></tr>`).join('')
        || '<tr><td colspan="8">該当なし</td></tr>'}</tbody></table>`;
  }
  return html || '<p>印刷する機体がありません</p>';
}

// =====================================================================
// 地図・天気
// =====================================================================
const WX = {
  0: ['☀️', '快晴'], 1: ['🌤', '晴れ'], 2: ['⛅', '晴れ時々曇り'], 3: ['☁️', '曇り'], 45: ['🌫', '霧'], 48: ['🌫', '霧'],
  51: ['🌦', '霧雨'], 53: ['🌦', '霧雨'], 55: ['🌦', '霧雨'], 56: ['🌧', '着氷性の霧雨'], 57: ['🌧', '着氷性の霧雨'],
  61: ['🌧', '弱い雨'], 63: ['🌧', '雨'], 65: ['🌧', '強い雨'], 66: ['🌧', '着氷性の雨'], 67: ['🌧', '着氷性の雨'],
  71: ['🌨', '弱い雪'], 73: ['🌨', '雪'], 75: ['🌨', '強い雪'], 77: ['🌨', '霧雪'],
  80: ['🌦', 'にわか雨'], 81: ['🌧', 'にわか雨'], 82: ['⛈', '激しいにわか雨'], 85: ['🌨', 'にわか雪'], 86: ['🌨', 'にわか雪'],
  95: ['⛈', '雷雨'], 96: ['⛈', '雷雨（ひょう）'], 99: ['⛈', '雷雨（ひょう）'],
};
const wxIcon = c => (WX[c] || ['❔'])[0];
const wxLabel = c => (WX[c] || ['', '不明']).join(' ');
const DIRS = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
const dirName = deg => (deg == null ? '' : DIRS[Math.round(deg / 22.5) % 16]);

async function fetchWeather(lat, lon) {
  const p = new URLSearchParams({
    latitude: Number(lat).toFixed(4), longitude: Number(lon).toFixed(4),
    current: 'temperature_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    hourly: 'temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_speed_80m,wind_speed_120m,wind_direction_10m,wind_gusts_10m,visibility',
    daily: 'sunrise,sunset', wind_speed_unit: 'ms', timezone: 'Asia/Tokyo', forecast_days: '2',
  });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`);
  if (!r.ok) throw new Error(`天気の取得に失敗しました（${r.status}）`);
  return r.json();
}

function tileXY(lat, lon, z) {
  const n = 2 ** z, rad = lat * Math.PI / 180;
  const fx = (lon + 180) / 360 * n;
  const fy = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n;
  return { x: Math.floor(fx), y: Math.floor(fy), px: Math.floor((fx % 1) * 256), py: Math.floor((fy % 1) * 256) };
}

// 人口集中地区：地理院の DID タイル画像で、その地点のピクセルに色があるかを見る
// 戻り値：true＝区域内、false＝区域外、null＝確認できない（通信エラー等）
async function checkDID(lat, lon) {
  const { x, y, px, py } = tileXY(lat, lon, 14);
  try {
    const r = await fetch(`https://cyberjapandata.gsi.go.jp/xyz/did2020/14/${x}/${y}.png`);
    if (r.status === 404) return false; // タイルが無い＝周辺に DID が無い
    if (!r.ok) return null;
    const bmp = await createImageBitmap(await r.blob());
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    return g.getImageData(px, py, 1, 1).data[3] > 0;
  } catch { return null; }
}

// 空港等の周辺空域：地理院の「空港等の周辺空域」データ（ズーム8のタイル）
const kokuCache = new Map();
async function loadKoku(x, y) {
  const key = `${x}/${y}`;
  if (!kokuCache.has(key)) {
    // 404＝その範囲に空港等の周辺空域が無い。通信エラーは null（確認できない）
    kokuCache.set(key, fetch(`https://cyberjapandata.gsi.go.jp/xyz/kokuarea/8/${x}/${y}.geojson`)
      .then(r => {
        if (r.status === 404) return { type: 'FeatureCollection', features: [] };
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .catch(() => { kokuCache.delete(key); return null; }));
  }
  return kokuCache.get(key);
}
function inRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPoly = (pt, rings) => inRing(pt, rings[0]) && !rings.slice(1).some(h => inRing(pt, h));
async function checkAirspace(lat, lon) {
  const { x, y } = tileXY(lat, lon, 8);
  const gj = await loadKoku(x, y);
  if (!gj) return null;
  const pt = [lon, lat], hits = [];
  for (const f of gj.features) {
    const g = f.geometry; if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    const p = polys.find(rings => inPoly(pt, rings));
    if (!p) continue;
    const hs = p[0].map(c => c[2]).filter(v => v > 0); // 0 は高さ未設定
    hits.push({ name: f.properties?.name || '名称不明', min: hs.length ? Math.min(...hs) : null, max: hs.length ? Math.max(...hs) : null });
  }
  return hits;
}

async function viewMap() {
  const st = await getSetting('mapState', { lat: 35.681, lon: 139.767, z: 12, base: 'std', did: false, airport: false });
  const wind = await getSetting('windLimits', { warn: 5, stop: 10 });
  view.innerHTML = `
    <div id="mapWrap"><div id="map"></div>
      <div class="map-tools">
        <button data-act="locate">📍 現在地</button>
        <button data-base="std">標準</button><button data-base="photo">写真</button><button data-base="osm">OSM</button>
        <button data-ov="did">DID</button><button data-ov="airport">空港周辺</button>
      </div>
      <div class="legend" id="legend" hidden></div>
    </div>
    <div class="map-panel" id="panel"><p class="muted">地図をタップするか「📍 現在地」を押すと、その地点の天気・風速と規制の目安を表示します。</p></div>`;

  const map = L.map('map', { preferCanvas: true, zoomControl: true }).setView([st.lat, st.lon], st.z);
  const gsiAttr = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>';
  const bases = {
    std: L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', { maxZoom: 18, attribution: gsiAttr }),
    photo: L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg', { maxZoom: 18, attribution: gsiAttr }),
    osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }),
  };
  const didLayer = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/did2020/{z}/{x}/{y}.png',
    { minZoom: 8, maxNativeZoom: 14, maxZoom: 19, opacity: 0.45, attribution: '人口集中地区（令和2年国勢調査）' });
  const airportGroup = L.layerGroup();
  const loadedKoku = new Set();
  let marker = null;

  const setBase = b => {
    Object.values(bases).forEach(l => map.removeLayer(l));
    bases[b].addTo(map); st.base = b;
    $$('[data-base]').forEach(x => x.classList.toggle('on', x.dataset.base === b));
  };
  const updateLegend = () => {
    const parts = [];
    if (st.did) parts.push('<span style="color:#d33">■</span> 人口集中地区（DID）');
    if (st.airport) parts.push(map.getZoom() >= 8 ? '<span style="color:#0a0">■</span> 空港等の周辺空域' : '空港周辺：拡大すると表示');
    $('#legend').innerHTML = parts.join('<br>'); $('#legend').hidden = !parts.length;
  };
  const refreshAirport = async () => {
    if (!st.airport || map.getZoom() < 8) return;
    const b = map.getBounds();
    const a = tileXY(b.getNorth(), b.getWest(), 8), c = tileXY(b.getSouth(), b.getEast(), 8);
    for (let x = a.x; x <= c.x; x++) for (let y = a.y; y <= c.y; y++) {
      const key = `${x}/${y}`;
      if (loadedKoku.has(key)) continue;
      loadedKoku.add(key);
      const gj = await loadKoku(x, y);
      if (!gj) { loadedKoku.delete(key); continue; }
      L.geoJSON(gj, {
        style: f => ({ color: f.properties._color || '#008800', weight: 1, opacity: 0.6, fillColor: f.properties._fillColor || '#00ff00', fillOpacity: 0.15 }),
        onEachFeature: (f, l) => l.bindTooltip(esc(f.properties.name || ''), { sticky: true }),
        interactive: false,
      }).addTo(airportGroup);
    }
  };
  const setOverlay = (k, on) => {
    st[k] = on;
    $(`[data-ov=${k}]`).classList.toggle('on', on);
    const layer = k === 'did' ? didLayer : airportGroup;
    if (on) layer.addTo(map); else map.removeLayer(layer);
    if (k === 'airport') refreshAirport();
    updateLegend();
  };
  const saveState = () => {
    const c = map.getCenter();
    setSetting('mapState', { ...st, lat: c.lat, lon: c.lng, z: map.getZoom() });
  };

  setBase(st.base);
  setOverlay('did', st.did);
  setOverlay('airport', st.airport);
  map.on('moveend', () => { saveState(); refreshAirport(); updateLegend(); });

  $$('[data-base]').forEach(b => b.addEventListener('click', () => { setBase(b.dataset.base); saveState(); }));
  $$('[data-ov]').forEach(b => b.addEventListener('click', () => { setOverlay(b.dataset.ov, !st[b.dataset.ov]); saveState(); }));
  $('[data-act=locate]').addEventListener('click', async () => {
    try {
      const p = await getPosition();
      map.setView([p.lat, p.lon], Math.max(map.getZoom(), 15));
      selectPoint(p.lat, p.lon);
    } catch (e) { toast(e.message); }
  });
  map.on('click', e => selectPoint(e.latlng.lat, e.latlng.lng));

  async function selectPoint(lat, lon) {
    if (marker) marker.setLatLng([lat, lon]);
    else marker = L.circleMarker([lat, lon], { radius: 9, color: '#fff', weight: 3, fillColor: '#1d6fb8', fillOpacity: 1 }).addTo(map);
    const panel = $('#panel');
    panel.innerHTML = '<p class="muted">読み込み中…</p>';
    const [w, did, air, place] = await Promise.all([
      fetchWeather(lat, lon).catch(e => ({ error: e.message })),
      checkDID(lat, lon), checkAirspace(lat, lon).catch(() => null), reverseGeocode(lat, lon)]);
    if (!$('#panel')) return; // 画面を離れた
    panel.innerHTML = pointPanel({ lat, lon, w, did, air, place, wind });
    bindFall(panel, w);
    $('#startHere').addEventListener('click', async () => {
      await setSetting('pendingPlace', { name: place, lat, lon });
      go('#/flight');
    });
  }
  // 直前に見ていた地点を開き直す
  setTimeout(() => map.invalidateSize(), 100);
  return () => { saveState(); map.remove(); };
}

function windCls(v, lim) { return v >= lim.stop ? 'wind-ng' : v >= lim.warn ? 'wind-warn' : 'wind-ok'; }

function pointPanel({ lat, lon, w, did, air, place, wind }) {
  const hasW = w && !w.error;
  const elev = hasW ? w.elevation : null;
  const regs = [];
  regs.push(`人口集中地区（DID）：${did === true ? '<b class="wind-ng">区域内</b>（許可が必要）' : did === false ? '区域外' : '確認できません'}`);
  if (air === null) regs.push('空港等の周辺空域：確認できません');
  else if (!air.length) regs.push('空港等の周辺空域：該当なし');
  else regs.push(`空港等の周辺空域：<b class="wind-warn">該当あり</b><br>${air.slice(0, 6).map(a =>
    `・${esc(a.name)}${a.min != null ? `（制限表面 海抜 約${Math.round(a.min)}${a.max !== a.min ? `〜${Math.round(a.max)}` : ''}m${elev != null ? `／地表から 約${Math.round(a.min - elev)}m` : ''}）` : ''}`).join('<br>')}`);
  regs.push('地表または水面から 150m 以上の高さ：許可が必要');
  let sun = '';
  if (hasW && w.daily) {
    sun = `日の出 ${w.daily.sunrise[0].slice(11)}／日の入 ${w.daily.sunset[0].slice(11)}（日没後〜日出前は夜間飛行）`;
  }
  let cur = '', table = '';
  if (hasW) {
    const c = w.current;
    cur = `<div class="card">
      <div style="font-size:20px">${wxIcon(c.weather_code)} ${wxLabel(c.weather_code).split(' ')[1] || ''}　${c.temperature_2m}℃</div>
      <div>風速（地上10m）<b class="${windCls(c.wind_speed_10m, wind)}">${c.wind_speed_10m} m/s</b>　突風 <b class="${windCls(c.wind_gusts_10m, wind)}">${c.wind_gusts_10m} m/s</b>　${dirName(c.wind_direction_10m)}の風</div>
      <div class="muted small">${sun}</div></div>`;
    const nowKey = `${todayStr()}T${pad(new Date().getHours())}:00`;
    let i0 = w.hourly.time.indexOf(nowKey); if (i0 < 0) i0 = 0;
    const H = w.hourly;
    const rows = [];
    for (let i = i0; i < Math.min(i0 + 12, H.time.length); i++) {
      rows.push(`<tr><td>${H.time[i].slice(11, 13)}時</td><td>${wxIcon(H.weather_code[i])}</td><td>${Math.round(H.temperature_2m[i])}℃</td>
        <td>${H.precipitation_probability[i] ?? '-'}%</td>
        <td class="${windCls(H.wind_speed_10m[i], wind)}">${H.wind_speed_10m[i].toFixed(1)}</td>
        <td class="${windCls(H.wind_speed_80m[i], wind)}">${H.wind_speed_80m[i].toFixed(1)}</td>
        <td class="${windCls(H.wind_speed_120m[i], wind)}">${H.wind_speed_120m[i].toFixed(1)}</td>
        <td class="${windCls(H.wind_gusts_10m[i], wind)}">${H.wind_gusts_10m[i].toFixed(1)}</td>
        <td>${dirName(H.wind_direction_10m[i])}</td></tr>`);
    }
    table = `<div class="card"><b>12時間の予報</b>（風速 m/s）
      <div class="wx-scroll"><table class="wx-table"><thead><tr><th>時刻</th><th>天気</th><th>気温</th><th>降水</th><th>地上10m</th><th>80m</th><th>120m</th><th>突風</th><th>風向</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table></div>
      <p class="muted small">上空ほど風は強くなります。色の目安：<span class="wind-warn">注意 ${wind.warn}m/s 以上</span>・<span class="wind-ng">中止 ${wind.stop}m/s 以上</span>（設定で変更できます）。予報データ：Open-Meteo</p></div>`;
  } else {
    cur = `<div class="card warn">天気を取得できませんでした。${esc(w?.error || '')}${navigator.onLine ? '' : '（オフラインです）'}</div>`;
  }
  const iNow = hasW ? Math.max(0, w.hourly.time.indexOf(`${todayStr()}T${pad(new Date().getHours())}:00`)) : 0;
  const defWind = hasW ? w.hourly.wind_speed_80m[iNow] : 5;
  return `
    <div class="card"><b>${esc(place || '選択した地点')}</b><br>
      <span class="muted small">${lat.toFixed(5)}, ${lon.toFixed(5)}${elev != null ? `　標高 約${Math.round(elev)}m` : ''}</span></div>
    <div class="card ${did !== false || !air || air.length ? 'warn' : ''}"><b>規制の目安（参考）</b><br>${regs.join('<br>')}
      <p class="muted small">あくまで目安です。最終確認は DIPS 2.0 の地図や国土地理院の地図で行ってください。小型無人機等飛行禁止法の対象施設は表示していません。</p>
      <div class="btn-row"><a class="btn sm" href="${DIPS_URL}" target="_blank" rel="noopener">DIPS 2.0 ↗</a>
      <a class="btn sm" href="https://maps.gsi.go.jp/#15/${lat.toFixed(5)}/${lon.toFixed(5)}/&base=std&ls=std%7Cdid2020%7Ckokuarea&disp=111" target="_blank" rel="noopener">地理院地図 ↗</a></div></div>
    ${cur}${table}
    <div class="card"><b>落下距離の目安</b>
      <div class="grid3">
        <label class="f"><span>高度 m</span><input type="number" inputmode="decimal" id="fh" value="50"></label>
        <label class="f"><span>機体速度 m/s</span><input type="number" inputmode="decimal" id="fv" value="5"></label>
        <label class="f"><span>風速 m/s</span><input type="number" inputmode="decimal" id="fw" value="${Number(defWind).toFixed(1)}"></label>
      </div>
      <p id="fr"></p>
      <p class="muted small">空気抵抗を無視した簡易計算（落下時間 = √(2×高度÷9.8)、水平距離 = (機体速度＋風速)×落下時間）。立入管理区画を決めるときの参考に。</p></div>
    <button class="btn primary block" id="startHere">この地点で飛行を開始</button>`;
}

function bindFall(panel) {
  const calc = () => {
    const h = Number($('#fh', panel).value) || 0, v = Number($('#fv', panel).value) || 0, wv = Number($('#fw', panel).value) || 0;
    const t = Math.sqrt(2 * h / 9.8);
    $('#fr', panel).innerHTML = `落下時間 約 <b>${t.toFixed(1)}</b> 秒 ／ 水平移動距離 約 <b>${((v + wv) * t).toFixed(0)}</b> m`;
  };
  ['#fh', '#fv', '#fw'].forEach(s => $(s, panel).addEventListener('input', calc));
  calc();
}

// =====================================================================
// 機体・書類・設定
// =====================================================================
async function viewSettings() {
  const [pilot, aircraft, docs, lists, wind, lastBackup, alertDays] = await Promise.all([
    getSetting('pilot', {}), db.all('aircraft'), db.all('documents'), getChecklists(),
    getSetting('windLimits', { warn: 5, stop: 10 }), getSetting('lastBackup', null), getSetting('alertDays', ALERT_DEFAULTS)]);
  const lastSync = await getSetting('lastSync', null);
  const deadlines = collectDeadlines(pilot, aircraft, docs);
  let persisted = null;
  try { persisted = await navigator.storage?.persisted?.(); } catch { /* 非対応 */ }
  const sortedDocs = [...docs].sort((a, b) => (a.expiresAt || '9999').localeCompare(b.expiresAt || '9999'));

  view.innerHTML = `
    <h2>操縦者</h2>
    <form id="pf" class="card">
      <label class="f"><span>氏名</span><input name="name" value="${esc(pilot.name)}"></label>
      <label class="f"><span>技能証明の区分</span><select name="licenseClass">${['なし', '二等', '一等'].map(c => `<option ${selected(c === pilot.licenseClass)}>${c}</option>`).join('')}</select></label>
      <label class="f"><span>技能証明番号</span><input name="licenseNo" value="${esc(pilot.licenseNo)}"></label>
      <div class="grid2">
        <label class="f"><span>交付日</span><input type="date" name="licenseIssued" value="${esc(pilot.licenseIssued)}"></label>
        <label class="f"><span>有効期限</span><input type="date" name="licenseExpires" value="${esc(pilot.licenseExpires)}"></label>
      </div>
      <div class="f"><span class="muted small">取得済みの限定変更</span><div class="chips">${LIMITS.map(l =>
        `<label class="chip"><input type="checkbox" name="limits" value="${l}" ${checked(pilot.limits?.includes(l))}>${l}</label>`).join('')}</div></div>
      <h3>目標（訓練・点検の提案に使います）</h3>
      <label class="f"><span>目指す区分</span><select name="targetClass">${['二等', '一等'].map(c => `<option ${selected(c === (pilot.targetClass || '二等'))}>${c}</option>`).join('')}</select></label>
      <div class="f"><span class="muted small">目指す限定変更</span><div class="chips">${LIMITS.map(l =>
        `<label class="chip"><input type="checkbox" name="targetLimits" value="${l}" ${checked(pilot.targetLimits?.includes(l))}>${l}</label>`).join('')}</div></div>
      <div class="btn-row"><button class="btn primary sm" type="submit">保存</button>
      ${pilot.licenseExpires ? '<button class="btn sm" type="button" id="licIcs">📅 期限をカレンダーに登録</button>' : ''}</div>
    </form>

    <h2>有効期限の一覧</h2>
    <div class="card">${deadlines.length ? `<ul class="list">${deadlines.map(x => `<li><a href="${x.href}"><div class="main">${esc(x.title)}
      <div class="sub">期限 ${fmtDate(x.date)} <span class="tag ${x.st.cls}">${x.st.label}</span></div></div><span class="chev">›</span></a></li>`).join('')}</ul>`
      : '<p class="muted">期限が登録されていません。技能証明は上の「操縦者」、機体登録・機体認証は各機体の画面、その他は「書類」に入力します。</p>'}</div>
    <form id="af" class="card"><b>お知らせを始める時期</b>
      <p class="muted small">期限の何日前からホーム画面に表示するかを決めます。</p>
      <div class="grid2">${Object.keys(ALERT_DEFAULTS).map(k => `<label class="f"><span>${ALERT_LABELS[k]}（日前）</span>
        <input type="number" inputmode="numeric" name="${k}" value="${alertDays[k] ?? ALERT_DEFAULTS[k]}"></label>`).join('')}</div>
      <button class="btn primary sm" type="submit">保存</button></form>

    <h2>総飛行時間</h2>
    <a class="card" href="#/hours" style="display:block;color:inherit;text-decoration:none">
      <b>飛行経歴（アプリ使用前・記録外の時間）</b><br><span class="muted small">総飛行時間に、アプリを使う前の時間や、アプリで記録できなかった時間を加えます ›</span></a>

    <h2>機体</h2>
    <div class="card"><ul class="list">${aircraft.map(a => `<li><a href="#/aircraft/${a.id}"><div class="main">${esc(aircraftLabel(a))}
      <div class="sub">${esc([a.maker, a.model].filter(Boolean).join(' '))}${a.retired ? '（使用終了）' : ''}</div></div><span class="chev">›</span></a></li>`).join('')}</ul>
      <a class="btn block" href="#/aircraft/new">＋ 機体を追加</a></div>

    <h2>書類・有効期限</h2>
    <div class="card"><ul class="list">${sortedDocs.map(d => { const s = docStatus(d); return `<li><a href="#/doc/${d.id}"><div class="main">
      ${esc(d.type)}：${esc(d.name || '')}<div class="sub">${d.expiresAt ? `期限 ${fmtDate(d.expiresAt)}` : '期限なし'} <span class="tag ${s.cls}">${s.label}</span></div></div><span class="chev">›</span></a></li>`; }).join('')}</ul>
      <a class="btn block" href="#/doc/new">＋ 書類を追加</a>
      <p class="muted small">機体登録・許可承認・技能証明・保険などの期限を登録すると、ホーム画面で期限前に知らせます。</p></div>

    <h2>点検チェックリスト</h2>
    <div class="card"><ul class="list">${lists.map(l => `<li><a href="#/checklist/${encodeURIComponent(l.id)}"><div class="main">${esc(l.name)}
      <div class="sub">${parseChecklist(l.text).reduce((s, x) => s + x.items.length, 0)}項目</div></div><span class="chev">›</span></a></li>`).join('')}</ul>
      <a class="btn block" href="#/checklist/new">＋ チェックリストを追加</a></div>

    <h2>風速の目安</h2>
    <form id="wf" class="card"><div class="grid2">
      <label class="f"><span>注意（m/s 以上）</span><input type="number" step="0.5" name="warn" value="${wind.warn}"></label>
      <label class="f"><span>中止（m/s 以上）</span><input type="number" step="0.5" name="stop" value="${wind.stop}"></label></div>
      <p class="muted small">機体の取扱説明書にある耐風性能に合わせてください。</p>
      <button class="btn primary sm" type="submit">保存</button></form>

    <h2>iPhone・iPad で共有</h2>
    <div class="card">
      <p>複数の端末で使うときは、片方で書き出したファイルをもう片方で「取り込む（統合）」します。両方の記録を合わせ、同じ記録は新しく更新されたほうを残します。削除した記録も相手に反映されます。</p>
      <ol class="small" style="padding-left:1.4em">
        <li>使った端末で「共有用に書き出す」→ AirDrop で相手の端末へ送るか、「"ファイル"に保存」で iCloud Drive に保存</li>
        <li>相手の端末で「取り込む（統合）」→ 受け取ったファイルを選ぶ</li>
        <li>両方向でそろえたいときは、逆向きにも同じ操作をする</li>
      </ol>
      <p class="muted small">前回の取り込み：${lastSync ? `${fmtDate(lastSync)} ${fmtTime(lastSync)}` : 'なし'}</p>
      <button class="btn primary block" id="shareExp">共有用に書き出す</button>
      <label class="btn block">取り込む（統合）<input type="file" id="merge" accept="application/json,.json" hidden></label>
      <p class="muted small">飛行中・点検中・訓練中の状態は端末ごとに別です。同じ時間帯に両方の端末で同じ記録を編集すると、後から更新したほうが残ります。</p>
    </div>

    <h2>データ</h2>
    <div class="card">
      <p>データはこの iPhone の中だけに保存されています。機種変更や誤削除に備えて、定期的にバックアップを書き出してください。</p>
      <p class="muted small">前回のバックアップ：${lastBackup ? fmtDate(lastBackup) : 'なし'}　保存の保護：${persisted ? '有効' : persisted === false ? '未設定' : '不明'}</p>
      <button class="btn primary block" id="exp">バックアップを書き出す</button>
      <label class="btn block">バックアップから復元（今のデータを置き換え）<input type="file" id="imp" accept="application/json,.json" hidden></label>
    </div>

    <h2>アプリ</h2>
    <div class="card">
      <p class="muted small">バージョン ${APP_VERSION}</p>
      <button class="btn block" id="upd">最新版に更新</button>
    </div>`;

  $('#pf').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await setSetting('pilot', {
      name: fd.get('name'), licenseClass: fd.get('licenseClass'), licenseNo: fd.get('licenseNo'),
      licenseIssued: fd.get('licenseIssued'), licenseExpires: fd.get('licenseExpires'), limits: fd.getAll('limits'),
      targetClass: fd.get('targetClass'), targetLimits: fd.getAll('targetLimits'),
    });
    toast('保存しました'); render();
  });
  $('#licIcs')?.addEventListener('click', () => {
    const x = collectDeadlines(pilot, [], []).find(d => d.kind === 'license');
    shareOrDownload('期限_技能証明.ics', makeIcs(x, alertDays.license ?? ALERT_DEFAULTS.license), 'text/calendar');
  });
  $('#af').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await setSetting('alertDays', Object.fromEntries(Object.keys(ALERT_DEFAULTS).map(k => [k, Number(fd.get(k)) || ALERT_DEFAULTS[k]])));
    toast('保存しました');
  });
  $('#wf').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await setSetting('windLimits', { warn: Number(fd.get('warn')), stop: Number(fd.get('stop')) });
    toast('保存しました');
  });
  $('#exp').addEventListener('click', async () => {
    const data = await db.exportAll();
    await shareOrDownload(`drone-log-backup-${todayStr()}.json`, JSON.stringify(data, null, 1), 'application/json');
    await setSetting('lastBackup', new Date().toISOString());
    toast('書き出しました');
  });
  $('#shareExp').addEventListener('click', async () => {
    const data = await db.exportAll();
    const dev = /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad' : /iPhone/.test(navigator.userAgent) ? 'iPhone' : 'device';
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    await shareOrDownload(`drone-log-${dev}-${stamp}.json`, JSON.stringify(data), 'application/json');
    toast('書き出しました');
  });
  $('#merge').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const r = await db.mergeAll(JSON.parse(await file.text()));
      await setSetting('lastSync', new Date().toISOString());
      alert(`取り込みました\n追加 ${r.added} 件・更新 ${r.updated} 件・削除 ${r.deleted} 件`);
      render();
    } catch (err) { alert(`取り込めませんでした：${err.message}`); }
    e.target.value = '';
  });
  $('#imp').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    if (!confirm('今のデータをすべて置き換えて復元します。よろしいですか？')) return;
    try { await db.importAll(JSON.parse(await file.text())); toast('復元しました'); render(); }
    catch (err) { alert(`復元できませんでした：${err.message}`); }
  });
  $('#upd').addEventListener('click', async () => {
    if (!navigator.onLine) { toast('オフラインのため更新できません'); return; }
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('core-')).map(k => caches.delete(k)));
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    location.reload();
  });
}

async function viewAircraftEdit(id) {
  const isNew = id === 'new';
  const a = isNew ? { category: 'マルチコプター' } : await db.get('aircraft', id);
  if (!a) { view.innerHTML = '<div class="card">機体が見つかりません</div>'; return; }
  const flights = await db.all('flights');
  setTitle(isNew ? '機体を追加' : '機体');
  view.innerHTML = `
  <form id="f"><div class="card">
    <label class="f"><span>呼び名（必須）</span><input name="name" required value="${esc(a.name)}" placeholder="例：Mavic 3 #1"></label>
    <label class="f"><span>登録記号</span><input name="regNo" value="${esc(a.regNo)}" placeholder="JU から始まる番号"></label>
    <label class="f"><span>種類</span><select name="category">${AIRCRAFT_TYPES.map(t => `<option ${selected(t === a.category)}>${t}</option>`).join('')}</select></label>
    <label class="f"><span>製造者</span><input name="maker" value="${esc(a.maker)}"></label>
    <label class="f"><span>型式</span><input name="model" value="${esc(a.model)}"></label>
    <label class="f"><span>製造番号</span><input name="serial" value="${esc(a.serial)}"></label>
    <label class="f"><span>最大離陸重量（kg）</span><input type="number" step="0.01" inputmode="decimal" name="weightKg" value="${esc(a.weightKg)}"></label>
    <label class="f"><span>機体登録の有効期限</span><input type="date" name="regExpires" value="${esc(a.regExpires)}"></label>
    <h3>機体認証</h3>
    <label class="f"><span>区分</span><select name="certType">${CERT_TYPES.map(t => `<option ${selected(t === (a.certType || 'なし'))}>${t}</option>`).join('')}</select></label>
    <label class="f"><span>機体認証番号</span><input name="certNo" value="${esc(a.certNo)}"></label>
    <label class="f"><span>機体認証の有効期限</span><input type="date" name="certExpires" value="${esc(a.certExpires)}"></label>
    <label class="f"><span>このアプリを使う前の総飛行時間（分）</span><input type="number" inputmode="numeric" name="baseMinutes" value="${esc(a.baseMinutes)}"></label>
    ${isNew ? '' : `<p>現在の総飛行時間：<b>${fmtDur(totalSecOf(a, flights))}</b>（${flights.filter(f => f.aircraftId === a.id).length} 回）</p>`}
    <label class="f"><span>メモ</span><textarea name="memo">${esc(a.memo)}</textarea></label>
    <label class="chk"><input type="checkbox" name="retired" ${checked(a.retired)}><span>使用終了（一覧から隠す）</span></label>
  </div>
  <button class="btn primary block" type="submit">保存</button>
  ${a.regExpires ? '<button class="btn block" type="button" id="regIcs">📅 機体登録の期限をカレンダーに登録</button>' : ''}
  ${a.certExpires && a.certType && a.certType !== 'なし' ? '<button class="btn block" type="button" id="certIcs">📅 機体認証の期限をカレンダーに登録</button>' : ''}
  ${isNew ? '' : '<button class="btn danger block" type="button" id="del">削除</button>'}</form>`;
  const alertDays = await getSetting('alertDays', ALERT_DEFAULTS);
  const icsFor = kind => {
    const x = collectDeadlines(null, [a], []).find(d => d.kind === kind);
    shareOrDownload(`期限_${x.title}.ics`, makeIcs(x, alertDays[kind] ?? ALERT_DEFAULTS[kind]), 'text/calendar');
  };
  $('#regIcs')?.addEventListener('click', () => icsFor('reg'));
  $('#certIcs')?.addEventListener('click', () => icsFor('cert'));
  $('#f').addEventListener('submit', async e => {
    e.preventDefault();
    const o = Object.fromEntries(new FormData(e.target));
    Object.assign(a, o, { retired: !!o.retired });
    await db.put('aircraft', a);
    toast('保存しました'); history.back();
  });
  $('#del')?.addEventListener('click', async () => {
    if (flights.some(f => f.aircraftId === a.id)) { alert('この機体には飛行記録があるため削除できません。「使用終了」にしてください。'); return; }
    if (!confirm('この機体を削除しますか？')) return;
    await db.remove('aircraft', a.id); history.back();
  });
}

async function viewDocEdit(id) {
  const isNew = id === 'new';
  const d = isNew ? { type: '許可・承認' } : await db.get('documents', id);
  if (!d) { view.innerHTML = '<div class="card">見つかりません</div>'; return; }
  const aircraft = await db.all('aircraft');
  setTitle(isNew ? '書類を追加' : '書類・期限');
  view.innerHTML = `
  <form id="f"><div class="card">
    <label class="f"><span>種類</span><select name="type">${DOC_TYPES.map(t => `<option ${selected(t === d.type)}>${t}</option>`).join('')}</select></label>
    <label class="f"><span>名称</span><input name="name" value="${esc(d.name)}" placeholder="例：包括申請（夜間・目視外）"></label>
    <label class="f"><span>番号</span><input name="number" value="${esc(d.number)}" placeholder="許可承認番号・証券番号など"></label>
    <label class="f"><span>関係する機体</span><select name="aircraftId">${aircraftOptions(aircraft, d.aircraftId, { includeNone: true })}</select></label>
    <div class="grid2">
      <label class="f"><span>開始日</span><input type="date" name="issuedAt" value="${esc(d.issuedAt)}"></label>
      <label class="f"><span>有効期限</span><input type="date" name="expiresAt" value="${esc(d.expiresAt)}"></label>
    </div>
    <label class="f"><span>メモ</span><textarea name="memo">${esc(d.memo)}</textarea></label>
  </div>
  <button class="btn primary block" type="submit">保存</button>
  ${isNew ? '' : `${d.expiresAt ? '<button class="btn block" type="button" id="ics">📅 期限をカレンダーに登録</button>' : ''}
  <button class="btn danger block" type="button" id="del">削除</button>`}</form>
  <p class="muted small">カレンダーに登録すると、お知らせ開始日（⚙ 設定で変更可）・30日前・当日に iPhone のカレンダーから通知されます。</p>`;
  $('#f').addEventListener('submit', async e => {
    e.preventDefault();
    Object.assign(d, Object.fromEntries(new FormData(e.target)));
    await db.put('documents', d);
    toast('保存しました'); history.back();
  });
  $('#ics')?.addEventListener('click', async () => {
    const alertDays = await getSetting('alertDays', ALERT_DEFAULTS);
    const x = collectDeadlines(null, [], [d])[0];
    shareOrDownload(`期限_${d.name || d.type}.ics`, makeIcs(x, alertDays[x.kind] ?? ALERT_DEFAULTS[x.kind]), 'text/calendar');
  });
  $('#del')?.addEventListener('click', async () => {
    if (!confirm('削除しますか？')) return;
    await db.remove('documents', d.id); history.back();
  });
}

// x は collectDeadlines の項目。lead 日前・30 日前・当日に通知する
function makeIcs(x, lead) {
  const clean = v => String(v || '').replace(/[,;\\]/g, ' ');
  const day = x.date.replace(/-/g, '');
  const next = ymd(new Date(parseDate(x.date).getTime() + 86400000)).replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const title = clean(`【期限】${x.title}`);
  const alarm = (trigger, label) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:${trigger}`, `DESCRIPTION:${title}（${label}）`, 'END:VALARM'];
  const leads = [...new Set([Number(lead) || 0, 30])].filter(n => n > 0);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//drone-log//JA', 'BEGIN:VEVENT',
    `UID:${x.uid}@drone-log`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${next}`,
    `SUMMARY:${title}`, `DESCRIPTION:番号 ${clean(x.number)}`,
    ...leads.flatMap(n => alarm(`-P${n}D`, `${n}日前`)), ...alarm('PT9H', '当日'),
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

async function viewChecklistEdit(id) {
  const isNew = id === 'new';
  const lists = await getChecklists();
  const def = DEFAULT_CHECKLISTS.find(x => x.id === id);
  const l = isNew ? { id: `c${Date.now().toString(36)}`, name: '', note: '', text: '# 見出し\n項目1\n項目2' } : lists.find(x => x.id === id);
  if (!l) { view.innerHTML = '<div class="card">見つかりません</div>'; return; }
  view.innerHTML = `
  <form id="f"><div class="card">
    <label class="f"><span>名前</span><input name="name" required value="${esc(l.name)}"></label>
    <label class="f"><span>説明</span><input name="note" value="${esc(l.note)}"></label>
    <label class="f"><span>項目（1行に1項目。「# 」で始まる行は見出し）</span><textarea name="text" style="min-height:50vh">${esc(l.text)}</textarea></label>
  </div>
  <button class="btn primary block" type="submit">保存</button>
  ${def ? '<button class="btn block" type="button" id="reset">初期内容に戻す</button>' : ''}
  ${!def && !isNew ? '<button class="btn danger block" type="button" id="del">削除</button>' : ''}</form>`;
  const saveAll = async next => {
    const stored = (await getSetting('checklists', [])).filter(x => x.id !== l.id);
    if (next) stored.push(next);
    await setSetting('checklists', stored);
  };
  $('#f').addEventListener('submit', async e => {
    e.preventDefault();
    const o = Object.fromEntries(new FormData(e.target));
    await saveAll({ id: l.id, name: o.name, note: o.note, text: o.text });
    toast('保存しました'); history.back();
  });
  $('#reset')?.addEventListener('click', async () => {
    if (!confirm('初期内容に戻しますか？')) return;
    await saveAll(null); toast('戻しました'); render();
  });
  $('#del')?.addEventListener('click', async () => {
    if (!confirm('削除しますか？')) return;
    await saveAll(null); history.back();
  });
}

// =====================================================================
// 訓練
// =====================================================================
const RATINGS = ['', '◎ よくできた', '○ できた', '△ 課題あり', '× できなかった'];

function sumByType(list) {
  const out = {};
  for (const t of list) for (const [k, v] of Object.entries(splitByType(t))) out[k] = (out[k] || 0) + v;
  return out;
}

function trainRow(t) {
  const items = (t.items || []).filter(i => i.type !== '休憩');
  return `<li><a href="#/train-edit/${t.id}"><div class="main">
    <div>${fmtDate(t.date)} ${fmtTime(t.startedAt)}–${fmtTime(t.endedAt)}　<b>${fmtDur(t.durationSec)}</b></div>
    <div>${(t.types || []).map(x => `<span class="tag">${TYPE_ICON[x] || ''} ${esc(x)}</span>`).join('')}${t.rating ? `<span class="tag">${esc(t.rating.split(' ')[0])}</span>` : ''}</div>
    ${items.length ? `<div class="sub">${items.filter(i => i.done).length}/${items.length} 科目</div>` : ''}
  </div><span class="chev">›</span></a></li>`;
}

function typeChips(name, sel = []) {
  return `<div class="chips">${TRAIN_TYPES.map(t =>
    `<label class="chip"><input type="checkbox" name="${name}" value="${t}" ${checked(sel.includes(t))}>${TYPE_ICON[t]} ${t}</label>`).join('')}</div>`;
}

async function viewTrain() {
  const active = await getSetting('activeTraining', null);
  if (active?.endedAt) return trainFinish(active);
  if (active) return trainActive(active);
  return trainHome();
}

async function trainHome() {
  const [pilot, trainings, prefs, flights, extras] = await Promise.all([
    getSetting('pilot', {}), db.all('trainings'), getSetting('trainPrefs', {}), db.all('flights'), getSetting('extraHours', [])]);
  const cls = prefs.cls || pilot.targetClass || '二等';
  const hoursSec = pilotHours(pilot, flights, extras).total;
  const autoLv = levelFromHours(hoursSec / 3600);
  const limits = prefs.limits || pilot.targetLimits || [];
  const ym = todayStr().slice(0, 7);
  const monthBy = sumByType(trainings.filter(t => (t.date || '').startsWith(ym)));
  const allBy = sumByType(trainings);
  const recent = [...trainings].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 10);

  view.innerHTML = `
    <h2>今日の訓練を提案</h2>
    <form id="pf" class="card">
      <div class="f"><span class="muted small">予定の訓練時間（分）</span>
        <div class="chips" style="margin:4px 0 6px">${[30, 60, 90, 120, 180].map(m => `<button type="button" class="btn sm" data-min="${m}">${m}分</button>`).join('')}</div>
        <input type="number" inputmode="numeric" name="minutes" min="10" step="5" value="${prefs.minutes || 60}"></div>
      <div class="f"><span class="muted small">希望する種目</span>${typeChips('types', prefs.types || ['実機'])}</div>
      <label class="f"><span>目指す区分</span><select name="cls">${['二等', '一等'].map(c => `<option ${selected(c === cls)}>${c}</option>`).join('')}</select></label>
      <label class="f"><span>レベル（総飛行時間 ${fmtDur(hoursSec)} → 自動判定：${LEVELS[autoLv - 1].name}）</span>
        <select name="level"><option value="auto">自動（${LEVELS[autoLv - 1].name}）</option>${LEVELS.map(l =>
          `<option value="${l.lv}" ${selected(String(prefs.level) === String(l.lv))}>${l.name}（${l.range}相当）</option>`).join('')}</select></label>
      <div class="f"><span class="muted small">限定変更の訓練も入れる</span><div class="chips">${LIMITS.map(l =>
        `<label class="chip"><input type="checkbox" name="limits" value="${l}" ${checked(limits.includes(l))}>${l}</label>`).join('')}</div></div>
      <button class="btn primary block" type="submit">カリキュラムを提案</button>
    </form>
    <div id="plan"></div>

    <a class="btn block" href="#/guides">📚 訓練科目の解説・参考動画</a>

    <h2>提案なしで始める</h2>
    <div class="card"><div class="btn-row">${TRAIN_TYPES.map(t => `<button class="btn" data-quick="${t}">${TYPE_ICON[t]} ${t}</button>`).join('')}</div>
      <p class="muted small">押すとすぐに時間の計測を始めます。後から記録だけ付ける場合は「手入力で追加」。</p>
      <a class="btn block" href="#/train-edit/new">手入力で追加</a></div>

    <h2>訓練時間</h2>
    <div class="card"><table class="wx-table"><thead><tr><th>種目</th><th>今月</th><th>累計</th></tr></thead><tbody>
      ${TRAIN_TYPES.map(t => `<tr><td>${TYPE_ICON[t]} ${t}</td><td>${fmtDur(monthBy[t] || 0)}</td><td>${fmtDur(allBy[t] || 0)}</td></tr>`).join('')}
      <tr><td><b>合計</b></td><td><b>${fmtDur(Object.values(monthBy).reduce((a, b) => a + b, 0))}</b></td><td><b>${fmtDur(Object.values(allBy).reduce((a, b) => a + b, 0))}</b></td></tr>
    </tbody></table></div>

    <h2>最近の訓練</h2>
    <div class="card">${recent.length ? `<ul class="list">${recent.map(trainRow).join('')}</ul>` : '<p class="muted">まだ記録がありません</p>'}</div>`;

  const form = $('#pf');
  $$('[data-min]').forEach(b => b.addEventListener('click', () => { form.minutes.value = b.dataset.min; }));
  const input = () => {
    const fd = new FormData(form);
    return { minutes: Number(fd.get('minutes')) || 0, types: fd.getAll('types'), cls: fd.get('cls'), limits: fd.getAll('limits'), level: fd.get('level') };
  };
  const levelOf = inp => (inp.level === 'auto' || !inp.level ? autoLv : Number(inp.level));
  const showPlan = (shuffle = false) => {
    const inp = input();
    const lv = LEVELS[levelOf(inp) - 1];
    const plan = proposePlan({ ...inp, level: lv.lv, lastDone: lastDoneMap(trainings), shuffle });
    const total = plan.items.reduce((s, i) => s + i.minutes, 0);
    let clock = 0;
    $('#plan').innerHTML = `
      ${plan.notes.map(n => `<div class="card warn small">${esc(n)}</div>`).join('')}
      ${plan.items.length ? `<div class="card"><b>提案カリキュラム（合計 ${total}分）</b>
        <ul class="list">${plan.items.map(i => {
          const row = `<li><div class="row"><span class="tag">${clock}分〜</span><div class="main">${guideBtn(i)}${TYPE_ICON[i.type] || ''} ${esc(i.title)}
            <div class="sub">${esc(i.type)}・${i.minutes}分</div></div></div></li>`;
          clock += i.minutes; return row;
        }).join('')}</ul>
        <p class="muted small">${lv.name}向け：${lv.desc}。しばらく行っていない科目や、目標（一等・限定変更）に関係する科目も優先しています。</p>
        <button class="btn primary block" type="button" id="startPlan">この内容で訓練を開始</button>
        <button class="btn block" type="button" id="reshuffle">別の組み合わせで作り直す</button></div>` : ''}`;
    $('#startPlan')?.addEventListener('click', async () => {
      await setSetting('trainPrefs', { ...prefs, ...inp });
      unlockAudio();
      const now = new Date().toISOString();
      await setSetting('activeTraining', { types: inp.types, cls: inp.cls, limits: inp.limits, level: lv.lv, items: plan.items, startedAt: now, cursor: { index: 0, startAt: now }, aircraftId: prefs.aircraftId || '' });
      render();
    });
    $('#reshuffle')?.addEventListener('click', () => showPlan(true));
    $('#plan').scrollIntoView({ behavior: 'smooth' });
  };
  form.addEventListener('submit', async e => {
    e.preventDefault();
    await setSetting('trainPrefs', { ...prefs, ...input() });
    showPlan();
  });
  $$('[data-quick]').forEach(b => b.addEventListener('click', async () => {
    await setSetting('activeTraining', { types: [b.dataset.quick], items: [], startedAt: new Date().toISOString(), aircraftId: prefs.aircraftId || '' });
    render();
  }));
}

// ---------- 音（Web Audio で合成。iPhone は画面を一度タップすると鳴らせる） ----------
let audioCtx = null;
function unlockAudio() {
  try {
    if (!audioCtx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) audioCtx = new AC(); }
    if (audioCtx?.state === 'suspended') audioCtx.resume();
    // iOS の解除用に無音を一瞬鳴らす
    if (audioCtx) { const b = audioCtx.createBuffer(1, 1, 22050); const src = audioCtx.createBufferSource(); src.buffer = b; src.connect(audioCtx.destination); src.start(0); }
  } catch { /* 音が使えない環境 */ }
}
function tone(freq, dur, vol, type = 'sine', delay = 0) {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const t0 = audioCtx.currentTime + delay;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(audioCtx.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
const mmss = sec => `${Math.floor(sec / 60)}:${pad(sec % 60)}`;
const playTick = () => tone(2000, 0.04, 0.35, 'square');
const playPon = () => { tone(1046, 1.6, 0.5); tone(2093, 1.0, 0.12); };
const playChime = () => { tone(784, 0.25, 0.3); tone(988, 0.4, 0.3, 'sine', 0.2); };

// 画面が消えないようにする（対応していない端末では何もしない）
async function keepScreenOn() {
  try { return await navigator.wakeLock?.request('screen'); } catch { return null; }
}

async function trainActive(active) {
  const [aircraft, prefs] = await Promise.all([db.all('aircraft'), getSetting('trainPrefs', {})]);
  const hasReal = active.types.includes('実機');
  const items = active.items || [];
  if (items.length && !active.cursor) {
    const i = items.findIndex(x => !x.done);
    active.cursor = { index: i < 0 ? items.length : i, startAt: active.startedAt };
  }
  const warnSec = prefs.warnSec ?? 30;
  const soundOn = prefs.sound !== false;

  view.innerHTML = `
    <div class="card" id="head">
      <div class="muted small">訓練中　${active.types.map(t => `${TYPE_ICON[t]} ${t}`).join('・')}　全体 <span id="timer">0:00:00</span></div>
      ${items.length ? `
        <div id="cur" class="cur"></div>
        <div class="bar"><div id="barIn"></div></div>
        <div id="alert" class="t-alert" hidden></div>
        <div id="nextInfo" class="muted small"></div>
        <button class="btn primary block" id="nextBtn">✓ 終えて次へ</button>
        <div class="row small" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="muted">残り時間のお知らせ</span>
          <select id="warnSel" style="width:auto;padding:6px">${[[30, '30秒前'], [15, '15秒前'], [0, 'なし']].map(([v, l]) =>
            `<option value="${v}" ${selected(v === warnSec)}>${l}</option>`).join('')}</select>
          <button class="btn sm" id="sndBtn" type="button">${soundOn ? '🔊 音あり' : '🔇 音なし'}</button>
        </div>` : '<div class="timer" id="timerBig">0:00:00</div>'}
    </div>
    ${items.length ? `<div class="card"><ul class="list">${items.map((i, n) => `<li class="${n === active.cursor.index ? 'now' : ''}"><label class="chk">
      <input type="checkbox" data-n="${n}" ${checked(i.done)}><span>${n === active.cursor.index ? '▶ ' : ''}${TYPE_ICON[i.type] || ''} ${esc(i.title)}<br><span class="muted small">${i.minutes}分</span></span></label>${guideBtn(i)}</li>`).join('')}</ul>
      <p class="muted small" id="prog"></p></div>` : ''}
    ${hasReal ? `<div class="card">
      <label class="f"><span>使用する機体</span><select id="ac">${aircraftOptions(aircraft, active.aircraftId, { includeNone: true })}</select></label>
      <a class="btn block" href="#/flight">✈ 離着陸を飛行記録に付ける</a>
      <p class="muted small">実機の飛行は、離着陸ごとに「飛行」で記録してください（飛行日誌になります）。訓練記録には、この時間内の飛行時間が自動で表示されます。</p></div>` : ''}
    <div class="card"><label class="f"><span>メモ</span><textarea id="memo">${esc(active.memo)}</textarea></label></div>
    <button class="btn big land block" id="end">訓練終了</button>
    <button class="btn danger block" id="cancel">取り消し（記録しない）</button>
    ${items.length ? '<p class="muted small">音が鳴らないとき：画面を一度タップする、iPhone の消音モード（横のスイッチ）を解除する、音量を上げる、を試してください。</p>' : ''}`;

  const save = () => setSetting('activeTraining', active);
  const prog = () => { const p = $('#prog'); if (p) { const it = items.filter(i => i.type !== '休憩'); p.textContent = `${it.filter(i => i.done).length} / ${it.length} 科目 完了`; } };
  prog();

  // 音の解除（iPhone は画面操作のあとでないと音が出せない）
  const unlock = () => unlockAudio();
  view.addEventListener('pointerdown', unlock);

  const start = new Date(active.startedAt).getTime();
  let lastSec = null;
  // すでに時間切れの科目を開き直したときに、音を鳴らし直さない
  let ponDone = false;
  if (items.length && active.cursor.index < items.length) {
    const it0 = items[active.cursor.index];
    ponDone = it0.minutes * 60 - (Date.now() - new Date(active.cursor.startAt).getTime()) / 1000 < -1;
  }

  const tick = () => {
    const now = Date.now();
    $('#timer').textContent = fmtClock((now - start) / 1000);
    if (!items.length) { $('#timerBig').textContent = fmtClock((now - start) / 1000); return; }
    const idx = active.cursor.index;
    const alertEl = $('#alert');
    if (idx >= items.length) {
      $('#cur').innerHTML = '<div class="cur-title">すべての科目が終わりました</div>';
      $('#barIn').style.width = '100%';
      $('#nextInfo').textContent = '「訓練終了」を押して記録してください。';
      $('#nextBtn').hidden = true; alertEl.hidden = true;
      return;
    }
    const it = items[idx], next = items[idx + 1];
    const total = it.minutes * 60;
    const elapsed = (now - new Date(active.cursor.startAt).getTime()) / 1000;
    const rem = total - elapsed;
    const remSec = Math.ceil(rem);
    $('#cur').innerHTML = `<div class="muted small">いまの科目（${idx + 1}/${items.length}）</div>
      <div class="cur-title">${TYPE_ICON[it.type] || ''} ${esc(it.title)} ${guideBtn(it, 'やり方')}</div>
      <div class="cur-rem ${remSec <= 0 ? 'over' : remSec <= 10 ? 'last' : ''}">${remSec > 0 ? `残り ${mmss(remSec)}` : `時間超過 +${mmss(Math.floor(-rem))}`}</div>`;
    $('#barIn').style.width = `${Math.min(100, (elapsed / total) * 100)}%`;
    $('#nextInfo').textContent = next ? `次：${next.title}（${next.minutes}分）` : '次：これが最後の科目です';

    // お知らせ
    const ws = Number(prefs.warnSec ?? 30);
    if (remSec <= 0) {
      alertEl.hidden = false; alertEl.className = 't-alert done';
      alertEl.innerHTML = next ? `⏰ 時間です。次の訓練に進んでください<br><b>${esc(next.title)}</b>` : '⏰ 時間です。最後の科目が終わりました';
    } else if (remSec <= 10) {
      alertEl.hidden = false; alertEl.className = 't-alert count';
      alertEl.textContent = remSec;
    } else if (ws && remSec <= ws) {
      alertEl.hidden = false; alertEl.className = 't-alert warn';
      alertEl.textContent = `残り ${remSec} 秒です`;
    } else {
      alertEl.hidden = true;
    }

    // 音（1 秒ごとに 1 回だけ判定）
    if (remSec !== lastSec) {
      const first = lastSec === null;
      lastSec = remSec;
      if (!first && prefs.sound !== false) {
        if (remSec >= 1 && remSec <= 10) playTick();
        else if (ws && remSec === ws) playChime();
      }
      if (remSec <= 0 && !ponDone) {
        ponDone = true;
        if (prefs.sound !== false) playPon();
      }
    }
  };
  tick();
  const iv = setInterval(tick, 200);

  // 画面を消さない
  let lock = await keepScreenOn();
  const onVis = async () => { if (document.visibilityState === 'visible') lock = await keepScreenOn(); };
  document.addEventListener('visibilitychange', onVis);

  $('#nextBtn')?.addEventListener('click', async () => {
    unlockAudio();
    const idx = active.cursor.index;
    if (idx < items.length) items[idx].done = true;
    active.cursor = { index: idx + 1, startAt: new Date().toISOString() };
    await save(); render();
  });
  $('#warnSel')?.addEventListener('change', async e => { prefs.warnSec = Number(e.target.value); await setSetting('trainPrefs', prefs); });
  $('#sndBtn')?.addEventListener('click', async e => {
    prefs.sound = prefs.sound === false;
    e.target.textContent = prefs.sound ? '🔊 音あり' : '🔇 音なし';
    if (prefs.sound) { unlockAudio(); playChime(); }
    await setSetting('trainPrefs', prefs);
  });
  $$('[data-n]').forEach(c => c.addEventListener('change', () => { items[c.dataset.n].done = c.checked; prog(); save(); }));
  $('#ac')?.addEventListener('change', async e => {
    active.aircraftId = e.target.value; save();
    const lp = await getSetting('lastFlightPrefs', {});
    await setSetting('lastFlightPrefs', { ...lp, aircraftId: e.target.value || lp.aircraftId, purpose: '訓練' });
  });
  $('#memo').addEventListener('change', e => { active.memo = e.target.value; save(); });
  $('#end').addEventListener('click', async () => { active.endedAt = new Date().toISOString(); await save(); render(); });
  $('#cancel').addEventListener('click', async () => {
    if (!confirm('この訓練を記録せずに取り消しますか？')) return;
    await setSetting('activeTraining', null); render();
  });
  return () => {
    clearInterval(iv);
    view.removeEventListener('pointerdown', unlock);
    document.removeEventListener('visibilitychange', onVis);
    lock?.release?.().catch(() => {});
  };
}

// =====================================================================
// 訓練科目の解説・参考動画
// =====================================================================
function guideBtn(i, label = '') {
  if (!i.moduleId || i.type === '休憩' || !getGuide(i.moduleId, i.type)) return '';
  return `<button type="button" class="gbtn" data-guide="${esc(i.moduleId)}" data-gtype="${esc(i.type)}" data-gtitle="${esc(i.title)}" aria-label="やり方を見る">ⓘ${label ? ` ${label}` : ''}</button>`;
}

async function showGuide(moduleId, type, title) {
  const g = getGuide(moduleId, type);
  if (!g) return;
  const videos = (await getSetting('moduleVideos', {}))[moduleId] || [];
  const sheet = $('#sheet');
  const list = arr => arr.map(x => `<li>${esc(x)}</li>`).join('');
  sheet.innerHTML = `
    <div class="sheet-body" role="dialog" aria-modal="true">
      <div class="sheet-head"><b>${TYPE_ICON[type] || ''} ${esc(title)}</b><button type="button" class="icon-btn" id="sheetClose" aria-label="閉じる">✕</button></div>
      <p>${esc(g.purpose)}</p>
      <h3>やり方</h3><ol>${list(g.steps)}</ol>
      ${g.points.length ? `<h3>ポイント</h3><ul>${list(g.points)}</ul>` : ''}
      ${g.mistakes.length ? `<h3>よくある失敗</h3><ul>${list(g.mistakes)}</ul>` : ''}
      ${g.safety.length ? `<div class="card warn small">${esc(g.safety[0])}</div>` : ''}
      <h3>参考動画</h3>
      ${videos.length ? `<ul class="list">${videos.map((v, n) => `<li><div class="row"><a class="main" href="${esc(v.url)}" target="_blank" rel="noopener">▶ ${esc(v.title || v.url)}</a>
        <button type="button" class="btn sm danger" data-vdel="${n}">削除</button></div></li>`).join('')}</ul>` : '<p class="muted small">登録した動画はまだありません。</p>'}
      ${g.search.length ? `<div class="btn-row">${g.search.map(q => `<a class="btn sm" href="${youtubeSearchUrl(q)}" target="_blank" rel="noopener">YouTube で「${esc(q)}」を探す ↗</a>`).join('')}</div>` : ''}
      <form id="vf" class="card">
        <b class="small">見つけた動画を登録する</b>
        <label class="f"><span>タイトル</span><input name="title" placeholder="例：スクエア飛行のコツ"></label>
        <label class="f"><span>URL</span><input name="url" type="url" inputmode="url" placeholder="https://www.youtube.com/watch?v=..."></label>
        <button class="btn sm primary" type="submit">登録</button>
      </form>
      <p class="muted small">動画の内容が、最新の法令や試験の内容と合っているかは確認してください。試験の手順・基準は実施細則とスクールの指導に従ってください。</p>
    </div>`;
  sheet.hidden = false;
  document.body.style.overflow = 'hidden';
  const close = () => { sheet.hidden = true; sheet.innerHTML = ''; document.body.style.overflow = ''; };
  $('#sheetClose').addEventListener('click', close);
  sheet.onclick = e => { if (e.target === sheet) close(); };
  const saveVideos = async next => {
    const all = await getSetting('moduleVideos', {});
    all[moduleId] = next;
    await setSetting('moduleVideos', all);
    showGuide(moduleId, type, title);
  };
  $('#vf').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const url = String(fd.get('url') || '').trim();
    if (!/^https?:\/\//i.test(url)) { alert('http:// または https:// で始まる URL を入力してください'); return; }
    await saveVideos([...videos, { title: String(fd.get('title') || '').trim(), url }]);
    toast('登録しました');
  });
  $$('[data-vdel]', sheet).forEach(b => b.addEventListener('click', async () => {
    if (!confirm('この動画の登録を削除しますか？')) return;
    await saveVideos(videos.filter((_, n) => n !== Number(b.dataset.vdel)));
  }));
}

// どの画面の ⓘ ボタンでも解説を開く
document.addEventListener('click', e => {
  const b = e.target.closest('[data-guide]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  showGuide(b.dataset.guide, b.dataset.gtype, b.dataset.gtitle);
}, true);

async function viewGuides(filter) {
  const type = TRAIN_TYPES.includes(filter) ? filter : TRAIN_TYPES[0];
  const videos = await getSetting('moduleVideos', {});
  const lvName = lv => (lv ? LEVELS[lv - 1].name : '');
  const mods = MODULES.filter(m => m.type === type);
  view.innerHTML = `
    <div class="seg">${TRAIN_TYPES.map(t => `<button data-t="${t}" class="${t === type ? 'on' : ''}">${TYPE_ICON[t]} ${t}</button>`).join('')}</div>
    <div class="card"><ul class="list">${mods.map(m => `<li><a href="#" data-guide="${m.id}" data-gtype="${m.type}" data-gtitle="${esc(m.title)}"><div class="main">
      ${esc(m.title)}<div>${m.lv ? `<span class="tag">${lvName(m.lv)}</span>` : ''}${m.cls ? `<span class="tag">${m.cls}</span>` : ''}${m.limit ? `<span class="tag">${esc(m.limit.replace('の解除', ''))}</span>` : ''}${videos[m.id]?.length ? `<span class="tag ok">動画 ${videos[m.id].length}</span>` : ''}</div>
    </div><span class="chev">›</span></a></li>`).join('')}</ul></div>
    <p class="muted small">科目をタップすると、やり方・ポイント・参考動画を表示します。</p>`;
  $$('.seg button').forEach(b => b.addEventListener('click', () => go(`#/guides/${encodeURIComponent(b.dataset.t)}`)));
}

// =====================================================================
// 総飛行時間（飛行経歴）
// =====================================================================
async function viewHours() {
  const [pilot, flights, extras] = await Promise.all([getSetting('pilot', {}), db.all('flights'), getSetting('extraHours', [])]);
  const h = pilotHours(pilot, flights, extras);
  const base = Number(pilot.baseMinutes) || 0;
  const sorted = [...extras].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const lv = LEVELS[levelFromHours(h.total / 3600) - 1];
  view.innerHTML = `
    <div class="card">
      <div class="timer" style="font-size:36px">${fmtDur(h.total)}</div>
      <dl class="kv">
        <dt>アプリ使用前</dt><dd>${fmtDur(h.base)}</dd>
        <dt>アプリの記録</dt><dd>${fmtDur(h.app)}（${flights.length}回）</dd>
        <dt>手入力の追加</dt><dd>${fmtDur(h.extra)}（${extras.length}件）</dd>
      </dl>
      <p class="muted small">経験レベル：<b>${lv.name}</b>（${lv.range}）。訓練の提案に使います。</p>
    </div>

    <h2>アプリを使う前の総飛行時間</h2>
    <form id="bf" class="card">
      <div class="grid2">
        <label class="f"><span>時間</span><input type="number" inputmode="numeric" min="0" name="h" value="${Math.floor(base / 60)}"></label>
        <label class="f"><span>分</span><input type="number" inputmode="numeric" min="0" max="59" name="m" value="${base % 60}"></label>
      </div>
      <p class="muted small">これまでの飛行日誌やスクールの記録にある合計時間を入れてください。</p>
      <button class="btn primary sm" type="submit">保存</button>
    </form>

    <h2>記録外の飛行時間を追加</h2>
    <form id="xf" class="card">
      <input type="hidden" name="id">
      <label class="f"><span>日付</span><input type="date" name="date" value="${todayStr()}"></label>
      <div class="grid2">
        <label class="f"><span>時間</span><input type="number" inputmode="numeric" min="0" name="h" value="0"></label>
        <label class="f"><span>分</span><input type="number" inputmode="numeric" min="0" max="59" name="m" value="0"></label>
      </div>
      <label class="f"><span>内容（例：スクールの機体で訓練、電池切れで記録できなかった）</span><input name="memo"></label>
      <div class="btn-row"><button class="btn primary sm" type="submit" id="xSave">追加</button>
      <button class="btn sm" type="button" id="xCancel" hidden>編集をやめる</button></div>
    </form>
    <div class="card">${sorted.length ? `<ul class="list">${sorted.map(x => `<li><div class="row"><div class="main">
      ${fmtDate(x.date)}　<b>${fmtDur((Number(x.minutes) || 0) * 60)}</b><div class="sub">${esc(x.memo || '')}</div></div>
      <button class="btn sm" data-edit="${x.id}">編集</button><button class="btn sm danger" data-del="${x.id}">削除</button></div></li>`).join('')}</ul>`
      : '<p class="muted">追加した時間はありません</p>'}</div>
    <p class="muted small">ここで追加した時間は、操縦者としての総飛行時間と経験レベルにだけ反映されます。機体ごとの飛行日誌には載りません（飛行日誌に残す場合は「記録 → ＋追加」で飛行記録として入力してください）。</p>`;

  $('#bf').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const p = await getSetting('pilot', {});
    await setSetting('pilot', { ...p, baseMinutes: (Number(fd.get('h')) || 0) * 60 + (Number(fd.get('m')) || 0) });
    toast('保存しました'); render();
  });
  const xf = $('#xf');
  xf.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(xf);
    const minutes = (Number(fd.get('h')) || 0) * 60 + (Number(fd.get('m')) || 0);
    if (minutes <= 0) { alert('時間を入力してください'); return; }
    const list = (await getSetting('extraHours', [])).filter(x => x.id !== fd.get('id'));
    list.push({ id: fd.get('id') || `x${Date.now().toString(36)}`, date: fd.get('date'), minutes, memo: fd.get('memo') });
    await setSetting('extraHours', list);
    toast('保存しました'); render();
  });
  $('#xCancel').addEventListener('click', () => render());
  $$('[data-edit]').forEach(b => b.addEventListener('click', () => {
    const x = extras.find(y => y.id === b.dataset.edit);
    xf.id.value = x.id; xf.date.value = x.date; xf.h.value = Math.floor(x.minutes / 60); xf.m.value = x.minutes % 60; xf.memo.value = x.memo || '';
    $('#xSave').textContent = '変更を保存'; $('#xCancel').hidden = false;
    xf.scrollIntoView({ behavior: 'smooth' });
  }));
  $$('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('この時間を削除しますか？')) return;
    await setSetting('extraHours', extras.filter(y => y.id !== b.dataset.del));
    render();
  }));
}

async function trainFinish(active) {
  await trainForm({ ...active }, {
    heading: '<div class="card ok"><b>訓練終了</b>　内容を確認して保存してください</div>',
    onSaved: async () => { await setSetting('activeTraining', null); toast('訓練記録を保存しました'); go('#/train'); },
    extra: [{ id: 'resume', label: '終了を取り消して続ける', fn: async () => { delete active.endedAt; await setSetting('activeTraining', active); render(); } }],
  });
}

async function viewTrainEdit(id) {
  const isNew = id === 'new';
  const prefs = await getSetting('trainPrefs', {});
  const t = isNew
    ? { types: prefs.types || ['実機'], items: [], startedAt: new Date(Date.now() - 3600000).toISOString(), endedAt: new Date().toISOString(), aircraftId: prefs.aircraftId || '' }
    : await db.get('trainings', id);
  if (!t) { view.innerHTML = '<div class="card">記録が見つかりません</div>'; return; }
  setTitle(isNew ? '訓練記録を追加' : '訓練記録');
  await trainForm(t, {
    isNew,
    onSaved: () => { toast('保存しました'); history.back(); },
    extra: isNew ? [] : [{ id: 'del', label: '削除', danger: true, fn: async () => {
      if (!confirm('この訓練記録を削除しますか？')) return;
      await db.remove('trainings', t.id); history.back();
    } }],
  });
}

// 訓練記録の入力フォーム（終了時・編集時で共通）
async function trainForm(t, { heading = '', onSaved, extra = [], isNew = false }) {
  const [aircraft, flights] = await Promise.all([db.all('aircraft'), db.all('flights')]);
  const exact = !isNew; // 新規の手入力以外は秒まで含む元の時刻を使う
  view.innerHTML = `
  ${heading}
  <form id="f">
    <div class="card">
      <label class="f"><span>開始</span><input type="datetime-local" name="startedAt" value="${toLocalInput(t.startedAt)}"></label>
      <label class="f"><span>終了</span><input type="datetime-local" name="endedAt" value="${toLocalInput(t.endedAt)}"></label>
      <p>訓練時間：<b id="dur"></b></p>
      <div class="f"><span class="muted small">種目</span>${typeChips('types', t.types)}</div>
      <label class="f"><span>機体（実機のとき）</span><select name="aircraftId">${aircraftOptions(aircraft, t.aircraftId, { includeNone: true })}</select></label>
      <p class="muted small" id="flt"></p>
      <label class="f"><span>場所</span><input name="place" value="${esc(t.place)}"></label>
    </div>
    ${t.items?.length ? `<div class="card"><b>実施した科目</b>${t.items.map((i, n) => `<label class="chk">
      <input type="checkbox" name="done" value="${n}" ${checked(i.done)}><span>${TYPE_ICON[i.type] || ''} ${esc(i.title)}<span class="muted small">（${i.minutes}分）</span></span>${guideBtn(i)}</label>`).join('')}</div>` : ''}
    <div class="card">
      <label class="f"><span>自己評価</span><select name="rating">${RATINGS.map(r => `<option value="${r}" ${selected(r === (t.rating || ''))}>${r || '（なし）'}</option>`).join('')}</select></label>
      <label class="f"><span>メモ（できたこと・課題・次回やること）</span><textarea name="memo">${esc(t.memo)}</textarea></label>
    </div>
    <button class="btn primary block" type="submit">保存</button>
    ${extra.map(x => `<button class="btn block ${x.danger ? 'danger' : ''}" type="button" id="${x.id}">${x.label}</button>`).join('')}
  </form>`;
  const form = $('#f');
  const times = () => [exact ? pickTime(form.startedAt.value, t.startedAt) : fromLocalInput(form.startedAt.value),
    exact ? pickTime(form.endedAt.value, t.endedAt) : fromLocalInput(form.endedAt.value)];
  const refresh = () => {
    const [a, b] = times();
    $('#dur').textContent = fmtDur((new Date(b) - new Date(a)) / 1000);
    const fs = flights.filter(f => f.takeoffAt >= a && f.takeoffAt <= b);
    $('#flt').textContent = fs.length ? `この時間内の飛行記録：${fs.length}回・飛行時間 ${fmtDur(fs.reduce((s, f) => s + (f.durationSec || 0), 0))}` : '';
  };
  form.startedAt.addEventListener('change', refresh); form.endedAt.addEventListener('change', refresh); refresh();
  extra.forEach(x => $(`#${x.id}`).addEventListener('click', x.fn));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const [startedAt, endedAt] = times();
    const durationSec = Math.round((new Date(endedAt) - new Date(startedAt)) / 1000);
    if (durationSec <= 0) { alert('終了が開始より前になっています'); return; }
    const types = fd.getAll('types');
    if (!types.length) { alert('種目を1つ以上選んでください'); return; }
    const done = fd.getAll('done').map(Number);
    const rec = {
      date: ymd(new Date(startedAt)), startedAt, endedAt, durationSec, types,
      items: (t.items || []).map((i, n) => ({ ...i, done: done.includes(n) })),
      cls: t.cls, limits: t.limits, aircraftId: fd.get('aircraftId'), place: fd.get('place'),
      rating: fd.get('rating'), memo: fd.get('memo'),
    };
    if (!isNew && t.date) rec.id = t.id; // 既存記録の編集
    await db.put('trainings', rec);
    const tp = await getSetting('trainPrefs', {});
    if (rec.aircraftId) await setSetting('trainPrefs', { ...tp, aircraftId: rec.aircraftId });
    await onSaved();
  });
}

// =====================================================================
// 起動
// =====================================================================
$('#backBtn').addEventListener('click', () => history.back());
window.addEventListener('hashchange', render);
const updateNet = () => { $('#netStatus').hidden = navigator.onLine; };
window.addEventListener('online', updateNet);
window.addEventListener('offline', updateNet);
updateNet();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(e => console.warn('Service Worker を登録できません', e));
}
// iPhone がデータを自動で消さないように保護を依頼する
navigator.storage?.persist?.().catch(() => {});

if (!location.hash) history.replaceState(null, '', '#/home');
render();
