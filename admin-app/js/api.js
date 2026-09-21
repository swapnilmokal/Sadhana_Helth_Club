/* साधना हेल्थ अँड न्यूट्रिशन सेंटर — core: config, storage, sync engine, helpers
   (this one file is shared, identical, by user-app and admin-app)

   DEMO MODE   (no server configured): data stays in this browser only (localStorage), sample data included.
   SERVER MODE (config.js has the Apps Script URL): login by mobile + PIN on the server, every change is queued and synced,
                data is cached on the phone in IndexedDB (works offline), photos are kept in a private Drive folder. */
'use strict';
const BRAND = { mr: 'साधना हेल्थ अँड न्यूट्रिशन सेंटर', en: 'Sadhana Health & Nutrition Center' };
/* Center details shown in the About & Contact section. Owner photos live in images/ of each app. */
const CENTER = {
  phone: '9702389779', /* admin / center contact number */
  owners: [
    { name: 'Bhagwan Mokal', nameMr: 'भगवान मोकल', role: 'Wellness Coach', roleMr: 'वेलनेस कोच', photo: 'images/bhagwan-mokal.jpg' },
    { name: 'Sadhana Mokal', nameMr: 'साधना मोकल', role: 'Wellness Coach', roleMr: 'वेलनेस कोच', photo: 'images/sadhana-mokal.jpg' }
  ]
};
/* ---------- config (from ../config.js at the repository root) ---------- */
const CFG = window.SADHANA_CONFIG || {};
const API_URL = CFG.API_URL || 'PASTE_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE';
const DEMO_MODE = API_URL.indexOf('PASTE_') === 0;
const APP_KIND = window.APP_KIND === 'admin' ? 'admin' : 'user';
const DB_KEY = 'sadhana_db_v1';   /* demo mode storage key */
const SYNC_COLLS = { members: 'memberId', logs: 'logId', photos: 'photoId', updates: 'updateId', appointments: 'appointmentId', events: 'eventId', notifications: 'notificationId', attendance: 'attendanceId', notes: 'noteId', audit: 'logId', staff: 'staffId' };
const emptyDb = () => ({ v: 1, members: [], logs: [], photos: [], updates: [], appointments: [], events: [], notifications: [], attendance: [], notes: [], audit: [], staff: [], settings: {} });
const blankMeta = () => ({ since: 0, outbox: [], token: '', user: null, lastSync: 0, needFull: false });

async function apiCall(action, payload, timeoutMs) {
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), timeoutMs || 30000);
  try {
    const body = JSON.stringify(Object.assign({ action, token: (Store.meta && Store.meta.token) || undefined }, payload || {}));
    const r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, signal: ctl.signal });
    return await r.json();
  } finally { clearTimeout(tm); }
}

/* ---------- small utilities ---------- */
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => ymd(new Date());
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
const nowTime = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = s => { if (!s) return '—'; const d = new Date(s + 'T00:00:00'); return d.getDate() + ' ' + MONTHS[d.getMonth()]; };
const fmtTime = t => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return ((h + 11) % 12 + 1) + ':' + pad(m) + ' ' + (h < 12 ? 'AM' : 'PM'); };
const dash = v => (v == null || v === '' ? '—' : v);
/* BMI = kg / (m x m). Tracking metric only — never a diagnosis. */
const bmiOf = (w, hcm) => +(w / ((hcm / 100) * (hcm / 100))).toFixed(1);

/* ---------- data access helpers ---------- */
const byNew = (a, b) => (b.date + (b.createdAt || '')).localeCompare(a.date + (a.createdAt || ''));
const memberLogs = (db, id) => db.logs.filter(l => l.memberId === id).sort(byNew);
const latestLog = (db, id) => memberLogs(db, id)[0] || null;
const nextCode = db => 'SHC' + String(101 + db.members.length).padStart(6, '0');
function goalPct(m, cur) {
  const p = m.profile;
  if (!p || !p.goalWeight || cur == null) return null;
  const s = p.baselineWeight, g = p.goalWeight;
  if (s === g) return 100;
  return Math.max(0, Math.min(100, Math.round((s - cur) / (s - g) * 100)));
}
function audit(db, actor, role, action, entity, entityId, detail) {
  db.audit.push({ logId: uid('A'), actorId: actor, actorRole: role, action, entity, entityId, newData: detail || '', timestamp: new Date().toISOString() });
}
function notify(db, memberId, title, message, type) {
  db.notifications.push({ notificationId: uid('N'), memberId, title, message, type: type || 'Reminder', sentAt: new Date().toISOString(), readAt: '', status: 'Sent' });
}

