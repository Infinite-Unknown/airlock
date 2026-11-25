// Fictional messages that reach a family clinic's front desk in Malaysia. Every name, number and
// address is made up; emails use example domains.

export interface Sample {
  id: string;
  label: string;
  task: 'reply' | 'reply_ms' | 'summary' | 'actions' | 'triage';
  text: string;
}

export const SAMPLES: Sample[] = [
  {
    id: 'clinic',
    label: 'WhatsApp: MC for school',
    task: 'reply_ms',
    text: `Salam, saya Aisyah binti Rahman (IC 900101-14-5678). Anak saya Daniel jumpa Dr. Lim hari Isnin sebab asma, tapi MC untuk sekolah dia, SK Taman Melati, belum dapat lagi. Boleh email ke aisyah.rahman@example.com atau WhatsApp +60 12-345 6789? Alamat untuk claim insurans: 12, Jalan Mawar 3, Taman Melati, 53100 Kuala Lumpur. Terima kasih.`,
  },
  {
    id: 'insurance',
    label: 'Email: insurance claim',
    task: 'reply',
    text: `Dear clinic, I am writing for my father, Mr Tan Ah Kow (MyKad 520303-07-5117, born 3 March 1952). His insurer needs the discharge summary and the bill from his visit last week. Please email them to tan.meiling@example.net or call me, Tan Mei Ling, at 016-789 0123. Thank you.`,
  },
  {
    id: 'appointment',
    label: 'Message: urgent appointment',
    task: 'triage',
    text: `Assalamualaikum. Saya Muthu a/l Rajendran, IC 780412-10-5531. Saya nak buat temujanji untuk ibu saya, Letchumy a/p Sinnasamy, tarikh lahir 9 Ogos 1949. Dia pening dan tekanan darah tinggi sejak semalam. Boleh call saya di 019-445 2210. Alamat: Lot 1123, Kampung Seri Aman, 40460 Shah Alam.`,
  },
];
