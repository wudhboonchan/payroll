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
  amount_wood_excess: number
  amount_film: number
  amount_special: number
  amount_diligence: number
  amount_position: number

  // Day/hour counts for display
  days_normal?: number
  days_shift?: number
  days_ot?: number

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

  const otUnit = isClerk ? 'ชม.' : 'วัน'

  const incomeRows = [
    { label: `ค่าจ้างปกติ${data.days_normal != null ? ` (${data.days_normal} วัน)` : ''}`, value: data.amount_normal },
    { label: `ค่ากะ${data.days_shift != null ? ` (${data.days_shift} วัน)` : ''}`, value: data.amount_shift },
    { label: `ค่าล่วงเวลา (OT)${data.days_ot != null && data.days_ot > 0 ? ` (${data.days_ot} ${otUnit})` : ''}`, value: data.amount_ot },
    { label: 'ค่าไม้ส่วนเกิน',  value: data.amount_wood_excess },
    { label: 'ค่าฟิล์ม',        value: data.amount_film },
    { label: 'เงินพิเศษ',       value: data.amount_special },
    { label: 'เบี้ยขยัน',       value: data.amount_diligence },
    { label: 'ค่าตำแหน่ง',      value: data.amount_position },
  ].filter(r => r.value > 0)

  const deductRows = [
    { label: 'ประกันสังคม',            value: data.deduct_social_security },
    { label: 'เบิกล่วงหน้า',           value: data.deduct_advance },
    { label: 'ค่าอุปกรณ์ความปลอดภัย', value: data.deduct_safety_equipment },
    { label: 'ค่าเสื้อพนักงาน',        value: data.deduct_uniform },
  ].filter(r => r.value > 0)

  return (
    <div
      ref={ref}
      className="bg-white font-sans text-slate-800 mx-auto box-border w-full max-w-[850px] print:w-[190mm] print:min-w-0 p-6 md:p-10 print:p-0 rounded-2xl shadow-xl print:shadow-none border border-slate-100 print:border-none relative overflow-hidden print:overflow-visible"
    >
      {/* Decorative Top Accent for Screen */}
      <div className="absolute top-0 left-0 w-full h-2 bg-[#1D9E75] print:hidden" />

      {/* ===== HEADER ===== */}
      <div className="flex items-start mb-6 print:mb-4">
        <div className="flex items-center gap-5 print:gap-4">
          <div className="flex-shrink-0">
            <img src="/logo.png" className="w-16 h-16 md:w-20 md:h-20 print:w-16 print:h-16 object-contain" alt="โลโก้ บริษัท" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl print:text-lg font-black text-slate-900 tracking-tight">ห้างหุ้นส่วนจำกัด วิราญกร</h1>
            <p className="text-xs md:text-sm print:text-[10px] text-slate-500 mt-1 max-w-sm leading-relaxed">
              เลขที่ 64 หมู่ 1 ตำบลบ้านธาตุ อำเภอแก่งคอย จังหวัดสระบุรี 18110 (สำนักงานใหญ่)
            </p>
            <p className="text-xs md:text-sm print:text-[10px] text-slate-500 mt-0.5">
              เลขประจำตัวผู้เสียภาษี: <span className="font-semibold text-slate-700">0193554000514</span>
            </p>
          </div>
        </div>
      </div>

      {/* ===== SLIP TITLE & DATE ===== */}
      <div className="text-center mb-8 print:mb-6">
        <div className="inline-block bg-[#1D9E75]/10 text-[#1D9E75] print:bg-transparent print:text-slate-800 border border-[#1D9E75]/20 print:border-slate-800 px-6 py-2 rounded-full text-base md:text-lg print:text-sm font-bold tracking-wide mb-3">
          ใบสลิปเงินเดือน
        </div>
        <div className="flex items-center justify-end gap-2 text-xs md:text-sm print:text-[10px] text-slate-500">
          <span className="font-medium uppercase tracking-wider">จัดทำเมื่อ:</span>
          <span className="font-semibold text-slate-700">{generatedAt}</span>
        </div>
      </div>

      {/* ===== EMPLOYEE INFO ===== */}
      <div className="bg-slate-50 border border-slate-100 print:border-slate-800 rounded-xl print:rounded-none p-5 print:p-3 mb-8 print:mb-5 grid grid-cols-2 gap-4 print:gap-2 relative overflow-hidden">
        <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#1D9E75] print:hidden" />
        
        <div>
          <p className="text-[10px] md:text-xs print:text-[9px] text-slate-400 font-medium uppercase tracking-wider mb-1">รหัสพนักงาน</p>
          <p className="text-sm md:text-base print:text-[11px] font-bold text-slate-800">{data.employee_code}</p>
          
          <p className="text-[10px] md:text-xs print:text-[9px] text-slate-400 font-medium uppercase tracking-wider mt-3 md:mt-4 print:mt-2 mb-1">ชื่อ - นามสกุล</p>
          <p className="text-sm md:text-base print:text-[11px] font-bold text-slate-800">{data.first_name} {data.last_name}</p>
        </div>
        
        <div>
          <p className="text-[10px] md:text-xs print:text-[9px] text-slate-400 font-medium uppercase tracking-wider mb-1">งวดค่าแรง (Period)</p>
          <p className="text-sm md:text-base print:text-[11px] font-bold text-slate-800">{periodLabel}</p>
          
          <p className="text-[10px] md:text-xs print:text-[9px] text-slate-400 font-medium uppercase tracking-wider mt-3 md:mt-4 print:mt-2 mb-1">หน่วยงาน</p>
          <p className="text-sm md:text-base print:text-[11px] font-bold text-slate-800">{data.factory_name || '—'}</p>
        </div>
      </div>

      {/* ===== FINANCIAL TABLE ===== */}
      <div className="border border-slate-200 rounded-xl print:border-slate-800 print:border-2 print:rounded-none overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-2 bg-slate-100 border-b border-slate-200 print:border-slate-800 print:bg-slate-100 divide-x divide-slate-200 print:divide-slate-800">
          <div className="px-4 py-2.5 md:py-3 print:px-3 print:py-2 text-xs md:text-sm print:text-[11px] font-bold text-slate-700 uppercase tracking-wider text-center">
            รายได้ (Earnings)
          </div>
          <div className="px-4 py-2.5 md:py-3 print:px-3 print:py-2 text-xs md:text-sm print:text-[11px] font-bold text-slate-700 uppercase tracking-wider text-center">
            รายการหัก (Deductions)
          </div>
        </div>
        
        {/* Content */}
        <div className="grid grid-cols-2 divide-x divide-slate-200 print:divide-slate-800 bg-white">
          <div className="p-4 md:p-5 print:p-3 space-y-2.5 print:space-y-2 align-top min-h-[140px] print:min-h-[100px]">
            {incomeRows.map(r => <NewSlipRow key={r.label} label={r.label} value={r.value} isIncome />)}
            {incomeRows.length === 0 && <p className="text-center text-slate-400 text-sm print:text-xs">—</p>}
          </div>
          
          <div className="p-4 md:p-5 print:p-3 space-y-2.5 print:space-y-2 align-top min-h-[140px] print:min-h-[100px]">
            {deductRows.map(r => <NewSlipRow key={r.label} label={r.label} value={r.value} isDeduct />)}
            {deductRows.length === 0 && <p className="text-center text-slate-400 text-sm print:text-xs">—</p>}
          </div>
        </div>

        {/* Subtotals */}
        <div className="grid grid-cols-2 divide-x divide-slate-200 print:divide-slate-800 bg-slate-50 border-t border-slate-200 print:border-slate-800">
          <div className="px-4 py-2.5 md:py-3 print:px-3 print:py-2 flex justify-between items-center text-sm print:text-xs font-bold text-slate-700">
            <span>รวมรายได้</span>
            <span className="text-emerald-700 print:text-slate-800">{formatThaiCurrency(data.total_income)}</span>
          </div>
          <div className="px-4 py-2.5 md:py-3 print:px-3 print:py-2 flex justify-between items-center text-sm print:text-xs font-bold text-slate-700">
            <span>รวมรายการหัก</span>
            <span className="text-rose-700 print:text-slate-800">{formatThaiCurrency(data.total_deductions)}</span>
          </div>
        </div>
      </div>

      {/* ===== NET PAY & PAYMENT INFO (STACKED) ===== */}
      <div className="mt-8 space-y-5 print:space-y-4">
        
        {/* Net Pay Focus - Very discrete for privacy */}
        <div className="border-t-2 border-b-2 border-slate-100 print:border-slate-800 py-4 px-2 flex flex-row items-center justify-between">
          <p className="text-xs md:text-sm print:text-[10px] text-slate-500 font-bold uppercase tracking-widest">
            เงินได้สุทธิ (Net Pay)
          </p>
          <div className="flex items-baseline gap-2">
            <span className="text-xl md:text-2xl print:text-lg font-black text-slate-900 tracking-tight">
              {formatThaiCurrency(data.net_pay)}
            </span>
            <span className="text-[10px] md:text-xs print:text-[9px] text-slate-400 font-medium">บาท</span>
          </div>
        </div>

        {/* Payment Details - Full Row, Clean List */}
        <div className="bg-slate-50 border border-slate-100 print:border-slate-800 print:border-2 rounded-xl print:rounded-none p-5 md:p-6 print:p-3">
          <h3 className="text-[10px] md:text-xs print:text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-4 print:mb-3 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#1D9E75] print:hidden" />
            ข้อมูลการชำระเงิน (Payment Details)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 print:grid-cols-3 gap-6 md:gap-4 text-xs md:text-sm print:text-[11px] text-slate-700">
            <div className="flex flex-col gap-1.5">
              <span className="text-slate-400 font-bold uppercase text-[9px] tracking-tight">วิธีการรับเงิน</span>
              <span className="font-bold text-slate-800">{data.payment_method === 'cash' ? 'เงินสด' : 'โอนบัญชีธนาคาร'}</span>
            </div>
            {data.payment_method === 'bank_transfer' && (
              <>
                <div className="flex flex-col gap-1.5">
                  <span className="text-slate-400 font-bold uppercase text-[9px] tracking-tight">ธนาคาร</span>
                  <span className="font-bold text-slate-800">{data.bank_name || '—'}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-slate-400 font-bold uppercase text-[9px] tracking-tight">เลขที่บัญชี</span>
                  <span className="font-bold text-slate-800 tracking-wider">{data.bank_account || '—'}</span>
                </div>
              </>
            )}
          </div>
        </div>

      </div>

      {/* Print Footer / Notes */}
      <div className="mt-8 md:mt-10 print:mt-6 text-center text-[10px] md:text-xs print:text-[9px] text-slate-400">
        เอกสารฉบับนี้เป็นเอกสารแสดงรายได้ของพนักงาน ห้างหุ้นส่วนจำกัด วิราญกร อย่างเป็นทางการ
      </div>
    </div>
  )
})

PaySlipPreview.displayName = 'PaySlipPreview'

function NewSlipRow({ label, value, isIncome }: { label: string; value: number; isIncome?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-2">
      <span className="text-slate-600 print:text-slate-800 text-sm print:text-[11px] flex-1 leading-snug">{label}</span>
      <span className={`font-semibold text-sm print:text-[11px] tabular-nums whitespace-nowrap mt-0.5 ${isIncome ? 'text-slate-900' : 'text-slate-900'}`}>
        {formatThaiCurrency(value)}
      </span>
    </div>
  )
}
