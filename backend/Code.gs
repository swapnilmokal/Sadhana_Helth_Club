/**
 * साधना हेल्थ अँड न्यूट्रिशन सेंटर — Google Apps Script backend (v2)
 * Sadhana Health & Nutrition Center
 *
 * WHAT THIS DOES
 *  - Stores all data in your Google Sheet (one tab per table) — you can open the Sheet and read it.
 *  - Member + admin login with mobile number and PIN (PIN stored only as a salted hash), lockout after 5 wrong tries.
 *  - PIN reset by admin, PIN change by the user.
 *  - Sync: both apps send their changes here and pull everyone else's changes, so user-app and admin-app stay in sync.
 *  - Photos are stored in a PRIVATE Google Drive folder (never public); only the owner member and admin can read them.
 *  - Automatic daily backup (copy of the Sheet in Drive folder "Sadhana_Backups") + "Backup now" from the admin app.
 *
 * SETUP (short version — full steps in docs/SETUP_MARATHI.md)
 *  1. Create a Google Sheet. Open Extensions > Apps Script (or paste the Sheet ID below).
 *  2. Paste this whole file, set the admin PIN in ADMINS below (4-6 digits), Save.
 *  3. Run  setup()  once (allow permissions). Then run  installTriggers()  once.
 *  4. Replace the PIN in ADMINS with 'x' (it is no longer needed) and Save.
 *  5. Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone > Deploy. Copy the Web app URL
 *     into config.js in your GitHub repository.
 */

const SPREADSHEET_ID = 'PASTE_GOOGLE_SHEET_ID_HERE'; // leave as is when the script is opened from the Sheet itself
const ADMINS = [{ mobile: '9702389779', name: 'Bhagwan Mokal', pin: 'CHANGE_ME' }]; // used once by setup()
const OPEN_REGISTRATION = true;   // false = only the admin can add members
const TIMEZONE = 'Asia/Kolkata';
const TOKEN_DAYS = 30, MAX_FAILS = 5, LOCK_MIN = 15, BACKUP_KEEP = 30;

let CTX = {};

/* ---------- table definitions (first 5 columns + readable columns + json) ---------- */
const COLLS = {
  members: { sheet: 'MEMBERS', id: 'memberId', cols: ['memberCode', 'fullName', 'mobile', 'status', 'joinDate', 'dob', 'gender', 'address', 'emergencyName', 'emergencyMobile', 'photoConsent', 'deletionRequested'] },
  logs: { sheet: 'DAILY_HEALTH_LOG', id: 'logId', cols: ['date', 'weight', 'height', 'bmi', 'bp', 'sugar', 'pulse', 'waist', 'hip', 'steps', 'water', 'sleep', 'activity', 'note', 'by'] },
  photos: { sheet: 'BEFORE_AFTER_PHOTOS', id: 'photoId', cols: ['type', 'view', 'date', 'caption', 'consent', 'fileId'] },
  updates: { sheet: 'HEALTH_UPDATES', id: 'updateId', cols: ['date', 'title', 'text', 'author'] },
  appointments: { sheet: 'APPOINTMENTS', id: 'appointmentId', cols: ['date', 'startTime', 'endTime', 'purpose', 'status', 'notes'] },
  events: { sheet: 'CALENDAR', id: 'eventId', cols: ['title', 'date', 'startTime', 'type'] },
  notifications: { sheet: 'NOTIFICATIONS', id: 'notificationId', cols: ['title', 'message', 'type', 'sentAt', 'readAt', 'status'] },
  attendance: { sheet: 'ATTENDANCE', id: 'attendanceId', cols: ['date', 'checkIn', 'checkOut', 'status', 'markedBy'] },
  notes: { sheet: 'MEMBER_NOTES', id: 'noteId', cols: ['note', 'createdBy', 'createdAt'] },
  audit: { sheet: 'AUDIT_LOG', id: 'logId', cols: ['actorId', 'actorRole', 'action', 'entity', 'entityId', 'newData', 'timestamp'] },
  staff: { sheet: 'STAFF', id: 'staffId', cols: ['name', 'mobile', 'role', 'status'] }
};
const KEYS = {
  appointments: ['appointmentId', 'memberId', 'date', 'startTime', 'endTime', 'purpose', 'status', 'notes', 'createdAt', 'updatedAt'],
  events: ['eventId', 'memberId', 'title', 'date', 'startTime', 'type'],
  notifications: ['notificationId', 'memberId', 'title', 'message', 'type', 'sentAt', 'readAt', 'status'],
  attendance: ['attendanceId', 'memberId', 'date', 'checkIn', 'checkOut', 'status', 'markedBy', 'createdAt'],
  notes: ['noteId', 'memberId', 'note', 'createdBy', 'createdAt'],
  staff: ['staffId', 'name', 'mobile', 'role', 'status'],
  updates: ['updateId', 'memberId', 'date', 'title', 'text', 'author', 'createdAt'],
  photos: ['photoId', 'memberId', 'type', 'view', 'date', 'caption', 'consent', 'createdAt', 'fileId'],
  audit: ['logId', 'actorId', 'actorRole', 'action', 'entity', 'entityId', 'newData', 'timestamp']
};
const AUTH_COLS = ['userId', 'role', 'mobile', 'salt', 'hash', 'fails', 'lockedUntil', 'mustChange', 'tv', 'name', 'updatedAt'];

