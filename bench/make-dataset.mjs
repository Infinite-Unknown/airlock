// Builds bench/dataset.json: a labelled, fully synthetic set of Malaysian messages (clinic, HR, bank,
// school; English, Bahasa Melayu and mixed) with every personal value marked. Seeded, so the same
// file comes out every time. Every name, number and address is made up; emails use example domains.
// Usage: node bench/make-dataset.mjs [--seed 20261125] [--per 3]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const SEED = Number(opt('--seed', 20261125));
const PER = Number(opt('--per', 3));

// ---------- seeded random
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const digits = (n) => Array.from({ length: n }, () => int(0, 9)).join('');
const pad = (n, w = 2) => String(n).padStart(w, '0');
const chance = (p) => rnd() < p;

// ---------- people
const MALAY_M = ['Muhammad Hafiz', 'Ahmad Firdaus', 'Mohd Faizal', 'Haziq Danial', 'Amirul Hakim', 'Syafiq Aiman', 'Khairul Anuar', 'Iskandar Zulkarnain', 'Wan Ahmad Syukri', 'Mohd Rizal'];
const MALAY_F = ['Nurul Aina', 'Siti Khadijah', 'Nur Iman', 'Aisyah Humaira', 'Farah Nadia', 'Nor Azura', 'Intan Suraya', 'Cahaya Nurin', 'Rosnah', 'Tengku Nur Zahira', 'Raja Nur Aisyah'];
const MALAY_FATHER = ['Ismail', 'Abdullah', 'Kamarudin', 'Omar', 'Rosli', 'Zainal', 'Yusof', 'Hassan', 'Mat Isa', 'Ghazali'];
const CN_SUR = ['Tan', 'Lim', 'Wong', 'Chong', 'Lee', 'Ng', 'Ooi', 'Teh', 'Goh', 'Yap', 'Mak', 'Ong', 'Chin', 'Ho'];
const CN_GIVEN_M = ['Wei Ming', 'Kar Hoe', 'Chee Keong', 'Boon Hock', 'Jun Kai', 'Kah Wai', 'Zhi Hao', 'Yong Sheng'];
const CN_GIVEN_F = ['Mei Ling', 'Siew Lan', 'Pei Shan', 'Hui Min', 'Xin Yi', 'Li Ying', 'May Ling', 'Shu Fen'];
const IN_M = ['Ganesh', 'Arjun', 'Suresh', 'Ravi Shankar', 'Muthu', 'Kumaran', 'Vikneswaran', 'Raja'];
const IN_F = ['Priya', 'Kavitha', 'Deepa', 'Thilaga Devi', 'Sangeetha', 'Malar', 'Devi', 'Revathi'];
const IN_FATHER = ['Subramaniam', 'Muniandy', 'Rajendran', 'Krishnan', 'Ramasamy', 'Pillai', 'Arumugam', 'Nair'];
const OTHER = [
  ['Clarence', 'Ujang', 'm'],
  ['Jenny', 'Lojingki', 'f'],
  ['Marcus', 'de Souza', 'm'],
  ['Aloysius', 'Gomez', 'm'],
  ['Nora', 'Jitin', 'f'],
  ['Rosalind', 'Majanggim', 'f'],
  ['Rahim', 'Uddin', 'm'],
  ['Thida', 'Win', 'f'],
  ['Bayu', 'Santoso', 'm'],
  ['Grace', 'anak Jimbun', 'f'],
  ['Daniel', 'Lansing', 'm'],
  ['Hope', 'Tingang', 'f'],
];

/** A person: full name, the given name people use, and a polite short form ("Puan Nurul", "Mr Tan"). */
function person(sex = chance(0.5) ? 'm' : 'f', origin = pick(['malay', 'malay', 'chinese', 'chinese', 'indian', 'other'])) {
  if (origin === 'malay') {
    const given = pick(sex === 'm' ? MALAY_M : MALAY_F);
    const full = `${given} ${sex === 'm' ? 'bin' : 'binti'} ${pick(MALAY_FATHER)}`;
    const first = given.split(' ').filter((w) => !['Muhammad', 'Mohd', 'Nur', 'Nurul', 'Siti', 'Wan', 'Tengku', 'Raja'].includes(w))[0] ?? given;
    return { full, given, first, title: sex === 'm' ? 'Encik' : 'Puan', sex, origin };
  }
  if (origin === 'chinese') {
    const sur = pick(CN_SUR);
    const given = pick(sex === 'm' ? CN_GIVEN_M : CN_GIVEN_F);
    return { full: `${sur} ${given}`, given, first: given, sur, title: sex === 'm' ? 'Mr' : 'Ms', sex, origin };
  }
  if (origin === 'indian') {
    const given = pick(sex === 'm' ? IN_M : IN_F);
    const father = pick(IN_FATHER);
    const full = chance(0.6) ? `${given} ${sex === 'm' ? 'a/l' : 'a/p'} ${father}` : `${given} ${father}`;
    return { full, given, first: given, title: sex === 'm' ? 'Mr' : 'Ms', sex, origin };
  }
  const [g, s, x] = pick(OTHER.filter((o) => !sex || o[2] === sex).length ? OTHER.filter((o) => o[2] === sex) : OTHER);
  return { full: `${g} ${s}`, given: g, first: g, sur: s, title: x === 'm' ? 'Mr' : 'Ms', sex: x, origin };
}
const short = (p) => (p.origin === 'chinese' ? `${p.title} ${p.sur}` : `${p.title} ${p.first}`);

