// Builds bench/heldout.json: 30 hand-written synthetic messages, written in one go before any
// tuning of the rules or the prompt and never used to tune them. Phrasing is deliberately different
// from the generated set (forwarded chats, lists, typos, long letters). All details are made up.
// Markup: {CAT|value} is a labelled personal value, {ORG|value} an optional organisation name,
// {CAT|value|key} ties repeated or split parts to one value (same key = one value).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const M = [
  ['clinic', 'en', null, 'Fwd from WhatsApp: "Pls tell the doctor my husband {PERSON|Rizal Hamdan} cannot come for his dialysis on Thursday, he is in {ORG|Hospital Serdang}. His IC {ID_NUMBER|780412-10-5531}. I am his wife {PERSON|Zarina}, 019 445 2210 is my number" - {PHONE|019 445 2210}'.replace('019 445 2210 is', '{PHONE|019 445 2210|zp} is').replace(' - {PHONE|019 445 2210}', '')],
  ['clinic', 'ms', null, 'Doktor, ini Kak Long, kakak kepada {PERSON|Shahrul Nizam}. Dia alah penisilin. Rekod dia di bawah nama penuh {PERSON|Shahrul Nizam bin Mohd Yatim}, lahir {DATE_OF_BIRTH|9 Ogos 1991}. Nombor saya {PHONE|+6019-2201 884}.'],
  ['clinic', 'en', null, 'Patient list for tomorrow (please keep private):\n1. {PERSON|Lee Ah Kow}, {ID_NUMBER|520303-07-5117}, {PHONE|04-229 1188}\n2. {PERSON|Muthamma a/p Govindasamy}, {ID_NUMBER|490918-08-6224}, {PHONE|05-254 7731}\n3. {PERSON|Fatimah Zahra}, {ID_NUMBER|880101-01-0042}, {PHONE|017-332 0909}'],
  ['clinic', 'mixed', 'typo', 'hi doc this is {PERSON|vinod} , my ic is {ID_NUMBER|8505o7-14-6631} sory typo, its {ID_NUMBER|850507-14-6631}. can i get refill for my insulin. whatsapp {PHONE|6012 778 3341}'],
  ['clinic', 'en', null, 'Good morning. I would like to cancel the appointment for my mother, Madam {PERSON|Chan Siew Kuen}, at 10am. She is staying with me now at {ADDRESS|No 5, Lorong Ara Kiri 2, Lucky Garden, 59100 Bangsar}. You can reach me, {PERSON|Daphne Chan}, on {PHONE|012-209 4471}.'],
  ['clinic', 'ms', 'spelled-digits', 'Assalamualaikum. Nombor IC anak saya {ID_NUMBER|satu tujuh kosong tiga dua satu, satu empat, kosong lapan lapan dua}. Nama dia {PERSON|Adam Rayyan}. Terima kasih, Puan {PERSON|Hasnah}.'],
  ['clinic', 'en', 'word-name', 'Message for Dr {PERSON|Wong}: {PERSON|Summer Lim} called again about her rash. Summer said it spread overnight. Her callback number is {PHONE|011-1092 3345}.'.replace('Summer said', '{PERSON|Summer|sm} said')],
  ['clinic', 'en', null, 'Insurance claim: insured {PERSON|Harjit Singh a/l Gurdev Singh}, policy no. {ID_NUMBER|PL-7781-2204}, NRIC {ID_NUMBER|690228-02-5013}, admitted {_|3 to 5 November}. Bank in to {ACCOUNT_NUMBER|5640 1122 8890} (Maybank).'],

  ['hr', 'en', null, 'From: {EMAIL|azlan.hr@example.com}\nTo: payroll\nPlease process final pay for {PERSON|Kelvin Liew Jun Hao} (staff {ID_NUMBER|TF0912}). Forwarding address: {ADDRESS|21-3A, Jalan Puteri 2/4, Bandar Puteri, 47100 Puchong, Selangor}. Personal email {EMAIL|kelvinliew.jh@example.net}.'],
  ['hr', 'ms', null, 'Tuan, saya {PERSON|Norhayati binti Che Mat} ingin maklumkan perubahan akaun bank untuk caruman. Akaun baru: {ACCOUNT_NUMBER|1520 0045 6631 08} Bank Rakyat. IC {ID_NUMBER|811115035522}.'],
  ['hr', 'en', 'split-number', 'My emergency contact is my brother {PERSON|Sanjay}. His number starts {PHONE|016-28|sj} and ends {PHONE|7 4410|sj} (sorry the keyboard is acting up).'],
  ['hr', 'mixed', null, 'Hi kak HR, nak confirm medical claim untuk anak I, {PERSON|Aryan Kumar}, umur 4. Receipt from {ORG|Klinik Pakar Kanak-Kanak Ampang}. My IC {ID_NUMBER|900612-10-7781}, phone {PHONE|0162019944}. Thanks, {PERSON|Kumar}'],
  ['hr', 'en', null, 'Visa renewal: {PERSON|Mohammad Shahidul Islam}, Bangladeshi passport {ID_NUMBER|EF0473321}, DOB {DATE_OF_BIRTH|1994-02-17}, hostel address {ADDRESS|Blok C-2-14, Asrama Pekerja, Jalan Industri 3, 70450 Seremban}.'],
  ['hr', 'en', 'lowercase-name', 'pls note {PERSON|siti aminah} from packing is on mc till friday. her husband {PERSON|zul} called from {PHONE|013 900 2271}.'],
  ['hr', 'ms', null, 'Untuk tujuan insurans berkelompok: pasangan {PERSON|Rohana binti Ahmad}, IC {ID_NUMBER|860707-11-5440}; anak {PERSON|Muhammad Irfan}, sijil lahir {ID_NUMBER|BQ 204417}.'],

  ['bank', 'en', null, 'Dear Sir/Madam, I am disputing a charge on my credit card ending {ACCOUNT_NUMBER|4417}. Full card {ACCOUNT_NUMBER|5412 7534 0112 4417}. Cardholder {PERSON|Benjamin Ooi Teik Seng}, born {DATE_OF_BIRTH|12/12/1979}. Statement address {ADDRESS|8, Jalan Gottlieb, 10350 George Town, Penang}.'.replace('{ACCOUNT_NUMBER|4417}', 'XXXX-4417')],
  ['bank', 'mixed', null, 'Hello bank, my mother Puan {PERSON|Salmah binti Daud} passed away last month. Her savings acc {ACCOUNT_NUMBER|1640 2233 9081}. I am the executor, {PERSON|Faridah Salleh}, IC {ID_NUMBER|720330-03-5098}. Boleh email saya at {EMAIL|faridah.salleh@example.com.my}?'],
  ['bank', 'en', 'obfuscated-email', 'Kindly resend the e-statement to {EMAIL|g.anand (at) example (dot) com}. Account holder {PERSON|Anand Gopal}, a/c {ACCOUNT_NUMBER|8008 112 445}.'],
  ['bank', 'en', 'letter-o-for-zero', 'urgent!! someone used my debit card. call me at {PHONE|O17-882 O911}. my name {PERSON|Ivan Chua}.'],
  ['bank', 'ms', null, 'Saya {PERSON|Jamilah Osman}, ingin menukar alamat surat-menyurat kepada {ADDRESS|Lot 1123, Kampung Seri Aman, 21300 Kuala Terengganu}. No. akaun {ACCOUNT_NUMBER|0123-0045-889-1}.'],
  ['bank', 'en', 'word-name', 'Transfer of RM 2,000 to {PERSON|Will Tan} (acc {ACCOUNT_NUMBER|7123 4401 2290}) was a mistake. I will call tomorrow. {PERSON|Joy Fernandez}, {PHONE|03-7956 1200}.'],
  ['bank', 'en', null, 'Joint account holders: Mr {PERSON|Arumugam Sinnathamby} ({ID_NUMBER|551010-05-5329}) and Mrs {PERSON|Saraswathy Arumugam} ({ID_NUMBER|580214-05-5106}). Please add our son {PERSON|Dinesh} as a nominee.'],

  ['school', 'ms', null, 'Cikgu, saya Mak Cik {PERSON|Rokiah}, nenek {PERSON|Danish Haikal} kelas {_|2 Mawar}. Ibu bapanya bekerja di Singapura. Kalau apa-apa hubungi saya {PHONE|019-701 3322} atau datang ke {ADDRESS|No. 14, Kampung Parit Jawa, 84150 Muar}.'.replace('{ADDRESS|No. 14, ', 'No. {ADDRESS|14, ')],
  ['school', 'en', null, "Hi Teacher {PERSON|Melissa}, {PERSON|Ethan}'s dad here ({PERSON|Raymond Kok}). Ethan has a dental appointment on Thursday at {ORG|Klinik Pergigian Mutiara}. I'll sign him out at 11. My number is {PHONE|+60 11-5523 0198}.".replace("Ethan has", "{PERSON|Ethan|et} has").replace("{PERSON|Ethan}'s", "{PERSON|Ethan|et}'s")],
  ['school', 'mixed', null, 'Cikgu, borang PIBG: nama bapa {PERSON|Hairul Azmi}, IC {ID_NUMBER|830101 08 6619}, emel {EMAIL|hairul_azmi83@example.org}, alamat {ADDRESS|33 Jalan Bunga Tanjung 8, Taman Seri Bayu, 31650 Ipoh, Perak}.'],
  ['school', 'en', 'spelled-digits', "Sorry I can't type numbers on this phone. My number is {PHONE|oh one two, five five five, zero one three two}. {PERSON|Agnes Lojitin} (mother of {PERSON|Kayla})."],
  ['school', 'en', null, 'Scholarship application: student {PERSON|Nur Alya Sofea binti Roslan}, MyKad {ID_NUMBER|090624-14-0388}, household income RM 2,400. Guardian {PERSON|Roslan bin Abu}, {PHONE|011-2345 9087}, {EMAIL|roslanabu@example.com}.'],
  ['school', 'ms', 'word-name', 'Cikgu, {PERSON|Intan} tak sihat hari ni. Intan dah makan ubat. Esok dia datang. - Ibu {PERSON|Intan|in}'.replace('{PERSON|Intan} tak', '{PERSON|Intan|in} tak').replace('- Ibu {PERSON|Intan|in}', '- Ibu {PERSON|Intan|in}').replace('Intan dah', '{PERSON|Intan|in} dah')],
  ['school', 'en', null, 'Lost and found: a wallet belonging to {PERSON|Tan Hui Xin} (Form 4) with her MyKad {ID_NUMBER|100803-10-1234} and a bank card {ACCOUNT_NUMBER|4000 1234 5678 9010}. Parent please collect from the office.'],
  ['school', 'en', null, 'Dear Mrs {PERSON|Pereira}, thank you for the update on {PERSON|Lucas}. Please send future letters to my office: {ADDRESS|Level 12, Menara Binjai, 2 Jalan Binjai, 50450 Kuala Lumpur}. Regards, {PERSON|Gabriel Pereira}.'],
];

