/* साधना हेल्थ अँड न्यूट्रिशन सेंटर — Admin App (demo mode: data stays in this browser) */
'use strict';
let db = null, tab = 'dashboard', sub = null, view = null, q = '', sf = 'All';
const $c = () => document.getElementById('content');
const mem = id => db.members.find(m => m.memberId === id);
const nm = id => (mem(id) || { fullName: 'Removed member' }).fullName;
const commit = () => Store.save(db);
const log = (action, entity, id, detail) => audit(db, 'ADMIN', 'Admin', action, entity, id, detail);
const plus30 = t => { const [h, m] = t.split(':').map(Number), e = new Date(2000, 0, 1, h, m + 30); return pad(e.getHours()) + ':' + pad(e.getMinutes()); };
const memberSelect = () => `<label>Member<select name="memberId">${db.members.map(m => `<option value="${esc(m.memberId)}">${esc(m.fullName)} (${esc(m.memberCode)})</option>`).join('')}</select></label>`;
const waLink = m => 'https://wa.me/91' + m.mobile + '?text=' + encodeURIComponent('नमस्कार ' + m.fullName + ', ' + BRAND.mr + ' चे मेंबर अ‍ॅप येथे उघडा: ' + appUrl('user') + '\nलॉगिन: तुमचा मोबाईल नंबर ' + m.mobile + ' + PIN (PIN सेंटरकडून मिळेल).');
const statusChip = s => `<span class="chip ${s === 'Active' ? '' : s === 'Pending' ? 'warn' : 'bad'}">${esc(s)}</span>`;

function setTab(t) { tab = t; sub = null; view = null; render(); window.scrollTo(0, 0); }

function render() {
  db = Store.load();
  const u = Auth.current();
  document.querySelector('.app').classList.toggle('noauth', !u);
  if (!u) { loginView(); return; }
  if (Auth.mustChange()) {
    $c().innerHTML = '<div class="section center"><div class="muted">Please set a new PIN to continue.</div></div>';
    if (!document.querySelector('.modal')) A.changePin(true);
    return;
  }
  document.querySelectorAll('.nav button').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  if (view) { memberView(); return; }
  ({ dashboard: dashView, members: membersView, reports: reportsView, calendar: calendarView, more: moreView })[tab]();
}

/* ---------- login ---------- */
function loginView() {
  const msg = window.__authMsg || ''; window.__authMsg = '';
  $c().innerHTML = `<div class="section center"><img class="hero-logo" src="images/logo-full.png" alt="Sadhana Health Club — Admin App" width="140" height="140"></div>
  <div class="section"><h2>Admin Login</h2>${msg ? `<div class="notice" style="margin-bottom:10px">${esc(msg)}</div>` : ''}
  <form id="lf" class="card">
  <label>Admin mobile number<input name="mobile" inputmode="numeric" maxlength="10" autocomplete="username" required></label>
  <label>PIN<input name="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password" required></label>
  <div class="err"></div><button class="btn wide">Login</button></form>
  ${DEMO_MODE ? `<div class="notice" style="margin-top:12px">Demo mode — admin mobile ${esc(CENTER.phone)}, PIN 1234. Data is stored only in this browser. Connect the server (config.js) for real use.</div>` : ''}
  <p class="center"><a href="../user-app/">Member app →</a></p></div>`;
  document.getElementById('lf').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('button.btn');
    btn.disabled = true; btn.textContent = 'Please wait…';
    const d = Object.fromEntries(new FormData(f)), err = await Auth.login(d.mobile, d.pin);
    btn.disabled = false; btn.textContent = 'Login';
    if (err) f.querySelector('.err').textContent = err; else { tab = 'dashboard'; render(); }
  };
}

/* ---------- dashboard ---------- */
function dashView() {
  const T = today(), ms = db.members, act = ms.filter(m => m.status === 'Active');
  const lasts = ms.map(m => latestLog(db, m.memberId)).filter(Boolean);
  const avg = k => lasts.length ? (lasts.reduce((s, l) => s + l[k], 0) / lasts.length).toFixed(1) : '—';
  const missed = act.filter(m => { const l = latestLog(db, m.memberId); return !l || l.date < addDays(T, -2); }).length;
  const recent = db.logs.slice().sort(byNew).slice(0, 6);
  const dels = ms.filter(m => m.deletionRequested).length;
  $c().innerHTML = `<div class="section"><h2>Center overview</h2><div class="grid">
  ${metric('Total members', ms.length, act.length + ' active')}${metric('Visits today', db.attendance.filter(a => a.date === T).length, 'check-ins')}
  ${metric('Updates today', db.logs.filter(l => l.date === T).length, 'health logs')}${metric('Appointments', db.appointments.filter(a => a.date === T && a.status !== 'Cancelled').length, 'today')}</div></div>
  ${dels ? `<div class="notice" style="margin-bottom:12px">${dels} member(s) requested account deletion — open the member profile to review.</div>` : ''}
  <div class="section"><div class="card"><b>Needs attention</b><div class="grid" style="margin-top:10px">
  ${metric('Pending verification', ms.filter(m => m.status === 'Pending').length, 'new members')}${metric('Appointment requests', db.appointments.filter(a => a.status === 'Requested').length, 'to confirm')}
  ${metric('Follow-ups', missed, 'no update 3+ days')}${metric('Avg weight / BMI', avg('weight') + ' / ' + avg('bmi'), 'latest values')}</div></div></div>
  <div class="section"><h2>Recent member updates</h2><div class="list cols">${recent.map(l => `<div class="item" data-act="open" data-id="${esc(l.memberId)}"><div class="row"><b>${esc(nm(l.memberId))}</b><span class="chip">${fmtDate(l.date)}</span></div>
  <div class="muted">Weight ${esc(l.weight)} kg · BMI ${esc(l.bmi)} · BP ${esc(dash(l.bp))} · Sugar ${esc(dash(l.sugar))}</div></div>`).join('') || '<div class="muted">No updates yet.</div>'}</div></div>`;
}

