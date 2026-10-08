import { forwardRef } from 'react';

import kkrLogo from '../assets/kkr-logo.png';
import { amountToIndianRupeesWords } from '../utils/numberToWords';

export interface JVReceiptData {
  receiptNumber: string;
  date: string;
  projectName: string;
  projectLocation: string;
  shareholderName: string;
  companyName?: string | null;
  clientAddress?: string | null;
  clientCity?: string | null;
  clientPincode?: string | null;
  amount: number;
  paymentMode?: string | null;
  notes?: string | null;
  drawnOn?: string | null;
  signatureImage?: string | null;
  sealType?: string | null;
}

function formatReceiptDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-GB');
}

function formatReceiptAmount(value: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.max(0, value));
}

function splitIntoLines(text: string, maxCharacters: number, lineCount: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return Array.from({ length: lineCount }, () => '');

  const lines = Array.from({ length: lineCount }, () => '');
  let lineIndex = 0;

  for (const word of words) {
    if (lineIndex >= lineCount) {
      lines[lineCount - 1] = `${lines[lineCount - 1]} ${word}`.trim();
      continue;
    }

    const next = `${lines[lineIndex]} ${word}`.trim();
    if (lines[lineIndex] && next.length > maxCharacters && lineIndex < lineCount - 1) {
      lineIndex += 1;
      lines[lineIndex] = word;
      continue;
    }
    lines[lineIndex] = next;
  }

  return lines;
}

function fittedFontSize(text: string, idealCharacters: number, baseSize: number, minSize: number) {
  const length = text.trim().length;
  if (length <= idealCharacters) return baseSize;
  return Math.max(minSize, Math.min(baseSize, Math.floor((idealCharacters / length) * baseSize)));
}

const billDetails = {
  developers: {
    name: 'KKR DEVELOPERS',
    gstin: '33GMCPK8915E2Z2',
    addressLines: [
      'G1, Guru, Bhargavi Apartments, 44th St, Nanganallur, Chennai, Tamil Nadu 600061.',
    ],
    phoneNumbers: ['87786 43001', '87786 46351'],
  },
  foundations: {
    name: 'KKR FOUNDATIONS',
    gstin: '33HLZPK2038D1ZX',
    addressLines: [
      'G1, Guru, Bhargavi Apartments, 44th St, Nanganallur, Chennai, Tamil Nadu 600061.',
    ],
    phoneNumbers: ['87786 43001', '87786 46351'],
  },
} as const;

