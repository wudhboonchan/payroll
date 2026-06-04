/**
 * VKSlipDocument — canonical slip rendering used in both the admin PaySlipV2 view
 * and the public EmployeeSlip page.  All styling is inline so it works inside a
 * popup print window without any external CSS file.
 */
import '../styles/tokens.css'

export interface SlipIncomeRow {
  label: string
  value: number
  detail?: string | null
  subs?: string[]
}

export interface SlipDeductRow {
  label: string
  value: number
}

export interface VKSlipDocumentProps {
  // Header
  logoSrc?: string
  companyName?: string          // "ห้างหุ้นส่วนจำกัด วิราญกร" etc.
  companyAddress?: string
  taxId?: string
  generatedAt?: string          // pre-formatted string; defaults to now

  // Employee band
  employeeName: string
  employeeCode: string
  positionLabel?: string
  jobTitle?: string
  branchName?: string

  // Period band
  periodLabel: string           // "1 พ.ค. – 15 พ.ค. 2569"
  paymentMethod: 'cash' | 'bank_transfer'
  bankName?: string
  bankAccount?: string          // already masked

  // Ledger
  income: SlipIncomeRow[]
  deductions: SlipDeductRow[]
  totalIncome: number
  totalDeduct: number
  netPay: number
  workingDays?: number

  // Admin-only indicators
  isOutdated?: boolean
}

const mono = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function thaiDateTimeNow() {
  const now = new Date()
  const MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']
  const d = now.getDate(), m = MONTHS[now.getMonth()], y = now.getFullYear() + 543
  const hh = String(now.getHours()).padStart(2, '0'), mm = String(now.getMinutes()).padStart(2, '0')
  return `${d} ${m} ${y} เวลา ${hh}:${mm} น.`
}