/* ---------- entry points ---------- */
function doGet() {
  return json({ ok: true, service: 'Sadhana Health & Nutrition Center API', version: '2.0', configured: !!prop('TOKEN_SECRET') });
}
function doPost(e) {
  CTX = {};
  let out;
  try {
    out = route(JSON.parse((e && e.postData && e.postData.contents) || '{}'));
  } catch (x) {
    if (!(x && x.validation)) console.error(x && x.stack ? x.stack : x);
    out = { ok: false, error: x && x.validation ? x.message : 'Server error' };
  }
  return json(out);
}
function route(b) {
  switch (b.action) {
    case 'ping': return { ok: true, seq: currentSeq() };
    case 'login': return actLogin(b);
    case 'register': return actRegister(b);
  }
  const u = authUser(b.token);
  if (!u) return { ok: false, error: 'AUTH' };
  switch (b.action) {
    case 'sync': return actSync(u, b);
    case 'changePin': return actChangePin(u, b);
    case 'getMedia': return actGetMedia(u, b);
  }
  if (u.role !== 'admin') return { ok: false, error: 'Forbidden' };
  switch (b.action) {
    case 'adminCreateMember': return actCreateMember(u, b);
    case 'adminResetPin': return actResetPin(u, b);
    case 'adminCreateAdmin': return actCreateAdmin(u, b);
    case 'backupNow': return { ok: true, name: doBackup() };
  }
  return { ok: false, error: 'Unknown action' };
}

/* ---------- one-time setup ---------- */
function setup() {
  ADMINS.forEach(a => { if (!/^[6-9]\d{9}$/.test(a.mobile) || !/^\d{4,6}$/.test(a.pin)) throw new Error('Set a valid mobile and a 4-6 digit PIN in ADMINS, then run setup() again.'); });
  Object.keys(COLLS).forEach(k => {
    const c = COLLS[k];
    const s = ss().getSheetByName(c.sheet) || ss().insertSheet(c.sheet);
    if (s.getLastRow() === 0) { s.getRange(1, 1, 1, head(c).length).setValues([head(c)]); s.setFrozenRows(1); }
  });
  let a = ss().getSheetByName('AUTH');
  if (!a) a = ss().insertSheet('AUTH');
  a.getRange('A:K').setNumberFormat('@');   // keep mobile numbers and hashes as text
  if (a.getLastRow() === 0) { a.getRange(1, 1, 1, AUTH_COLS.length).setValues([AUTH_COLS]); a.setFrozenRows(1); }
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('TOKEN_SECRET')) p.setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid());
  if (!p.getProperty('SEQ')) p.setProperty('SEQ', '0');
  if (!p.getProperty('MEMBER_COUNTER')) p.setProperty('MEMBER_COUNTER', '100');
  CTX = {};
  ADMINS.forEach(ad => {
    if (!authAll().some(x => x.role === 'admin' && String(x.mobile) === ad.mobile)) createAuth('admin', 'A_' + ad.mobile, ad.mobile, ad.pin, ad.name, false);
  });
  console.log('Setup complete. Now run installTriggers(), replace the PIN in ADMINS with x, and deploy the Web app.');
}
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'backupNow') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('backupNow').timeBased().everyDays(1).atHour(2).create();
}
function backupNow() { doBackup(); }