/* ---------- validation + record builders (historical logs are only ever appended) ---------- */
function parseLog(d, height) {
  const n = k => (d[k] === '' || d[k] == null ? null : Number(d[k]));
  const w = n('weight');
  if (w == null || !(w >= 20 && w <= 300)) return { error: 'Enter weight between 20 and 300 kg.' };
  const h = n('height') || height;
  if (!h || !(h >= 80 && h <= 250)) return { error: 'Enter height between 80 and 250 cm.' };
  const rng = (k, a, b, l) => { const v = n(k); if (v != null && !(v >= a && v <= b)) return l + ' must be between ' + a + ' and ' + b + '.'; };
  const e = rng('sugar', 20, 600, 'Sugar') || rng('pulse', 30, 220, 'Pulse') || rng('waist', 30, 200, 'Waist') ||
    rng('hip', 30, 200, 'Hip') || rng('steps', 0, 100000, 'Steps') || rng('water', 0, 15, 'Water') || rng('sleep', 0, 24, 'Sleep');
  if (e) return { error: e };
  let bp = (d.bp || '').trim();
  if (bp) {
    const m = bp.match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
    if (!m || +m[1] < 60 || +m[1] > 260 || +m[2] < 30 || +m[2] > 160 || +m[1] <= +m[2]) return { error: 'Enter BP like 120/80.' };
    bp = m[1] + '/' + m[2];
  }
  const date = d.date || today();
  if (date > today()) return { error: 'Date cannot be in the future.' };
  return { log: { logId: uid('L'), date, height: h, weight: w, bmi: bmiOf(w, h), bp, sugar: n('sugar'), pulse: n('pulse'), waist: n('waist'), hip: n('hip'), steps: n('steps'), water: n('water'), sleep: n('sleep'), activity: (d.activity || '').trim().slice(0, 100), note: (d.note || '').trim().slice(0, 300), createdAt: new Date().toISOString() } };
}
function saveLog(db, m, d, by) {
  const r = parseLog(d, m.profile && m.profile.height);
  if (r.error) return r.error;
  r.log.memberId = m.memberId; r.log.by = by;
  db.logs.push(r.log);
  return null;
}
function saveBaseline(db, m, d, by) {
  const g = Number(d.goalWeight);
  if (!(g >= 20 && g <= 300)) return 'Enter goal weight between 20 and 300 kg.';
  if (d.goalDate && d.goalDate < today()) return 'Goal date cannot be in the past.';
  const r = parseLog(Object.assign({}, d, { note: 'Day-1 baseline' }), null);
  if (r.error) return r.error;
  const l = r.log;
  l.memberId = m.memberId; l.by = by;
  db.logs.push(l);
  m.profile = { height: l.height, baselineWeight: l.weight, baselineBMI: l.bmi, baselineBP: l.bp, baselineSugar: l.sugar, baselinePulse: l.pulse, baselineWaist: l.waist, baselineHip: l.hip, goalWeight: g, goalDate: d.goalDate || '', createdAt: new Date().toISOString() };
  return null;
}
function logFieldsHtml(m, extra) {
  const p = m.profile || {};
  return `<label>Date<input type="date" name="date" value="${today()}" max="${today()}" required></label>
  <div class="two"><label>Weight (kg)<input name="weight" type="number" step="0.1" inputmode="decimal" required></label>
  <label>Height (cm)<input name="height" type="number" step="0.1" inputmode="decimal" value="${esc(p.height || '')}" ${p.height ? '' : 'required'}></label></div>
  <div class="two"><label>BP (mmHg)<input name="bp" placeholder="120/80" maxlength="7"></label>
  <label>Sugar (mg/dL)<input name="sugar" type="number" inputmode="decimal"></label></div>
  <div class="two"><label>Pulse (bpm)<input name="pulse" type="number" inputmode="numeric"></label>
  <label>Waist (cm)<input name="waist" type="number" step="0.1" inputmode="decimal"></label></div>
  <div class="two"><label>Hip (cm)<input name="hip" type="number" step="0.1" inputmode="decimal"></label>
  <label>Steps<input name="steps" type="number" inputmode="numeric"></label></div>
  ${extra || ''}`;
}
const dailyExtraHtml = `<div class="two"><label>Water (litres)<input name="water" type="number" step="0.1" inputmode="decimal"></label>
  <label>Sleep (hours)<input name="sleep" type="number" step="0.1" inputmode="decimal"></label></div>
  <label>Activity<input name="activity" maxlength="100" placeholder="e.g. Yoga 30 min"></label>
  <label>Note<textarea name="note" maxlength="300" rows="2"></textarea></label>`;