/* ---------- members ---------- */
function membersView() {
  $c().innerHTML = `<div class="section"><div class="row"><h2>Members</h2><button class="btn small" data-act="addMember">＋ Add member</button></div>
  <input id="q" class="search" placeholder="Search name, code or mobile…" value="${esc(q)}">
  <select id="sf" class="search">${['All', 'Active', 'Pending', 'Inactive'].map(s => `<option ${s === sf ? 'selected' : ''}>${s}</option>`).join('')}</select><div id="ml" class="list cols"></div></div>`;
  const draw = () => {
    const t = q.toLowerCase();
    const rows = db.members.filter(m => (sf === 'All' || m.status === sf) && (m.fullName + ' ' + m.memberCode + ' ' + m.mobile).toLowerCase().includes(t));
    document.getElementById('ml').innerHTML = rows.map(m => { const l = latestLog(db, m.memberId); return `<div class="item" data-act="open" data-id="${esc(m.memberId)}"><div class="row"><div><b>${esc(m.fullName)}</b><div class="muted">${esc(m.memberCode)} · Last update ${l ? fmtDate(l.date) : '—'}</div></div>${statusChip(m.status)}</div>
    <div class="muted">${l ? `Weight ${esc(l.weight)} kg · BMI ${esc(l.bmi)} · BP ${esc(dash(l.bp))} · Sugar ${esc(dash(l.sugar))}` : 'No measurements yet'}</div></div>`; }).join('') || '<div class="muted">No members found.</div>';
  };
  document.getElementById('q').oninput = e => { q = e.target.value; draw(); };
  document.getElementById('sf').onchange = e => { sf = e.target.value; draw(); };
  draw();
}

