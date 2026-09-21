/* साधना हेल्थ अँड न्यूट्रिशन सेंटर — Member App (demo mode: data stays in this browser) */
'use strict';
let db = null, tab = 'home', sub = null, authMode = 'login';
const $c = () => document.getElementById('content');
const sid = () => (Auth.current() || {}).memberId || null;
const cur = () => { db = Store.load(); return db.members.find(m => m.memberId === sid()) || null; };
const commit = () => Store.save(db);
const mine = (list, id) => list.filter(x => x.memberId === id);

function setTab(t) { tab = t; sub = null; render(); window.scrollTo(0, 0); }

function render() {
  const u = Auth.current(), m = cur();
  document.querySelector('.app').classList.toggle('noauth', !m);
  if (u && Auth.mustChange()) {
    $c().innerHTML = '<div class="section center"><div class="muted">Please set a new PIN to continue.</div></div>';
    if (!document.querySelector('.modal')) A.changePin(true);
    return;
  }
  if (!m) {
    if (u && !DEMO_MODE) { $c().innerHTML = '<div class="section center"><div class="muted">Loading your data…</div></div>'; return; }
    authView(); return;
  }
  document.querySelectorAll('.nav button').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  const un = db.notifications.filter(n => n.memberId === m.memberId && !n.readAt).length;
  const mb = document.querySelector('.nav [data-tab=more]');
  let dot = mb.querySelector('.dot');
  if (un) { if (!dot) { dot = document.createElement('span'); dot.className = 'dot'; mb.appendChild(dot); } dot.textContent = un; } else if (dot) dot.remove();
  ({ home: homeView, health: healthView, progress: progressView, calendar: calendarView, more: moreView })[tab](m);
}

/* ---------- login / register ---------- */
function authView() {
  const login = authMode === 'login', msg = window.__authMsg || ''; window.__authMsg = '';
  const wa = 'https://wa.me/91' + CENTER.phone + '?text=' + encodeURIComponent('नमस्कार, माझा PIN विसरलो आहे. कृपया PIN रीसेट करा. माझा मोबाईल नंबर: ');
  $c().innerHTML = `<div class="section center"><img class="hero-logo" src="images/logo-full.png" alt="Sadhana Health Club" width="120" height="120"></div>
  <div class="section"><h2>${login ? 'Member Login' : 'New Member Registration'}</h2>
  ${msg ? `<div class="notice" style="margin-bottom:10px">${esc(msg)}</div>` : ''}
  <form id="af" class="card">${login ? `
    <label>Mobile number<input name="mobile" inputmode="numeric" maxlength="10" autocomplete="username" required></label>
    <label>PIN<input name="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password" required></label>` : `
    <label>Full name<input name="fullName" maxlength="60" required></label>
    <label>Mobile number (this is your login)<input name="mobile" inputmode="numeric" maxlength="10" required></label>
    <div class="two"><label>Date of birth<input type="date" name="dob" max="${today()}"></label>
    <label>Gender<select name="gender"><option value="F">Female</option><option value="M">Male</option><option value="O">Other</option></select></label></div>
    <label>Create PIN (4–6 digits)<input name="pin" type="password" inputmode="numeric" maxlength="6" required></label>
    <label class="chk"><input type="checkbox" name="consent"><span>I consent to the center storing my health measurements and progress data for wellness tracking. I understand this app does not provide diagnosis or medical treatment.</span></label>`}
    <div class="err"></div><button class="btn wide">${login ? 'Login' : 'Register'}</button></form>
  <p class="center"><a href="#" id="sw">${login ? 'New member? Register here' : 'Already registered? Login'}</a></p>
  ${login ? `<p class="center muted">PIN विसरलात? <a href="${wa}" target="_blank" rel="noopener">सेंटरला WhatsApp करा</a> · <a href="tel:+91${esc(CENTER.phone)}">Call</a></p>` : ''}
  ${DEMO_MODE ? '<div class="notice">Demo mode — sample login: mobile 9800000001, PIN 1111. Data is stored only in this browser.</div>' : ''}
  <p class="center"><a href="../admin-app/">Center staff login → Admin app</a></p></div>`;
  document.getElementById('sw').onclick = e => { e.preventDefault(); authMode = login ? 'register' : 'login'; authView(); };
  document.getElementById('af').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('button.btn'), label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Please wait…';
    const err = await (login ? doLogin : doRegister)(Object.fromEntries(new FormData(f)));
    btn.disabled = false; btn.textContent = label;
    if (err) f.querySelector('.err').textContent = err;
  };
}
async function doLogin(d) {
  const err = await Auth.login(d.mobile, d.pin);
  if (err) return err;
  tab = 'home'; sub = null; render();
}
async function doRegister(d) {
  const name = (d.fullName || '').trim(), mobile = (d.mobile || '').trim();
  if (name.length < 2) return 'Enter your full name.';
  if (!/^[6-9]\d{9}$/.test(mobile)) return 'Enter a valid 10-digit mobile number.';
  if (!/^\d{4,6}$/.test(d.pin || '')) return 'PIN must be 4 to 6 digits.';
  if (d.consent !== 'on') return 'Consent is required to register.';
  if (DEMO_MODE) {
    db = Store.load();
    if (db.members.some(x => x.mobile === mobile)) return 'This mobile number is already registered.';
    const m = { memberId: uid('M'), memberCode: nextCode(db), fullName: name, mobile, pin: d.pin, dob: d.dob || '', gender: d.gender || '', address: '', emergencyName: '', emergencyMobile: '', joinDate: today(), status: 'Pending', consent: true, photoConsent: false, deletionRequested: false, profile: null, createdAt: new Date().toISOString() };
    db.members.push(m);
    notify(db, m.memberId, 'Welcome', 'Welcome to ' + BRAND.en + '. Please add your Day-1 baseline.', 'Welcome');
    if (!commit()) return 'Could not save.';
    localStorage.setItem('sadhana_user_session', m.memberId);
  } else {
    const err = await Auth.register({ fullName: name, mobile, pin: d.pin, dob: d.dob || '', gender: d.gender || '', consent: true });
    if (err) return err;
  }
  tab = 'home'; sub = null; render();
}

