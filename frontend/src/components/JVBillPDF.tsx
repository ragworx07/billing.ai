import { forwardRef, useId } from 'react';
import kkrLogo from '../assets/kkr-logo.png';
import type { Bill } from '../types/api';
import { amountToIndianRupeesWords } from '../utils/numberToWords';

export interface JVBillPDFProps {
  bill: Bill;
  sheetClassName?: string;
}

function formatBillDateDisplay(value: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = String(date.getDate()).padStart(2, '0');
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${day} ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
}

function formatIndianNumber(value: number) {
  return Math.round(value || 0).toLocaleString('en-IN');
}

const companyDetails = {
  developers: {
    name: 'KKR DEVELOPERS',
    gstin: '33GMCPK8915E2Z2',
    pan: 'GMCPK8915E',
    addressLines: [
      'No.12A, Dr.Ambedkar street, Rajarajeswari nagar,',
      'Madipakkam, Chennai- 600 091.',
    ],
    email: 'kkrdevelopers09@gmail.com',
    mobiles: '8778643001, 8778646351',
    stampTitle: 'KKR DEVELOPERS',
    stampPincode: '600 061',
  },
  foundations: {
    name: 'KKR FOUNDATIONS',
    gstin: '33HLZPK2038D1ZX',
    pan: 'HLZPK2038D',
    addressLines: [
      'No.21A, Senthil Nagar, 1st street,',
      'Madipakkam, Chennai- 600 091.',
    ],
    email: 'kkrfoundations09@gmail.com',
    mobiles: '8778643001, 8778646351',
    stampTitle: 'KKR FOUNDATIONS',
    stampPincode: '600 091',
  },
} as const;

const cell = {
  border: '1px solid #0f172a',
  padding: '8px 8px',
  verticalAlign: 'middle' as const,
};

const amountCell = {
  ...cell,
  textAlign: 'right' as const,
  whiteSpace: 'nowrap' as const,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  overflow: 'visible' as const,
};

