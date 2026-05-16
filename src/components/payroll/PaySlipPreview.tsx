import { forwardRef } from 'react'
import { format } from 'date-fns'
import { th } from 'date-fns/locale'
import { formatThaiCurrency, formatPeriodLabel } from '../../lib/formatters'

export interface PaySlipData {
  employee_code: string
  first_name: string
  last_name: string
  factory_name?: string
  period_start: string
  period_end: string
  generated_at?: string
  position?: string   // 'worker' | 'clerk'

  // Income
  amount_normal: number
  amount_shift: number
  amount_ot: number
  amount_ot_1x?: number
  amount_wood_excess: number
  amount_film: number
  amount_special: number
  special_note?: string
  amount_diligence: number
  amount_position: number

  // Day/hour counts for display
  days_normal?: number
  days_shift?: number
  days_ot?: number
  days_ot_1x?: number

  // Deductions
  deduct_social_security: number
  deduct_advance: number
  deduct_safety_equipment: number
  deduct_uniform: number

  // Totals
  total_income: number
  total_deductions: number
  net_pay: number

  // Payment
  payment_method: 'cash' | 'bank_transfer'
  bank_name?: string
  bank_account?: string
}

interface PaySlipPreviewProps {
  data: PaySlipData | null
}

export const PaySlipPreview = forwardRef<HTMLDivElement, PaySlipPreviewProps>(({ data }, ref) => {
  if (!data) return null

  const isClerk = data.position === 'clerk'
  const periodLabel = formatPeriodLabel(data.period_start, data.period_end)

  const formatDateThai = (dateStr: string) => {
    const date = new Date(dateStr)
    const d = format(date, 'd')
    const m = format(date, 'MMM', { locale: th })
    const y = date.getFullYear() + 543
    const time = format(date, 'HH:mm')
    return `${d} ${m} ${y}, ${time} น.`
  }

  const generatedAt = data.generated_at
    ? formatDateThai(data.generated_at)
    : formatDateThai(new Date().toISOString())

  const otUnit = 'ชม.'

  const incomeRows = [
    { label: `ค่าจ้างปกติ${data.days_normal != null ? ` (${data.days_normal} วัน)` : ''}`, value: data.amount_normal },
    { label: `ค่ากะ${data.days_shift != null ? ` (${data.days_shift} วัน)` : ''}`, value: data.amount_shift },
    { label: `ค่าล่วงเวลา (OT)${data.days_ot != null && data.days_ot > 0 ? ` (${data.days_ot} ${otUnit})` : ''}`, value: data.amount_ot },
    { label: `ค่าล่วงเวลา (OT วันหยุด 1 เท่า)${data.days_ot_1x != null && data.days_ot_1x > 0 ? ` (${data.days_ot_1x} ${otUnit})` : ''}`, value: data.amount_ot_1x || 0 },
    { label: 'ค่าไม้ส่วนเกิน',  value: data.amount_wood_excess },
    { label: 'ค่าฟิล์ม',        value: data.amount_film },
    { label: 'เงินพิเศษ' + (data.special_note ? ` (${data.special_note})` : ''), value: data.amount_special },
    { label: 'เบี้ยขยัน',       value: data.amount_diligence },
    { label: 'ค่าตำแหน่ง',      value: data.amount_position },
  ].filter(r => r.value > 0)

  const deductRows = [
    { label: 'ประกันสังคม',            value: data.deduct_social_security },
    { label: 'เบิกล่วงหน้า',           value: data.deduct_advance },
    { label: 'ค่าอุปกรณ์ความปลอดภัย', value: data.deduct_safety_equipment },
    { label: 'ค่าเสื้อพนักงาน',        value: data.deduct_uniform },
  ].filter(r => r.value > 0)

  const S = {
    wrap: {
      background: '#fff',
      fontFamily: 'sans-serif',
      color: '#1e293b',
      maxWidth: '210mm',
      margin: '0 auto',
      padding: '32px',
      boxSizing: 'border-box' as const,
    },
    headerRow: { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' },
    logo: { width: '64px', height: '64px', objectFit: 'contain' as const },
    companyName: { fontSize: '18px', fontWeight: 900, color: '#0f172a', margin: 0 },
    companyAddr: { fontSize: '11px', color: '#475569', marginTop: '4px', lineHeight: '1.5' },
    titleBox: { display: 'inline-block', border: '1.5px solid #0f172a', padding: '5px 24px', borderRadius: '999px', fontSize: '14px', fontWeight: 700, letterSpacing: '1px', marginBottom: '6px', color: '#0f172a' },
    dateRow: { textAlign: 'right' as const, fontSize: '11px', color: '#334155', marginBottom: '20px' },
    infoGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', border: '1.5px solid #64748b', borderRadius: '10px', padding: '14px 18px', marginBottom: '20px' },
    label9: { fontSize: '9px', color: '#475569', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '1px', margin: '0 0 3px 0', display: 'block' },
    val13: { fontSize: '13px', fontWeight: 700, color: '#0f172a', margin: 0, display: 'block' },
    table: { border: '1.5px solid #334155', width: '100%', boxSizing: 'border-box' as const, borderRadius: '10px', overflow: 'hidden' as const },
    tHeaderCell: { padding: '9px 14px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, textAlign: 'center' as const, background: '#e2e8f0', color: '#0f172a' },
    tBodyRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid #94a3b8' },
    tCell: { padding: '12px 14px' },
    itemRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '7px', gap: '8px' },
    itemLabel: { fontSize: '12px', color: '#1e293b', flex: 1 },
    itemValue: { fontSize: '12px', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' as const },
    subtotalRow: { display: 'grid', gridTemplateColumns: '1fr 1fr' },
    subtotalCell: { padding: '9px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f1f5f9' },
    subtotalLabel: { fontSize: '12px', fontWeight: 700, color: '#0f172a' },
    subtotalVal: { fontSize: '13px', fontWeight: 700, color: '#0f172a' },
    netPayRow: { borderTop: '2px solid #334155', borderBottom: '2px solid #334155', padding: '12px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' },
    netPayLabel: { fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '2px', color: '#334155', margin: 0 },
    netPayAmount: { fontSize: '24px', fontWeight: 900, color: '#0f172a', letterSpacing: '-0.5px' },
    payBox: { border: '1.5px solid #64748b', borderRadius: '10px', padding: '14px 18px', marginTop: '16px' },
    payTitle: { fontSize: '10px', fontWeight: 700, color: '#334155', textTransform: 'uppercase' as const, letterSpacing: '1px', margin: '0 0 12px 0' },
    payGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' },
    footer: { marginTop: '24px', textAlign: 'center' as const, fontSize: '10px', color: '#475569' },
  }

  return (
    <div ref={ref} style={S.wrap}>

      {/* HEADER */}
      <div style={S.headerRow}>
        <img src="/logo.png" style={S.logo} alt="โลโก้" />
        <div>
          <h1 style={S.companyName}>ห้างหุ้นส่วนจำกัด วิราญกร</h1>
          <p style={S.companyAddr}>เลขที่ 64 หมู่ 1 ตำบลบ้านธาตุ อำเภอแก่งคอย จังหวัดสระบุรี 18110 (สำนักงานใหญ่)</p>
          <p style={{ ...S.companyAddr, marginTop: '2px' }}>เลขประจำตัวผู้เสียภาษี: <strong>0193554000514</strong></p>
        </div>
      </div>

      {/* TITLE */}
      <div style={{ textAlign: 'center', marginBottom: '4px' }}>
        <div style={S.titleBox}>ใบสลิปเงินเดือน</div>
      </div>
      <div style={S.dateRow}>
        <span style={{ fontWeight: 600 }}>จัดทำเมื่อ: </span>
        <span style={{ fontWeight: 700, color: '#334155' }}>{generatedAt}</span>
      </div>

      {/* EMPLOYEE INFO */}
      <div style={S.infoGrid}>
        <div>
          <span style={S.label9}>รหัสพนักงาน</span>
          <span style={{ ...S.val13, marginBottom: '10px' }}>{data.employee_code}</span>
          <span style={{ ...S.label9, marginTop: '10px' }}>พนักงาน</span>
          <span style={S.val13}>{data.first_name} {data.last_name}</span>
        </div>
        <div>
          <span style={S.label9}>งวด</span>
          <span style={{ ...S.val13, marginBottom: '10px' }}>{periodLabel}</span>
          <span style={{ ...S.label9, marginTop: '10px' }}>หน่วยงาน</span>
          <span style={S.val13}>{data.factory_name || '—'}</span>
        </div>
      </div>

      {/* FINANCIAL TABLE */}
      <div style={S.table}>
        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid #475569' }}>
          <div style={{ ...S.tHeaderCell, borderRight: '1px solid #475569' }}>รายได้ (Earnings)</div>
          <div style={S.tHeaderCell}>รายการหัก (Deductions)</div>
        </div>

        {/* Body */}
        <div style={S.tBodyRow}>
          <div style={{ ...S.tCell, borderRight: '1px solid #475569' }}>
            {incomeRows.length === 0
              ? <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: '12px' }}>—</p>
              : incomeRows.map(r => (
                <div key={r.label} style={S.itemRow}>
                  <span style={S.itemLabel}>{r.label}</span>
                  <span style={S.itemValue}>{formatThaiCurrency(r.value)}</span>
                </div>
              ))
            }
          </div>
          <div style={S.tCell}>
            {deductRows.length === 0
              ? <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: '12px' }}>—</p>
              : deductRows.map(r => (
                <div key={r.label} style={S.itemRow}>
                  <span style={S.itemLabel}>{r.label}</span>
                  <span style={S.itemValue}>{formatThaiCurrency(r.value)}</span>
                </div>
              ))
            }
          </div>
        </div>

        {/* Subtotals */}
        <div style={{ ...S.subtotalRow, borderTop: '1px solid #475569' }}>
          <div style={{ ...S.subtotalCell, borderRight: '1px solid #475569' }}>
            <span style={S.subtotalLabel}>รวมรายได้</span>
            <span style={S.subtotalVal}>{formatThaiCurrency(data.total_income)}</span>
          </div>
          <div style={S.subtotalCell}>
            <span style={S.subtotalLabel}>รวมรายการหัก</span>
            <span style={S.subtotalVal}>{formatThaiCurrency(data.total_deductions)}</span>
          </div>
        </div>
      </div>

      {/* NET PAY */}
      <div style={S.netPayRow}>
        <p style={S.netPayLabel}>เงินได้สุทธิ (Net Pay)</p>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
          <span style={S.netPayAmount}>{formatThaiCurrency(data.net_pay)}</span>
          <span style={{ fontSize: '11px', color: '#334155', fontWeight: 600 }}>บาท</span>
        </div>
      </div>

      {/* PAYMENT DETAILS */}
      <div style={S.payBox}>
        <h3 style={S.payTitle}>ข้อมูลการชำระเงิน (Payment Details)</h3>
        <div style={S.payGrid}>
          <div>
            <span style={S.label9}>วิธีการรับเงิน</span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block' }}>
              {data.payment_method === 'bank_transfer' ? 'โอนบัญชีธนาคาร' : 'เงินสด'}
            </span>
          </div>
          {data.payment_method === 'bank_transfer' && (
            <>
              <div>
                <span style={S.label9}>ธนาคาร</span>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block' }}>{data.bank_name || '—'}</span>
              </div>
              <div>
                <span style={S.label9}>เลขที่บัญชี</span>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', letterSpacing: '1px' }}>{data.bank_account || '—'}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={S.footer}>
        เอกสารฉบับนี้เป็นเอกสารแสดงรายได้ของพนักงาน ห้างหุ้นส่วนจำกัด วิราญกร อย่างเป็นทางการ
      </div>
    </div>
  )
})

PaySlipPreview.displayName = 'PaySlipPreview'
