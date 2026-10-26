# EKC's HR rules in Kara — review notes for the HR head

The eight HR rule documents of Electrokavir (EKC), in
`services/kara-api/seed/ekc/hr-rules/`, are in Kara as knowledge items of kind
**آیین‌نامه منابع انسانی** (HR rule). `cli.js seed-org ekc` loads them, and
they appear under ekc → **دانش شرکت** (company knowledge). Each item has:

- the original Word file, downloadable;
- the document's whole text from «هدف» (purpose) on: this is what the HR assistant reads;
- a summary of the rules that carry a number or a deadline: this is what the assistant finds first;
- the document's number, revision, creation date and sign-off date as features.

The HR assistant (hr.simorghai.com, and **دستیار هوش مصنوعی** in Kara)
answers EKC's people from these, alongside the HR documents it already had.

When a document changes, replace the `.docx` in the folder and run
`python3 services/kara-api/seed/ekc/build-hr-rules.py`. Then run
`cli.js seed-org ekc` again: a new revision of the same document number
replaces the old one. Alternatively, upload the new file over the old item in
Kara.

| Number | Title | Created | This revision signed |
|---|---|---|---|
| EKWI-AD-001-08 | دستورالعمل تردد، حضور و غیاب (attendance) | 1396/09/21 | 1405/08/02 |
| EKWI-AD-004-08 | دستورالعمل جذب و استخدام (recruitment and hiring) | 1397/04/26 | 1405/07/13 |
| EKWI-AD-005-02 | دستورالعمل اضافه کاری (overtime) | 1403/04/06 | 1405/07/13 |
| EKWI-AD-006-02 | دستورالعمل مرخصی (leave) | 1403/04/06 | 1405/07/13 |
| EKWI-AD-007-02 | دستورالعمل مأموریت (business trips) | 1403/08/12 | 1405/07/13 |
| EKWI-AD-008-01 | دستورالعمل قطع همکاری (leaving the company) | 1404/07/08 | 1405/06/28 |
| EKWI-AD-009-00 | دستورالعمل انتصاب و ارتقا (appointment and promotion) | 1404/07/08 | 1404/07/01 |
| EKWI-AD-010-01 | دستورالعمل جامع تردد افراد، کالا و وسایل نقلیه (movement of people, goods and vehicles) | 1404/11/02 | 1405/07/13 |

## What to look at before relying on them

The assistant answers from the documents as they are written. The points
below are where a document contradicts itself or another document, or reads
differently from the Labour Law (قانون کار). People will be given these
answers, so they are worth fixing in the documents.

### Contradictions and likely errors

1. **EKWI-AD-005 (overtime), the premium.**
   - The text says overtime is paid at 1.4 times the hourly wage (۴/۱ ارزش هر ساعت کار عادی).
   - The formula beneath it reads «مزد یک ساعت اضافه کاری = 40% * مزد یک ساعت کار عادی», which is 0.4 times.
   - A note (تبصره) says the premium applies **only on holidays** (official and shift).
   - Article 59 of the Labour Law gives the 40% premium for every overtime hour. Decide which is meant and correct both the formula and the note.
2. **EKWI-AD-005, the daily ceiling.** The document allows overtime "never more than 8 hours a day". Article 59 limits overtime to 4 hours a day. The 120-hour monthly cap and the 2:15-hour daily threshold are company rules; worth stating as such.
3. **EKWI-AD-008 (leaving), final settlement.** Dues are paid «حداقل ۲ ماه پس از تاریخ تسویه» (*at least* two months after settlement). This almost certainly means *at most* (حداکثر); as written it sets no deadline at all.
4. **EKWI-AD-009 (appointment).**
   - Its «هدف» (purpose) is copied word for word from EKWI-AD-008: "a clear and respectful process for people leaving the organisation".
   - The paragraph on promotion-committee members repeats itself ("for managers … in the supervisors' level") and is hard to read.
   - Its sign-off date (1404/07/01) is a week **before** its creation date (1404/07/08).
5. **EKWI-AD-001 (attendance) against EKWI-AD-006 (leave), lateness.**
   - 001: lateness of up to 5 minutes a month is ignored, and justified lateness "may be taken as entitlement leave".
   - 006: the first 10 minutes of any lateness can never be recorded as leave.
   - Say which wins for justified lateness.
6. **Length of a leave day.**
   - EKWI-AD-006 counts 7:20 hours as one leave day at the factory and 8:30 at the head office.
   - EKWI-AD-005 defines the morning shift as 07:30–15:45, which is 7:30 after the 45-minute break of EKWI-AD-001.
   - Confirm the factory's day: 7:20 or 7:30.
7. **Law citations in EKWI-AD-006 (leave).**
   - Storing up to 9 days is cited as Article 66 in 6-1-1 (correct), but as Article 69 in تبصره 10. Article 69 is about when leave is taken.
   - Hourly leave counting against entitlement is cited as «ماده ۷». That is Article 65.
8. **Date of the Labour Law.** EKWI-AD-005 and 006 cite it as approved on 2/7/1368. EKWI-AD-007 cites 09/03/1389. The law in force was approved on 1369/08/29 (by the Expediency Council). Use one, correct date.

### Wording and numbering

- **EKWI-AD-001:** the notes (تبصره) are numbered twice: 3, 9 and 10 each appear twice. A reference such as «تبصره ۹» is therefore ambiguous.
- **EKWI-AD-004:** it refers to «بند 3-1-5» for the online application. The clause is 5-1-3.
- **EKWI-AD-005:** «نرم افزار کسری» should be «کسرا» (the attendance system).
- **EKWI-AD-007:** its «دامنه کاربرد» (scope) is copied from the attendance document ("who need to know about attendance").

### For the assistant

- Where two documents differ (points 5 and 6), the assistant may quote either one. Until they agree, it is safer to add a short circular (بخشنامه) in Kara that settles the question. It then answers from that.
- EKWI-AD-006 (تبصره 5) lets each unit set its own leave conditions, and EKWI-AD-010 makes rules per unit too. There is now a place for these: in **دانش شرکت**, a rule or circular can be for **one unit** (and the units under it).
  - The manager of a unit can add these for their own unit even without company-wide knowledge rights.
  - The assistant tells them only to people of that unit.