/* ---------- views ---------- */
function homeView(m) {
  const T = today(), L = latestLog(db, m.memberId), p = m.profile;
  const tl = memberLogs(db, m.memberId).find(l => l.date === T);
  const h = new Date().getHours(), g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const visits = mine(db.attendance, m.memberId).filter(a => a.date.slice(0, 7) === T.slice(0, 7)).length;
  const checked = mine(db.attendance, m.memberId).some(a => a.date === T);
  const pct = goalPct(m, L && L.weight);
  $c().innerHTML = `<div class="section"><h2>${g}, ${esc(m.fullName.split(' ')[0])} 👋</h2><div class="muted">ID ${esc(m.memberCode)} · ${memberLogs(db, m.memberId).length} tracking entries</div></div>
  ${m.status === 'Pending' ? '<div class="notice" style="margin-bottom:12px">Your registration is awaiting verification by the center.</div>' : ''}
  ${p ? '' : '<div class="card" style="margin-bottom:12px"><b>Start your journey</b><p class="muted">Add your Day-1 baseline (height, weight and other measurements) to begin tracking.</p><button class="btn" data-act="baseline">Add Day-1 baseline</button></div>'}
  <div class="grid">${metric('Weight', dash(L && L.weight), 'kg')}${metric('BMI', dash(L && L.bmi), 'tracking metric')}${metric('BP', dash(L && L.bp), 'mmHg')}${metric('Sugar', dash(L && L.sugar), 'mg/dL')}</div>
  ${pct == null ? '' : `<div class="section"><div class="card"><div class="row"><b>Goal progress</b><b>${pct}%</b></div><div class="progress"><i style="width:${pct}%"></i></div><small>Target ${esc(p.goalWeight)} kg${p.goalDate ? ' by ' + fmtDate(p.goalDate) : ''}</small></div></div>`}
  <div class="section"><h2>Today's activity</h2><div class="grid">${metric('Steps', dash(tl && tl.steps), 'steps')}${metric('Water', dash(tl && tl.water), 'litres')}${metric('Sleep', dash(tl && tl.sleep), 'hours')}${metric('Center visits', visits, 'this month')}</div></div>
  <div class="two"><button class="btn" data-act="daily">＋ Daily update</button><button class="btn secondary" data-act="checkin" ${checked ? 'disabled' : ''}>${checked ? '✓ Checked in' : 'Check in'}</button></div>
  <div class="notice" style="margin-top:14px">Wellness tracking only. Measurements are for record keeping and do not constitute a diagnosis or medical advice.</div>`;
}