const baselineExtraHtml = () => `<div class="two"><label>Goal weight (kg)<input name="goalWeight" type="number" step="0.1" inputmode="decimal" required></label>
  <label>Goal date<input type="date" name="goalDate" min="${today()}"></label></div>`;

/* ---------- storage (DEMO MODE) ---------- */
function seed() {
  const T = today();
  const db = { v: 1, members: [], logs: [], photos: [], updates: [], appointments: [], events: [], notifications: [], attendance: [], notes: [], audit: [],
    staff: [{ staffId: 'S1', name: 'Bhagwan Mokal', mobile: CENTER.phone, role: 'Owner / Wellness Coach', status: 'Active' },
      { staffId: 'S2', name: 'Sadhana Mokal', mobile: '', role: 'Owner / Wellness Coach', status: 'Active' }],
    settings: { adminMobile: CENTER.phone, adminPin: '1234' } }; /* DEMO ONLY — production must use server-side authentication */
  const P = [['Priya Patil', 'F', 158, 61, 55, '9800000001', '1991-04-12', 10, 0],
    ['Rohit Deshmukh', 'M', 172, 76, 70, '9800000002', '1988-09-03', 10, 0],
    ['Neha Kulkarni', 'F', 160, 58, 54, '9800000003', '1995-01-22', 8, 1],
    ['Amit Jadhav', 'M', 170, 86, 78, '9800000004', '1983-07-30', 6, 3],
    ['Sneha Joshi', 'F', 163, 66, 60, '9800000005', '1990-11-15', 5, 4]];
  P.forEach((p, i) => {
    const id = 'M' + (i + 1), n = p[7], off = p[8];
    const m = { memberId: id, memberCode: 'SHC' + String(101 + i).padStart(6, '0'), fullName: p[0], mobile: p[5], pin: '1111', dob: p[6], gender: p[1], address: '', emergencyName: '', emergencyMobile: '', joinDate: addDays(T, -(n + off + 5)), status: 'Active', consent: true, photoConsent: false, deletionRequested: false, profile: null, createdAt: new Date().toISOString() };
    for (let k = 0; k < n; k++) {
      const w = +(p[3] - k * 0.25 + (k ? ((k * 7 + i) % 3 - 1) * 0.1 : 0)).toFixed(1);
      db.logs.push({ logId: 'L' + id + '_' + k, memberId: id, date: addDays(T, -(off + (n - 1 - k))), height: p[2], weight: w, bmi: bmiOf(w, p[2]), bp: k % 2 ? '118/78' : '120/80', sugar: 88 + (k * 5 + i * 3) % 14, pulse: 70 + (k + i) % 8, waist: null, hip: null, steps: 5500 + (k * 913 + i * 311) % 3500, water: 2 + (k % 3) * 0.5, sleep: 6 + (k % 4) * 0.5, activity: '', note: k ? '' : 'Day-1 baseline', createdAt: new Date(Date.now() - (n - k) * 864e5).toISOString(), by: 'Admin' });
    }
    const f = db.logs.find(l => l.memberId === id && l.note === 'Day-1 baseline');
    m.profile = { height: p[2], baselineWeight: f.weight, baselineBMI: f.bmi, baselineBP: f.bp, baselineSugar: f.sugar, baselinePulse: f.pulse, baselineWaist: null, baselineHip: null, goalWeight: p[4], goalDate: addDays(T, 90), createdAt: f.createdAt };
    for (let d = 0; d < 21; d++) if ((d + i) % 3 === 0) db.attendance.push({ attendanceId: uid('T'), memberId: id, date: addDays(T, -d), checkIn: '07:' + pad(10 + i * 5), checkOut: d ? '08:' + pad(10 + i * 5) : '', status: 'Present', markedBy: 'Member' });
    notify(db, id, 'Reminder', 'Please update your daily wellness log.', 'Daily reminder');
    db.members.push(m);
  });
  db.appointments.push(
    { appointmentId: 'AP1', memberId: 'M1', date: T, startTime: '18:00', endTime: '18:30', purpose: 'Progress review', status: 'Confirmed', notes: '', createdAt: new Date().toISOString() },
    { appointmentId: 'AP2', memberId: 'M2', date: T, startTime: '12:00', endTime: '12:30', purpose: 'Measurement update', status: 'Confirmed', notes: '', createdAt: new Date().toISOString() },
    { appointmentId: 'AP3', memberId: 'M3', date: addDays(T, 1), startTime: '10:00', endTime: '10:30', purpose: 'Nutrition consultation', status: 'Requested', notes: '', createdAt: new Date().toISOString() },
    { appointmentId: 'AP4', memberId: 'M4', date: addDays(T, 5), startTime: '17:00', endTime: '17:30', purpose: 'Progress review', status: 'Confirmed', notes: '', createdAt: new Date().toISOString() });
  db.events.push({ eventId: 'E1', memberId: 'ALL', title: 'Center wellness session', date: addDays(T, 1), startTime: '07:00', type: 'Club event' });
  db.updates.push({ updateId: 'U1', memberId: 'M1', date: addDays(T, -2), title: 'Morning walks', text: 'Started 30 minute morning walks this week.', author: 'Member', createdAt: new Date().toISOString() });
  return db;
}
/* ---------- IndexedDB: data snapshot, sync queue and photo cache (server mode) ---------- */
const IDB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('IndexedDB not available'));
      const r = indexedDB.open('sadhana_' + APP_KIND, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('media'); };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  tx(store, mode, fn) {
    if (!this.db) return Promise.resolve(undefined);
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode), rq = fn(t.objectStore(store));
      t.oncomplete = () => res(rq && rq.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  },
  get(store, key) { return this.tx(store, 'readonly', s => s.get(key)); },
  set(store, key, val) { return this.tx(store, 'readwrite', s => s.put(val, key)); },
  del(store, key) { return this.tx(store, 'readwrite', s => s.delete(key)); },
  clear(store) { return this.tx(store, 'readwrite', s => s.clear()); }
};