/* ---------- helpers: sheets ---------- */
function ss() {
  if (!CTX.ss) CTX.ss = SPREADSHEET_ID.indexOf('PASTE_') === 0 ? SpreadsheetApp.getActiveSpreadsheet() : SpreadsheetApp.openById(SPREADSHEET_ID);
  return CTX.ss;
}
function head(c) { return ['id', 'memberId', 'seq', 'deleted', 'updatedAt'].concat(c.cols, ['json']); }
function sh(coll) {
  const s = ss().getSheetByName(COLLS[coll].sheet);
  if (!s) throw new Error('Sheet missing — run setup() first');
  return s;
}
function prop(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function currentSeq() { return Number(prop('SEQ') || 0); }
function nextSeq() { const n = currentSeq() + 1; PropertiesService.getScriptProperties().setProperty('SEQ', String(n)); return n; }
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function withLock(fn) {
  const l = LockService.getScriptLock();
  l.waitLock(25000);
  try { CTX.auth = null; CTX.idx = null; return fn(); } finally { l.releaseLock(); }
}
function V(msg) { const e = new Error(msg); e.validation = true; throw e; }
function bad(msg) { return { ok: false, error: msg }; }

function idIndex(coll) {
  CTX.idx = CTX.idx || {};
  if (CTX.idx[coll]) return CTX.idx[coll];
  const s = sh(coll), n = s.getLastRow() - 1, m = {};
  if (n > 0) s.getRange(2, 1, n, 1).getValues().forEach((r, i) => { m[String(r[0])] = i + 2; });
  CTX.idx[coll] = m;
  return m;
}
function getRec(coll, id) {
  const row = idIndex(coll)[id];
  if (!row) return null;
  const c = COLLS[coll], v = sh(coll).getRange(row, 1, 1, 6 + c.cols.length).getValues()[0];
  return { row: row, deleted: Number(v[3]) === 1, rec: JSON.parse(v[5 + c.cols.length]) };
}
function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}
function putRec(coll, rec, deleted) {
  const c = COLLS[coll], id = String(rec[c.id]), s = sh(coll), seq = nextSeq();
  const mid = coll === 'members' ? id : (rec.memberId == null ? '' : String(rec.memberId));
  const row = [id, mid, seq, deleted ? 1 : 0, new Date().toISOString()].concat(c.cols.map(k => cell(rec[k])), [JSON.stringify(rec)]);
  const idx = idIndex(coll);
  if (idx[id]) s.getRange(idx[id], 1, 1, row.length).setValues([row]);
  else { s.appendRow(row); idx[id] = s.getLastRow(); }
  return seq;
}

/* ---------- helpers: auth ---------- */
function hex(bytes) { return bytes.map(b => ((b < 0 ? b + 256 : b)).toString(16).padStart(2, '0')).join(''); }
function hashPin(pin, salt) {
  let h = salt + ':' + pin;
  for (let i = 0; i < 150; i++) h = hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt));
  return h;
}
function authAll() {
  if (CTX.auth) return CTX.auth;
  const s = ss().getSheetByName('AUTH');
  if (!s) throw new Error('Sheet missing — run setup() first');
  const n = s.getLastRow() - 1;
  const v = n > 0 ? s.getRange(2, 1, n, AUTH_COLS.length).getValues() : [];
  CTX.auth = v.map((r, i) => { const o = { row: i + 2 }; AUTH_COLS.forEach((k, j) => { o[k] = r[j]; }); return o; });
  return CTX.auth;
}
function authSave(o) {
  const s = ss().getSheetByName('AUTH');
  o.updatedAt = new Date().toISOString();
  const vals = AUTH_COLS.map(k => (o[k] === undefined || o[k] === null ? '' : String(o[k])));
  if (o.row) s.getRange(o.row, 1, 1, AUTH_COLS.length).setValues([vals]);
  else { s.appendRow(vals); o.row = s.getLastRow(); }
  CTX.auth = null;
}
function createAuth(role, userId, mobile, pin, name, mustChange) {
  const salt = Utilities.getUuid().replace(/-/g, '');
  const o = { userId: userId, role: role, mobile: mobile, salt: salt, hash: hashPin(pin, salt), fails: 0, lockedUntil: 0, mustChange: mustChange ? 1 : 0, tv: 1, name: name };
  authSave(o);
  return o;
}
function setPin(a, pin, mustChange) {
  a.salt = Utilities.getUuid().replace(/-/g, '');
  a.hash = hashPin(pin, a.salt);
  a.fails = 0; a.lockedUntil = 0; a.mustChange = mustChange ? 1 : 0; a.tv = (Number(a.tv) || 0) + 1;
  authSave(a);
}
function bumpTv(id) { const a = authAll().find(x => String(x.userId) === id); if (a) { a.tv = (Number(a.tv) || 0) + 1; authSave(a); } }
function sign(s) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(s, prop('TOKEN_SECRET'))); }
function makeToken(a) {
  const p = Utilities.base64EncodeWebSafe(JSON.stringify({ u: String(a.userId), tv: Number(a.tv) || 0, exp: Date.now() + TOKEN_DAYS * 864e5 }));
  return p + '.' + sign(p);
}
function authUser(t) {
  if (typeof t !== 'string') return null;
  const i = t.indexOf('.');
  if (i < 1) return null;
  const p = t.slice(0, i);
  if (sign(p) !== t.slice(i + 1)) return null;
  let o;
  try { o = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(p)).getDataAsString()); } catch (e) { return null; }
  if (!o || !(o.exp > Date.now())) return null;
  const a = authAll().find(x => String(x.userId) === String(o.u));
  if (!a || Number(a.tv) !== o.tv) return null;
  return { role: String(a.role), memberId: a.role === 'member' ? String(a.userId) : '', name: String(a.name || ''), authRow: a };
}
function pubUser(a) { return { role: String(a.role), memberId: a.role === 'member' ? String(a.userId) : '', name: String(a.name || ''), mustChange: String(a.mustChange) === '1' }; }
function vmobile(m) { m = String(m == null ? '' : m).trim(); if (!/^[6-9]\d{9}$/.test(m)) V('Enter a valid 10-digit mobile number.'); return m; }
function vpin(p) { p = String(p == null ? '' : p); if (!/^\d{4,6}$/.test(p)) V('PIN must be 4 to 6 digits.'); return p; }