function healthView(m) {
  const p = m.profile, logs = memberLogs(db, m.memberId).slice(0, 30), ups = mine(db.updates, m.memberId).sort(byNew).slice(0, 20);
  $c().innerHTML = `<div class="section"><h2>Health Profile</h2><div class="card">
  <p style="margin:0 0 6px"><b>${esc(m.fullName)}</b> · ${esc(m.memberCode)}</p>
  ${p ? `<div class="muted">Height ${esc(p.height)} cm · Day-1 weight ${esc(p.baselineWeight)} kg · BMI ${esc(p.baselineBMI)} · Goal ${esc(p.goalWeight)} kg</div>` : '<div class="muted">Day-1 baseline not added yet.</div>'}</div></div>
  ${p ? '<button class="btn wide" data-act="daily">＋ Add today\'s update</button>' : '<button class="btn wide" data-act="baseline">Add Day-1 baseline</button>'}
  <div class="section"><h2>Day-to-day log</h2><div class="list">${logs.map(x => `<div class="item"><div class="row"><b>${fmtDate(x.date)}</b><span class="chip">${esc(x.weight)} kg</span></div>
  <div class="muted">BMI ${esc(x.bmi)} · BP ${esc(dash(x.bp))} · Sugar ${esc(dash(x.sugar))} · Pulse ${esc(dash(x.pulse))} · Steps ${esc(dash(x.steps))}</div>${x.note ? `<div style="font-size:13px;margin-top:4px">${esc(x.note)}</div>` : ''}</div>`).join('') || '<div class="muted">No entries yet.</div>'}</div></div>
  <div class="section"><div class="row"><h2>Wellness notes</h2><button class="btn small secondary" data-act="note">＋ Add</button></div><div class="list">${ups.map(u => `<div class="item"><div class="row"><b>${esc(u.title)}</b><small>${fmtDate(u.date)}</small></div><div style="font-size:13px">${esc(u.text)}</div></div>`).join('') || '<div class="muted">No notes yet.</div>'}</div></div>`;
}

function progressView(m) {
  const logs = memberLogs(db, m.memberId).slice(0, 30).reverse(), p = m.profile, L = logs[logs.length - 1];
  const ph = mine(db.photos, m.memberId).sort((a, b) => a.date.localeCompare(b.date));
  const before = ph.find(x => x.type === 'BEFORE'), after = ph.filter(x => x.type === 'AFTER').pop();
  const cell = (x, t) => `<div><div class="photo">${x ? photoImg(x, t + ' photo') : esc(t) + ' PHOTO'}</div><small>${x ? fmtDate(x.date) : 'Not added'}</small></div>`;
  const chg = p && L ? +(L.weight - p.baselineWeight).toFixed(1) : null;
  $c().innerHTML = `<div class="section"><h2>Progress trend</h2><div class="card">${lineChart(logs.map(l => ({ l: fmtDate(l.date), v: l.weight })), p ? p.goalWeight : null)}
  ${chg == null ? '' : `<div class="row" style="margin-top:8px"><span class="muted">Change since Day-1</span><b>${chg > 0 ? '+' : ''}${chg} kg</b></div>`}</div></div>
  <div class="section"><h2>Before & After</h2><div class="photos">${cell(before, 'BEFORE')}${cell(after, 'AFTER')}</div></div>
  <button class="btn secondary wide" data-act="photoAdd">＋ Add progress photo</button>
  ${ph.length ? `<div class="section"><h2>All photos</h2><div class="photos">${ph.map(x => `<div><div class="photo">${photoImg(x, x.type + ' photo')}</div><div class="row"><small>${esc(x.type)} · ${esc(x.view)} · ${fmtDate(x.date)}</small><button class="btn small danger" data-act="photoDel" data-id="${esc(x.photoId)}">Delete</button></div></div>`).join('')}</div></div>` : ''}
  <div class="notice" style="margin-top:14px">Photos are private to you and the center, and only stored with your consent.</div>`;
}

