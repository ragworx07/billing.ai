const smallNumbers = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const tensWords = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function convertBelowHundred(value: number): string {
  if (value < 20) return smallNumbers[value];
  const ten = Math.floor(value / 10);
  const unit = value % 10;
  return unit ? `${tensWords[ten]} ${smallNumbers[unit]}` : tensWords[ten];
}

function convertBelowThousand(value: number): string {
  const hundred = Math.floor(value / 100);
  const remainder = value % 100;
  const pieces: string[] = [];
  if (hundred) pieces.push(`${smallNumbers[hundred]} Hundred`);
  if (remainder) pieces.push(convertBelowHundred(remainder));
  return pieces.join(' ');
}

function convertIndianNumber(value: number): string {
  if (value === 0) return 'Zero';

  const crores = Math.floor(value / 10000000);
  const lakhs = Math.floor((value % 10000000) / 100000);
  const thousands = Math.floor((value % 100000) / 1000);
  const remainder = value % 1000;

  const pieces: string[] = [];
  if (crores) pieces.push(`${convertBelowThousand(crores)} Crore`);
  if (lakhs) pieces.push(`${convertBelowThousand(lakhs)} Lakh`);
  if (thousands) pieces.push(`${convertBelowThousand(thousands)} Thousand`);
  if (remainder) pieces.push(convertBelowThousand(remainder));
  return pieces.join(' ').trim();
}

export function amountToIndianRupeesWords(amount: number): string {
  const numericAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  const rupees = Math.floor(numericAmount);
  const paise = Math.round((numericAmount - rupees) * 100);
  const rupeeWords = convertIndianNumber(rupees);
  if (paise <= 0) return `${rupeeWords} Only`;
  return `${rupeeWords} and ${convertBelowHundred(paise)} Paise Only`;
}
