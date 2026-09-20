# साधना हेल्थ अँड न्यूट्रिशन सेंटर — Wellness Manager PWA
**Sadhana Health & Nutrition Center**

Two separate installable PWAs:

| App | Folder | For |
|---|---|---|
| Member app | `user-app/` | Center members |
| Admin app | `admin-app/` | Center owners / wellness coaches — **Bhagwan Mokal** & **Sadhana Mokal** |

Backend starter: Google Apps Script (`backend/Code.gs`). Database: Google Sheets (`database/GOOGLE_SHEET_SCHEMA.csv`).

## Try it now (demo mode)
Serve the folder over HTTP (PWAs need `http://localhost` or HTTPS), e.g.

```
python3 -m http.server 8000
```
- Member app: `http://localhost:8000/user-app/` — sample login **9800000001 / PIN 1111**, or register a new member
- Admin app: `http://localhost:8000/admin-app/` — admin mobile **9702389779**, PIN **1234** (change it in More → Settings)

In demo mode data is stored in the browser (`localStorage`). Both apps on the same origin share it, so a member registered in the member app appears in the admin app. Reset it from Admin → More → Settings.

## What is included
- **Member app:** login/register with consent, Day-1 baseline, daily health update (weight, BP, sugar, pulse, waist, hip, steps, water, sleep), BMI, goals, progress chart, before/after photos (consent-based, deletable), wellness notes, calendar & appointment requests, notifications, attendance check-in, privacy (download data, revoke photos, request deletion), **About & Contact**.
- **Admin app:** login, dashboard, member management & verification, full member profile, add measurements / Day-1 baseline, follow-up notes, appointments (confirm / complete / cancel), center events, attendance, notifications & announcements, reports, CSV exports, staff list, audit log, backup, **About & Contact**.
- **About & Contact (both apps):** owner photos, roles (वेलनेस कोच), and contact number 9702389779 with Call / WhatsApp buttons. Edit the `CENTER` constant in `js/api.js` (in both apps) to change details; photos are in each app's `images/` folder.

## Going to production
Read `docs/MASTER_PROCEDURE.txt` and `docs/CLAUDE_BUILD_PROMPT.txt`.
1. Create the Google Sheet with the tabs/columns from `database/GOOGLE_SHEET_SCHEMA.csv`.
2. Deploy `backend/Code.gs` as a Web App and set the `ADMIN_KEY` script property.
3. Put the Web App URL in `API_URL` in `js/api.js` of both apps and replace the `Store` calls with `apiGet` / `apiPost`.
4. **Add real server-side authentication and per-member authorization before real member data is stored.** The demo PIN checks run in the browser and are not secure. Keep photos in private storage.
5. Host the two folders on GitHub Pages (HTTPS). Never commit secrets.

## Disclaimer
Record keeping and wellness tracking only — not diagnosis or medical treatment.