// ---------- identifiers
const STATES = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16'];
function birth(y0 = 1950, y1 = 2005) {
  return { y: int(y0, y1), m: int(1, 12), d: int(1, 28) };
}
function mykad(b = birth(), sex = 'm', style = pick(['dash', 'dash', 'dash', 'plain', 'space'])) {
  const head = `${pad(b.y % 100)}${pad(b.m)}${pad(b.d)}`;
  const pb = pick(STATES);
  let tail = digits(3) + String(int(0, 4) * 2 + (sex === 'm' ? 1 : 0));
  if (style === 'plain') return `${head}${pb}${tail}`;
  if (style === 'space') return `${head} ${pb} ${tail}`;
  return `${head}-${pb}-${tail}`;
}
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_MS = ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun', 'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];
function dob(b = birth(), lang = 'en') {
  const s = pick(['slash', 'long', 'iso']);
  if (s === 'slash') return `${pad(b.d)}/${pad(b.m)}/${b.y}`;
  if (s === 'iso') return `${b.y}-${pad(b.m)}-${pad(b.d)}`;
  return `${b.d} ${(lang === 'ms' ? MONTHS_MS : MONTHS_EN)[b.m - 1]} ${b.y}`;
}
function mobileDigits() {
  const p = pick(['10', '11', '12', '13', '14', '16', '17', '18', '19']);
  return { p, rest: digits(p === '11' ? 8 : 7) };
}
function phone(style = pick(['dash', 'dash', 'intl', 'intl2', 'plain', 'spaced', 'land', 'land2'])) {
  if (style === 'land' || style === 'land2') {
    const area = pick(['03', '04', '05', '07', '09', '082', '088']);
    const n = digits(area === '03' ? 8 : area.length === 3 ? 6 : 7);
    const a = n.slice(0, n.length - 4);
    const b = n.slice(-4);
    return style === 'land' ? `${area}-${a} ${b}` : `(${area}) ${a} ${b}`;
  }
  const { p, rest } = mobileDigits();
  const a = rest.slice(0, rest.length - 4);
  const b = rest.slice(-4);
  if (style === 'intl') return `+60 ${p}-${a} ${b}`;
  if (style === 'intl2') return `+60${p}${rest}`;
  if (style === 'plain') return `0${p}${rest}`;
  if (style === 'spaced') return `0${p} ${a} ${b}`;
  return `0${p}-${a} ${b}`;
}
const WORD_EN = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const WORD_MS = ['kosong', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'lapan', 'sembilan'];
/** Digits as words, grouped like people say them: "zero one two, three four five, ..." */
function spell(num, lang = 'en', groups = [3, 3, 4]) {
  const d = num.replace(/\D/g, '');
  const W = lang === 'ms' ? WORD_MS : WORD_EN;
  const out = [];
  let i = 0;
  for (const g of groups) {
    out.push([...d.slice(i, i + g)].map((c) => W[+c]).join(' '));
    i += g;
  }
  if (i < d.length) out.push([...d.slice(i)].map((c) => W[+c]).join(' '));
  return out.filter(Boolean).join(', ');
}
function luhnComplete(prefix, len = 16) {
  let body = prefix + digits(len - prefix.length - 1);
  for (let c = 0; c <= 9; c++) {
    const s = body + c;
    let sum = 0;
    let dbl = false;
    for (let i = s.length - 1; i >= 0; i--) {
      let n = +s[i];
      if (dbl) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      dbl = !dbl;
    }
    if (sum % 10 === 0) return s;
  }
  return body + '0';
}
function card() {
  const n = luhnComplete(pick(['4', '5', '4', '5', '37']), 16);
  return chance(0.75) ? n.match(/.{4}/g).join(' ') : n;
}
function account() {
  const style = pick(['may', 'may2', 'ten', 'fourteen', 'dash']);
  if (style === 'may') return `${digits(4)} ${digits(4)} ${digits(4)}`;
  if (style === 'may2') return digits(12);
  if (style === 'ten') return digits(10);
  if (style === 'fourteen') return digits(14);
  return `${int(1, 9)}-${digits(7)}-${digits(2)}`;
}
const BANKS = ['Maybank', 'CIMB', 'Public Bank', 'RHB', 'Hong Leong Bank', 'Bank Islam', 'AmBank', 'BSN'];
const EMAIL_DOMAINS = ['example.com', 'example.net', 'example.org', 'mail.example.com', 'example.com.my'];
function email(p) {
  const base = p.full
    .toLowerCase()
    .replace(/\b(bin|binti|a\/l|a\/p|anak)\b/g, '')
    .replace(/[^a-z ]/g, '')
    .trim()
    .split(/\s+/);
  const user = pick([base.slice(0, 2).join('.'), base.join(''), `${base[0]}_${base.at(-1)}`, `${base[0]}${int(70, 99)}`]);
  return `${user}@${pick(EMAIL_DOMAINS)}`;
}
const obfEmail = (e) => e.replace('@', ' at ').replace(/\./g, ' dot ');