export function VKSlipDocument({
  logoSrc = '/logo.png',
  companyName = 'ห้างหุ้นส่วนจำกัด วิราญกร',
  companyAddress = 'เลขที่ 64 หมู่ 1 ตำบลบ้านธาตุ อำเภอแก่งคอย จังหวัดสระบุรี 18110',
  taxId = '0193554000514',
  generatedAt,
  employeeName,
  employeeCode,
  positionLabel,
  jobTitle,
  branchName,
  periodLabel,
  paymentMethod,
  bankName,
  bankAccount,
  income,
  deductions,
  totalIncome,
  totalDeduct,
  netPay,
  workingDays,
  isOutdated = false,
}: VKSlipDocumentProps) {
  const dateStr = generatedAt ?? thaiDateTimeNow()

  return (
    <div style={{
      background: '#fff',
      fontFamily: "'Sarabun', 'Noto Sans Thai', sans-serif",
      color: '#1a1a1a',
      border: isOutdated ? '2px solid #f5c842' : '1px solid #e2e2e2',
      boxShadow: '0 2px 16px rgba(0,0,0,0.07)',
    }}>

      {/* ── Header ── */}
      <div style={{ padding: '24px 28px 20px', borderBottom: '1px solid #e8e8e8', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img src={logoSrc} alt="logo" style={{ width: 72, height: 72, objectFit: 'contain', flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#1a1a1a', letterSpacing: '-0.02em' }}>
              {companyName}
            </div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 4, lineHeight: 1.7 }}>
              {companyAddress}<br />
              เลขประจำตัวผู้เสียภาษี: <span style={{ color: '#555', fontWeight: 600 }}>{taxId}</span>
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#1a1a1a', letterSpacing: '-0.01em' }}>ใบสลิปเงินเดือน</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 6, lineHeight: 1.8 }}>
            จัดทำเมื่อ<br />
            <span style={{ color: '#555', fontWeight: 600 }}>{dateStr}</span>
          </div>
        </div>
      </div>

      {/* ── Employee + period band ── */}
      <div style={{ background: '#f7f7f7', borderBottom: '1px solid #e8e8e8', display: 'grid', gridTemplateColumns: '1fr 380px', gap: 0 }}>
        <div style={{ padding: '14px 28px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#aaa', marginBottom: 5 }}>พนักงาน</div>
          <div style={{ fontWeight: 700, fontSize: 17, color: '#1a1a1a', letterSpacing: '-0.01em' }}>{employeeName}</div>
          <div style={{ fontSize: 11, color: '#777', marginTop: 3 }}>
            <span style={{ fontFamily: 'monospace' }}>{employeeCode}</span>
            {positionLabel ? ` · ${positionLabel}` : ''}
            {jobTitle ? ` – ${jobTitle}` : ''}
          </div>
          {branchName && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{branchName}</div>}
        </div>
        <div style={{ padding: '14px 28px', display: 'grid', gridTemplateColumns: '160px 1fr' }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#aaa', marginBottom: 5 }}>งวดเงินเดือน</div>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#1a1a1a' }}>{periodLabel}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#aaa', marginBottom: 5 }}>วิธีรับเงิน</div>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#1a1a1a' }}>
              {paymentMethod === 'bank_transfer' ? 'โอนธนาคาร' : 'เงินสด'}
            </div>
            {paymentMethod === 'bank_transfer' && bankName && (
              <div style={{ fontSize: 11, color: '#888', fontFamily: 'monospace', marginTop: 2 }}>
                {bankName}{bankAccount ? ` · ${bankAccount}` : ''}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Ledger ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>

        {/* Income */}
        <div style={{ borderRight: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 24px', background: '#fafafa', borderBottom: '1px solid #e8e8e8' }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#777' }}>รายได้</span>
          </div>
          <div style={{ flex: 1, padding: '0 24px' }}>
            {income.map((r, i) => (
              <div key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '9px 0 2px' }}>
                  <span style={{ fontSize: 13, color: '#1a1a1a', fontWeight: 500 }}>{r.label}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap' }}>{mono(r.value)}</span>
                </div>
                {r.detail && (
                  <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#b44a2a', paddingBottom: 5 }}>{r.detail}</div>
                )}
                {r.subs?.map((sub, si) => (
                  <div key={si} style={{ display: 'flex', gap: 6, padding: '3px 0 3px 8px', alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: '#bbb', flexShrink: 0 }}>·</span>
                    <span style={{ fontSize: 11, color: '#999', flex: 1 }}>{sub}</span>
                  </div>
                ))}
                {(r.subs?.length ?? 0) > 0 && <div style={{ paddingBottom: 6 }} />}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 24px', background: '#f7f7f7', borderTop: '1px solid #e8e8e8', marginTop: 'auto' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: '0.04em' }}>รวมรายได้</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 14, color: '#1a7a3c' }}>{mono(totalIncome)}</span>
          </div>
        </div>

        {/* Deductions */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 24px', background: '#fafafa', borderBottom: '1px solid #e8e8e8' }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#777' }}>รายการหัก</span>
          </div>
          <div style={{ flex: 1, padding: '0 24px' }}>
            {deductions.length === 0
              ? <div style={{ padding: '9px 0', fontSize: 12, color: '#bbb' }}>ไม่มีรายการหัก</div>
              : deductions.map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '9px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <span style={{ fontSize: 13, color: '#1a1a1a', fontWeight: 500 }}>{r.label}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600, color: '#c0392b', whiteSpace: 'nowrap' }}>{mono(r.value)}</span>
                </div>
              ))
            }
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 24px', background: '#f7f7f7', borderTop: '1px solid #e8e8e8', marginTop: 'auto' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: '0.04em' }}>รวมรายการหัก</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 14, color: '#c0392b' }}>{mono(totalDeduct)}</span>
          </div>
        </div>
      </div>

      {/* ── Net pay ── */}
      <div style={{ borderTop: '2px solid #e8e8e8', padding: '18px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#aaa' }}>เงินได้สุทธิ</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#555', marginTop: 2 }}>NET PAY</div>
          {(workingDays ?? 0) > 0 && (
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 3 }}>{workingDays} วันทำงาน</div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 38, letterSpacing: '-0.03em', color: '#1a1a1a', lineHeight: 1 }}>
            {mono(netPay)}
          </div>
          <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>บาท</div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{ padding: '10px 28px', background: '#f7f7f7', borderTop: '1px solid #e8e8e8', textAlign: 'center', fontSize: 10, color: '#bbb', letterSpacing: '0.02em' }}>
        เอกสารฉบับนี้เป็นเอกสารแสดงรายได้ของพนักงาน {companyName} อย่างเป็นทางการ
      </div>
    </div>
  )
}