function memberView() {
  const m = mem(view); if (!m) { view = null; return render(); }
  const id = esc(m.memberId), L = latestLog(db, m.memberId), logs = memberLogs(db, m.memberId), p = m.profile, pct = goalPct(m, L && L.weight), T = today();
  const ph = db.photos.filter(x => x.memberId === m.memberId && x.consent && m.photoConsent);
  const aps = db.appointments.filter(a => a.memberId === m.memberId).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  const notes = db.notes.filter(n => n.memberId === m.memberId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const ups = db.updates.filter(u => u.memberId === m.memberId).sort(byNew).slice(0, 8);
  const att = db.attendance.find(a => a.memberId === m.memberId && a.date === T);
  $c().innerHTML = `<button class="back" data-act="close">← All members</button>
  <div class="card"><div class="row"><div><b style="font-size:18px">${esc(m.fullName)}</b><div class="muted">${esc(m.memberCode)} · Mobile ${esc(m.mobile)} · Joined ${fmtDate(m.joinDate)}</div>
  <div class="muted">DOB ${esc(dash(m.dob))} · Gender ${esc(dash(m.gender))} · Emergency ${esc(dash(m.emergencyName))} ${esc(m.emergencyMobile)}</div></div>${statusChip(m.status)}</div>
  <div style="margin-top:10px" class="two"><button class="btn" data-act="editMember" data-id="${id}">✎ Edit details</button><button class="btn secondary" data-act="resetPin" data-id="${id}">🔑 Reset PIN</button></div>
  <div style="margin-top:8px" class="two">${m.status === 'Pending' ? `<button class="btn" data-act="verify" data-id="${id}">Verify member</button>` : `<button class="btn secondary" data-act="toggleStatus" data-id="${id}">${m.status === 'Active' ? 'Mark inactive' : 'Mark active'}</button>`}
  <button class="btn secondary" data-act="notifyMember" data-id="${id}">Send notification</button></div>
 <a class="btn secondary wide" style="margin-top:8px" href="${esc(waLink(m))}" target="_blank" rel="noopener">💬 Send Member app link on WhatsApp</a>
  ${m.deletionRequested ? `<div class="notice" style="margin-top:10px">Member requested account deletion. <button class="btn small danger" data-act="deleteMember" data-id="${id}">Delete all member data</button></div>` : ''}</div>
  <div class="section"><div class="grid">${metric('Weight', dash(L && L.weight), 'kg')}${metric('BMI', dash(L && L.bmi), 'tracking metric')}${metric('BP', dash(L && L.bp), 'mmHg')}${metric('Sugar', dash(L && L.sugar), 'mg/dL')}</div></div>
  ${pct == null ? '' : `<div class="card"><div class="row"><b>Goal progress</b><b>${pct}%</b></div><div class="progress"><i style="width:${pct}%"></i></div><small>Target ${esc(p.goalWeight)} kg${p.goalDate ? ' by ' + fmtDate(p.goalDate) : ''}</small></div>`}
  <div class="section"><h2>Weight trend</h2><div class="card">${lineChart(logs.slice(0, 30).reverse().map(l => ({ l: fmtDate(l.date), v: l.weight })), p ? p.goalWeight : null)}</div></div>
  <div class="section"><div class="row"><h2>Measurements</h2>${p ? `<button class="btn small" data-act="addLog" data-id="${id}">＋ Add measurement</button>` : `<button class="btn small" data-act="baseline" data-id="${id}">Record Day-1 baseline</button>`}</div>
  <div class="list cols">${logs.slice(0, 10).map(x => `<div class="item"><div class="row"><b>${fmtDate(x.date)}</b><span class="chip">${esc(x.weight)} kg</span></div><div class="muted">BMI ${esc(x.bmi)} · BP ${esc(dash(x.bp))} · Sugar ${esc(dash(x.sugar))} · Pulse ${esc(dash(x.pulse))} · Steps ${esc(dash(x.steps))} · by ${esc(x.by || '')}</div>${x.note ? `<div style="font-size:13px">${esc(x.note)}</div>` : ''}</div>`).join('') || '<div class="muted">No measurements yet.</div>'}</div></div>
  <div class="section"><h2>Before & After photos</h2>${ph.length ? `<div class="photos">${ph.map(x => `<div><div class="photo">${photoImg(x, x.type)}</div><small>${esc(x.type)} · ${esc(x.view)} · ${fmtDate(x.date)}</small></div>`).join('')}</div>` : '<div class="muted">No photos shared (photos are shown only with the member\'s consent).</div>'}</div>
  <div class="section"><h2>Member wellness notes</h2><div class="list">${ups.map(u => `<div class="item"><div class="row"><b>${esc(u.title)}</b><small>${fmtDate(u.date)}</small></div><div style="font-size:13px">${esc(u.text)}</div></div>`).join('') || '<div class="muted">None.</div>'}</div></div>
  <div class="section"><div class="row"><h2>Follow-up notes</h2><button class="btn small" data-act="addNote" data-id="${id}">＋ Add</button></div><div class="list">${notes.map(n => `<div class="item"><div class="row"><b>${esc(n.createdBy)}</b><small>${fmtDate(n.createdAt.slice(0, 10))} ${esc(n.createdAt.slice(11, 16))}</small></div><div style="font-size:13px">${esc(n.note)}</div></div>`).join('') || '<div class="muted">None.</div>'}</div></div>
  <div class="section"><div class="row"><h2>Appointments</h2><button class="btn small" data-act="book" data-id="${id}">＋ Book</button></div><div class="list">${aps.map(a => `<div class="item"><div class="row"><b>${fmtDate(a.date)} · ${fmtTime(a.startTime)}</b><span class="chip ${a.status === 'Requested' ? 'warn' : a.status === 'Cancelled' ? 'bad' : ''}">${esc(a.status)}</span></div><div class="muted">${esc(a.purpose)}</div></div>`).join('') || '<div class="muted">None.</div>'}</div></div>
  <div class="section"><h2>Attendance today</h2><div class="two">${att ? `<div class="item">In ${esc(fmtTime(att.checkIn))}${att.checkOut ? ' · Out ' + esc(fmtTime(att.checkOut)) : ''}</div>${att.checkOut ? '' : `<button class="btn secondary" data-act="checkout" data-id="${id}">Check-out</button>`}` : `<button class="btn secondary" data-act="checkin" data-id="${id}">Mark check-in</button>`}</div></div>`;
}

/* ---------- reports ---------- */
function reportsView() {
  const T = today(), act = db.members.filter(m => m.status === 'Active'), n = act.length || 1;
  const cov = d => Math.round(act.filter(m => memberLogs(db, m.memberId).some(l => l.date >= addDays(T, -d + 1))).length / n * 100);
  const gp = act.map(m => goalPct(m, (latestLog(db, m.memberId) || {}).weight)).filter(v => v != null);
  const bars = [['Updated in last 7 days', cov(7)], ['Updated in last 30 days', cov(30)], ['Goals set', Math.round(act.filter(m => m.profile && m.profile.goalWeight).length / n * 100)], ['Average goal progress', gp.length ? Math.round(gp.reduce((a, b) => a + b, 0) / gp.length) : 0]];
  const visits = act.map(m => [m.fullName, db.attendance.filter(a => a.memberId === m.memberId && a.date >= addDays(T, -29)).length]).sort((a, b) => b[1] - a[1]);
  const cnt = s => db.appointments.filter(a => a.status === s).length;
  $c().innerHTML = `<div class="section"><h2>Reports & analytics</h2><div class="grid">${metric('Members', db.members.length)}${metric('Active', act.length)}${metric('Health logs / 30 days', db.logs.filter(l => l.date >= addDays(T, -29)).length)}${metric('Visits / 30 days', db.attendance.filter(a => a.date >= addDays(T, -29)).length)}</div></div>
  <div class="section"><div class="card"><b>Tracking coverage (active members)</b>${bars.map(b => `<p style="margin:10px 0 0">${b[0]} · ${b[1]}%</p><div class="progress"><i style="width:${b[1]}%"></i></div>`).join('')}</div></div>
  <div class="section"><div class="card"><b>Appointments</b><div class="muted">Requested ${cnt('Requested')} · Confirmed ${cnt('Confirmed')} · Completed ${cnt('Completed')} · Cancelled ${cnt('Cancelled')}</div></div></div>
  <div class="section"><h2>Visits — last 30 days</h2><div class="list cols">${visits.map(v => `<div class="item"><div class="row"><span>${esc(v[0])}</span><b>${v[1]}</b></div></div>`).join('')}</div></div>
  <div class="section"><h2>Export</h2><div class="two"><button class="btn secondary" data-act="csvMembers">Members CSV</button><button class="btn secondary" data-act="csvLogs">Health logs CSV</button></div><button class="btn secondary wide" data-act="csvAtt" style="margin-top:8px">Attendance CSV</button></div>`;
}

/* ---------- calendar ---------- */
function calendarView() {
  const T = today(), ap = db.appointments.slice();
  const open = ap.filter(a => a.date >= T && ['Requested', 'Confirmed'].includes(a.status)).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  const past = ap.filter(a => !open.includes(a)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  const evs = db.events.filter(e => e.date >= T).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  const btn = (a, st, t, c) => `<button class="btn small ${c || 'secondary'}" data-act="apptSet" data-id="${esc(a.appointmentId)}" data-st="${st}">${t}</button>`;
  $c().innerHTML = `<div class="section"><div class="row"><h2>Appointments & follow-ups</h2><button class="btn small" data-act="book">＋ Book</button></div><div class="list cols">
  ${open.map(a => `<div class="item"><div class="row"><b>${fmtDate(a.date)} · ${fmtTime(a.startTime)}</b><span class="chip ${a.status === 'Requested' ? 'warn' : ''}">${esc(a.status)}</span></div><div class="muted">${esc(nm(a.memberId))} · ${esc(a.purpose)}</div>
  <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${a.status === 'Requested' ? btn(a, 'Confirmed', 'Confirm', '') : ''}${btn(a, 'Completed', 'Complete')}${btn(a, 'Cancelled', 'Cancel', 'danger')}</div></div>`).join('') || '<div class="muted">No upcoming appointments.</div>'}</div></div>
  <div class="section"><div class="row"><h2>Center events</h2><button class="btn small secondary" data-act="addEvent">＋ Event</button></div><div class="list cols">${evs.map(e => `<div class="item"><div class="row"><b>${fmtDate(e.date)} · ${fmtTime(e.startTime)}</b><span class="chip">${esc(e.type)}</span></div><div class="muted">${esc(e.title)}</div></div>`).join('') || '<div class="muted">No upcoming events.</div>'}</div></div>
  ${past.length ? `<div class="section"><h2>Earlier</h2><div class="list cols">${past.map(a => `<div class="item"><div class="row"><b>${fmtDate(a.date)} · ${esc(nm(a.memberId))}</b><span class="chip ${a.status === 'Cancelled' ? 'bad' : ''}">${esc(a.status)}</span></div><div class="muted">${esc(a.purpose)}</div></div>`).join('')}</div></div>` : ''}`;
}

/* ---------- more ---------- */
function moreView() {
  const back = '<button class="back" data-act="back">← Back</button>', T = today();
  if (sub === 'attend') {
    const rows = db.members.filter(m => m.status === 'Active').map(m => {
      const a = db.attendance.find(x => x.memberId === m.memberId && x.date === T), id = esc(m.memberId);
      return `<div class="item"><div class="row"><div><b>${esc(m.fullName)}</b><div class="muted">${a ? 'In ' + esc(fmtTime(a.checkIn)) + (a.checkOut ? ' · Out ' + esc(fmtTime(a.checkOut)) : '') : 'Not checked in'}</div></div>
      ${!a ? `<button class="btn small" data-act="checkin" data-id="${id}">Check-in</button>` : a.checkOut ? '<span class="chip">Done</span>' : `<button class="btn small secondary" data-act="checkout" data-id="${id}">Check-out</button>`}</div></div>`;
    }).join('');
    $c().innerHTML = `${back}<div class="section"><h2>Attendance — ${fmtDate(T)}</h2><div class="list cols">${rows || '<div class="muted">No active members.</div>'}</div></div>`;
  } else if (sub === 'notif') {
    const ns = db.notifications.slice().sort((a, b) => b.sentAt.localeCompare(a.sentAt)).slice(0, 40);
    $c().innerHTML = `${back}<div class="section"><div class="row"><h2>Notifications</h2><button class="btn small" data-act="announce">＋ Send</button></div><div class="list cols">
    ${ns.map(n => `<div class="item"><div class="row"><b>${esc(n.title)}</b><span class="chip ${n.readAt ? '' : 'warn'}">${n.readAt ? 'Read' : 'Sent'}</span></div><div class="muted">${esc(nm(n.memberId))} · ${fmtDate(n.sentAt.slice(0, 10))}</div><div style="font-size:13px">${esc(n.message)}</div></div>`).join('')}</div></div>`;
  } else if (sub === 'staff') {
    $c().innerHTML = `${back}<div class="section"><div class="row"><h2>Staff & roles</h2><button class="btn small" data-act="addStaff">＋ Add</button></div><div class="list cols">
    ${db.staff.map(s => `<div class="item"><div class="row"><b>${esc(s.name)}</b><span class="chip">${esc(s.status)}</span></div><div class="muted">${esc(s.role)}${s.mobile ? ' · ' + esc(s.mobile) : ''}</div></div>`).join('')}</div></div>
    <div class="notice">Role-based permissions are enforced by the server in production (see docs).</div>`;
  } else if (sub === 'audit') {
    $c().innerHTML = `${back}<div class="section"><h2>Audit log</h2><div class="list cols">${db.audit.slice().reverse().slice(0, 60).map(a => `<div class="item"><div class="row"><b>${esc(a.action)}</b><small>${fmtDate(a.timestamp.slice(0, 10))} ${esc(a.timestamp.slice(11, 16))}</small></div><div class="muted">${esc(a.actorRole)} · ${esc(a.entity)} ${esc(a.entityId)} ${esc(a.newData)}</div></div>`).join('') || '<div class="muted">No entries yet.</div>'}</div></div>`;
  } else if (sub === 'about') {
    $c().innerHTML = back + aboutHtml();
  } else if (sub === 'settings') {
    $c().innerHTML = `${back}<div class="section"><h2>Sync, backup & settings</h2>${syncPanelHtml()}
    <div class="card" style="margin-top:12px"><p style="margin-top:0"><b>${esc(BRAND.mr)}</b><br><small>${esc(BRAND.en)}</small></p>
    <p class="muted">Logged in as ${esc((Auth.current() || {}).name || 'Admin')} · Center number ${esc(CENTER.phone)}</p>
    <button class="btn secondary wide" data-act="changePin">Change my PIN</button></div>
    <div class="card" style="margin-top:12px"><b>Backup</b><p class="muted" style="margin:6px 0 10px">${DEMO_MODE ? 'Download a copy of all data (with photos) to this phone.' : 'The server also keeps an automatic daily backup copy of the Google Sheet in Google Drive (folder Sadhana_Backups). Photos are kept in the private Drive folder Sadhana_Private_Photos.'}</p>
    <button class="btn secondary wide" data-act="backup">Download full backup (JSON)</button>
    ${DEMO_MODE ? '' : '<button class="btn secondary wide" data-act="serverBackup">Back up on server now</button>'}
    ${DEMO_MODE ? '<button class="btn danger wide" data-act="resetDemo">Reset demo data</button>' : ''}</div></div>`;
    fillSyncPanel();
  } else {
    const row = (k, t) => `<div class="item" data-act="sub" data-id="${k}"><div class="row"><b>${t}</b><span class="muted">›</span></div></div>`;
    $c().innerHTML = `<div class="section"><h2>More</h2><div class="list cols">${row('attend', '✓ Attendance')}${row('notif', '🔔 Notifications')}${row('staff', '👥 Staff & roles')}${row('audit', '📜 Audit log')}${row('about', 'ℹ️ About & Contact')}${row('settings', '⚙️ Sync, backup & settings')}<a class="item" style="display:block;text-decoration:none;color:inherit" href="../user-app/" target="_blank" rel="noopener"><div class="row"><b>📱 Open Member app</b><span class="muted">↗</span></div></a><div class="item" data-act="shareLink"><div class="row"><b>🔗 Share Member app link</b><span class="muted">›</span></div></div><div class="item" data-act="logout"><b>⎋ Logout</b></div></div></div>`;
  }
}

/* ---------- actions ---------- */
function apptFields(withMember) {
  return `${withMember ? memberSelect() : ''}<div class="two"><label>Date<input type="date" name="date" min="${today()}" value="${today()}" required></label><label>Time<input type="time" name="time" value="10:00" required></label></div>
  <label>Purpose<select name="purpose"><option>Progress review</option><option>Nutrition consultation</option><option>Measurement update</option><option>Other</option></select></label>`;
}
const A = {
  back() { sub = null; render(); },
  sub(id) { sub = id; render(); window.scrollTo(0, 0); },
  open(id) { view = id; render(); window.scrollTo(0, 0); },
  close() { view = null; render(); },
  async logout() {
    const r = await Auth.logout();
    if (!r.ok && r.pending) {
      if (!confirm(r.pending + ' change(s) have not reached the server yet and will be lost if you log out. Log out anyway?')) return;
      await Auth.logout(true);
    }
    view = null; sub = null; render();
  },
  syncNow: syncNowAction,
  keepSafe: keepSafeAction,
  async shareLink() {
    const url = appUrl('user'), text = BRAND.mr + ' — Member app: ' + url;
    if (navigator.share) { try { await navigator.share({ title: BRAND.en, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch (e) { prompt('Copy this link', url); }
  },
  editMember(id) {
    const m = mem(id), p = m.profile, opt = (v, arr) => arr.map(a => `<option value="${a[0]}" ${v === a[0] ? 'selected' : ''}>${a[1]}</option>`).join('');
    modal('Edit member — ' + m.fullName, `<label>Full name<input name="fullName" maxlength="60" value="${esc(m.fullName)}" required></label>
    <label>Login mobile number<input name="mobile" inputmode="numeric" maxlength="10" value="${esc(m.mobile)}" required></label>
    <div class="two"><label>Date of birth<input type="date" name="dob" value="${esc(m.dob)}" max="${today()}"></label><label>Gender<select name="gender">${opt(m.gender, [['F', 'Female'], ['M', 'Male'], ['O', 'Other']])}</select></label></div>
    <label>Address<input name="address" maxlength="150" value="${esc(m.address)}"></label>
    <div class="two"><label>Emergency contact<input name="emergencyName" maxlength="60" value="${esc(m.emergencyName)}"></label><label>Emergency mobile<input name="emergencyMobile" inputmode="numeric" maxlength="10" value="${esc(m.emergencyMobile)}"></label></div>
    <div class="two"><label>Status<select name="status">${opt(m.status, [['Active', 'Active'], ['Pending', 'Pending'], ['Inactive', 'Inactive']])}</select></label><label>Joined on<input type="date" name="joinDate" value="${esc(m.joinDate)}"></label></div>
    ${p ? `<div class="two"><label>Height (cm)<input name="height" type="number" step="0.1" value="${esc(p.height)}"></label><label>Goal weight (kg)<input name="goalWeight" type="number" step="0.1" value="${esc(p.goalWeight)}"></label></div><label>Goal date<input type="date" name="goalDate" value="${esc(p.goalDate)}"></label>` : ''}`, d => {
      if ((d.fullName || '').trim().length < 2) return 'Enter the member name.';
      if (!/^[6-9]\d{9}$/.test((d.mobile || '').trim())) return 'Enter a valid 10-digit mobile number.';
      if (d.emergencyMobile && !/^[6-9]\d{9}$/.test(d.emergencyMobile)) return 'Emergency mobile must be 10 digits.';
      db = Store.load(); const mm = mem(id); if (!mm) return 'Member not found.';
      if (db.members.some(x => x.memberId !== id && x.mobile === d.mobile.trim())) return 'This mobile number is already used by another member.';
      if (mm.profile) {
        const h = Number(d.height), g = Number(d.goalWeight);
        if (!(h >= 80 && h <= 250)) return 'Height must be between 80 and 250 cm.';
        if (!(g >= 20 && g <= 300)) return 'Goal weight must be between 20 and 300 kg.';
        mm.profile.height = h; mm.profile.goalWeight = g; mm.profile.goalDate = d.goalDate || '';
      }
      const loginChanged = mm.mobile !== d.mobile.trim();
      Object.assign(mm, { fullName: d.fullName.trim(), mobile: d.mobile.trim(), dob: d.dob || '', gender: d.gender, address: (d.address || '').trim(), emergencyName: (d.emergencyName || '').trim(), emergencyMobile: d.emergencyMobile || '', status: d.status, joinDate: d.joinDate || mm.joinDate, updatedAt: new Date().toISOString() });
      log('editMember', 'MEMBERS', id, loginChanged ? 'mobile changed' : '');
      if (!commit()) return 'Could not save.'; render(); toast(loginChanged ? 'Saved — the member now logs in with the new mobile number' : 'Member details saved');
    });
  },
  resetPin(id) {
    modal('Reset PIN — ' + nm(id), `<div class="notice" style="margin-bottom:10px">Set a temporary PIN and tell it to the member. They will be asked to choose their own PIN at the next login.</div><label>Temporary PIN (4–6 digits)<input name="pin" inputmode="numeric" maxlength="6" required></label>`, async d => {
      if (!/^\d{4,6}$/.test(d.pin || '')) return 'PIN must be 4 to 6 digits.';
      if (DEMO_MODE) { db = Store.load(); mem(id).pin = d.pin; log('resetPin', 'MEMBERS', id, ''); if (!commit()) return 'Could not save.'; toast('PIN reset'); return; }
      let r; try { r = await apiCall('adminResetPin', { memberId: id, pin: d.pin }); } catch (e) { return 'Cannot reach the server. Check the internet connection.'; }
      if (!r.ok) return r.error || 'Could not reset PIN.';
      Sync.run(); toast('PIN reset — tell the member the temporary PIN');
    }, 'Reset PIN');
  },
  async serverBackup() {
    toast('Backing up…');
    try { const r = await apiCall('backupNow', {}, 60000); toast(r.ok ? 'Backup saved in Google Drive: ' + r.name : (r.error || 'Backup failed')); } catch (e) { toast('Cannot reach the server'); }
  },
  addMember() {
    modal('Add member', `<label>Full name<input name="fullName" maxlength="60" required></label><label>Mobile number<input name="mobile" inputmode="numeric" maxlength="10" required></label>
    <div class="two"><label>Date of birth<input type="date" name="dob" max="${today()}"></label><label>Gender<select name="gender"><option value="F">Female</option><option value="M">Male</option><option value="O">Other</option></select></label></div>
    <label>Temporary PIN (4–6 digits)<input name="pin" inputmode="numeric" maxlength="6" required></label>
    <label class="chk"><input type="checkbox" name="consent"><span>Member has given consent to store health measurements and progress data.</span></label>`, async d => {
      const name = (d.fullName || '').trim(), mobile = (d.mobile || '').trim(); db = Store.load();
      if (name.length < 2) return 'Enter the member name.';
      if (!/^[6-9]\d{9}$/.test(mobile)) return 'Enter a valid 10-digit mobile number.';
      if (!/^\d{4,6}$/.test(d.pin || '')) return 'PIN must be 4 to 6 digits.';
      if (d.consent !== 'on') return 'Member consent is required.';
      if (db.members.some(x => x.mobile === mobile)) return 'This mobile number is already registered.';
      if (!DEMO_MODE) {
        let r; try { r = await apiCall('adminCreateMember', { pin: d.pin, member: { fullName: name, mobile, dob: d.dob || '', gender: d.gender, consent: true } }); } catch (e) { return 'Cannot reach the server. Check the internet connection.'; }
        if (!r.ok) return r.error || 'Could not add member.';
        await Sync.run(); render(); toast('Member added — they set their own PIN at first login'); return;
      }
      const m = { memberId: uid('M'), memberCode: nextCode(db), fullName: name, mobile, pin: d.pin, dob: d.dob || '', gender: d.gender, address: '', emergencyName: '', emergencyMobile: '', joinDate: today(), status: 'Active', consent: true, photoConsent: false, deletionRequested: false, profile: null, createdAt: new Date().toISOString() };
      db.members.push(m); notify(db, m.memberId, 'Welcome', 'Welcome to ' + BRAND.en + '.', 'Welcome'); log('createMember', 'MEMBERS', m.memberId, name);
      if (!commit()) return 'Could not save.'; render(); toast('Member added');
    });
  },
  verify(id) { const m = mem(id); m.status = 'Active'; notify(db, id, 'Registration verified', 'Your registration is verified. Please add your Day-1 baseline.', 'Verification'); log('verifyMember', 'MEMBERS', id, ''); if (commit()) { render(); toast('Member verified'); } },
  toggleStatus(id) { const m = mem(id); m.status = m.status === 'Active' ? 'Inactive' : 'Active'; log('setStatus', 'MEMBERS', id, m.status); if (commit()) render(); },
  deleteMember(id) {
    if (!confirm('Permanently delete this member and all their records?')) return;
    const keep = x => x.memberId !== id;
    ['members', 'logs', 'photos', 'updates', 'appointments', 'events', 'notifications', 'attendance', 'notes'].forEach(k => { db[k] = db[k].filter(keep); });
    log('deleteMember', 'MEMBERS', id, 'on member request'); view = null; if (commit()) { render(); toast('Member data deleted'); }
  },
  baseline(id) {
    const m = mem(id);
    modal('Day-1 baseline — ' + m.fullName, logFieldsHtml(m, baselineExtraHtml()), d => {
      db = Store.load(); const mm = mem(id); if (mm.profile) return 'Baseline already saved.';
      const e = saveBaseline(db, mm, d, 'Admin'); if (e) return e; log('saveBaseline', 'MEMBER_HEALTH_PROFILE', id, '');
      if (!commit()) return 'Could not save.'; render(); toast('Baseline saved');
    });
  },
  addLog(id) {
    const m = mem(id);
    modal('Add measurement — ' + m.fullName, logFieldsHtml(m, dailyExtraHtml), d => {
      db = Store.load(); const e = saveLog(db, mem(id), d, 'Admin'); if (e) return e; log('createDailyHealthLog', 'DAILY_HEALTH_LOG', id, d.date || today());
      if (!commit()) return 'Could not save.'; render(); toast('Measurement saved');
    });
  },
  addNote(id) {
    modal('Follow-up note', '<label>Note<textarea name="note" rows="4" maxlength="500" required></textarea></label>', d => {
      if ((d.note || '').trim().length < 2) return 'Enter a note.';
      db = Store.load(); db.notes.push({ noteId: uid('NT'), memberId: id, note: d.note.trim(), createdBy: 'Admin', createdAt: new Date().toISOString() }); log('adminNote', 'MEMBER_NOTES', id, '');
      if (!commit()) return 'Could not save.'; render(); toast('Note added');
    });
  },
  notifyMember(id) {
    modal('Notification to ' + nm(id), '<label>Title<input name="title" maxlength="60" required></label><label>Message<textarea name="message" rows="3" maxlength="300" required></textarea></label>', d => {
      if (!(d.title || '').trim() || !(d.message || '').trim()) return 'Enter title and message.';
      db = Store.load(); notify(db, id, d.title.trim(), d.message.trim(), 'Follow-up'); log('sendNotification', 'NOTIFICATIONS', id, d.title.trim());
      if (!commit()) return 'Could not save.'; toast('Notification sent');
    }, 'Send');
  },
  announce() {
    modal('Send notification', `<label>To<select name="to"><option value="ALL">All active members</option>${db.members.map(m => `<option value="${esc(m.memberId)}">${esc(m.fullName)}</option>`).join('')}</select></label>
    <label>Title<input name="title" maxlength="60" required></label><label>Message<textarea name="message" rows="3" maxlength="300" required></textarea></label>`, d => {
      if (!(d.title || '').trim() || !(d.message || '').trim()) return 'Enter title and message.';
      db = Store.load(); const ids = d.to === 'ALL' ? db.members.filter(m => m.status === 'Active').map(m => m.memberId) : [d.to];
      ids.forEach(i => notify(db, i, d.title.trim(), d.message.trim(), d.to === 'ALL' ? 'Announcement' : 'Follow-up')); log('sendNotification', 'NOTIFICATIONS', d.to, d.title.trim());
      if (!commit()) return 'Could not save.'; render(); toast('Sent to ' + ids.length + ' member(s)');
    }, 'Send');
  },
  book(id) {
    modal('Book appointment', apptFields(!id), d => {
      const mid = id || d.memberId;
      if (!d.date || d.date < today()) return 'Choose today or a future date.';
      db = Store.load(); if (!mem(mid)) return 'Choose a member.';
      const a = { appointmentId: uid('AP'), memberId: mid, date: d.date, startTime: d.time, endTime: plus30(d.time), purpose: d.purpose, status: 'Confirmed', notes: '', createdAt: new Date().toISOString() };
      db.appointments.push(a); notify(db, mid, 'Appointment booked', d.purpose + ' on ' + fmtDate(d.date) + ' at ' + fmtTime(d.time), 'Appointment'); log('createAppointment', 'APPOINTMENTS', a.appointmentId, nm(mid));
      if (!commit()) return 'Could not save.'; render(); toast('Appointment booked');
    }, 'Book');
  },
  apptSet(id, b) {
    const st = b.dataset.st, a = db.appointments.find(x => x.appointmentId === id); if (!a) return;
    if (st === 'Cancelled' && !confirm('Cancel this appointment?')) return;
    a.status = st; a.updatedAt = new Date().toISOString(); notify(db, a.memberId, 'Appointment ' + st.toLowerCase(), a.purpose + ' on ' + fmtDate(a.date) + ' is ' + st.toLowerCase() + '.', 'Appointment');
    log('appointment' + st, 'APPOINTMENTS', id, ''); if (commit()) { render(); toast('Appointment ' + st.toLowerCase()); }
  },
  addEvent() {
    modal('Center event', `<label>Title<input name="title" maxlength="80" required></label><div class="two"><label>Date<input type="date" name="date" min="${today()}" value="${today()}" required></label><label>Time<input type="time" name="time" value="07:00" required></label></div>`, d => {
      if ((d.title || '').trim().length < 2) return 'Enter a title.'; if (d.date < today()) return 'Choose today or a future date.';
      db = Store.load(); const e = { eventId: uid('E'), memberId: 'ALL', title: d.title.trim(), date: d.date, startTime: d.time, type: 'Club event' };
      db.events.push(e); log('createEvent', 'CALENDAR', e.eventId, e.title); if (!commit()) return 'Could not save.'; render(); toast('Event added');
    });
  },
  checkin(id) {
    if (db.attendance.some(a => a.memberId === id && a.date === today())) return;
    db.attendance.push({ attendanceId: uid('T'), memberId: id, date: today(), checkIn: nowTime(), checkOut: '', status: 'Present', markedBy: 'Admin', createdAt: new Date().toISOString() });
    log('attendanceCheckIn', 'ATTENDANCE', id, ''); if (commit()) { render(); toast('Checked in'); }
  },
  checkout(id) {
    const a = db.attendance.find(x => x.memberId === id && x.date === today()); if (!a || a.checkOut) return;
    a.checkOut = nowTime(); log('attendanceCheckOut', 'ATTENDANCE', id, ''); if (commit()) { render(); toast('Checked out'); }
  },
  addStaff() {
    modal('Add staff', `<label>Name<input name="name" maxlength="60" required></label><label>Mobile<input name="mobile" inputmode="numeric" maxlength="10"></label><label>Role<select name="role"><option>Wellness Coach</option><option>Receptionist</option><option>Assistant</option></select></label>
    ${DEMO_MODE ? '' : '<label class="chk"><input type="checkbox" name="login"><span>Give this person Admin app login (needs the mobile number above)</span></label><label>Temporary PIN (only if giving login)<input name="pin" inputmode="numeric" maxlength="6"></label>'}`, async d => {
      const name = (d.name || '').trim();
      if (name.length < 2) return 'Enter a name.';
      if (d.mobile && !/^[6-9]\d{9}$/.test(d.mobile)) return 'Mobile must be 10 digits.';
      if (d.login === 'on') {
        if (!d.mobile) return 'Enter the mobile number for login.';
        if (!/^\d{4,6}$/.test(d.pin || '')) return 'Temporary PIN must be 4 to 6 digits.';
        let r; try { r = await apiCall('adminCreateAdmin', { mobile: d.mobile, pin: d.pin, name }); } catch (e) { return 'Cannot reach the server.'; }
        if (!r.ok) return r.error || 'Could not create login.';
      }
      db = Store.load(); db.staff.push({ staffId: uid('S'), name, mobile: d.mobile || '', role: d.role, status: 'Active' }); log('createStaff', 'ADMINS', name, d.role);
      if (!commit()) return 'Could not save.'; render(); toast('Staff added');
    });
  },
  changePin(forced) {
    forced = forced === true;
    modal('Change PIN', `${forced ? '<div class="notice" style="margin-bottom:10px">Please set your own PIN to continue.</div>' : ''}<label>Current PIN<input name="old" type="password" inputmode="numeric" maxlength="6" required></label>
    <label>New PIN (4–6 digits)<input name="pin" type="password" inputmode="numeric" maxlength="6" required></label><label>Confirm new PIN<input name="pin2" type="password" inputmode="numeric" maxlength="6" required></label>`, async d => {
      if (d.pin !== d.pin2) return 'The two new PINs do not match.';
      const e = await Auth.changePin(d.old, d.pin); if (e) return e;
      await Sync.run(); render(); toast('PIN changed');
    }, 'Save PIN', { force: forced });
  },
  async backup() {
    toast('Preparing backup…');
    const photos = [];
    for (const p of db.photos) { const q = Object.assign({}, p); q.image = await Media.data(p); delete q.fileUrl; photos.push(q); }
    download('sadhana-backup-' + today() + '.json', JSON.stringify(Object.assign({}, db, { photos }), (k, v) => (k === 'pin' || k === 'adminPin' ? undefined : v), 2), 'application/json');
    toast('Backup downloaded');
  },
  resetDemo() { if (!confirm('Reset ALL data in this browser to the demo sample data?')) return; db = Store.reset(); view = null; sub = null; render(); toast('Demo data reset'); },
  csvMembers() { download('members.csv', toCSV([['memberCode', 'fullName', 'mobile', 'status', 'joinDate', 'height', 'baselineWeight', 'goalWeight']].concat(db.members.map(m => [m.memberCode, m.fullName, m.mobile, m.status, m.joinDate, m.profile ? m.profile.height : '', m.profile ? m.profile.baselineWeight : '', m.profile ? m.profile.goalWeight : '']))), 'text/csv'); },
  csvLogs() { download('health-logs.csv', toCSV([['memberCode', 'fullName', 'date', 'weight', 'bmi', 'bp', 'sugar', 'pulse', 'steps', 'water', 'sleep']].concat(db.logs.slice().sort(byNew).map(l => { const m = mem(l.memberId) || {}; return [m.memberCode, m.fullName, l.date, l.weight, l.bmi, l.bp, l.sugar, l.pulse, l.steps, l.water, l.sleep]; }))), 'text/csv'); },
  csvAtt() { download('attendance.csv', toCSV([['memberCode', 'fullName', 'date', 'checkIn', 'checkOut', 'status', 'markedBy']].concat(db.attendance.slice().sort((a, b) => b.date.localeCompare(a.date)).map(a => { const m = mem(a.memberId) || {}; return [m.memberCode, m.fullName, a.date, a.checkIn, a.checkOut, a.status, a.markedBy]; }))), 'text/csv'); }
};

$c().addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const f = A[b.dataset.act]; if (f) f(b.dataset.id, b);
});
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js').catch(() => { }));
window.onload = async () => {
  await Store.init();
  setSync(DEMO_MODE ? 'demo' : (navigator.onLine ? 'synced' : 'offline'));
  render();
  Sync.start();
};