/* Store keeps the same simple API in both modes: load() -> copy of data, save(data) -> persists (+ queues sync). */
const Store = {
  mem: null, meta: null, ready: false,
  async init() {
    if (DEMO_MODE) { this.ready = true; return; }
    try { await IDB.open(); } catch (e) { console.warn('Local database unavailable; data will not survive a reload.', e); }
    this.mem = (await IDB.get('kv', 'db')) || emptyDb();
    this.meta = Object.assign(blankMeta(), (await IDB.get('kv', 'meta')) || {});
    this.ready = true;
    requestPersist();
  },
  load() {
    if (DEMO_MODE) {
      try { const r = localStorage.getItem(DB_KEY); if (r) return JSON.parse(r); } catch (e) { /* fall through to fresh data */ }
      const d = seed(); this.save(d); return d;
    }
    return JSON.parse(JSON.stringify(this.mem));
  },
  save(d) {
    if (DEMO_MODE) {
      try { localStorage.setItem(DB_KEY, JSON.stringify(d)); return true; }
      catch (e) { alert('Could not save — browser storage is full. Delete some photos and try again.'); return false; }
    }
    const ops = diffDb(this.mem, d);
    if (!ops.length) return true;
    ops.forEach(op => {
      if (op.coll === 'photos' && op.type === 'put' && op.rec.fileUrl) { op.media = op.rec.fileUrl; Media.put(op.id, op.rec.fileUrl); delete op.rec.fileUrl; }
      if (op.coll === 'photos' && op.type === 'del') Media.del(op.id);
    });
    this.mem = d;
    this.meta.outbox.push(...ops);
    this.persist();
    Sync.kick();
    setSync(navigator.onLine ? 'syncing' : 'offline');
    return true;
  },
  persist() {
    IDB.set('kv', 'db', this.mem).catch(e => console.warn('Local save failed', e));
    IDB.set('kv', 'meta', this.meta).catch(e => console.warn('Local save failed', e));
  },
  async wipe() {
    this.mem = emptyDb(); this.meta = blankMeta(); Media.cache = {};
    await Promise.all([IDB.clear('kv'), IDB.clear('media')]).catch(() => { });
  },
  reset() { localStorage.removeItem(DB_KEY); return this.load(); }   /* demo mode only */
};

function diffDb(a, b) {
  const ops = [];
  Object.keys(SYNC_COLLS).forEach(c => {
    const idk = SYNC_COLLS[c], old = new Map((a[c] || []).map(r => [r[idk], JSON.stringify(r)])), seen = new Set();
    (b[c] || []).forEach(r => { seen.add(r[idk]); if (old.get(r[idk]) !== JSON.stringify(r)) ops.push({ opId: uid('O'), coll: c, type: 'put', id: r[idk], rec: r }); });
    old.forEach((_, k) => { if (!seen.has(k)) ops.push({ opId: uid('O'), coll: c, type: 'del', id: k }); });
  });
  return ops;
}