const messages = M.map(([domain, lang, adversarial, src], i) => {
  let text = '';
  const labels = new Map();
  const optional = [];
  let last = 0;
  let anon = 0;
  for (const m of src.matchAll(/\{([A-Z_]+)\|([^|}]+)(?:\|([a-z]+))?\}/g)) {
    text += src.slice(last, m.index);
    last = m.index + m[0].length;
    const [, cat, value, key] = m;
    const start = text.length;
    text += value;
    if (cat === '_') continue;
    if (cat === 'ORG') {
      optional.push({ category: 'ORGANIZATION', value, spans: [[start, text.length]] });
      continue;
    }
    const k = key ?? `v${anon++}`;
    const L = labels.get(k) ?? { category: cat, parts: [] };
    L.parts.push({ value, span: [start, text.length] });
    labels.set(k, L);
  }
  text += src.slice(last);
  return {
    id: `heldout-${String(i).padStart(2, '0')}`,
    domain,
    lang,
    adversarial,
    text,
    labels: [...labels.values()].map((l) => ({ category: l.category, value: [...new Set(l.parts.map((p) => p.value))].join(' '), spans: l.parts.map((p) => p.span) })),
    optional,
  };
});
for (const m of messages) for (const l of [...m.labels, ...m.optional]) for (const [s, e] of l.spans) if (!m.text.slice(s, e).trim()) throw new Error(`bad span in ${m.id}`);

const file = join(import.meta.dirname, 'heldout.json');
writeFileSync(file, JSON.stringify({ name: 'Held-out hand-written messages (synthetic)', note: 'Written before tuning; not used to tune. All details are made up.', messages }, null, 1));
console.log(`wrote ${file}: ${messages.length} messages, ${messages.reduce((n, m) => n + m.labels.length, 0)} labelled values`);
