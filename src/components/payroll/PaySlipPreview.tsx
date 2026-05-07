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
  generated_at?: string  // ISO datetime

  // Income
  amount_normal: number
  amount_shift: number
  amount_ot: number
  amount_wood_excess: number
  amount_film: number
  amount_special: number
  amount_diligence: number
  amount_position: number

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

  const incomeRows = [
    { label: 'ค่าจ้างปกติ',           value: data.amount_normal },
    { label: 'ค่ากะ',                  value: data.amount_shift },
    { label: 'ค่าล่วงเวลา (OT)',       value: data.amount_ot },
    { label: 'ค่าไม้ส่วนเกิน',        value: data.amount_wood_excess },
    { label: 'ค่าฟิล์ม',              value: data.amount_film },
    { label: 'เงินพิเศษ',             value: data.amount_special },
    { label: 'เบี้ยขยัน',             value: data.amount_diligence },
    { label: 'ค่าตำแหน่ง',            value: data.amount_position },
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
      className="bg-white text-black p-8 w-[640px] max-w-full font-sans border-2 border-slate-800 mx-auto shadow-sm print:shadow-none print:border-none"
    >
      {/* Header */}
      <div className="text-center mb-6 border-b-2 border-slate-800 pb-4">
        <h1 className="text-2xl font-bold">ห้างหุ้นส่วนจำกัด วิราญกร</h1>
        <h2 className="text-lg mt-1 font-semibold">ใบแจ้งยอดเงินเดือน</h2>
      </div>

      {/* Employee Info */}
      <div className="flex justify-between items-start mb-5 font-medium text-sm">
        <div className="space-y-1">
          <p><span className="text-slate-500">รหัสพนักงาน:</span> {data.employee_code}</p>
          <p><span className="text-slate-500">ชื่อ - นามสกุล:</span> {data.first_name} {data.last_name}</p>
          {data.factory_name && (
            <p><span className="text-slate-500">หน่วยงาน:</span> {data.factory_name}</p>
          )}
        </div>
        <div className="text-right space-y-1">
          <p><span className="text-slate-500">งวดค่าแรง:</span> {periodLabel}</p>
          <p className="text-xs text-slate-400 mt-1">จัดทำเมื่อ: {generatedAt}</p>
        </div>
      </div>

      {/* Main Table */}
      <div className="border-2 border-slate-800">

        {/* Table Header */}
        <div className="grid grid-cols-12 border-b-2 border-slate-800 font-bold text-center divide-x-2 divide-slate-800">
          <div className="col-span-5 p-2 text-sm">รายได้</div>
          <div className="col-span-5 p-2 text-sm">รายการหัก</div>
          <div className="col-span-2 p-2 text-sm">รวมสุทธิ</div>
        </div>

        {/* Table Rows */}
        <div className="grid grid-cols-12 divide-x-2 divide-slate-800">

          {/* Income Column */}
          <div className="col-span-5 p-3 space-y-2">
            {incomeRows.map(r => <SlipRow key={r.label} label={r.label} value={r.value} />)}
            {incomeRows.length === 0 && <p className="text-xs text-slate-400 text-center py-2">—</p>}
          </div>

          {/* Deductions Column */}
          <div className="col-span-5 p-3 space-y-2">
            {deductRows.map(r => <SlipRow key={r.label} label={r.label} value={r.value} />)}
            {deductRows.length === 0 && <p className="text-xs text-slate-400 text-center py-2">—</p>}
          </div>

          {/* Net Column */}
          <div className="col-span-2 flex flex-col items-center justify-center bg-yellow-100 p-2">
            <span className="text-lg font-bold text-center leading-snug">
              {formatThaiCurrency(data.net_pay)}
            </span>
          </div>
        </div>

        {/* Footer Totals */}
        <div className="grid grid-cols-12 border-t-2 border-slate-800 divide-x-2 divide-slate-800 font-bold bg-slate-50 text-sm">
          <div className="col-span-5 p-2 flex justify-between">
            <span>รวมรายได้</span>
            <span>{formatThaiCurrency(data.total_income)}</span>
          </div>
          <div className="col-span-5 p-2 flex justify-between">
            <span>รวมรายการหัก</span>
            <span>{formatThaiCurrency(data.total_deductions)}</span>
          </div>
          <div className="col-span-2 bg-yellow-100" />
        </div>
      </div>

      {/* Payment Info */}
      <div className="mt-4 p-3 border-2 border-slate-800 space-y-1.5 text-sm font-medium">
        <p>วิธีการรับเงิน: {data.payment_method === 'cash' ? 'เงินสด' : 'โอนบัญชีธนาคาร'}</p>
        {data.payment_method === 'bank_transfer' && (
          <p>ธนาคาร: {data.bank_name || '—'} &nbsp; เลขที่บัญชี: {data.bank_account || '—'}</p>
        )}
      </div>
    </div>
  )
})

PaySlipPreview.displayName = 'PaySlipPreview'

function SlipRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span>{label}</span>
      <span className="font-medium tabular-nums">{formatThaiCurrency(value)}</span>
    </div>
  )
}