function calendarView(m) {
  const T = today(), hasToday = memberLogs(db, m.memberId).some(l => l.date === T);
  const ap = mine(db.appointments, m.memberId), open = ap.filter(a => a.date >= T && ['Requested', 'Confirmed'].includes(a.status));
  const ev = db.events.filter(e => (e.memberId === 'ALL' || e.memberId === m.memberId) && e.date >= T);
  const items = open.map(a => ({ d: a.date, t: a.startTime, title: a.purpose, tag: a.status, id: a.appointmentId }))
    .concat(ev.map(e => ({ d: e.date, t: e.startTime, title: e.title, tag: e.type }))).sort((a, b) => (a.d + a.t).localeCompare(b.d + b.t));
  const past = ap.filter(a => !open.includes(a)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  $c().innerHTML = `<div class="section"><div class="row"><h2>Upcoming</h2><button class="btn small" data-act="apptReq">＋ Request appointment</button></div><div class="list">
  ${hasToday ? '' : `<div class="item"><div class="row"><b>Today</b><span class="chip warn">Reminder</span></div><div class="muted">Daily wellness update</div></div>`}
  ${items.map(i => `<div class="item"><div class="row"><b>${fmtDate(i.d)}${i.t ? ' · ' + fmtTime(i.t) : ''}</b><span class="chip ${i.tag === 'Requested' ? 'warn' : ''}">${esc(i.tag)}</span></div><div class="muted">${esc(i.title)}</div>
  ${i.id ? `<button class="btn small danger" data-act="apptCancel" data-id="${esc(i.id)}" style="margin-top:8px">Cancel</button>` : ''}</div>`).join('') || '<div class="muted">No upcoming appointments or events.</div>'}</div></div>
  ${past.length ? `<div class="section"><h2>Earlier</h2><div class="list">${past.map(a => `<div class="item"><div class="row"><b>${fmtDate(a.date)} · ${esc(a.purpose)}</b><span class="chip ${a.status === 'Cancelled' ? 'bad' : ''}">${esc(a.status)}</span></div></div>`).join('')}</div></div>` : ''}`;
}

function moreView(m) {
  const back = '<button class="back" data-act="back">← Back</button>';
  if (sub === 'profile') {
    const p = m.profile;
    $c().innerHTML = `${back}<div class="section"><h2>My profile</h2><div class="card">
    <p><b>${esc(m.fullName)}</b><br><small>${esc(m.memberCode)} · Joined ${fmtDate(m.joinDate)} · <span class="chip ${m.status === 'Active' ? '' : 'warn'}">${esc(m.status)}</span></small></p>
    <p class="muted">Login mobile ${esc(m.mobile)} <small>(to change it, ask the center)</small><br>DOB ${esc(dash(m.dob))} · Gender ${esc(dash(m.gender))}<br>Address ${esc(dash(m.address))}<br>Emergency contact ${esc(dash(m.emergencyName))} ${esc(m.emergencyMobile)}</p>
    ${p ? `<p class="muted">Goal ${esc(p.goalWeight)} kg${p.goalDate ? ' by ' + fmtDate(p.goalDate) : ''}</p>` : ''}
    <button class="btn secondary" data-act="editProfile">Edit profile & goal</button><button class="btn secondary" data-act="changePin">Change PIN</button></div></div>`;
  } else if (sub === 'notif') {
    const ns = mine(db.notifications, m.memberId).sort((a, b) => b.sentAt.localeCompare(a.sentAt)).slice(0, 40);
    $c().innerHTML = `${back}<div class="section"><div class="row"><h2>Notifications</h2><button class="btn small secondary" data-act="notifAll">Mark all read</button></div><div class="list">
    ${ns.map(n => `<div class="item" data-act="notifRead" data-id="${esc(n.notificationId)}" style="${n.readAt ? 'opacity:.65' : ''}"><div class="row"><b>${esc(n.title)}</b><small>${fmtDate(n.sentAt.slice(0, 10))}</small></div><div style="font-size:13px">${esc(n.message)}</div></div>`).join('') || '<div class="muted">No notifications.</div>'}</div></div>`;
  } else if (sub === 'attendance') {
    const at = mine(db.attendance, m.memberId).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
    $c().innerHTML = `${back}<div class="section"><h2>Attendance</h2><div class="list">${at.map(a => `<div class="item"><div class="row"><b>${fmtDate(a.date)}</b><span class="chip">${esc(a.status)}</span></div><div class="muted">In ${esc(fmtTime(a.checkIn) || '—')} · Out ${esc(fmtTime(a.checkOut) || '—')}</div></div>`).join('') || '<div class="muted">No visits recorded.</div>'}</div></div>`;
  } else if (sub === 'storage') {
    $c().innerHTML = `${back}<div class="section"><h2>Sync & phone storage</h2>${syncPanelHtml()}<div class="notice" style="margin-top:12px">Your data is saved on this phone and on the center's server. Install the app to the home screen so the phone keeps it safe.</div></div>`;
    fillSyncPanel();
  } else if (sub === 'about') {
    $c().innerHTML = back + aboutHtml();
  } else if (sub === 'privacy') {
    $c().innerHTML = `${back}<div class="section"><h2>Privacy & data</h2><div class="card">
    <p style="margin-top:0">Your health measurements and photos are sensitive. They are visible only to you and the center team, and stored with your consent.</p>
    <p class="muted">Photo consent: ${m.photoConsent ? 'Given' : 'Not given'}${m.deletionRequested ? ' · Account deletion requested' : ''}</p>
    <button class="btn secondary wide" data-act="export">Download my data</button>
    <button class="btn danger wide" data-act="revokePhotos">Revoke photo consent & delete photos</button>
    <button class="btn danger wide" data-act="reqDelete" ${m.deletionRequested ? 'disabled' : ''}>Request account deletion</button></div></div>
    <div class="notice">This app is for record keeping and wellness tracking. It is not a diagnosis or medical treatment tool.</div>`;
  } else {
    const un = db.notifications.filter(n => n.memberId === m.memberId && !n.readAt).length;
    const row = (k, t, x) => `<div class="item" data-act="sub" data-id="${k}"><div class="row"><b>${t}</b><span class="muted">${x || '›'}</span></div></div>`;
    $c().innerHTML = `<div class="section"><h2>More</h2><div class="list">${row('profile', '👤 My profile')}${row('notif', '🔔 Notifications', un ? un + ' new' : '')}${row('attendance', '✓ Attendance')}${row('storage', '🔄 Sync & phone storage')}${row('about', 'ℹ️ About & Contact')}${row('privacy', '🔒 Privacy & data')}
    <div class="item" data-act="logout"><b>⎋ Logout</b></div></div></div>`;
  }
}

/* ---------- actions ---------- */
const A = {
  back() { sub = null; render(); },
  sub(id) { sub = id; render(); window.scrollTo(0, 0); },
  async logout() {
    const r = await Auth.logout();
    if (!r.ok && r.pending) {
      if (!confirm(r.pending + ' change(s) have not reached the server yet and will be lost if you log out. Log out anyway?')) return;
      await Auth.logout(true);
    }
    tab = 'home'; sub = null; authMode = 'login'; render();
  },
  syncNow: syncNowAction,
  keepSafe: keepSafeAction,
  changePin(forced) {
    forced = forced === true;
    modal('Change PIN', `${forced ? '<div class="notice" style="margin-bottom:10px">The center has reset your PIN. Please set a new PIN of your own.</div>' : ''}<label>Current PIN${forced ? ' (the PIN you just logged in with)' : ''}<input name="old" type="password" inputmode="numeric" maxlength="6" required></label>
    <label>New PIN (4–6 digits)<input name="pin" type="password" inputmode="numeric" maxlength="6" required></label><label>Confirm new PIN<input name="pin2" type="password" inputmode="numeric" maxlength="6" required></label>`, async d => {
      if (d.pin !== d.pin2) return 'The two new PINs do not match.';
      const e = await Auth.changePin(d.old, d.pin); if (e) return e;
      await Sync.run(); render(); toast('PIN changed');
    }, 'Save PIN', { force: forced });
  },
  baseline() {
    const m = cur();
    modal('Day-1 baseline', logFieldsHtml(m, baselineExtraHtml()), d => {
      db = Store.load(); const mm = db.members.find(x => x.memberId === m.memberId);
      if (mm.profile) return 'Baseline is already saved.';
      const e = saveBaseline(db, mm, d, 'Member'); if (e) return e;
      if (!commit()) return 'Could not save.'; render(); toast('Baseline saved');
    });
  },
  daily() {
    const m = cur(); if (!m.profile) return A.baseline();
    modal("Today's update", logFieldsHtml(m, dailyExtraHtml), d => {
      db = Store.load(); const mm = db.members.find(x => x.memberId === m.memberId);
      const e = saveLog(db, mm, d, 'Member'); if (e) return e;
      if (!commit()) return 'Could not save.'; render(); toast('Update saved');
    });
  },
  note() {
    const m = cur();
    modal('Wellness note', '<label>Title<input name="title" maxlength="80" required></label><label>Note<textarea name="text" rows="4" maxlength="500" required></textarea></label>', d => {
      if ((d.title || '').trim().length < 2) return 'Enter a title.';
      db = Store.load();
      db.updates.push({ updateId: uid('U'), memberId: m.memberId, date: today(), title: d.title.trim(), text: (d.text || '').trim(), author: 'Member', createdAt: new Date().toISOString() });
      if (!commit()) return 'Could not save.'; render(); toast('Note saved');
    });
  },
  checkin() {
    const m = cur(); if (mine(db.attendance, m.memberId).some(a => a.date === today())) return;
    db.attendance.push({ attendanceId: uid('T'), memberId: m.memberId, date: today(), checkIn: nowTime(), checkOut: '', status: 'Present', markedBy: 'Member', createdAt: new Date().toISOString() });
    if (commit()) { render(); toast('Checked in'); }
  },
  photoAdd() {
    const m = cur();
    modal('Add progress photo', `<div class="two"><label>Type<select name="type"><option>BEFORE</option><option>AFTER</option></select></label><label>View<select name="view"><option>front</option><option>side</option><option>back</option></select></label></div>
    <label>Date<input type="date" name="date" value="${today()}" max="${today()}" required></label><label>Photo<input type="file" name="file" accept="image/*" required></label><label>Caption<input name="caption" maxlength="100"></label>
    <label class="chk"><input type="checkbox" name="consent"><span>I consent to storing this photo privately for my progress tracking. I can delete it any time.</span></label>`, async d => {
      if (d.consent !== 'on') return 'Consent is required to store photos.';
      const f = d.file; if (!f || !f.size) return 'Choose a photo.';
      let url; try { url = await resizeImage(f); } catch (e) { return 'Could not read this image.'; }
      db = Store.load(); const mm = db.members.find(x => x.memberId === m.memberId);
      db.photos.push({ photoId: uid('P'), memberId: m.memberId, type: d.type, view: d.view, date: d.date || today(), fileUrl: url, caption: (d.caption || '').slice(0, 100), consent: true, createdAt: new Date().toISOString() });
      mm.photoConsent = true;
      if (!commit()) return 'Could not save.'; render(); toast('Photo saved');
    });
  },
  photoDel(id) {
    if (!confirm('Delete this photo?')) return;
    db = Store.load(); db.photos = db.photos.filter(p => p.photoId !== id); if (commit()) { render(); toast('Photo deleted'); }
  },
  apptReq() {
    const m = cur();
    modal('Request appointment', `<div class="two"><label>Date<input type="date" name="date" min="${today()}" value="${today()}" required></label><label>Time<input type="time" name="time" value="10:00" required></label></div>
    <label>Purpose<select name="purpose"><option>Progress review</option><option>Nutrition consultation</option><option>Measurement update</option><option>Other</option></select></label>`, d => {
      if (!d.date || d.date < today()) return 'Choose today or a future date.';
      if (d.date === today() && d.time <= nowTime()) return 'Choose a later time.';
      const [h, mi] = d.time.split(':').map(Number), e = new Date(2000, 0, 1, h, mi + 30);
      db = Store.load();
      db.appointments.push({ appointmentId: uid('AP'), memberId: m.memberId, date: d.date, startTime: d.time, endTime: pad(e.getHours()) + ':' + pad(e.getMinutes()), purpose: d.purpose, status: 'Requested', notes: '', createdAt: new Date().toISOString() });
      if (!commit()) return 'Could not save.'; render(); toast('Request sent');
    }, 'Send request');
  },
  apptCancel(id) {
    if (!confirm('Cancel this appointment?')) return;
    db = Store.load(); const a = db.appointments.find(x => x.appointmentId === id); if (!a) return;
    a.status = 'Cancelled'; a.updatedAt = new Date().toISOString(); if (commit()) { render(); toast('Cancelled'); }
  },
  notifRead(id) { db = Store.load(); const n = db.notifications.find(x => x.notificationId === id); if (n && !n.readAt) { n.readAt = new Date().toISOString(); n.status = 'Read'; commit(); render(); } },
  notifAll() { const m = cur(); mine(db.notifications, m.memberId).forEach(n => { if (!n.readAt) { n.readAt = new Date().toISOString(); n.status = 'Read'; } }); commit(); render(); },
  editProfile() {
    const m = cur(), p = m.profile;
    modal('Edit profile', `<label>Full name<input name="fullName" maxlength="60" value="${esc(m.fullName)}" required></label>
    <div class="two"><label>Date of birth<input type="date" name="dob" value="${esc(m.dob)}" max="${today()}"></label><label>Gender<select name="gender">${[['F', 'Female'], ['M', 'Male'], ['O', 'Other']].map(g => `<option value="${g[0]}" ${m.gender === g[0] ? 'selected' : ''}>${g[1]}</option>`).join('')}</select></label></div>
    <label>Address<input name="address" maxlength="150" value="${esc(m.address)}"></label>
    <div class="two"><label>Emergency contact<input name="emergencyName" maxlength="60" value="${esc(m.emergencyName)}"></label><label>Emergency mobile<input name="emergencyMobile" inputmode="numeric" maxlength="10" value="${esc(m.emergencyMobile)}"></label></div>
    ${p ? `<div class="two"><label>Goal weight (kg)<input name="goalWeight" type="number" step="0.1" value="${esc(p.goalWeight)}" required></label><label>Goal date<input type="date" name="goalDate" value="${esc(p.goalDate)}"></label></div>` : ''}`, d => {
      if ((d.fullName || '').trim().length < 2) return 'Enter your name.';
      if (d.emergencyMobile && !/^[6-9]\d{9}$/.test(d.emergencyMobile)) return 'Emergency mobile must be 10 digits.';
      db = Store.load(); const mm = db.members.find(x => x.memberId === m.memberId);
      if (mm.profile) { const g = Number(d.goalWeight); if (!(g >= 20 && g <= 300)) return 'Enter goal weight between 20 and 300 kg.'; mm.profile.goalWeight = g; mm.profile.goalDate = d.goalDate || ''; }
      Object.assign(mm, { fullName: d.fullName.trim(), dob: d.dob || '', gender: d.gender, address: (d.address || '').trim(), emergencyName: (d.emergencyName || '').trim(), emergencyMobile: d.emergencyMobile || '', updatedAt: new Date().toISOString() });
      if (!commit()) return 'Could not save.'; render(); toast('Profile updated');
    });
  },
  async export() {
    const m = cur(), id = m.memberId, safe = Object.assign({}, m); delete safe.pin;
    toast('Preparing your data…');
    const photos = [];
    for (const p of mine(db.photos, id)) { const q = Object.assign({}, p); q.image = await Media.data(p); delete q.fileUrl; photos.push(q); }
    download('my-sadhana-data.json', JSON.stringify({ member: safe, logs: memberLogs(db, id), updates: mine(db.updates, id), appointments: mine(db.appointments, id), attendance: mine(db.attendance, id), notifications: mine(db.notifications, id), photos }, null, 2), 'application/json');
  },
  revokePhotos() {
    if (!confirm('Delete all your photos and revoke photo consent?')) return;
    const m = cur(); db.photos = db.photos.filter(p => p.memberId !== m.memberId); db.members.find(x => x.memberId === m.memberId).photoConsent = false;
    if (commit()) { render(); toast('Photos deleted'); }
  },
  reqDelete() {
    if (!confirm('Send a request to delete your account and data?')) return;
    const m = cur(); db.members.find(x => x.memberId === m.memberId).deletionRequested = true;
    audit(db, m.memberId, 'Member', 'requestDeletion', 'MEMBERS', m.memberId, '');
    if (commit()) { render(); toast('Request sent to the center'); }
  }
};

$c().addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const f = A[b.dataset.act]; if (f) f(b.dataset.id);
});
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js').catch(() => { }));
window.onload = async () => {
  await Store.init();
  setSync(DEMO_MODE ? 'demo' : (navigator.onLine ? 'synced' : 'offline'));
  render();
  Sync.start();
};