export const JVReceipt = forwardRef<HTMLDivElement, { data: JVReceiptData; sheetClassName?: string; compact?: boolean }>(
  function JVReceipt({ data, sheetClassName = '', compact = false }, ref) {
    const bill = data.sealType === 'foundations' ? billDetails.foundations : billDetails.developers;
    const fullAddress = [
      data.clientAddress,
      data.clientCity && data.clientPincode ? `${data.clientCity} - ${data.clientPincode}` : (data.clientCity || data.clientPincode),
    ].filter(Boolean).join(', ');

    const clientDetails = [
      data.shareholderName + (data.companyName ? ` @ ${data.companyName}` : ''),
      fullAddress || data.projectLocation,
    ].filter(Boolean).join(', ');

    const clientLines = splitIntoLines(clientDetails, 42, 2);
    const towardsText = [data.notes, data.projectName].filter(Boolean).join(' - ');
    const amountWords = amountToIndianRupeesWords(data.amount);

    const handwrittenStyle = {
      fontFamily: '"Times New Roman", Times, serif',
      color: '#1d3c90', // beautiful blue ballpoint pen ink color
      fontSize: '21px',
      fontWeight: 'bold',
      paddingLeft: '10px',
      paddingRight: '10px',
    } as const;

    return (
      <div
        ref={ref}
        className={`${sheetClassName} bg-white select-none relative overflow-hidden`}
        style={{
          width: '1000px',
          height: '626px',
          fontFamily: '"Times New Roman", Times, serif',
          color: '#0e2b67',
          boxSizing: 'border-box',
        }}
      >
        {/* Double Border Outer */}
        <div
          className="w-full h-full border-[3px] p-[5px]"
          style={{ borderColor: '#0e2b67', boxSizing: 'border-box' }}
        >
          {/* Double Border Inner */}
          <div
            className="w-full h-full border relative p-4"
            style={{ borderColor: '#0e2b67', borderWidth: '1.5px', boxSizing: 'border-box' }}
          >
            {/* GST No */}
            <div className="absolute left-[20px] top-[14px] text-[13px] font-sans font-bold text-[#0e2b67]">
              GST No: {bill.gstin}
            </div>

            {/* Cell numbers */}
            <div className="absolute right-[20px] top-[14px] text-right text-[13px] font-sans font-bold leading-[1.3] text-[#0e2b67]">
              <div>Cell : {bill.phoneNumbers[0]}</div>
              <div className="pr-[4px]">{bill.phoneNumbers[1]}</div>
            </div>

            {/* Logo */}
            <div className="absolute left-[30px] top-[40px] w-[110px]">
              <img
                src={kkrLogo}
                alt={`${bill.name} logo`}
                className="w-full object-contain"
              />
            </div>

            {/* Header Center Text */}
            <div className="absolute left-[150px] right-[150px] top-[15px] text-center text-[#0e2b67] flex flex-col items-center">
              <div className="text-[50px] font-bold uppercase tracking-[0.06em] leading-normal pb-2">
                {bill.name}
              </div>
              <div className="h-[2px] w-[460px]" style={{ backgroundColor: '#0e2b67' }} />
              <div className="mt-[6px] pb-2 text-[20px] font-bold leading-normal tracking-wide">
                ❖ Engineers ❖ Interior Designers ❖ Promoters ❖
              </div>
              <div className="h-[2px] w-[460px]" style={{ backgroundColor: '#0e2b67' }} />
              <div className="mt-[8px] text-[15px] font-bold leading-normal whitespace-nowrap">
                {bill.addressLines[0]}
              </div>
            </div>

            {/* Divider separating Header and Body */}
            <div className="absolute left-0 right-0 top-[180px]">
              <div className="h-[2px]" style={{ backgroundColor: '#0e2b67' }} />
              <div className="h-[1px] mt-[2px]" style={{ backgroundColor: '#0e2b67' }} />
            </div>

            {/* RECEIPT badge */}
            <div
              className="absolute left-[380px] w-[240px] top-[191px] bg-[#0e2b67] text-white text-[17px] font-sans font-bold py-1 px-8 rounded-full tracking-[0.15em] leading-none flex items-center justify-center z-10"
              style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}
            >
              RECEIPT
            </div>

            {/* S.No. and Date */}
            <div className="absolute left-[20px] top-[226px] flex items-end">
              <span className="font-serif font-bold text-[18px] text-[#0e2b67]">S.No.</span>
              <span className="font-sans font-extrabold text-[23px] text-[#cb1717] pl-3 leading-none tracking-wide">
                {data.receiptNumber}
              </span>
            </div>
            
            <div className="absolute right-[20px] top-[223px] flex items-end">
              <span className="font-serif font-bold text-[18px] text-[#0e2b67] pr-2">Date</span>
              <div className="w-[180px] border-b-2 border-dotted border-[#0e2b67] pb-[5px] text-center">
                <span style={handwrittenStyle} className="text-[20px] leading-none whitespace-nowrap">
                  {formatReceiptDate(data.date)}
                </span>
              </div>
            </div>

            {/* Line 1: RECEIVED with thanks from */}
            <div className="absolute left-[20px] right-[20px] top-[270px] flex items-end h-[35px]">
              <span className="font-serif font-bold text-[17px] text-[#0e2b67] pr-2 leading-[1.2] whitespace-nowrap">
                RECEIVED with thanks from
              </span>
              <div className="flex-1 border-b-2 border-dotted border-[#0e2b67] pb-[5px] min-w-0">
                <span style={{ ...handwrittenStyle, fontSize: `${fittedFontSize(clientLines[0], 52, 21, 12)}px` }} className="leading-none whitespace-nowrap">
                  {clientLines[0]}
                </span>
              </div>
            </div>

            {/* Line 2: RECEIVED with thanks from (Second line) */}
            <div className="absolute left-[20px] right-[20px] top-[315px] flex items-end h-[35px]">
              <div className="w-full border-b-2 border-dotted border-[#0e2b67] pb-[5px] min-w-0">
                <span style={{ ...handwrittenStyle, fontSize: `${fittedFontSize(clientLines[1], 58, 21, 12)}px` }} className="leading-none whitespace-nowrap pl-4">
                  {clientLines[1]}
                </span>
              </div>
            </div>

            {/* Line 3: sum of Rupees */}
            <div className="absolute left-[20px] right-[20px] top-[360px] flex items-end h-[35px]">
              <span className="font-serif font-bold text-[17px] text-[#0e2b67] pr-2 leading-[1.2] whitespace-nowrap">
                sum of Rupees
              </span>
              <div className="flex-1 border-b-2 border-dotted border-[#0e2b67] pb-[5px] min-w-0">
                <span style={{ ...handwrittenStyle, fontSize: `${fittedFontSize(amountWords, 72, 21, 10)}px` }} className="leading-none whitespace-nowrap">
                  {amountWords}
                </span>
              </div>
            </div>

            {/* Line 4: by Cash / Cheque / DD ... Drawn on */}
            <div className="absolute left-[20px] right-[20px] top-[405px] flex items-end h-[35px]">
              <span className="font-serif font-bold text-[17px] text-[#0e2b67] pr-2 leading-[1.2] whitespace-nowrap">
                by Cash / Cheque / DD
              </span>
              <div className="flex-1 border-b-2 border-dotted border-[#0e2b67] pb-[5px] min-w-[200px]">
                <span style={handwrittenStyle} className="leading-none whitespace-nowrap uppercase">
                  {data.paymentMode || 'Cash'}
                </span>
              </div>
              <span className="font-serif font-bold text-[17px] text-[#0e2b67] px-4 leading-[1.2] whitespace-nowrap">
                Drawn on
              </span>
              <div className="w-[260px] border-b-2 border-dotted border-[#0e2b67] pb-[5px] min-w-0">
                <span style={handwrittenStyle} className="leading-none whitespace-nowrap">
                  {data.drawnOn || ''}
                </span>
              </div>
            </div>

            {/* Line 5: Towards */}
            <div className="absolute left-[20px] right-[20px] top-[450px] flex items-end h-[35px]">
              <span className="font-serif font-bold text-[17px] text-[#0e2b67] pr-2 leading-[1.2] whitespace-nowrap">
                Towards
              </span>
              <div className="flex-1 border-b-2 border-dotted border-[#0e2b67] pb-[5px] min-w-0">
                <span style={{ ...handwrittenStyle, fontSize: `${fittedFontSize(towardsText, 78, 19, 10)}px` }} className="leading-none whitespace-nowrap">
                  {towardsText}
                </span>
              </div>
            </div>

            {/* Footer Amount Box (Rs.) */}
            <div className="absolute left-[20px] bottom-[20px] w-[280px]">
              <div className="border-2 border-[#0e2b67] p-[3px] rounded-[10px]">
                <div className="border border-[#0e2b67] rounded-[6px] px-4 py-2 flex items-baseline gap-2">
                  <span className="font-serif font-bold text-[22px] text-[#0e2b67]">Rs.</span>
                  <div className="flex-1 border-b-2 border-[#0e2b67] pb-1 text-center">
                    <span style={handwrittenStyle} className="text-[25px] font-bold">
                      {formatReceiptAmount(data.amount)} /-
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Signatory & Selected Stamp Overlay */}
            <div className="absolute right-[30px] bottom-[15px] w-[260px] text-center flex flex-col items-center">
              <span className="font-serif font-bold text-[15px] text-[#0e2b67] uppercase leading-none pb-[2px]">
                For {bill.name}
              </span>
              <div className="h-[95px] w-[240px] relative my-1 flex items-center justify-center">
                {/* Circular Stamp */}
                <div className="absolute transform pointer-events-none select-none opacity-85 z-0">
                  <svg width="100" height="100" viewBox="0 0 100 100" style={{ color: '#133580' }}>
                    <g transform="rotate(-6 50 50)">
                      <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeWidth="2" />
                      <circle cx="50" cy="50" r="32" fill="none" stroke="currentColor" strokeWidth="1" />
                      
                      <path id="stamp-top-path" d="M 12 50 A 38 38 0 0 1 88 50" fill="none" stroke="none" />
                      
                      <text fontSize="8.2" fontFamily="Arial, sans-serif" fontWeight="bold" fill="currentColor">
                        <textPath href="#stamp-top-path" startOffset="50%" textAnchor="middle">
                          {bill.name}
                        </textPath>
                      </text>
                      
                      <text x="50" y="48" fontFamily="Arial, sans-serif" fontSize="5.5" fontWeight="bold" textAnchor="middle" fill="currentColor">
                        Authorised Signatory
                      </text>
                      <text x="50" y="59" fontFamily="Arial, sans-serif" fontSize="6.5" fontWeight="bold" textAnchor="middle" fill="currentColor">
                        600061
                      </text>
                    </g>
                  </svg>
                </div>

                {/* Digital Signature Image Overlay */}
                {data.signatureImage && (
                  <div className="absolute transform pointer-events-none select-none z-10">
                    <img
                      src={data.signatureImage}
                      alt="Authorised Signature"
                      className="max-h-[85px] max-w-[200px] object-contain"
                    />
                  </div>
                )}
              </div>
              <span className="font-serif font-bold text-[13px] text-[#0e2b67] leading-none pt-1">
                Authorised Signatory
              </span>
            </div>

          </div>
        </div>
      </div>
    );
  },
);