// ---------- addresses (house and street made up; postcodes and towns are real places)
const STREETS = ['Jalan Mawar 3', 'Jalan SS 2/24', 'Lorong Perda Utama 5', 'Jalan Kenari 7', 'Jalan Cempaka 12', 'Jalan Bunga Raya', 'Jalan Setia Murni U13/42', 'Lorong Seri Kuantan 9', 'Jalan Pinang 4', 'Jalan Teratai 2/1', 'Jalan Merbau 8'];
const AREAS = ['Taman Melati', 'Taman Sri Muda', 'Taman Desa Jaya', 'Bandar Perda', 'Taman Universiti', 'Kampung Padang Jawa', 'Taman Bukit Indah', 'Seksyen 7', 'Taman Tasik Utama'];
const TOWNS = ['53100 Kuala Lumpur', '40460 Shah Alam', '43650 Bandar Baru Bangi', '14000 Bukit Mertajam', '81200 Johor Bahru', '88300 Kota Kinabalu', '93350 Kuching', '15200 Kota Bharu', '31400 Ipoh', '47301 Petaling Jaya', '25200 Kuantan', '05150 Alor Setar', '75450 Melaka'];
const STATE_OF = { '40460': 'Selangor', '43650': 'Selangor', '47301': 'Selangor', '14000': 'Pulau Pinang', '81200': 'Johor', '31400': 'Perak', '25200': 'Pahang', '05150': 'Kedah', '15200': 'Kelantan' };
function address() {
  const house = pick([`${int(1, 120)}`, `${int(1, 120)}`, `Lot ${int(100, 4999)}`, `B-${int(1, 30)}-${int(1, 12)}`, `Unit ${int(1, 20)}-${int(1, 9)}, Blok ${pick(['A', 'B', 'C', 'D'])}`]);
  const town = pick(TOWNS);
  const st = STATE_OF[town.slice(0, 5)];
  return `${house}, ${pick(STREETS)}, ${pick(AREAS)}, ${town}${st && chance(0.5) ? `, ${st}` : ''}`;
}
const SCHOOLS = ['SK Taman Melati', 'SJK(C) Chung Hwa', 'SMK Seri Permaisuri', 'SK Bukit Indah', 'SJK(T) Ladang Edinburgh', 'SMK Convent Bukit Nanas'];
const CLINICS = ['Klinik Kesihatan Seksyen 7', 'Klinik Mediviron Bangi', 'Poliklinik Damai', 'Klinik Famili Sri Muda'];
const HOSPITALS = ['Hospital Kuala Lumpur', 'Hospital Sultanah Aminah', 'Pantai Hospital Ayer Keroh', 'Hospital Pulau Pinang'];
const COMPANIES = ['Syarikat Maju Jaya Sdn Bhd', 'Gemilang Logistics Sdn Bhd', 'Tropika Foods Sdn Bhd'];
const INSURERS = ['Great Eastern', 'AIA', 'Etiqa', 'Prudential BSN Takaful'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const HARI = ['Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat'];
const amount = () => `RM ${int(50, 4999)}.${pick(['00', '50', '90'])}`;
const futureDate = (lang = 'en') => `${int(1, 28)} ${(lang === 'ms' ? MONTHS_MS : MONTHS_EN)[int(0, 11)]}`;

// ---------- templates
// {CAT:key} marks a personal value (labelled), {ORG:key} an organisation (optional: hiding it is
// neither required nor counted against precision), {_:key} plain text that should NOT be hidden.
// A key "x#a" / "x#b" marks two parts of one value written apart (a split number).
const T = [];
const tpl = (domain, lang, adversarial, text, gen) => T.push({ domain, lang, adversarial, text, gen });

// ---- clinic
tpl('clinic', 'en', null,
  'Hello, this is {PERSON:parent} (IC {ID_NUMBER:ic}). My son {PERSON:child} was seen by Dr. {PERSON:doctor} on {_:day} for his asthma and I still have not received the medical certificate for his school, {ORG:school}. Please email it to {EMAIL:email} or WhatsApp me at {PHONE:phone}. Our address for the insurance claim is {ADDRESS:addr}. Thank you.',
  () => { const p = person('f'); const c = person('m', p.origin); return { parent: p.full, ic: mykad(birth(), 'f'), child: c.first, doctor: pick([person().sur ?? person().first, person().full]), day: pick(DAYS), school: pick(SCHOOLS), email: email(p), phone: phone(), addr: address() }; });
tpl('clinic', 'ms', null,
  'Assalamualaikum doktor. Saya {PERSON:parent}, no. IC {ID_NUMBER:ic}. Saya nak buat temujanji untuk ibu saya, {PERSON:elder}, tarikh lahir {DATE_OF_BIRTH:dob}. Dia ada darah tinggi dan kencing manis. Boleh hubungi saya di {PHONE:phone}. Alamat rumah: {ADDRESS:addr}. Terima kasih.',
  () => { const p = person(undefined, 'malay'); const b = birth(1940, 1960); return { parent: p.full, ic: mykad(birth(), p.sex), elder: person('f', 'malay').full, dob: dob(b, 'ms'), phone: phone(), addr: address() }; });
tpl('clinic', 'mixed', null,
  'Hi klinik, saya {PERSON:parent} nak tanya pasal result blood test semalam. My IC {ID_NUMBER:ic}, phone {PHONE:phone}. Doctor {PERSON:doctor} cakap kena datang balik {_:day} tapi I kerja, boleh tukar? Email {EMAIL:email}.',
  () => { const p = person(); return { parent: p.full, ic: mykad(birth(), p.sex), phone: phone(), doctor: person().first, day: pick(HARI), email: email(p) }; });
tpl('clinic', 'en', null,
  'Dear clinic, I am writing on behalf of my father, {PERSON:elder} (MyKad {ID_NUMBER:ic}, born {DATE_OF_BIRTH:dob}). His insurer {ORG:insurer} needs the discharge summary and the bill of {_:amount}. The policy holder is me, {PERSON:parent}, contact {PHONE:phone} / {EMAIL:email}.',
  () => { const e = person('m'); const b = birth(1940, 1962); const p = person(undefined, e.origin); return { elder: e.full, ic: mykad(b, 'm'), dob: dob(b), insurer: pick(INSURERS), amount: amount(), parent: p.full, phone: phone(), email: email(p) }; });
tpl('clinic', 'ms', null,
  'Salam, nama saya {PERSON:parent}. Anak saya {PERSON:child} (MyKid {ID_NUMBER:ic2}) demam tiga hari. Boleh saya bawa dia jam {_:time}? Kalau ada slot, call {PHONE:phone}. Kami tinggal di {ADDRESS:addr}.',
  () => { const p = person('f'); const c = person(undefined, p.origin); return { parent: p.full, child: c.full, ic2: mykad(birth(2014, 2022), c.sex), time: pick(['10 pagi', '2 petang', '4.30 petang']), phone: phone(), addr: address() }; });
tpl('clinic', 'en', null,
  'Referral for {PERSON:patient}, {_:age}-year-old, IC {ID_NUMBER:ic}, address {ADDRESS:addr}. Next of kin: {PERSON:kin} ({PHONE:phone}). Please send the report to Dr. {PERSON:doctor} at {ORG:hospital}.',
  () => { const p = person(); return { patient: p.full, age: String(int(20, 80)), ic: mykad(birth(), p.sex), addr: address(), kin: person(undefined, p.origin).full, phone: phone(), doctor: person().full, hospital: pick(HOSPITALS) }; });
tpl('clinic', 'en', 'spelled-digits',
  'Hi, my name is {PERSON:parent}. My phone is {PHONE:spelled}. Please call after 5pm about my daughter {PERSON:child}. My IC is {ID_NUMBER:ic}.',
  () => { const p = person(); const n = phone('plain'); return { parent: p.full, spelled: spell(n, 'en', n.length === 11 ? [3, 4, 4] : [3, 3, 4]), child: person('f', p.origin).first, ic: mykad(birth(), p.sex) }; });
tpl('clinic', 'mixed', 'split-number',
  'Hello, {PERSON:parent} here. My new number is {PHONE:split#a} ... sorry terhantar, the rest is {PHONE:split#b}. IC saya {ID_NUMBER:ic#a} - {ID_NUMBER:ic#b}. Nak confirm appointment {_:day}.',
  () => { const p = person(); const n = phone('dash'); const i = mykad(birth(), p.sex, 'dash'); return { parent: p.full, split: [n.slice(0, 7), n.slice(8)], ic: [i.slice(0, 9), i.slice(10)], day: pick(HARI) }; });
tpl('clinic', 'en', 'word-name',
  "Hi, this is {PERSON:kidFull}'s mum, {PERSON:parent}. I hope the doctor can see {PERSON:kid} today, her cough is worse. Call me at {PHONE:phone}.",
  () => { const p = person('f', 'other'); const first = pick(['Hope', 'Grace', 'Joy', 'Faith', 'Rose']); return { kidFull: `${first} ${p.sur}`, parent: p.full, kid: first, phone: phone() }; });
tpl('clinic', 'ms', 'word-name',
  'Saya nak buat appointment untuk mak saya. Nama dia {PERSON:elder}, IC {ID_NUMBER:ic}. Mak saya pening sejak semalam. Boleh hubungi {PERSON:parent} di {PHONE:phone}.',
  () => { const g = pick(CN_GIVEN_F); const b = birth(1945, 1960); return { elder: `Mak ${g}`, ic: mykad(b, 'f'), parent: person(undefined, 'chinese').full, phone: phone() }; });
tpl('clinic', 'en', 'obfuscated-email',
  'can u email the mc to {EMAIL:obf} . name {PERSON:parent} , ic {ID_NUMBER:ic} . tq',
  () => { const p = person(); return { obf: obfEmail(email(p)), parent: p.full.toLowerCase(), ic: mykad(birth(), p.sex) }; });
tpl('clinic', 'en', 'letter-o-for-zero',
  'Please call me back on {PHONE:ophone}, I am {PERSON:parent}. My son {PERSON:child} needs his vaccination record for {ORG:school}.',
  () => { const p = person(); return { ophone: phone('dash').replace(/^0/, 'O'), parent: p.full, child: person('m', p.origin).full, school: pick(SCHOOLS) }; });

// ---- HR
tpl('hr', 'en', null,
  "Hi HR team, I'm {PERSON:emp} from the {_:branch} branch (employee no. {ID_NUMBER:empno}). My wife {PERSON:spouse} is due on {_:date} so I'd like to apply for paternity leave. Please credit the allowance to my {ORG:bank} account {ACCOUNT_NUMBER:acct}. Reach me on {PHONE:phone} or {EMAIL:email}. My manager, {PERSON:manager}, has approved it verbally.",
  () => { const e = person('m'); return { emp: e.full, branch: pick(['Penang', 'Klang', 'Johor Bahru', 'Kuching']), empno: `${pick(['EMP', 'AB', 'MJ'])}${digits(pick([5, 6, 7]))}`, spouse: person('f', e.origin).first, date: futureDate(), bank: pick(BANKS), acct: account(), phone: phone(), email: email(e), manager: person().full }; });
tpl('hr', 'ms', null,
  'Kepada HR, saya {PERSON:emp}, no. pekerja {ID_NUMBER:empno}, ingin memohon cuti sakit dari {_:from} hingga {_:to}. Sijil MC dari {ORG:clinic} dilampirkan. No. IC saya {ID_NUMBER:ic}. Sebarang pertanyaan boleh hubungi {PHONE:phone}.',
  () => { const e = person(); const d = int(1, 20); return { emp: e.full, empno: `${pick(['P', 'K'])}${digits(5)}`, from: `${d} ${pick(MONTHS_MS)}`, to: `${d + 2} haribulan`, clinic: pick(CLINICS), ic: mykad(birth(1965, 2003), e.sex), phone: phone() }; });
tpl('hr', 'mixed', null,
  'HR, pls update my address dalam sistem. New address: {ADDRESS:addr}. Also my new phone {PHONE:phone}. TQ. - {PERSON:emp}',
  () => ({ addr: address(), phone: phone(), emp: person().full }));
tpl('hr', 'en', null,
  "Dear Payroll, my EPF number is {ID_NUMBER:epf} and my IC is {ID_NUMBER:ic}. Last month's deduction was wrong. My bank account is {ACCOUNT_NUMBER:acct} ({ORG:bank}). Regards, {PERSON:emp}",
  () => { const e = person(); return { epf: digits(pick([8, 9])), ic: mykad(birth(1965, 2003), e.sex), acct: account(), bank: pick(BANKS), emp: e.full }; });
tpl('hr', 'en', null,
  "Dear HR, worker {PERSON:worker} (passport {ID_NUMBER:passport}) has a permit that expires on {_:date}. His agent {PERSON:agent} can be reached at {PHONE:phone}. Please renew before then.",
  () => ({ worker: pick(['Rahim Uddin', 'Bayu Santoso', 'Min Thu Aung', 'Ram Bahadur Gurung', 'Nguyen Van Hai']), passport: `${pick(['A', 'B', 'BB', 'EA', 'PA'])}${digits(7)}`, date: futureDate(), agent: person().full, phone: phone() }));
tpl('hr', 'ms', null,
  'Saya nak tukar waris: nama {PERSON:kin}, hubungan isteri, no. tel {PHONE:phone}, IC {ID_NUMBER:ic}, alamat {ADDRESS:addr}.',
  () => { const k = person('f'); return { kin: k.full, phone: phone(), ic: mykad(birth(), 'f'), addr: address() }; });
tpl('hr', 'en', null,
  "Hi, I'm calling about {PERSON:candidate}, born {DATE_OF_BIRTH:dob}, who applied for the clerk role. She listed you, {PERSON:referee}, as a referee. Could you call me back on {PHONE:phone}? - {PERSON:recruiter}, {ORG:company}",
  () => ({ candidate: person('f').full, dob: dob(birth(1985, 2003)), referee: person().full, phone: phone(), recruiter: person().first, company: pick(COMPANIES) }));
tpl('hr', 'mixed', null,
  "Boss, {PERSON:colleague} dari accounts asyik WhatsApp I at {PHONE:phone} lepas midnight. I don't want to make it big but pls advise. - {PERSON:emp} (staff ID {ID_NUMBER:empno})",
  () => ({ colleague: person().full, phone: phone(), emp: person().first, empno: `S${digits(5)}` }));
tpl('hr', 'en', 'spelled-digits',
  'For the insurance form: my IC number is {ID_NUMBER:spelled} and my name is {PERSON:emp}. Mobile {PHONE:phone}.',
  () => { const e = person(); return { spelled: spell(mykad(birth(), e.sex, 'plain'), 'en', [6, 2, 4]), emp: e.full, phone: phone() }; });
tpl('hr', 'en', 'split-number',
  'Bank account for the claim: {ACCOUNT_NUMBER:acct#a} and then {ACCOUNT_NUMBER:acct#b} (sorry, my phone cut it). Name on the account: {PERSON:emp}, {ORG:bank}.',
  () => { const a = digits(12); return { acct: [a.slice(0, 6), a.slice(6)], emp: person().full, bank: pick(BANKS) }; });

// ---- bank
tpl('bank', 'en', null,
  'To whom it may concern, my name is {PERSON:cust}, date of birth {DATE_OF_BIRTH:dob}. On {_:date} my card {ACCOUNT_NUMBER:card} was charged twice for {_:amount} at an online store. I called your hotline from {PHONE:land} and spoke to an agent called {PERSON:agent}, who promised a refund within 7 days. Please resolve this by Friday. Reply to {EMAIL:email}.',
  () => { const c = person(); return { cust: c.full, dob: dob(birth()), date: futureDate(), card: card(), amount: amount(), land: phone(pick(['land', 'land2'])), agent: person().first, email: email(c) }; });
tpl('bank', 'ms', null,
  'Tuan/Puan, saya {PERSON:cust} (No. KP: {ID_NUMBER:ic}) ingin membuat aduan. Akaun simpanan saya {ACCOUNT_NUMBER:acct} telah didebit {_:amount} tanpa kebenaran pada {_:date}. Sila hubungi saya di {PHONE:phone}.',
  () => { const c = person(); return { cust: c.full, ic: mykad(birth(), c.sex), acct: account(), amount: amount(), date: futureDate('ms'), phone: phone() }; });
tpl('bank', 'mixed', null,
  'Hi, I nak block card {ACCOUNT_NUMBER:card} sebab hilang semalam kat {_:place}. Nama {PERSON:cust}, IC {ID_NUMBER:ic}. Pls call {PHONE:phone} asap.',
  () => { const c = person(); return { card: card(), place: pick(['Mid Valley', 'pasar malam', 'LRT Kelana Jaya', 'Pavilion']), cust: c.full, ic: mykad(birth(), c.sex), phone: phone() }; });
tpl('bank', 'en', null,
  'Please update the mailing address on account {ACCOUNT_NUMBER:acct} to {ADDRESS:addr}. Account holder: {PERSON:cust}, MyKad {ID_NUMBER:ic}.',
  () => { const c = person(); return { acct: account(), addr: address(), cust: c.full, ic: mykad(birth(), c.sex) }; });
tpl('bank', 'en', null,
  'I transferred {_:amount} to {PERSON:payee} (account {ACCOUNT_NUMBER:acct2}) by mistake instead of my brother {PERSON:sibling}. My account is {ACCOUNT_NUMBER:acct}. Can you recall the transfer? Phone {PHONE:phone}.',
  () => ({ amount: amount(), payee: person().full, acct2: account(), sibling: person('m').full, acct: account(), phone: phone() }));
tpl('bank', 'ms', null,
  'Saya {PERSON:cust}, peminjam bersama dengan suami {PERSON:spouse} (IC {ID_NUMBER:ic2}). Kami nak tangguh bayaran pinjaman rumah di {ADDRESS:addr}. Emel: {EMAIL:email}.',
  () => { const c = person('f'); return { cust: c.full, spouse: person('m', c.origin).full, ic2: mykad(birth(), 'm'), addr: address(), email: email(c) }; });
tpl('bank', 'en', null,
  'Someone called me from {PHONE:scam} pretending to be from the bank and asked for my TAC. I gave them my card number {ACCOUNT_NUMBER:card} before I realised. My name is {PERSON:cust}, IC {ID_NUMBER:ic}, and my real number is {PHONE:phone}.',
  () => { const c = person(); return { scam: phone(), card: card(), cust: c.full, ic: mykad(birth(), c.sex), phone: phone() }; });
tpl('bank', 'en', 'letter-o-for-zero',
  'Call me at {PHONE:ophone} or {PHONE:plain}. Account no {ACCOUNT_NUMBER:acct}. - {PERSON:cust}',
  () => ({ ophone: phone('dash').replace(/^0/, 'O'), plain: phone('plain'), acct: account(), cust: person().full }));
tpl('bank', 'en', 'obfuscated-email',
  'Statement please send to {EMAIL:obf}, name {PERSON:cust}, a/c {ACCOUNT_NUMBER:acct}.',
  () => { const c = person(); return { obf: obfEmail(email(c)), cust: c.full, acct: account() }; });
tpl('bank', 'en', null,
  'I am {PERSON:cust}, holding power of attorney for my aunt {PERSON:elder} (IC {ID_NUMBER:ic}, DOB {DATE_OF_BIRTH:dob}) who lives at {ADDRESS:addr}. Please call me at {PHONE:phone}.',
  () => { const b = birth(1935, 1955); return { cust: person().full, elder: person('f').full, ic: mykad(b, 'f'), dob: dob(b), addr: address(), phone: phone() }; });

// ---- school
tpl('school', 'ms', null,
  'Cikgu {PERSON:teacher}, saya {PERSON:parent}, ibu kepada {PERSON:child} dari kelas {_:class}. Anak saya tak dapat hadir esok sebab demam. Surat MC dari Dr. {PERSON:doctor} akan saya hantar. No. tel saya {PHONE:phone}.',
  () => { const p = person('f'); return { teacher: person().first, parent: p.full, child: person(undefined, p.origin).full, class: pick(['5 Bestari', '3 Cemerlang', '4 Amanah', '2 Dahlia']), doctor: person().full, phone: phone() }; });
tpl('school', 'en', null,
  'Dear Teacher {PERSON:teacher}, my daughter {PERSON:child} (student ID {ID_NUMBER:sid}, MyKid {ID_NUMBER:ic2}) will be picked up by her uncle {PERSON:uncle} today. His number is {PHONE:phone}. - {PERSON:parent}',
  () => { const p = person(); const c = person('f', p.origin); return { teacher: person().first, child: c.full, sid: `${pick(['M', 'P', 'S'])}${digits(7)}`, ic2: mykad(birth(2010, 2019), 'f'), uncle: person('m', p.origin).full, phone: phone(), parent: p.full }; });
tpl('school', 'mixed', null,
  'Hi cikgu, saya {PERSON:parent}. {PERSON:child} kena buli dengan {PERSON:bully} dalam bas sekolah. Pls call me {PHONE:phone}, I takut nak tulis panjang kat sini.',
  () => { const p = person(); return { parent: p.full, child: person(undefined, p.origin).first, bully: person('m').full, phone: phone() }; });
tpl('school', 'en', null,
  "Hello, I'd like to pay the PIBG fee for {PERSON:child} and {PERSON:child2} by bank transfer from my account {ACCOUNT_NUMBER:acct} at {ORG:bank}. Receipt to {EMAIL:email}. The address on record should be {ADDRESS:addr}.",
  () => { const p = person(); return { child: person(undefined, p.origin).full, child2: person(undefined, p.origin).full, acct: account(), bank: pick(BANKS), email: email(p), addr: address() }; });
tpl('school', 'ms', null,
  'Kami berpindah ke {ADDRESS:addr}. Mohon pindahkan rekod {PERSON:child} (no. sijil lahir {ID_NUMBER:bc}) ke sekolah baru. Hubungi bapa, {PERSON:parent}, di {PHONE:phone} atau {EMAIL:email}.',
  () => { const p = person('m'); return { addr: address(), child: person(undefined, p.origin).full, bc: `${pick(['A', 'B', 'AB'])}${digits(6)}`, parent: p.full, phone: phone(), email: email(p) }; });
tpl('school', 'en', null,
  'Please note {PERSON:child} (born {DATE_OF_BIRTH:dob}) has a peanut allergy. Her EpiPen is in her bag. In an emergency call me, {PERSON:parent}, at {PHONE:phone}, or her grandmother {PERSON:elder} at {PHONE:phone2}.',
  () => { const p = person(); return { child: person('f', p.origin).full, dob: dob(birth(2010, 2019)), parent: p.full, phone: phone(), elder: person('f', p.origin).full, phone2: phone() }; });
tpl('school', 'en', 'word-name',
  "{PERSON:kidFull} won't be in today. {PERSON:kid} is unwell; with God's grace she'll be back on Monday. I hope that's okay. - {PERSON:parent} ({PHONE:phone})",
  () => { const p = person('f', 'other'); const first = pick(['Grace', 'Hope', 'Joy', 'Faith']); return { kidFull: `${first} ${p.sur}`, kid: first, parent: p.full, phone: phone() }; });
tpl('school', 'ms', 'lowercase-name',
  'salam cikgu, ni mak {PERSON:child}. dia tertinggal buku latihan kat rumah. boleh call {PHONE:plain}? - {PERSON:parent}',
  () => { const p = person('f', 'malay'); return { child: person(undefined, 'malay').given.toLowerCase(), plain: phone('plain'), parent: p.given.toLowerCase() }; });
tpl('school', 'ms', 'spelled-digits',
  'Nombor telefon saya {PHONE:spelled}. Nama saya {PERSON:parent}, bapa kepada {PERSON:child}.',
  () => { const p = person('m'); const n = phone('plain'); return { spelled: spell(n, 'ms', n.length === 11 ? [3, 4, 4] : [3, 3, 4]), parent: p.full, child: person(undefined, p.origin).full }; });
tpl('school', 'en', 'word-name',
  'Hi Ms {PERSON:teacher}, {PERSON:child} will miss school in May for her surgery at {ORG:hospital}. You can reach me at {EMAIL:email}. - {PERSON:parent}',
  () => { const sur = pick(CN_SUR); const p = person('m', 'chinese'); return { teacher: pick(CN_SUR), child: `${sur} May Ling`, hospital: pick(HOSPITALS), email: email(p), parent: p.full }; });

// ---- a few longer, form-like messages
tpl('clinic', 'en', null,
  'Booking for a family check-up on {_:day}: {PERSON:a} (IC {ID_NUMBER:icA}), {PERSON:b} (IC {ID_NUMBER:icB}) and our daughter {PERSON:c}, born {DATE_OF_BIRTH:dobC}. Contact {PHONE:phone}, {EMAIL:email}. Home: {ADDRESS:addr}.',
  () => { const a = person('m'); const b = person('f', a.origin); const c = person('f', a.origin); return { day: pick(DAYS), a: a.full, icA: mykad(birth(), 'm'), b: b.full, icB: mykad(birth(), 'f'), c: c.full, dobC: dob(birth(2012, 2020)), phone: phone(), email: email(a), addr: address() }; });
tpl('hr', 'mixed', null,
  'Hi payroll, gaji bulan ni please masuk ke akaun baru {ACCOUNT_NUMBER:acct} ({ORG:bank}). Nama {PERSON:emp}, IC {ID_NUMBER:ic}, staff no {ID_NUMBER:empno}. Kalau ada masalah call {PHONE:phone}.',
  () => { const e = person(); return { acct: account(), bank: pick(BANKS), emp: e.full, ic: mykad(birth(1965, 2003), e.sex), empno: `${pick(['EMP', 'TF'])}${digits(5)}`, phone: phone() }; });
tpl('bank', 'ms', null,
  'Saya {PERSON:cust}, tarikh lahir {DATE_OF_BIRTH:dob}, pemegang kad {ACCOUNT_NUMBER:card}. Ada transaksi {_:amount} yang saya tak buat. Tolong hubungi saya di {PHONE:phone} atau emel {EMAIL:email}.',
  () => { const c = person(); return { cust: c.full, dob: dob(birth(), 'ms'), card: card(), amount: amount(), phone: phone(), email: email(c) }; });
tpl('school', 'en', null,
  'Emergency contact update for {PERSON:child} ({_:class}): mother {PERSON:mum}, {PHONE:phone}; father {PERSON:dad}, {PHONE:phone2}; email {EMAIL:email}; address {ADDRESS:addr}.',
  () => { const d = person('m'); const m = person('f', d.origin); return { child: person(undefined, d.origin).full, class: pick(['5 Bestari', '3 Cemerlang', '4 Amanah']), mum: m.full, phone: phone(), dad: d.full, phone2: phone(), email: email(m), addr: address() }; });

// ---------- fill
function fill(t, idx) {
  const v = t.gen();
  let text = '';
  const labels = new Map(); // key -> {category, parts: [{start, end, text}]}
  const optional = [];
  const re = /\{([A-Z_]+):([a-zA-Z0-9]+)(?:#([ab]))?\}/g;
  let last = 0;
  for (const m of t.text.matchAll(re)) {
    text += t.text.slice(last, m.index);
    last = m.index + m[0].length;
    const [, cat, key, part] = m;
    let val = v[key];
    if (Array.isArray(val)) val = val[part === 'b' ? 1 : 0];
    if (val === undefined) throw new Error(`template ${idx}: no value for ${key}`);
    const start = text.length;
    text += val;
    const span = { start, end: text.length, text: val };
    if (cat === '_') continue;
    if (cat === 'ORG') {
      optional.push({ category: 'ORGANIZATION', ...span });
      continue;
    }
    // the same key used twice (e.g. a name repeated) is one value seen twice; a split key is one value in parts
    const L = labels.get(key) ?? { category: cat, parts: [] };
    L.parts.push(span);
    labels.set(key, L);
  }
  text += t.text.slice(last);
  return {
    text,
    labels: [...labels.values()].map((l) => ({ category: l.category, value: l.parts.map((p) => p.text).join(' '), spans: l.parts.map(({ start, end }) => [start, end]) })),
    optional: optional.map((o) => ({ category: o.category, value: o.text, spans: [[o.start, o.end]] })),
  };
}

const messages = [];
for (let round = 0; round < PER; round++) {
  T.forEach((t, i) => {
    const m = fill(t, i);
    messages.push({ id: `${t.domain}-${String(i).padStart(2, '0')}-${round}`, domain: t.domain, lang: t.lang, adversarial: t.adversarial, ...m });
  });
}
// sanity: every span points at its value
for (const m of messages)
  for (const l of [...m.labels, ...m.optional])
    for (const [s, e] of l.spans) if (!m.text.slice(s, e) || /^\s|\s$/.test(m.text.slice(s, e))) throw new Error(`bad span in ${m.id}`);

const out = {
  name: 'Malaysian front-desk messages (synthetic)',
  note: 'Every name, number, address and email in this file is made up by bench/make-dataset.mjs. Postcodes and town names are real places; house numbers and streets are random. Emails use example domains.',
  seed: SEED,
  templates: T.length,
  messages,
};
const file = join(import.meta.dirname, 'dataset.json');
writeFileSync(file, JSON.stringify(out, null, 1));
const nLabels = messages.reduce((n, m) => n + m.labels.length, 0);
const byCat = {};
for (const m of messages) for (const l of m.labels) byCat[l.category] = (byCat[l.category] ?? 0) + 1;
console.log(`wrote ${file}: ${messages.length} messages, ${nLabels} labelled values, ${messages.reduce((n, m) => n + m.optional.length, 0)} optional`);
console.log(byCat);
console.log('adversarial messages:', messages.filter((m) => m.adversarial).length, 'langs:', Object.fromEntries(['en', 'ms', 'mixed'].map((l) => [l, messages.filter((m) => m.lang === l).length])));