/* ---------- actions: login / register / pin ---------- */
function actLogin(b) {
  const kind = b.kind === 'admin' ? 'admin' : 'member', mobile = String(b.mobile || '').trim(), pin = String(b.pin || '');
  const fail = 'Invalid mobile number or PIN.';
  if (!/^\d{10}$/.test(mobile) || !/^\d{4,6}$/.test(pin)) return bad(fail);
  const a = authAll().find(x => String(x.role) === kind && String(x.mobile) === mobile);
  if (!a) return bad(fail);
  if (Number(a.lockedUntil) > Date.now()) return bad('Too many wrong attempts. Try again in ' + Math.ceil((Number(a.lockedUntil) - Date.now()) / 60000) + ' minutes.');
  if (hashPin(pin, String(a.salt)) !== String(a.hash)) {
    return withLock(() => {
      const f = authAll().find(x => String(x.userId) === String(a.userId));
      f.fails = (Number(f.fails) || 0) + 1;
      if (f.fails >= MAX_FAILS) { f.fails = 0; f.lockedUntil = Date.now() + LOCK_MIN * 60000; }
      authSave(f);
      return bad(fail);
    });
  }
  if (kind === 'member') {
    const m = getRec('members', String(a.userId));
    if (!m || m.deleted) return bad(fail);
    if (m.rec.status === 'Inactive') return bad('Your account is inactive. Please contact the center.');
  }
  if (Number(a.fails) > 0) withLock(() => { const f = authAll().find(x => String(x.userId) === String(a.userId)); f.fails = 0; authSave(f); });
  return { ok: true, token: makeToken(a), user: pubUser(a) };
}
function actRegister(b) {
  if (!OPEN_REGISTRATION) return bad('Registration is closed. Please contact the center.');
  const cache = CacheService.getScriptCache(), n = Number(cache.get('reg') || 0);
  if (n >= 30) return bad('Too many registrations. Please try later.');
  const name = String(b.fullName || '').trim();
  if (name.length < 2 || name.length > 60) return bad('Enter your full name.');
  const mobile = vmobile(b.mobile), pin = vpin(b.pin);
  if (b.consent !== true) return bad('Consent is required to register.');
  cache.put('reg', String(n + 1), 3600);
  return withLock(() => {
    if (authAll().some(x => x.role === 'member' && String(x.mobile) === mobile)) return bad('This mobile number is already registered.');
    const m = newMember({ fullName: name, mobile: mobile, dob: sdate(b.dob), gender: ['F', 'M', 'O'].indexOf(b.gender) >= 0 ? b.gender : '' }, 'Pending');
    putRec('members', m);
    putRec('notifications', { notificationId: 'N' + uid(), memberId: m.memberId, title: 'Welcome', message: 'Welcome to Sadhana Health & Nutrition Center. Please add your Day-1 baseline.', type: 'Welcome', sentAt: new Date().toISOString(), readAt: '', status: 'Sent' });
    const a = createAuth('member', m.memberId, mobile, pin, name, false);
    return { ok: true, token: makeToken(a), user: pubUser(a) };
  });
}
function actCreateMember(u, b) {
  const d = b.member || {}, name = String(d.fullName || '').trim();
  if (name.length < 2 || name.length > 60) return bad('Enter the member name.');
  const mobile = vmobile(d.mobile), pin = vpin(b.pin);
  if (d.consent !== true) return bad('Member consent is required.');
  return withLock(() => {
    if (authAll().some(x => x.role === 'member' && String(x.mobile) === mobile)) return bad('This mobile number is already registered.');
    const m = newMember({ fullName: name, mobile: mobile, dob: sdate(d.dob), gender: ['F', 'M', 'O'].indexOf(d.gender) >= 0 ? d.gender : '' }, 'Active');
    putRec('members', m);
    putRec('notifications', { notificationId: 'N' + uid(), memberId: m.memberId, title: 'Welcome', message: 'Welcome to Sadhana Health & Nutrition Center.', type: 'Welcome', sentAt: new Date().toISOString(), readAt: '', status: 'Sent' });
    createAuth('member', m.memberId, mobile, pin, name, true);   // member must set own PIN at first login
    serverAudit(u, 'createMember', 'MEMBERS', m.memberId, name);
    return { ok: true, memberId: m.memberId };
  });
}
function actResetPin(u, b) {
  const id = String(b.memberId || ''), pin = vpin(b.pin);
  return withLock(() => {
    const a = authAll().find(x => x.role === 'member' && String(x.userId) === id);
    if (!a) return bad('Member not found.');
    setPin(a, pin, true);
    serverAudit(u, 'resetPin', 'MEMBERS', id, '');
    return { ok: true };
  });
}
function actCreateAdmin(u, b) {
  const mobile = vmobile(b.mobile), pin = vpin(b.pin), name = String(b.name || '').trim().slice(0, 60);
  if (name.length < 2) return bad('Enter a name.');
  return withLock(() => {
    if (authAll().some(x => x.role === 'admin' && String(x.mobile) === mobile)) return bad('This mobile already has admin access.');
    createAuth('admin', 'A_' + mobile, mobile, pin, name, true);
    serverAudit(u, 'createAdmin', 'ADMINS', mobile, name);
    return { ok: true };
  });
}
function actChangePin(u, b) {
  const np = vpin(b.newPin);
  return withLock(() => {
    const a = authAll().find(x => String(x.userId) === String(u.authRow.userId));
    if (!a || hashPin(String(b.oldPin || ''), String(a.salt)) !== String(a.hash)) return bad('Current PIN is incorrect.');
    setPin(a, np, false);
    return { ok: true, token: makeToken(a), user: pubUser(a) };
  });
}
function newMember(d, status) {
  const p = PropertiesService.getScriptProperties(), n = Number(p.getProperty('MEMBER_COUNTER') || 100) + 1;
  p.setProperty('MEMBER_COUNTER', String(n));
  const today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  return { memberId: 'M' + uid(), memberCode: 'SHC' + String(n).padStart(6, '0'), fullName: d.fullName, mobile: d.mobile, dob: d.dob || '', gender: d.gender || '', address: '', emergencyName: '', emergencyMobile: '', joinDate: today, status: status, consent: true, photoConsent: false, deletionRequested: false, profile: null, createdAt: new Date().toISOString() };
}
function uid() { return Utilities.getUuid().replace(/-/g, '').slice(0, 14); }
function serverAudit(u, action, entity, entityId, detail) {
  putRec('audit', { logId: 'A' + uid(), actorId: u.authRow.userId, actorRole: 'Admin', action: action, entity: entity, entityId: entityId, newData: String(detail || '').slice(0, 200), timestamp: new Date().toISOString() });
}