/* Photos: image bytes live outside the records (IndexedDB on the phone, private Drive folder on the server). */
const Media = {
  cache: {}, loading: {}, failed: {},
  put(id, dataUrl) { this.cache[id] = dataUrl; return IDB.set('media', id, dataUrl).catch(() => { }); },
  del(id) { delete this.cache[id]; return IDB.del('media', id).catch(() => { }); },
  src(p) {
    if (p.fileUrl) return p.fileUrl;
    if (this.cache[p.photoId]) return this.cache[p.photoId];
    this.load(p);
    return '';
  },
  async data(p) { if (p.fileUrl) return p.fileUrl; delete this.failed[p.photoId]; await this.load(p); return this.cache[p.photoId] || ''; },
  async load(p) {
    const id = p.photoId;
    if (DEMO_MODE || this.loading[id] || (this.failed[id] && Date.now() - this.failed[id] < 60000)) return;
    this.loading[id] = 1;
    try {
      let d = await IDB.get('media', id);
      if (!d && Store.meta.token) { const r = await apiCall('getMedia', { photoId: id }); if (r.ok) { d = r.data; await IDB.set('media', id, d); } }
      if (d) { this.cache[id] = d; delete this.failed[id]; refreshUI(); } else this.failed[id] = Date.now();
    } catch (e) { this.failed[id] = Date.now(); }
    finally { delete this.loading[id]; }
  }
};
function photoImg(p, alt) {
  const s = Media.src(p);
  return s ? `<img src="${esc(s)}" alt="${esc(alt || 'photo')}">` : '<span class="muted">Loading photo…</span>';
}

/* ---------- sync engine ---------- */
function setSync(state) {
  Sync.state = state;
  const e = document.getElementById('sync'); if (!e) return;
  const n = (Store.meta && Store.meta.outbox.length) || 0;
  const map = { syncing: ['⟳ Syncing…', 'syncing'], synced: ['✓ Synced', 'ok'], offline: ['● Offline' + (n ? ' · ' + n + ' pending' : ''), 'off'], error: ['⚠ Sync issue' + (n ? ' · ' + n + ' pending' : ''), 'err'], demo: ['Demo mode', 'off'] };
  const m = map[state] || map.offline; e.textContent = m[0]; e.className = 'pill ' + m[1];
}
function refreshUI() {
  if (typeof render !== 'function') return;
  const a = document.activeElement, typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
  if (document.querySelector('.modal') || typing) { window.__needRender = true; return; }
  render();
}
setInterval(() => {
  if (!window.__needRender || document.querySelector('.modal')) return;
  const a = document.activeElement; if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
  window.__needRender = false; if (typeof render === 'function') render();
}, 1500);

