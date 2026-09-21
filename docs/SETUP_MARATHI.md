# साधना हेल्थ अँड न्यूट्रिशन सेंटर — सेटअप मार्गदर्शक (फोनवरून)

दोन्ही अ‍ॅप्स (Member आणि Admin) एकमेकांशी **सिंक** व्हावेत, डेटा सुरक्षित राहावा आणि बॅकअप मिळावा यासाठी एकदा Google Sheet + Apps Script जोडायचे आहे. सर्व फोनवरून करता येते.

> Chrome मध्ये ⋮ → **Desktop site** चालू ठेवा (Apps Script साठी आवश्यक).

## भाग 1 — GitHub वर नवीन फाइल्स टाका
1. GitHub रिपॉझिटरीत **Add file → Upload files** → नवीन `Sadhana_Health_Nutrition_PWA.zip` निवडा → Commit.
2. **Actions → Unzip project → Run workflow**. हिरवी टिक आली की झाले. (जुन्या फाइल्स बदलल्या जातात.)

## भाग 2 — Google Sheet बनवा
1. sheets.google.com → **Blank** स्प्रेडशीट → नाव द्या `Sadhana Data`.
2. वरच्या मेनूत **Extensions → Apps Script**.

## भाग 3 — कोड पेस्ट करा
1. GitHub मध्ये `backend/Code.gs` उघडा → **Copy raw file** बटण दाबा.
2. Apps Script मधील जुना कोड सर्व पुसा (Select all → Delete) आणि कॉपी केलेला कोड पेस्ट करा.
3. वरच्या भागात ही ओळ शोधा:
   `const ADMINS = [{ mobile: '9702389779', name: 'Bhagwan Mokal', pin: 'CHANGE_ME' }];`
   `CHANGE_ME` च्या जागी तुमचा **4 ते 6 अंकी PIN** टाका (उदा. `'482913'`). Save (💾).

## भाग 4 — एकदाच चालवा
1. वरच्या फंक्शन ड्रॉपडाउनमधून **setup** निवडा → **Run**. परवानगी विचारल्यास: Review permissions → तुमचे Google खाते → Advanced → *Go to … (unsafe)* → Allow.
2. नंतर **installTriggers** निवडून Run (हे रोज रात्री 2 वाजता आपोआप बॅकअप घेते).
3. आता कोडमधील PIN पुसून `'x'` करा आणि Save (PIN आता सेव्ह झालेला आहे, कोडमध्ये ठेवू नका).

## भाग 5 — Web app म्हणून प्रकाशित करा
1. **Deploy → New deployment** → ⚙ आयकॉनवर **Web app** निवडा.
2. *Execute as:* **Me** — *Who has access:* **Anyone** → **Deploy**.
3. **Web app URL** कॉपी करा (`https://script.google.com/macros/s/…/exec`).

## भाग 6 — URL अ‍ॅप्सना द्या
1. GitHub रिपॉझिटरीत **Add file → Create new file**. नाव: `config.js` (README.md च्या शेजारी, कोणत्याही फोल्डरमध्ये नाही).
2. `config.example.js` मधील मजकूर पेस्ट करा आणि URL बदला:
   ```
   window.SADHANA_CONFIG = { API_URL: 'https://script.google.com/macros/s/…/exec' };
   ```
3. Commit करा. 1–2 मिनिटांनी अ‍ॅप्स उघडा.

`config.js` अपडेट-zip मध्ये नसल्यामुळे पुढच्या अपडेटमध्ये ती पुसली जाणार नाही.

## भाग 7 — वापर
- **Admin अ‍ॅप:** मोबाईल `9702389779` + तुम्ही ठेवलेला PIN → Members → **＋ Add member** (सदस्याचा मोबाईल आणि *तात्पुरता PIN*).
- सदस्याला **Send Member app link on WhatsApp** दाबून लिंक पाठवा. सदस्य आपला मोबाईल नंबर आणि तात्पुरता PIN टाकतो, नंतर स्वतःचा नवीन PIN ठेवतो.
- **PIN विसरला?** सदस्याची प्रोफाइल → **Reset PIN** → नवीन तात्पुरता PIN द्या.
- **माहिती बदलायची?** सदस्याची प्रोफाइल → **Edit details** (नाव, मोबाईल, पत्ता, स्टेटस, ध्येय…). मोबाईल बदलला की सदस्य नवीन नंबरने लॉगिन करतो.
- सर्व बदल दोन्ही अ‍ॅप्समध्ये आपोआप सिंक होतात (वरच्या पट्टीत ✓ Synced दिसते). इंटरनेट नसल्यास बदल फोनवर साठतात आणि नेट आल्यावर आपोआप जातात.

## बॅकअप आणि साठवण
- **रोज आपोआप:** Google Drive मधील `Sadhana_Backups` फोल्डरमध्ये शीटची कॉपी (शेवटच्या 30 ठेवल्या जातात).
- **आत्ता:** Admin → More → *Sync, backup & settings* → **Back up on server now**.
- **फोनवर फाइल:** त्याच पानावर **Download full backup (JSON)** (फोटोंसह).
- **फोटो:** Google Drive मधील खाजगी फोल्डर `Sadhana_Private_Photos` (कधीही public नाही). फक्त संबंधित सदस्य आणि admin पाहू शकतात.
- **फोनमधील जागा:** अ‍ॅप डेटा फोनवर (IndexedDB) साठवतो. *Keep data safe* बटण दाबा आणि अ‍ॅप होम स्क्रीनवर इन्स्टॉल करा — म्हणजे फोन डेटा आपोआप पुसणार नाही.

## Code.gs अपडेट केल्यावर
Deploy → **Manage deployments** → ✏ → Version: **New version** → Deploy. (URL तोच राहतो.)

## अडचणी
| समस्या | उपाय |
|---|---|
| Login वर "Cannot reach the server" | `config.js` मधील URL तपासा; Deploy मध्ये *Anyone* निवडले आहे का ते पाहा |
| "Sheet missing — run setup() first" | Apps Script मध्ये `setup` एकदा चालवा |
| 5 चुकीच्या PIN नंतर लॉक | 15 मिनिटे थांबा किंवा Reset PIN करा |
| अ‍ॅपमध्ये जुने रूप दिसते | अ‍ॅप बंद करून पुन्हा उघडा (एकदा रिफ्रेश) |

## सुरक्षा टिपा
- PIN कोडमध्ये ठेवू नका; तो फक्त सर्व्हरवर hash स्वरूपात असतो.
- Admin PIN कोणालाही सांगू नका; कधीही More → Settings मधून बदला.
- Google Sheet फक्त तुमच्याकडे share ठेवा.