/* ---------- sync ---------- */
function canRead(u, k) { return u.role === 'admin' || (k !== 'notes' && k !== 'audit' && k !== 'staff'); }
function visible(u, k, memberId, id) {
  if (u.role === 'admin') return true;
  if (k === 'members') return id === u.memberId;
  if (k === 'events') return memberId === 'ALL' || memberId === u.memberId;
  return memberId === u.memberId;
}
function actSync(u, b) {
  if (String(u.authRow.mustChange) === '1') return bad('MUSTCHANGE');
  const ops = Array.isArray(b.ops) ? b.ops.slice(0, 100) : [];
  const since = Math.max(0, Number(b.since) || 0);
  let results = [];
  if (ops.length) {
    withLock(() => {
      results = ops.map(op => {
        try { return Object.assign({ opId: op && op.opId }, applyOp(u, op || {})); }
        catch (e) { if (!e.validation) console.error(e && e.stack ? e.stack : e); return { opId: op && op.opId, ok: false, error: e.validation ? e.message : 'Server error' }; }
      });
    });
  }
  const r = readChanges(u, since);
  return { ok: true, results: results, changes: r.changes, deleted: r.deleted, seq: r.seq, full: since === 0 };
}
function readChanges(u, since) {
  const out = { changes: {}, deleted: {}, seq: currentSeq() };
  Object.keys(COLLS).forEach(k => {
    if (!canRead(u, k)) return;
    const c = COLLS[k], s = sh(k), last = s.getLastRow();
    if (last < 2) return;
    const seqs = s.getRange(2, 3, last - 1, 1).getValues(), width = 6 + c.cols.length, runs = [];
    seqs.forEach((r, i) => {
      if (Number(r[0]) > since) { const row = i + 2; if (runs.length && runs[runs.length - 1][1] === row - 1) runs[runs.length - 1][1] = row; else runs.push([row, row]); }
    });
    runs.forEach(run => {
      s.getRange(run[0], 1, run[1] - run[0] + 1, width).getValues().forEach(r => {
        const id = String(r[0]), mid = String(r[1]);
        if (!visible(u, k, mid, id)) return;
        if (Number(r[3]) === 1) { if (since > 0) (out.deleted[k] = out.deleted[k] || []).push(id); }
        else (out.changes[k] = out.changes[k] || []).push(JSON.parse(r[5 + c.cols.length]));
      });
    });
  });
  return out;
}

