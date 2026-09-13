/**
 * Fixed demo values for rows the CSV does not cover (leads).
 *
 * Plausible Indirapuram names and goals. Fake by construction: lead mobiles use the
 * reserved `+91 90000 3xxxx` range from demo-data-seed-spec.md §1, which the
 * WhatsApp simulator refuses to send to outside the allowlist.
 */

export const LEAD_NAMES: readonly string[] = [
  'Neha Srivastava',
  'Rahul Chaudhary',
  'Pooja Bansal',
  'Aman Saxena',
  'Kavita Rawat',
  'Sandeep Yadav',
  'Ritika Goel',
  'Vikas Negi',
  'Swati Mishra',
  'Deepak Bhatia',
  'Anjali Verma',
  'Rohan Kapoor',
  'Meenakshi Jain',
  'Gaurav Sharma',
  'Sonal Agarwal',
  'Manish Tripathi',
  'Divya Malhotra',
  'Arjun Rana',
  'Nisha Bisht',
  'Kunal Sethi',
  'Priyanka Dutta',
  'Yash Garg',
  'Shalini Pathak',
  'Tarun Mehra',
  'Isha Khurana',
];

export const LEAD_GOALS: readonly string[] = [
  'Weight loss',
  'Muscle gain',
  'General fitness',
  'Strength training',
  'Back to fitness after a break',
];

export const LEFT_OWNER_REASONS = ['OWNER_MARKED', 'MOVED_AWAY', 'PRICE', 'HEALTH', 'NOT_SATISFIED', 'LAPSED'] as const;