const Sync = {
  state: 'idle', running: false, again: false, p: null, started: false, t: null,
  kick(ms) { clearTimeout(this.t); this.t = setTimeout(() => this.run(), ms == null ? 400 : ms); },
  start() {
    if (DEMO_MODE || this.started) return;
    this.started = true;
    setInterval(() => { if (!document.hidden) this.run({ poll: true }); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.run({ poll: true }); });
    window.addEventListener('online', () => this.run());
    window.addEventListener('offline', () => setSync('offline'));
    this.run();
  },
  run(opts) {
    if (DEMO_MODE || !Store.ready || !Store.meta.token) return Promise.resolve();
    if (this.running) { this.again = true; return this.p; }
    this.running = true;
    this.p = this._run(opts).finally(() => { this.running = false; });
    return this.p;
  },
  async _run(opts) {
    const m = Store.meta;
    setSync('syncing');
    try {
      do {
        this.again = false;
        if (opts && opts.poll && !m.outbox.length && !m.needFull) {
          const pg = await apiCall('ping', {}, 15000);
          if (pg.ok && pg.seq === m.since) break;
        }
        opts = null;
        const ops = m.outbox.slice(0, 25), since = (m.needFull && !m.outbox.length) ? 0 : m.since;
        const r = await apiCall('sync', { since, ops });
        if (!r.ok) {
          if (r.error === 'AUTH') { Auth.expired('Session expired. Please login again.'); return; }
          if (r.error === 'MUSTCHANGE') { m.user.mustChange = true; Store.persist(); refreshUI(); return; }
          throw new Error(r.error || 'Sync failed');
        }
        m.outbox = m.outbox.slice(ops.length);
        const rejected = (r.results || []).filter(x => !x.ok);
        if (rejected.length) { m.needFull = true; toast('Some changes were not accepted: ' + rejected[0].error); }
        else if (since === 0) m.needFull = false;
        const changed = applyServer(r);
        m.since = r.seq; m.lastSync = Date.now();
        if (r.full && m.user && m.user.role === 'member' && !Store.mem.members.length) { Auth.expired('Account not found. Please contact the center.'); return; }
        Store.persist();
        if (changed) refreshUI();
        if (m.outbox.length) this.again = true;
      } while (this.again);
      setSync('synced');
    } catch (e) {
      setSync(navigator.onLine ? 'error' : 'offline');
      this.kick(15000);
    }
  }
};
function applyServer(r) {
  let changed = false;
  const pend = {};
  Store.meta.outbox.forEach(o => { (pend[o.coll] = pend[o.coll] || new Set()).add(o.id); });
  Object.keys(SYNC_COLLS).forEach(c => {
    const idk = SYNC_COLLS[c], hold = pend[c] || new Set(), cur = Store.mem[c] || [];
    if (r.full) {
      const next = (r.changes[c] || []).filter(x => !hold.has(x[idk])).concat(cur.filter(x => hold.has(x[idk])));
      if (JSON.stringify(next) !== JSON.stringify(cur)) changed = true;
      Store.mem[c] = next; return;
    }
    (r.changes[c] || []).forEach(rec => {
      if (hold.has(rec[idk])) return;
      const i = cur.findIndex(x => x[idk] === rec[idk]);
      if (i < 0) { cur.push(rec); changed = true; }
      else if (JSON.stringify(cur[i]) !== JSON.stringify(rec)) { cur[i] = rec; changed = true; }
    });
    (r.deleted[c] || []).forEach(id => {
      if (hold.has(id)) return;
      const n = cur.length; Store.mem[c] = cur.filter(x => x[idk] !== id);
      if (Store.mem[c].length !== n) { changed = true; if (c === 'photos') Media.del(id); }
    });
    Store.mem[c] = Store.mem[c] || cur;
  });
  return changed;
}

/* ---------- login / session ---------- */
const Auth = {
  current() {
    if (DEMO_MODE) {
      if (APP_KIND === 'admin') return sessionStorage.getItem('sadhana_admin_session') === '1' ? { role: 'admin', memberId: '', name: 'Admin' } : null;
      const id = localStorage.getItem('sadhana_user_session');
      return id ? { role: 'member', memberId: id, name: '' } : null;
    }
    return Store.meta && Store.meta.token ? Store.meta.user : null;
  },
  mustChange() { return !DEMO_MODE && !!(Store.meta && Store.meta.token && Store.meta.user && Store.meta.user.mustChange); },
  async login(mobile, pin) {
    mobile = String(mobile || '').trim();
    if (DEMO_MODE) {
      const db = Store.load();
      if (APP_KIND === 'admin') {
        if (mobile === db.settings.adminMobile && pin === db.settings.adminPin) { sessionStorage.setItem('sadhana_admin_session', '1'); return null; }
        return 'Invalid mobile number or PIN.';
      }
      const m = db.members.find(x => x.mobile === mobile && x.pin === pin);
      if (!m) return 'Invalid mobile number or PIN.';
      localStorage.setItem('sadhana_user_session', m.memberId); return null;
    }
    let r;
    try { r = await apiCall('login', { kind: APP_KIND === 'admin' ? 'admin' : 'member', mobile, pin }); }
    catch (e) { return 'Cannot reach the server. Check your internet connection and try again.'; }
    if (!r.ok) return r.error || 'Login failed.';
    return this.adopt(r);
  },
  async adopt(r) {
    const prev = Store.meta.user;
    if (prev && (prev.role !== r.user.role || prev.memberId !== r.user.memberId)) await Store.wipe();
    Store.meta.token = r.token; Store.meta.user = r.user; Store.meta.since = 0; Store.meta.needFull = true;
    Store.persist();
    await Sync.run();
    return null;
  },
  async register(d) {
    if (DEMO_MODE) return null;
    let r;
    try { r = await apiCall('register', d); } catch (e) { return 'Cannot reach the server. Check your internet connection and try again.'; }
    if (!r.ok) return r.error || 'Registration failed.';
    return this.adopt(r);
  },
  async changePin(oldPin, newPin) {
    if (!/^\d{4,6}$/.test(newPin || '')) return 'PIN must be 4 to 6 digits.';
    if (oldPin === newPin) return 'Choose a PIN different from the current one.';
    if (DEMO_MODE) {
      const db = Store.load();
      if (APP_KIND === 'admin') { if (oldPin !== db.settings.adminPin) return 'Current PIN is incorrect.'; db.settings.adminPin = newPin; }
      else { const m = db.members.find(x => x.memberId === this.current().memberId); if (!m || m.pin !== oldPin) return 'Current PIN is incorrect.'; m.pin = newPin; }
      Store.save(db); return null;
    }
    let r;
    try { r = await apiCall('changePin', { oldPin, newPin }); } catch (e) { return 'Cannot reach the server. Check your internet connection.'; }
    if (!r.ok) return r.error || 'Could not change PIN.';
    Store.meta.token = r.token; Store.meta.user = r.user; Store.persist(); Sync.kick(100);
    return null;
  },
  async logout(force) {
    if (DEMO_MODE) { if (APP_KIND === 'admin') sessionStorage.removeItem('sadhana_admin_session'); else localStorage.removeItem('sadhana_user_session'); return { ok: true }; }
    try { await Sync.run(); } catch (e) { /* offline */ }
    if (Store.meta.outbox.length && !force) return { ok: false, pending: Store.meta.outbox.length };
    await Store.wipe();
    return { ok: true };
  },
  expired(msg) { Store.meta.token = ''; Store.persist(); window.__authMsg = msg || ''; setSync('offline'); if (typeof render === 'function') render(); }
};

