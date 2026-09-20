/**
 * साधना हेल्थ अँड न्यूट्रिशन सेंटर — Google Apps Script JSON API (starter)
 *
 * SETUP
 *  1. Paste your Google Sheet ID below (Sheet tabs/columns: database/GOOGLE_SHEET_SCHEMA.csv).
 *  2. Project Settings > Script properties: add ADMIN_KEY = a long random secret. Never commit it to GitHub.
 *  3. Deploy > New deployment > Web app (Execute as: Me). Copy the URL into js/api.js (API_URL) of both apps.
 *
 * SECURITY NOTE
 *  Every action except "config" currently requires the ADMIN_KEY (sent as `key`), so nothing is public by default.
 *  Before the member app talks to this API you MUST add per-member authentication
 *  (login + hashed PIN + session token) and check that a member can only read/write their own rows.
 *  Also add: rate limiting, consent validation, audit logging and private photo storage (Drive folder, not public).
 */
const SPREADSHEET_ID = 'PASTE_GOOGLE_SHEET_ID_HERE';

function doGet(e) {
  try {
    const a = (e.parameter.action || 'config');
    if (a === 'config') return json({ ok: true, service: 'Sadhana Health & Nutrition Center API', version: '1.1' });
    if (!isAdmin(e.parameter.key)) return json({ ok: false, error: 'Unauthorized' });
    if (a === 'members') return json({ ok: true, data: rows('MEMBERS').map(stripSecrets) });
    if (a === 'member') return json({ ok: true, data: (rows('MEMBERS').map(stripSecrets).find(x => String(x.memberId) === String(e.parameter.id))) || null });
    return json({ ok: false, error: 'Unknown GET action' });
  } catch (x) { return json({ ok: false, error: 'Server error' }); }
}

function doPost(e) {
  try {
    const b = JSON.parse((e.postData && e.postData.contents) || '{}');
    if (!b.action) return json({ ok: false, error: 'Missing action' });
    if (!isAdmin(b.key)) return json({ ok: false, error: 'Unauthorized' });
    delete b.key;
    switch (b.action) {
      case 'createDailyHealthLog': return add('DAILY_HEALTH_LOG', b, 'logId');   // append only — history is never overwritten
      case 'createHealthUpdate': return add('HEALTH_UPDATES', b, 'updateId');
      case 'createAppointment': return add('APPOINTMENTS', b, 'appointmentId');
      case 'createMember': return add('MEMBERS', b, 'memberId');
      default: return json({ ok: false, error: 'Unknown POST action' });
    }
  } catch (x) { return json({ ok: false, error: 'Server error' }); }
}

function isAdmin(k) {
  const key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  return !!key && !!k && k === key;
}
function stripSecrets(r) { const c = Object.assign({}, r); delete c.pinHash; return c; }
function sh(n) { const s = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(n); if (!s) throw Error('Missing sheet ' + n); return s; }
function rows(n) {
  const v = sh(n).getDataRange().getValues();
  if (v.length < 2) return [];
  return v.slice(1).map(r => Object.fromEntries(v[0].map((h, i) => [h, r[i]])));
}
// Cells starting with = + - @ are prefixed with ' so user text can never run as a spreadsheet formula.
function safeCell(v) { return (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v; }
function add(n, b, id) {
  const s = sh(n), h = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  b[id] = b[id] || Utilities.getUuid();
  b.createdAt = new Date();
  s.appendRow(h.map(k => (b[k] === undefined || b[k] === null) ? '' : safeCell(b[k])));
  return json({ ok: true, data: b });
}
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
