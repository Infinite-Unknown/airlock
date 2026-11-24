// Fictional sample messages for trying Airlock. Every name, number and address is made up.

export interface Sample {
  id: string;
  label: string;
  task: 'reply' | 'summary' | 'actions';
  text: string;
}

export const SAMPLES: Sample[] = [
  {
    id: 'clinic',
    label: 'Clinic front desk',
    task: 'reply',
    text: `Hello, this is Aisyah binti Rahman (IC 900101-14-5678). My son Daniel was seen by Dr. Lim on Monday for his asthma and I still have not received the medical certificate for his school, SK Taman Melati. Please email it to aisyah.rahman@example.com or WhatsApp me at +60 12-345 6789. Our address for the insurance claim is 12, Jalan Mawar 3, Taman Melati, 53100 Kuala Lumpur. Thank you.`,
  },
  {
    id: 'hr',
    label: 'HR leave request',
    task: 'actions',
    text: `Hi HR team, I'm Marcus Tan from the Penang warehouse (employee no. AB1234567). My wife Priya is due on 14 December so I'd like to apply for paternity leave from 12 Dec to 18 Dec. Please credit the leave allowance to my Maybank account 5123 4567 8901 2346. You can reach me on 016-789 0123 or marcus.tan@example.org. My manager, Siti Nur, has already approved it verbally.`,
  },
  {
    id: 'support',
    label: 'Bank complaint',
    task: 'summary',
    text: `To whom it may concern, my name is Jonathan Reyes, date of birth 03/07/1985. On 2 November my card 4111 1111 1111 1111 was charged twice for RM 489.00 at an online store. I called your hotline from (03) 2345 6789 and spoke to an agent called Farah, who promised a refund within 7 days. It has now been 3 weeks. Please resolve this by Friday or I will escalate to the regulator. Reply to j.reyes@example.net.`,
  },
];