/* ---------- phone storage + sync panel ---------- */
async function storageInfo() {
  const o = { usage: null, quota: null, persisted: null };
  try {
    if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); o.usage = e.usage; o.quota = e.quota; }
    if (navigator.storage && navigator.storage.persisted) o.persisted = await navigator.storage.persisted();
  } catch (e) { /* ignore */ }
  return o;
}
async function requestPersist() { try { return !!(navigator.storage && navigator.storage.persist && await navigator.storage.persist()); } catch (e) { return false; } }
const fmtBytes = n => (n == null ? '—' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
function syncPanelHtml() { return '<div id="syncPanel"><div class="muted">Loading…</div></div>'; }
async function fillSyncPanel() {
  const el = document.getElementById('syncPanel'); if (!el) return;
  const i = await storageInfo(), m = Store.meta;
  el.innerHTML = `<div class="card"><div class="row"><b>Sync & phone storage</b><span class="chip ${DEMO_MODE ? 'warn' : ''}">${DEMO_MODE ? 'Demo mode' : 'Server connected'}</span></div>
  <p class="muted" style="margin:8px 0">${DEMO_MODE ? 'Server not connected yet — data is stored only in this browser.' : 'Last sync: ' + (m.lastSync ? esc(new Date(m.lastSync).toLocaleString()) : 'never') + ' · Waiting to send: ' + m.outbox.length}</p>
  <p class="muted" style="margin:0 0 10px">Space used on this phone: ${esc(fmtBytes(i.usage))}${i.quota ? ' of ' + esc(fmtBytes(i.quota)) : ''} · Protected from auto-clean: ${i.persisted === null ? 'unknown' : i.persisted ? 'Yes ✓' : 'Not yet'}</p>
  <div class="two"><button class="btn secondary" data-act="syncNow">Sync now</button><button class="btn secondary" data-act="keepSafe">Keep data safe</button></div></div>`;
}
function syncNowAction() { if (DEMO_MODE) return toast('Demo mode — nothing to sync'); toast('Syncing…'); Sync.run().then(() => { fillSyncPanel(); toast(Sync.state === 'synced' ? 'Synced ✓' : 'Could not sync — check internet'); }); }
async function keepSafeAction() { const ok = await requestPersist(); toast(ok ? 'Phone storage is protected' : 'Not allowed by this browser. Install the app to the home screen and try again.'); fillSyncPanel(); }
const appUrl = kind => new URL('../' + kind + '-app/', location.href).href;

/* ---------- UI helpers ---------- */
function toast(t) {
  let e = document.getElementById('toast');
  if (!e) { e = document.createElement('div'); e.id = 'toast'; document.body.appendChild(e); }
  e.textContent = t; e.className = 'show';
  clearTimeout(toast.t); toast.t = setTimeout(() => { e.className = ''; }, 2200);
}
/* onSubmit(data) returns an error string (or a Promise of one) to keep the sheet open. opts.force = cannot be dismissed. */
function modal(title, html, onSubmit, btn, opts) {
  const force = !!(opts && opts.force);
  const w = document.createElement('div'); w.className = 'modal';
  w.innerHTML = `<form class="sheet"><div class="row"><h2>${esc(title)}</h2>${force ? '' : '<button type="button" class="x" aria-label="Close">✕</button>'}</div>${html}<div class="err" role="alert"></div><button class="btn wide">${esc(btn || 'Save')}</button></form>`;
  document.body.appendChild(w);
  const f = w.querySelector('form'), close = () => w.remove();
  if (!force) { w.querySelector('.x').onclick = close; w.addEventListener('click', e => { if (e.target === w) close(); }); }
  f.onsubmit = e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f)), b = f.querySelector('button.btn'); b.disabled = true;
    Promise.resolve(onSubmit(d)).then(err => { b.disabled = false; if (err) f.querySelector('.err').textContent = err; else close(); });
  };
}
function aboutHtml() {
  const o = CENTER.owners.map(p => `<div class="owner"><img src="${esc(p.photo)}" alt="${esc(p.name)}" width="96" height="96"><b>${esc(p.nameMr)}</b><small>${esc(p.name)}</small><span class="chip">${esc(p.roleMr)} · ${esc(p.role)}</span></div>`).join('');
  const other = APP_KIND === 'admin'
    ? `<a class="btn secondary wide" href="../user-app/" target="_blank" rel="noopener">Open Member app</a>`
    : `<a class="btn secondary wide" href="../admin-app/">Center staff? Open Admin app</a>`;
  return `<div class="section center"><img class="hero-logo" src="images/logo-full.png" alt="Sadhana Health Club logo" width="150" height="150"></div>
  <div class="section"><h2>About Us</h2><div class="card"><p style="margin:0 0 6px"><b>${esc(BRAND.mr)}</b><br><small>${esc(BRAND.en)}</small></p>
  <p class="muted" style="margin:0;font-size:13px">Daily health tracking, nutrition guidance and follow-ups with our wellness coaches.</p></div></div>
  <div class="section"><h2>Our Wellness Coaches</h2><div class="owners">${o}</div></div>
  <div class="section"><h2>Contact</h2><div class="card"><b>+91 ${esc(CENTER.phone)}</b><div class="muted">Call or WhatsApp</div>
  <div class="two" style="margin-top:10px"><a class="btn wide" href="tel:+91${esc(CENTER.phone)}">📞 Call</a><a class="btn secondary wide" href="https://wa.me/91${esc(CENTER.phone)}" target="_blank" rel="noopener">💬 WhatsApp</a></div></div></div>
  <div class="section">${other}</div>`;
}
function metric(a, b, c) { return `<div class="card metric"><span>${esc(a)}</span><b>${esc(b)}</b><small>${esc(c || '')}</small></div>`; }
function lineChart(pts, goal) {
  if (pts.length < 2) return '<div class="muted">Add at least two entries to see a trend.</div>';
  const W = 320, H = 160, P = 26, vals = pts.map(p => p.v).concat(goal != null ? [goal] : []);
  let mn = Math.min(...vals), mx = Math.max(...vals);
  if (mn === mx) { mn -= 1; mx += 1; }
  const x = i => P + i * (W - 2 * P) / (pts.length - 1), y = v => H - P - (v - mn) * (H - 2 * P) / (mx - mn);
  const path = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ');
  const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3"/>`).join('');
  const gl = goal != null ? `<line class="goal" x1="${P}" x2="${W - P}" y1="${y(goal).toFixed(1)}" y2="${y(goal).toFixed(1)}"/><text x="${W - P}" y="${(y(goal) - 4).toFixed(1)}" text-anchor="end">Goal ${goal}</text>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight trend">${gl}<path d="${path}"/>${dots}
  <text x="${P}" y="${H - 6}">${esc(pts[0].l)} · ${pts[0].v}</text><text x="${W - P}" y="${H - 6}" text-anchor="end">${esc(pts[pts.length - 1].l)} · ${pts[pts.length - 1].v}</text></svg>`;
}
function resizeImage(file, max = 480) {
  return new Promise((res, rej) => {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u); res(c.toDataURL('image/jpeg', 0.6));
    };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Not a valid image')); };
    img.src = u;
  });
}
function download(name, text, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
/* CSV export; cells starting with = + - @ are prefixed to block spreadsheet formula injection */
function toCSV(rows) {
  return rows.map(r => r.map(c => { let s = String(c == null ? '' : c); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }).join(',')).join('\r\n');
}