export const JVBillPDF = forwardRef<HTMLDivElement, JVBillPDFProps>(function JVBillPDF(
  { bill, sheetClassName = '' },
  ref
) {
  const company = bill.seal_type === 'foundations' ? companyDetails.foundations : companyDetails.developers;
  const stampPathId = `gst-stamp-arc-${useId().replace(/:/g, '')}`;

  const processedItems = (bill.items || []).map((item) => {
    const qty = item.quantity || 1;
    const baseAmt = item.amount || (qty * item.rate) || 0;
    const cgstRate = item.cgst_rate ?? 2.5;
    const sgstRate = item.sgst_rate ?? 2.5;
    const cgstAmt = item.cgst_amount || Math.round((baseAmt * cgstRate) / 100);
    const sgstAmt = item.sgst_amount || Math.round((baseAmt * sgstRate) / 100);
    return {
      description: item.description,
      hsnCode: item.hsn_code || '995411',
      baseAmt,
      cgstRate,
      sgstRate,
      cgstAmt,
      sgstAmt,
      itemTotal: baseAmt + cgstAmt + sgstAmt,
    };
  });

  const totalBaseAmount = processedItems.reduce((sum, i) => sum + i.baseAmt, 0) || bill.subtotal || 0;
  const totalCgstAmount = processedItems.reduce((sum, i) => sum + i.cgstAmt, 0) || Math.round((totalBaseAmount * 2.5) / 100);
  const totalSgstAmount = processedItems.reduce((sum, i) => sum + i.sgstAmt, 0) || Math.round((totalBaseAmount * 2.5) / 100);
  const discount = Number(bill.discount_amount || 0);
  const grandTotal = bill.total_amount || Math.max(0, totalBaseAmount + totalCgstAmount + totalSgstAmount - discount);
  const amountWords = amountToIndianRupeesWords(grandTotal);
  const projectLabel = bill.project_name || bill.custom_project_name || '';
  const billingLines = [
    bill.billing_address,
    [bill.billing_city, bill.billing_pincode].filter(Boolean).join(' – ') || null,
  ].filter(Boolean) as string[];
  const displayItems = processedItems.length
    ? processedItems
    : [{
        description: 'Payment',
        hsnCode: '995411',
        baseAmt: totalBaseAmount,
        cgstRate: 2.5,
        sgstRate: 2.5,
        cgstAmt: totalCgstAmount,
        sgstAmt: totalSgstAmount,
        itemTotal: grandTotal,
      }];
  const minRows = 5;
  const spacerCount = Math.max(0, minRows - displayItems.length);

  return (
    <div
      ref={ref}
      className={`${sheetClassName} bg-white select-none relative`}
      style={{
        width: '794px',
        minHeight: '1123px',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
        color: '#0f172a',
        padding: '24px 22px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          border: '1.5px solid #0f172a',
          minHeight: '1067px',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ padding: '18px 20px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px' }}>
          <div style={{ display: 'flex', gap: '12px', minWidth: 0, flex: 1 }}>
            <img src={kkrLogo} alt="KKR Logo" style={{ height: '52px', width: 'auto', objectFit: 'contain', flexShrink: 0, marginTop: '2px' }} />
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: '18px', fontWeight: 900, letterSpacing: '0.04em', lineHeight: 1.15 }}>{company.name}</p>
              <p style={{ margin: '6px 0 0', fontSize: '11px', lineHeight: 1.45, color: '#334155', fontWeight: 500 }}>
                {company.addressLines.join(' ')}
              </p>
              <p style={{ margin: '4px 0 0', fontSize: '11px', lineHeight: 1.45, color: '#334155' }}>
                Email: <span style={{ fontWeight: 700, color: '#0f172a' }}>{company.email}</span>
                <span style={{ margin: '0 6px', color: '#94a3b8' }}>|</span>
                Mob: <span style={{ fontWeight: 700, color: '#0f172a' }}>{company.mobiles}</span>
              </p>
              <p style={{ margin: '6px 0 0', fontSize: '11px', fontWeight: 700, letterSpacing: '0.02em' }}>
                GSTIN: {company.gstin}
                <span style={{ margin: '0 8px', color: '#94a3b8', fontWeight: 500 }}>|</span>
                PAN: {company.pan}
              </p>
            </div>
          </div>
          <div
            style={{
              width: '214px',
              flexShrink: 0,
              border: '1px solid #0f172a',
              background: '#f8fafc',
            }}
          >
            <div style={{ background: '#0f172a', color: '#fff', textAlign: 'center', fontSize: '11px', fontWeight: 800, letterSpacing: '0.16em', padding: '7px 8px' }}>
              TAX INVOICE
            </div>
            <div style={{ padding: '10px 12px', fontSize: '11px', lineHeight: 1.55 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ color: '#64748b', fontWeight: 700 }}>Invoice No.</span>
                <span style={{ fontWeight: 800, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{bill.bill_number}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '4px' }}>
                <span style={{ color: '#64748b', fontWeight: 700 }}>Date</span>
                <span style={{ fontWeight: 700 }}>{formatBillDateDisplay(bill.bill_date)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '4px' }}>
                <span style={{ color: '#64748b', fontWeight: 700 }}>Due Date</span>
                <span style={{ fontWeight: 700 }}>{formatBillDateDisplay(bill.due_date)}</span>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', borderTop: '1px solid #0f172a', borderBottom: '1px solid #0f172a' }}>
          <div style={{ padding: '12px 16px 14px', borderRight: '1px solid #0f172a' }}>
            <p style={{ margin: 0, fontSize: '9px', fontWeight: 800, letterSpacing: '0.16em', color: '#64748b', textTransform: 'uppercase' }}>Bill To</p>
            <p style={{ margin: '6px 0 0', fontSize: '13px', fontWeight: 800, lineHeight: 1.3 }}>{bill.client_name}</p>
            {bill.company_name ? (
              <p style={{ margin: '3px 0 0', fontSize: '11px', fontWeight: 600, color: '#334155' }}>PAN / Co.: {bill.company_name}</p>
            ) : null}
            {billingLines.length ? billingLines.map((line) => (
              <p key={line} style={{ margin: '3px 0 0', fontSize: '11px', lineHeight: 1.4, color: '#334155', fontWeight: 500 }}>{line}</p>
            )) : (
              <p style={{ margin: '3px 0 0', fontSize: '11px', color: '#334155' }}>Chennai</p>
            )}
          </div>
          <div style={{ padding: '12px 16px 14px', background: '#f8fafc' }}>
            <p style={{ margin: 0, fontSize: '9px', fontWeight: 800, letterSpacing: '0.16em', color: '#64748b', textTransform: 'uppercase' }}>Supply Details</p>
            <div style={{ marginTop: '8px', fontSize: '11px', lineHeight: 1.55 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                <span style={{ color: '#64748b', fontWeight: 700 }}>Place of Supply</span>
                <span style={{ fontWeight: 700, textAlign: 'right' }}>Tamil Nadu (33)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginTop: '4px' }}>
                <span style={{ color: '#64748b', fontWeight: 700 }}>Project</span>
                <span style={{ fontWeight: 700, textAlign: 'right' }}>{projectLabel || '—'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginTop: '4px' }}>
                <span style={{ color: '#64748b', fontWeight: 700 }}>HSN / SAC</span>
                <span style={{ fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>995411</span>
              </div>
            </div>
          </div>
        </div>

        <        table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: '11px' }}>
          <colgroup>
            <col style={{ width: '5.5%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '6.5%' }} />
            <col style={{ width: '6.5%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '15.5%' }} />
          </colgroup>
          <thead>
            <tr style={{ background: '#0f172a', color: '#fff' }}>
              <th style={{ ...cell, borderColor: '#0f172a', textAlign: 'center', fontWeight: 700 }}>S.No</th>
              <th style={{ ...cell, textAlign: 'left', fontWeight: 700 }}>Particulars</th>
              <th style={{ ...cell, textAlign: 'center', fontWeight: 700 }}>HSN</th>
              <th style={{ ...amountCell, fontWeight: 700, fontFamily: 'inherit' }}>Taxable (₹)</th>
              <th style={{ ...cell, textAlign: 'center', fontWeight: 700 }}>CGST</th>
              <th style={{ ...cell, textAlign: 'center', fontWeight: 700 }}>SGST</th>
              <th style={{ ...amountCell, fontWeight: 700, fontFamily: 'inherit' }}>CGST (₹)</th>
              <th style={{ ...amountCell, fontWeight: 700, fontFamily: 'inherit' }}>SGST (₹)</th>
              <th style={{ ...amountCell, fontWeight: 700, fontFamily: 'inherit' }}>Total (₹)</th>
            </tr>
          </thead>
          <tbody>
            {displayItems.map((item, idx) => (
              <tr key={`item-${idx}`}>
                <td style={{ ...cell, textAlign: 'center', fontWeight: 600, color: '#475569' }}>{idx + 1}</td>
                <td style={{ ...cell, textAlign: 'left', fontWeight: 700 }}>{item.description}</td>
                <td style={{ ...cell, textAlign: 'center', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{item.hsnCode}</td>
                <td style={amountCell}>{formatIndianNumber(item.baseAmt)}</td>
                <td style={{ ...cell, textAlign: 'center' }}>{item.cgstRate}%</td>
                <td style={{ ...cell, textAlign: 'center' }}>{item.sgstRate}%</td>
                <td style={amountCell}>{formatIndianNumber(item.cgstAmt)}</td>
                <td style={amountCell}>{formatIndianNumber(item.sgstAmt)}</td>
                <td style={{ ...amountCell, fontWeight: 800 }}>{formatIndianNumber(item.itemTotal)}</td>
              </tr>
            ))}
            {Array.from({ length: spacerCount }).map((_, idx) => (
              <tr key={`spacer-${idx}`}>
                {Array.from({ length: 9 }).map((__, col) => (
                  <td key={col} style={{ ...cell, height: '34px' }}>&nbsp;</td>
                ))}
              </tr>
            ))}
            <tr style={{ background: '#f1f5f9', fontWeight: 800 }}>
              <td colSpan={3} style={{ ...cell, textAlign: 'center', letterSpacing: '0.08em', fontSize: '10px', textTransform: 'uppercase' }}>Subtotal</td>
              <td style={amountCell}>{formatIndianNumber(totalBaseAmount)}</td>
              <td style={cell} />
              <td style={cell} />
              <td style={amountCell}>{formatIndianNumber(totalCgstAmount)}</td>
              <td style={amountCell}>{formatIndianNumber(totalSgstAmount)}</td>
              <td style={{ ...amountCell, fontWeight: 800 }}>{formatIndianNumber(totalBaseAmount + totalCgstAmount + totalSgstAmount)}</td>
            </tr>
          </tbody>
        </table>

        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', flex: 1 }}>
          <div style={{ padding: '14px 16px 16px', borderRight: '1px solid #0f172a', display: 'flex', flexDirection: 'column' }}>
            <p style={{ margin: 0, fontSize: '9px', fontWeight: 800, letterSpacing: '0.16em', color: '#64748b', textTransform: 'uppercase' }}>Amount in Words</p>
            <p style={{ margin: '8px 0 0', fontSize: '13px', fontWeight: 700, lineHeight: 1.4, fontStyle: 'italic' }}>
              Rupees {amountWords} only
            </p>
            {bill.notes ? (
              <div style={{ marginTop: '16px' }}>
                <p style={{ margin: 0, fontSize: '9px', fontWeight: 800, letterSpacing: '0.16em', color: '#64748b', textTransform: 'uppercase' }}>Remarks</p>
                <p style={{ margin: '6px 0 0', fontSize: '11px', lineHeight: 1.45, color: '#334155', fontWeight: 500 }}>{bill.notes}</p>
              </div>
            ) : null}
            <div style={{ marginTop: 'auto', paddingTop: '18px' }}>
              <p style={{ margin: 0, fontSize: '9px', fontWeight: 800, letterSpacing: '0.16em', color: '#64748b', textTransform: 'uppercase' }}>Declaration</p>
              <p style={{ margin: '6px 0 0', fontSize: '10px', lineHeight: 1.45, color: '#475569', fontWeight: 500 }}>
                We declare that this invoice shows the actual price of the services described and that all particulars are true and correct.
              </p>
            </div>
          </div>
          <div>
            {[
              ['Taxable Value', formatIndianNumber(totalBaseAmount)],
              ['CGST', formatIndianNumber(totalCgstAmount)],
              ['SGST', formatIndianNumber(totalSgstAmount)],
              ...(discount > 0 ? [['Discount', `− ${formatIndianNumber(discount)}`]] as const : []),
            ].map(([label, value]) => (
              <div
                key={label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderBottom: '1px solid #0f172a',
                  padding: '9px 14px',
                  fontSize: '11px',
                  fontWeight: 700,
                }}
              >
                <span style={{ color: '#334155' }}>{label}</span>
                <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'nowrap' }}>{value}</span>
              </div>
            ))}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 14px',
                background: '#0f172a',
                color: '#fff',
                fontWeight: 900,
                fontSize: '13px',
              }}
            >
              <span>Grand Total</span>
              <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'nowrap' }}>₹ {formatIndianNumber(grandTotal)}</span>
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: '24px',
            borderTop: '1px solid #0f172a',
            padding: '14px 16px 16px',
            minHeight: '168px',
          }}
        >
          <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 600, lineHeight: 1.45, maxWidth: '280px' }}>
            This is a computer generated tax invoice. Please quote the invoice number in all correspondence.
          </div>
          <div style={{ width: '250px', textAlign: 'center', flexShrink: 0 }}>
            <p style={{ margin: 0, fontSize: '11px', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              For {company.name}
            </p>
            <div style={{ height: '108px', position: 'relative', margin: '4px 0 2px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ position: 'absolute', opacity: 0.88, pointerEvents: 'none' }}>
                <svg width="108" height="108" viewBox="0 0 100 100" style={{ color: '#102a6b' }}>
                  <g transform="rotate(-5 50 50)">
                    <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeWidth="2.5" />
                    <circle cx="50" cy="50" r="32" fill="none" stroke="currentColor" strokeWidth="1.2" />
                    <path id={stampPathId} d="M 12 50 A 38 38 0 0 1 88 50" fill="none" stroke="none" />
                    <text fontSize="7.4" fontFamily="Inter, sans-serif" fontWeight="bold" fill="currentColor">
                      <textPath href={`#${stampPathId}`} startOffset="50%" textAnchor="middle">
                        {company.stampTitle}
                      </textPath>
                    </text>
                    <text x="50" y="47" fontFamily="Inter, sans-serif" fontSize="5.8" fontWeight="bold" textAnchor="middle" fill="currentColor">Chennai</text>
                    <text x="50" y="56" fontFamily="Inter, sans-serif" fontSize="6.2" fontWeight="bold" textAnchor="middle" fill="currentColor">{company.stampPincode}</text>
                    <text x="50" y="65" fontFamily="Inter, sans-serif" fontSize="6.2" fontWeight="bold" textAnchor="middle" fill="currentColor">Proprietor</text>
                  </g>
                </svg>
              </div>
              {bill.signature_image ? (
                <img
                  src={bill.signature_image}
                  alt="Authorised signature"
                  style={{
                    position: 'relative',
                    zIndex: 2,
                    maxHeight: '86px',
                    maxWidth: '210px',
                    objectFit: 'contain',
                    pointerEvents: 'none',
                  }}
                />
              ) : null}
            </div>
            <div style={{ borderTop: '1px solid #0f172a', paddingTop: '6px' }}>
              <p style={{ margin: 0, fontSize: '11px', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Authorised Signatory
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
