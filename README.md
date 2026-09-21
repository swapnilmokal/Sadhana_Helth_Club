# साधना हेल्थ अँड न्यूट्रिशन सेंटर — Wellness Manager PWA
**Sadhana Health & Nutrition Center** (logo: Sadhana Health Club)

Two separate installable apps that stay in sync with each other:

| App | Folder | For |
|---|---|---|
| Member app (green logo) | `user-app/` | Center members |
| Admin app (navy logo) | `admin-app/` | Owners / wellness coaches — **Bhagwan Mokal** & **Sadhana Mokal** (admin mobile 9702389779) |

Both apps link to each other (login screens, About & Contact, Admin → More → *Open / Share Member app*, and a WhatsApp login-link button on every member profile).

## Two modes
- **Demo mode** (no `config.js`): sample data, stored only in that browser. Sample logins — member `9800000001` / PIN `1111`, admin `9702389779` / PIN `1234`.
- **Server mode** (`config.js` with your Apps Script URL): real login, sync between all phones, private photo storage, backups. **Setup steps: `docs/SETUP_MARATHI.md`.**

## Features
- **Login by mobile number + PIN** for every member; PIN change by the user; **PIN reset by admin** (temporary PIN, user must choose a new one); lock-out after 5 wrong tries; inactive members are blocked.
- **Admin can edit every member detail** (name, login mobile, DOB, gender, address, emergency contact, status, height, goal); members edit their own profile.
- **Always in sync:** changes are queued and sent automatically; each app pulls the other's changes (on open, every 30 s, on reconnect). A status pill shows ✓ Synced / Syncing / Offline · N pending.
- **Saved on the phone:** each app keeps its own persistent storage (IndexedDB) with profile, login session, health data and photos; works offline; a *Sync & phone storage* panel shows usage and lets you request protected storage.
- **Photos** go to a private Google Drive folder (never public) — only the owner and admin can see them.
- **Backups:** automatic daily copy of the Google Sheet in Drive (`Sadhana_Backups`), *Back up now* button, and JSON download (with photos) from the phone.
- Member app: Day-1 baseline, daily update, BMI, goal progress + chart, before/after photos, wellness notes, calendar & appointment requests, notifications, attendance, privacy (download data, revoke photos, request deletion), About & Contact.
- Admin app: dashboard, members, verification, measurements, follow-up notes, appointments, events, attendance, announcements, reports + CSV, staff (with optional admin login), audit log, settings.

## Project layout
```
config.example.js      -> copy to config.js (repo root) and paste your Apps Script URL
user-app/              index.html, css, js (api.js = core/sync, app.js = screens), manifest, service-worker, icons, images
admin-app/             same structure (navy theme + admin logo)
backend/Code.gs        Google Apps Script backend (auth, sync, private photos, backup)
database/              GOOGLE_SHEET_SCHEMA.csv (tabs created automatically by setup())
docs/                  SETUP_MARATHI.md, MASTER_PROCEDURE.txt, CLAUDE_BUILD_PROMPT.txt
```

## Updating the apps on GitHub (from a phone)
Upload the new zip → Actions → *Unzip project* → Run workflow. `config.js` is not in the zip, so your server URL is never overwritten.

## Disclaimer
Record keeping and wellness tracking only — not diagnosis or medical treatment.