/* ---------- validation ---------- */
const sstr = (v, max) => String(v == null ? '' : v).slice(0, max);
function sdate(v) { v = v == null ? '' : String(v); if (v !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) V('Invalid date.'); return v; }
function stime(v) { v = v == null ? '' : String(v); if (v !== '' && !/^\d{2}:\d{2}$/.test(v)) V('Invalid time.'); return v; }
function num(v, a, b) { if (v === null || v === undefined || v === '') return null; const n = Number(v); if (!isFinite(n) || n < a || n > b) V('A number is out of range.'); return n; }
function clean(coll, rec) {
  const o = {};
  KEYS[coll].forEach(k => {
    let v = rec[k];
    if (v === undefined) return;
    if (v !== null && typeof v === 'object') V('Invalid field.');
    if (typeof v === 'string') v = v.slice(0, 500);
    o[k] = v;
  });
  return o;
}
function vlog(rec, me, by) {
  const w = num(rec.weight, 20, 300), h = num(rec.height, 80, 250);
  if (w === null || h === null) V('Weight and height are required.');
  const bp = sstr(rec.bp, 10);
  if (bp) { const m = /^(\d{2,3})\/(\d{2,3})$/.exec(bp); if (!m || +m[1] < 60 || +m[1] > 260 || +m[2] < 30 || +m[2] > 160 || +m[1] <= +m[2]) V('Invalid BP.'); }
  const date = sdate(rec.date); if (!date) V('Date is required.');
  return { logId: String(rec.logId), memberId: me, date: date, height: h, weight: w, bmi: num(rec.bmi, 1, 200), bp: bp, sugar: num(rec.sugar, 20, 600), pulse: num(rec.pulse, 30, 220), waist: num(rec.waist, 30, 200), hip: num(rec.hip, 30, 200), steps: num(rec.steps, 0, 100000), water: num(rec.water, 0, 15), sleep: num(rec.sleep, 0, 24), activity: sstr(rec.activity, 100), note: sstr(rec.note, 300), createdAt: sstr(rec.createdAt, 40) || new Date().toISOString(), by: by };
}
function vprofile(p) {
  if (!p || typeof p !== 'object') V('Invalid profile.');
  return { height: num(p.height, 80, 250), baselineWeight: num(p.baselineWeight, 20, 300), baselineBMI: num(p.baselineBMI, 1, 200), baselineBP: sstr(p.baselineBP, 10), baselineSugar: num(p.baselineSugar, 20, 600), baselinePulse: num(p.baselinePulse, 30, 220), baselineWaist: num(p.baselineWaist, 30, 200), baselineHip: num(p.baselineHip, 30, 200), goalWeight: num(p.goalWeight, 20, 300), goalDate: sdate(p.goalDate), createdAt: sstr(p.createdAt, 40) };
}
function vperson(rec, upd) {
  if (rec.fullName !== undefined) { const n = sstr(rec.fullName, 60).trim(); if (n.length < 2) V('Enter a name.'); upd.fullName = n; }
  if (rec.dob !== undefined) upd.dob = sdate(rec.dob);
  if (rec.gender !== undefined) { if (['F', 'M', 'O', ''].indexOf(rec.gender) < 0) V('Invalid gender.'); upd.gender = rec.gender; }
  if (rec.address !== undefined) upd.address = sstr(rec.address, 150);
  if (rec.emergencyName !== undefined) upd.emergencyName = sstr(rec.emergencyName, 60);
  if (rec.emergencyMobile !== undefined) { const m = String(rec.emergencyMobile || ''); if (m && !/^[6-9]\d{9}$/.test(m)) V('Invalid emergency mobile.'); upd.emergencyMobile = m; }
  if (rec.photoConsent !== undefined) upd.photoConsent = rec.photoConsent === true;
  if (rec.deletionRequested !== undefined) upd.deletionRequested = rec.deletionRequested === true;
  upd.updatedAt = new Date().toISOString();
}

/* ---------- apply one change, with permission rules ---------- */
function applyOp(u, op) {
  const c = COLLS[op.coll];
  if (!c) return bad('Unknown table');
  const id = String(op.id == null ? '' : op.id);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return bad('Bad id');
  if (op.type !== 'put' && op.type !== 'del') return bad('Bad operation');
  const ex = getRec(op.coll, id);
  if (op.type === 'del') return u.role === 'admin' ? adminDel(op.coll, id, ex) : memberDel(u, op.coll, id, ex);
  const rec = op.rec;
  if (!rec || typeof rec !== 'object' || String(rec[c.id]) !== id) return bad('Bad record');
  if (JSON.stringify(rec).length > 20000) return bad('Record too large');
  if (ex && ex.deleted) return bad('Record was deleted');
  return u.role === 'admin' ? adminPut(op, rec, ex) : memberPut(u, op, rec, ex);
}
function saveMedia(photoId, dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+\/=]+)$/.exec(String(dataUrl || ''));
  if (!m) V('Photo is missing or not a valid image.');
  const bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > 600000) V('Photo is too large.');
  const file = folderByName('Sadhana_Private_Photos').createFile(Utilities.newBlob(bytes, m[1], photoId + '.jpg'));
  return file.getId();
}
function trashMedia(fileId) { try { if (fileId) DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { console.error(e); } }
function newPhoto(op, rec, me) {
  const o = clean('photos', rec);
  if (['BEFORE', 'AFTER'].indexOf(o.type) < 0 || ['front', 'side', 'back'].indexOf(o.view) < 0) V('Invalid photo details.');
  if (o.consent !== true) V('Photo consent is required.');
  o.memberId = me; o.date = sdate(o.date); o.caption = sstr(o.caption, 100);
  o.fileId = saveMedia(o.photoId, op.media);
  return o;
}
function memberPut(u, op, rec, ex) {
  const me = u.memberId, k = op.coll;
  if (k === 'members') {
    if (String(rec.memberId) !== me || !ex) return bad('Not allowed');
    const old = ex.rec, upd = Object.assign({}, old);
    vperson(rec, upd);
    if (rec.profile) {
      if (!old.profile) upd.profile = vprofile(rec.profile);
      else upd.profile = Object.assign({}, old.profile, { goalWeight: num(rec.profile.goalWeight, 20, 300), goalDate: sdate(rec.profile.goalDate) });
    }
    putRec(k, upd); return { ok: true };
  }
  if (k === 'logs') { if (ex || rec.memberId !== me) return bad('Not allowed'); putRec(k, vlog(rec, me, 'Member')); return { ok: true }; }
  if (k === 'updates') {
    if (ex || rec.memberId !== me) return bad('Not allowed');
    const o = clean(k, rec); o.memberId = me; o.author = 'Member'; o.date = sdate(o.date);
    if (sstr(o.title, 80).trim().length < 2) V('Enter a title.');
    putRec(k, o); return { ok: true };
  }
  if (k === 'photos') { if (ex || rec.memberId !== me) return bad('Not allowed'); putRec(k, newPhoto(op, rec, me)); return { ok: true }; }
  if (k === 'appointments') {
    if (!ex) {
      if (rec.memberId !== me) return bad('Not allowed');
      const o = clean(k, rec); o.memberId = me; o.status = 'Requested'; o.notes = ''; o.date = sdate(o.date); o.startTime = stime(o.startTime); o.endTime = stime(o.endTime); o.purpose = sstr(o.purpose, 60);
      putRec(k, o); return { ok: true };
    }
    if (ex.rec.memberId !== me || ['Requested', 'Confirmed'].indexOf(ex.rec.status) < 0 || rec.status !== 'Cancelled') return bad('Not allowed');
    putRec(k, Object.assign({}, ex.rec, { status: 'Cancelled', updatedAt: new Date().toISOString() })); return { ok: true };
  }
  if (k === 'attendance') {
    if (ex || rec.memberId !== me) return bad('Not allowed');
    const o = clean(k, rec); o.memberId = me; o.markedBy = 'Member'; o.status = 'Present'; o.checkOut = ''; o.date = sdate(o.date); o.checkIn = stime(o.checkIn);
    putRec(k, o); return { ok: true };
  }
  if (k === 'notifications') {
    if (!ex || ex.rec.memberId !== me) return bad('Not allowed');
    putRec(k, Object.assign({}, ex.rec, { readAt: sstr(rec.readAt, 40), status: rec.readAt ? 'Read' : ex.rec.status })); return { ok: true };
  }
  if (k === 'audit') {
    if (ex || rec.actorId !== me) return bad('Not allowed');
    const o = clean(k, rec); o.actorRole = 'Member'; putRec(k, o); return { ok: true };
  }
  return bad('Not allowed');
}
function adminPut(op, rec, ex) {
  const k = op.coll;
  if (k === 'members') {
    if (!ex) return bad('Use Add member');
    const old = ex.rec, upd = Object.assign({}, old);
    vperson(rec, upd);
    if (rec.status !== undefined) { if (['Active', 'Pending', 'Inactive'].indexOf(rec.status) < 0) V('Invalid status.'); upd.status = rec.status; if (rec.status === 'Inactive' && old.status !== 'Inactive') bumpTv(String(old.memberId)); }
    if (rec.joinDate !== undefined) upd.joinDate = sdate(rec.joinDate);
    if (rec.profile !== undefined && rec.profile !== null) upd.profile = vprofile(rec.profile);
    if (rec.mobile !== undefined && String(rec.mobile) !== String(old.mobile)) {
      const m = vmobile(rec.mobile);
      if (authAll().some(a => a.role === 'member' && String(a.mobile) === m && String(a.userId) !== String(old.memberId))) V('This mobile number is already registered.');
      const a = authAll().find(x => x.role === 'member' && String(x.userId) === String(old.memberId));
      if (a) { a.mobile = m; authSave(a); }
      upd.mobile = m;
    }
    putRec(k, upd); return { ok: true };
  }
  if (k === 'logs') {
    if (ex) return bad('Health history is never overwritten');
    if (!getRec('members', String(rec.memberId))) return bad('Member not found');
    putRec(k, vlog(rec, String(rec.memberId), 'Admin')); return { ok: true };
  }
  if (k === 'photos') {
    if (ex) { putRec(k, Object.assign({}, ex.rec, { caption: sstr(rec.caption, 100) })); return { ok: true }; }
    if (!getRec('members', String(rec.memberId))) return bad('Member not found');
    putRec(k, newPhoto(op, rec, String(rec.memberId))); return { ok: true };
  }
  if (k === 'audit' && ex) return bad('Audit log is append-only');
  const o = clean(k, rec);
  if (k === 'notes') o.createdBy = 'Admin';
  if (k === 'updates') { o.author = 'Admin'; o.date = sdate(o.date); }
  if (k === 'appointments') { o.date = sdate(o.date); o.startTime = stime(o.startTime); o.endTime = stime(o.endTime); }
  if (k === 'events') { o.date = sdate(o.date); o.startTime = stime(o.startTime); o.memberId = o.memberId || 'ALL'; }
  if (k === 'attendance') { o.date = sdate(o.date); o.checkIn = stime(o.checkIn); o.checkOut = stime(o.checkOut); }
  if (k === 'audit') o.actorRole = 'Admin';
  putRec(k, o); return { ok: true };
}
function adminDel(k, id, ex) {
  if (k === 'audit') return bad('Audit log is append-only');
  if (!ex || ex.deleted) return { ok: true };
  putRec(k, ex.rec, true);
  if (k === 'photos') trashMedia(ex.rec.fileId);
  if (k === 'members') { const a = authAll().find(x => x.role === 'member' && String(x.userId) === id); if (a) ss().getSheetByName('AUTH').deleteRow(a.row); CTX.auth = null; }
  return { ok: true };
}
function memberDel(u, k, id, ex) {
  if (k !== 'photos' || !ex || ex.deleted || ex.rec.memberId !== u.memberId) return bad('Not allowed');
  putRec(k, ex.rec, true); trashMedia(ex.rec.fileId); return { ok: true };
}

/* ---------- photos (private Drive folder) ---------- */
function actGetMedia(u, b) {
  const ex = getRec('photos', String(b.photoId || ''));
  if (!ex || ex.deleted || !ex.rec.fileId) return bad('Not found');
  if (u.role !== 'admin' && ex.rec.memberId !== u.memberId) return bad('Forbidden');
  const blob = DriveApp.getFileById(ex.rec.fileId).getBlob();
  return { ok: true, data: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
}
function folderByName(name) {
  const it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

/* ---------- backup ---------- */
function doBackup() {
  const folder = folderByName('Sadhana_Backups');
  const name = 'Sadhana_Backup_' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd_HH-mm');
  DriveApp.getFileById(ss().getId()).makeCopy(name, folder);
  const files = [], it = folder.getFiles();
  while (it.hasNext()) { const f = it.next(); files.push({ f: f, t: f.getDateCreated().getTime() }); }
  files.sort((a, b) => b.t - a.t).slice(BACKUP_KEEP).forEach(x => x.f.setTrashed(true));
  return name;
}
