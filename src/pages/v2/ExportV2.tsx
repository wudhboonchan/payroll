import { useState, useEffect, useRef } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/useAppStore'
import { TopBarV2 } from '../../components/v2/layout/TopBarV2'
import { toast } from 'sonner'
import { Download, FileText, Grid3x3, ShieldCheck, Loader2, Search, Check, X } from 'lucide-react'
import { format } from 'date-fns'
import { th } from 'date-fns/locale'
import { formatPeriodLabel } from '../../lib/formatters'
import '../../styles/v2-tokens.css'

interface PayrollPeriod { id: string; period_start: string; period_end: string; status: string | null }

// ── helpers ──────────────────────────────────────────────────────────────────
const MONTHS_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
function thaiPeriod(start: string, end: string) {
  const s = new Date(start), e = new Date(end)
  return `${s.getDate()} ${MONTHS_SHORT[s.getMonth()]} – ${e.getDate()} ${MONTHS_SHORT[e.getMonth()]} ${e.getFullYear() + 543}`
}
function maskBank(a?: string | null) {
  if (!a) return undefined
  const s = a.replace(/[-\s]/g, '')
  if (s.length <= 6) return s
  return `${s.slice(0, 3)}-${'X'.repeat(s.length - 6)}-${s.slice(-3)}`
}
function thaiDateTimeNow() {
  const now = new Date()
  const MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']
  const hh = String(now.getHours()).padStart(2, '0'), mm = String(now.getMinutes()).padStart(2, '0')
  return `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear() + 543} เวลา ${hh}:${mm} น.`
}
const mono = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2 })
const POSITIONS: Record<string, string> = { worker: 'พนักงานทั่วไป', clerk: 'เสมียน', foreman: 'โฟร์แมน', office: 'พนักงานออฟฟิศ', manager: 'ผู้จัดการ' }

// ── Generate print HTML from entry data ──────────────────────────────────────
const isWeekend = (d: string) => { const day = new Date(d).getDay(); return day === 0 || day === 6 }

const COMPANY_FULL_NAME: Record<string, string> = {
  'ผลิตภัณฑ์ตราเพชร': 'บริษัท ผลิตภัณฑ์ตราเพชร จำกัด (มหาชน)',
  'ทีพีไอ โพลีน':     'บริษัท ทีพีไอ โพลีน จำกัด (มหาชน)',
}
function fullFactoryName(name: string) {
  if (!name) return name
  for (const [key, full] of Object.entries(COMPANY_FULL_NAME)) { if (name.includes(key)) return full }
  return name
}

function buildSlipHtml(entry: any, period: any, shifts: any[], branchName: string, generatedAt: string): string {
  const emp = entry.employee
  const isClerk = emp.position === 'clerk'
  const posLabel = POSITIONS[emp.position] || emp.position || ''
  const jobTitle = emp.job_title || ''

  // ── shift breakdown (mirrors PaySlipV2 exactly) ──
  const normShifts = shifts.filter((s: any) => !s.is_holiday_ot || s.is_holiday_ot_exempt)
  const holShifts  = shifts.filter((s: any) => s.is_holiday_ot && !s.is_holiday_ot_exempt)
  const normDays   = normShifts.filter((s: any) => !s.is_half_shift && !s.actual_hours).length
  const halfDays   = normShifts.filter((s: any) => s.is_half_shift && !s.actual_hours).length
  const partialHrs = normShifts.reduce((a: number, s: any) => a + Number(s.actual_hours || 0), 0)
  const holFull    = holShifts.filter((s: any) => !s.is_half_shift).length
  const holHalf    = holShifts.filter((s: any) =>  s.is_half_shift).length
  const clerkNorm  = normShifts.filter((s: any) => !isWeekend(s.work_date)).length
  const clerkOt    = shifts.filter((s: any) => !isWeekend(s.work_date)).reduce((a: number, s: any) => a + Number(s.ot_hours || 0), 0)
  const clerkOt1x  = shifts.filter((s: any) => isWeekend(s.work_date)).reduce((a: number, s: any) => a + Number(s.ot_hours || 0), 0)
  const daysShift  = isClerk
    ? normShifts.filter((s: any) => isWeekend(s.work_date)).length
    : normDays

  // ── rate breakdown ──
  const empRate    = Number(emp.rate_per_12h) || 0
  const baseNormal = 357
  const baseShift  = Math.max(0, empRate - baseNormal)
  const clerkDaily = empRate / 30
  const clerkHourly = clerkDaily / 8

  // ── amounts ──
  const amtNormal  = Number(entry.amount_normal  || 0)
  const amtShift   = Number(entry.amount_shift   || 0)
  const amtOtRaw   = Number(entry.amount_ot      || 0)
  const amtOt1xRaw = Number(entry.amount_ot_1x   || 0)
  const amtWood    = Number(entry.amount_wood_excess || 0)
  const amtFilm    = Number(entry.amount_film    || 0)
  const amtSpecial = Number(entry.amount_special || 0) + Number(entry.override_special || 0)
  const amtDilig   = Number(entry.amount_diligence || 0)
  const amtPos     = Number(entry.amount_position || 0)
  const deductSS   = Number(entry.deduct_social_security || 0)
  const deductAdv  = Number(entry.deduct_advance  || 0)
  const deductSafe = Number(entry.deduct_safety_equipment || 0)
  const deductUni  = Number(entry.deduct_uniform  || 0)

  // Clerk OT split
  const clerkOtAmt   = isClerk ? clerkHourly * 1.5 * clerkOt   : 0
  const clerkOt1xAmt = isClerk ? clerkHourly * 1.0 * clerkOt1x : 0
  const amtOt   = isClerk ? clerkOtAmt   : amtOtRaw
  const amtOt1x = isClerk ? clerkOt1xAmt : amtOt1xRaw

  // ── formula details ──
  const dnDays = baseNormal > 0 ? Math.round(amtNormal / (isClerk ? clerkDaily : baseNormal)) : 0
  const dsDays = baseShift  > 0 ? Math.round(amtShift  / baseShift) : 0
  const otHrs  = clerkHourly > 0 && isClerk ? Math.round(amtOt   / (clerkHourly * 1.5)) : 0
  const ot1Hrs = clerkHourly > 0 && isClerk ? Math.round(amtOt1x / clerkHourly)         : 0
  const otDays = !isClerk && empRate > 0    ? Math.round(amtOtRaw / (empRate * 2))       : 0

  const workingDays = isClerk ? (dnDays + daysShift + holFull + holHalf) : (dnDays + holFull + holHalf)

  const detailNormal = dnDays > 0
    ? (isClerk ? `฿${Math.round(clerkDaily)} × ${dnDays} วัน` : `฿${baseNormal} × ${dnDays} วัน`)
    : null
  const detailShift  = dsDays > 0 && !isClerk ? `฿${Math.round(baseShift)} × ${dsDays} วัน` : null
  const detailOt     = (isClerk && otHrs  > 0 ? `฿${clerkHourly.toFixed(2)} × 1.5 × ${otHrs} ชม.`  : null)
                    || (!isClerk && otDays > 0 ? `฿${empRate} × 2 × ${otDays} วัน`                  : null)
  const detailOt1x   = isClerk && ot1Hrs > 0   ? `฿${clerkHourly.toFixed(2)} × 1.0 × ${ot1Hrs} ชม.` : null

  // special note subs
  const specialSubs: string[] = entry.special_note
    ? (entry.special_note as string).split(',').map((s: string) => s.trim()).filter(Boolean)
    : []

  type IncomeRow = { label: string; val: number; detail: string | null; subs: string[] }
  const incomeRows: IncomeRow[] = [
    { label: isClerk ? 'ค่าจ้างปกติ (วันธรรมดา)' : 'ค่าจ้างปกติ (8 ชม.)', val: amtNormal, detail: detailNormal, subs: [] },
    { label: 'ค่ากะ (4 ชม.)',                                                  val: isClerk ? 0 : amtShift,     detail: detailShift,  subs: [] },
    { label: isClerk ? 'OT ล่วงเวลา (×1.5)' : 'OT วันหยุดนักขัตฤกษ์ (×2)', val: amtOt,                      detail: detailOt,     subs: [] },
    { label: isClerk ? 'OT วันหยุดสัปดาห์ (×1)' : '',                         val: isClerk ? amtOt1x : 0,     detail: detailOt1x,   subs: [] },
    { label: 'ค่าไม้ส่วนเกิน',  val: amtWood,    detail: null, subs: [] },
    { label: 'ค่าฟิล์ม',        val: amtFilm,    detail: null, subs: [] },
    { label: 'เงินพิเศษ',       val: amtSpecial, detail: null, subs: specialSubs },
    { label: 'เบี้ยขยัน',       val: amtDilig,   detail: null, subs: [] },
    { label: 'ค่าตำแหน่ง',      val: amtPos,     detail: null, subs: [] },
  ].filter(r => r.val > 0 && r.label !== '')

  const deductRows = [
    { label: 'ประกันสังคม',            val: deductSS   },
    { label: 'เบิกล่วงหน้า',           val: deductAdv  },
    { label: 'ค่าอุปกรณ์ความปลอดภัย', val: deductSafe },
    { label: 'ค่าเสื้อพนักงาน',        val: deductUni  },
  ].filter(r => r.val > 0)

  const totalIncome = incomeRows.reduce((s, r) => s + r.val, 0)
  const totalDeduct = deductRows.reduce((s, r) => s + r.val, 0)
  const netPay      = totalIncome - totalDeduct

  const bankLine = emp.payment_method === 'bank_transfer' && emp.bank_name
    ? `<div style="font-size:11px;color:#888;font-family:monospace;margin-top:2px">${emp.bank_name}${emp.bank_account ? ' · ' + maskBank(emp.bank_account) : ''}</div>`
    : ''

  const incomeHtml = incomeRows.map(r => `
    <div style="border-bottom:1px solid #f0f0f0">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:9px 0 2px">
        <span style="font-size:13px;color:#1a1a1a;font-weight:500">${r.label}</span>
        <span style="font-family:monospace;font-size:13px;font-weight:600;color:#1a1a1a;white-space:nowrap">${mono(r.val)}</span>
      </div>
      ${r.detail ? `<div style="font-family:monospace;font-size:10px;color:#b44a2a;padding-bottom:5px">${r.detail}</div>` : ''}
      ${r.subs.map(sub => `<div style="display:flex;gap:6px;padding:3px 0 3px 8px;align-items:center"><span style="font-size:10px;color:#bbb;flex-shrink:0">·</span><span style="font-size:11px;color:#999">${sub}</span></div>`).join('')}
      ${r.subs.length > 0 ? '<div style="padding-bottom:6px"></div>' : ''}
    </div>`).join('')

  const deductHtml = deductRows.length ? deductRows.map(r => `
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:9px 0;border-bottom:1px solid #f0f0f0">
      <span style="font-size:13px;color:#1a1a1a;font-weight:500">${r.label}</span>
      <span style="font-family:monospace;font-size:13px;font-weight:600;color:#c0392b;white-space:nowrap">${mono(r.val)}</span>
    </div>`).join('')
  : '<div style="padding:9px 0;font-size:12px;color:#bbb">ไม่มีรายการหัก</div>'

  const workingDaysHtml = workingDays > 0
    ? `<div style="font-size:11px;color:#aaa;margin-top:3px">${workingDays} วันทำงาน</div>` : ''

  return `
<div style="background:#fff;font-family:'Sarabun','Noto Sans Thai',sans-serif;color:#1a1a1a;border:1px solid #e2e2e2">
  <!-- header -->
  <div style="padding:24px 28px 20px;border-bottom:1px solid #e8e8e8;display:flex;align-items:flex-start;justify-content:space-between;gap:20px">
    <div style="display:flex;align-items:center;gap:16px">
      <img src="/logo.png" style="width:72px;height:72px;object-fit:contain;flex-shrink:0" />
      <div>
        <div style="font-weight:800;font-size:16px;color:#1a1a1a;letter-spacing:-0.02em">ห้างหุ้นส่วนจำกัด วิราญกร</div>
        <div style="font-size:11px;color:#888;margin-top:4px;line-height:1.7">
          เลขที่ 64 หมู่ 1 ตำบลบ้านธาตุ อำเภอแก่งคอย จังหวัดสระบุรี 18110<br>
          เลขประจำตัวผู้เสียภาษี: <span style="color:#555;font-weight:600">0193554000514</span>
        </div>
      </div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      <div style="font-size:18px;font-weight:800;color:#1a1a1a;letter-spacing:-0.01em">ใบสลิปเงินเดือน</div>
      <div style="font-size:11px;color:#888;margin-top:6px;line-height:1.8">จัดทำเมื่อ<br><span style="color:#555;font-weight:600">${generatedAt}</span></div>
    </div>
  </div>
  <!-- employee band -->
  <div style="background:#f7f7f7;border-bottom:1px solid #e8e8e8;display:grid;grid-template-columns:1fr 380px">
    <div style="padding:14px 28px">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#aaa;margin-bottom:5px">พนักงาน</div>
      <div style="font-weight:700;font-size:17px;color:#1a1a1a">${emp.first_name} ${emp.last_name}</div>
      <div style="font-size:11px;color:#777;margin-top:3px"><span style="font-family:monospace">${emp.employee_code}</span>${posLabel ? ' · ' + posLabel : ''}${jobTitle ? ' – ' + jobTitle : ''}</div>
      ${branchName ? `<div style="font-size:11px;color:#888;margin-top:2px">${branchName}</div>` : ''}
    </div>
    <div style="padding:14px 28px;display:grid;grid-template-columns:160px 1fr">
      <div>
        <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#aaa;margin-bottom:5px">งวดเงินเดือน</div>
        <div style="font-weight:600;font-size:13px;color:#1a1a1a">${thaiPeriod(period.period_start, period.period_end)}</div>
      </div>
      <div>
        <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#aaa;margin-bottom:5px">วิธีรับเงิน</div>
        <div style="font-weight:600;font-size:13px;color:#1a1a1a">${emp.payment_method === 'bank_transfer' ? 'โอนธนาคาร' : 'เงินสด'}</div>
        ${bankLine}
      </div>
    </div>
  </div>
  <!-- ledger -->
  <div style="display:grid;grid-template-columns:1fr 1fr">
    <div style="border-right:1px solid #e8e8e8;display:flex;flex-direction:column">
      <div style="padding:10px 24px;background:#fafafa;border-bottom:1px solid #e8e8e8"><span style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#777">รายได้</span></div>
      <div style="flex:1;padding:0 24px">${incomeHtml}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:11px 24px;background:#f7f7f7;border-top:1px solid #e8e8e8;margin-top:auto">
        <span style="font-size:11px;font-weight:700;color:#555;letter-spacing:0.04em">รวมรายได้</span>
        <span style="font-family:monospace;font-weight:800;font-size:14px;color:#1a7a3c">${mono(totalIncome)}</span>
      </div>
    </div>
    <div style="display:flex;flex-direction:column">
      <div style="padding:10px 24px;background:#fafafa;border-bottom:1px solid #e8e8e8"><span style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#777">รายการหัก</span></div>
      <div style="flex:1;padding:0 24px">${deductHtml}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:11px 24px;background:#f7f7f7;border-top:1px solid #e8e8e8;margin-top:auto">
        <span style="font-size:11px;font-weight:700;color:#555;letter-spacing:0.04em">รวมรายการหัก</span>
        <span style="font-family:monospace;font-weight:800;font-size:14px;color:#c0392b">${mono(totalDeduct)}</span>
      </div>
    </div>
  </div>
  <!-- net pay -->
  <div style="border-top:2px solid #e8e8e8;padding:18px 28px;display:flex;align-items:center;justify-content:space-between">
    <div>
      <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#aaa">เงินได้สุทธิ</div>
      <div style="font-size:13px;font-weight:600;color:#555;margin-top:2px">NET PAY</div>
      ${workingDaysHtml}
    </div>
    <div style="text-align:right">
      <div style="font-family:monospace;font-weight:800;font-size:38px;letter-spacing:-0.03em;color:#1a1a1a;line-height:1">${mono(netPay)}</div>
      <div style="font-size:11px;color:#999;margin-top:4px">บาท</div>
    </div>
  </div>
  <!-- footer -->
  <div style="padding:10px 28px;background:#f7f7f7;border-top:1px solid #e8e8e8;text-align:center;font-size:10px;color:#bbb;letter-spacing:0.02em">
    เอกสารฉบับนี้เป็นเอกสารแสดงรายได้ของพนักงาน ห้างหุ้นส่วนจำกัด วิราญกร อย่างเป็นทางการ
  </div>
</div>`
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ExportV2() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user } = useAppStore()

  const [exportType,       setExportType]       = useState<'month' | 'period'>('month')
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)
  const [selectedMonth,    setSelectedMonth]    = useState<string>('')
  const [isExportingXlsx,  setIsExportingXlsx]  = useState(false)
  const [isExportingSSO,   setIsExportingSSO]   = useState(false)
  const [showPdfModal,     setShowPdfModal]     = useState(false)

  // PDF modal state
  const [pdfTarget,        setPdfTarget]        = useState<'all' | 'individual'>('individual')
  const [pdfMode,          setPdfMode]          = useState<'month' | 'period'>('month')
  const [pdfMonth,         setPdfMonth]         = useState('')
  const [pdfPeriodId,      setPdfPeriodId]      = useState('')
  const [pdfEmpId,         setPdfEmpId]         = useState<string | null>(null)
  const [pdfMonths,        setPdfMonths]        = useState<string[]>([])
  const [empSearch,        setEmpSearch]        = useState('')
  const [isGeneratingPDF,  setIsGeneratingPDF]  = useState(false)

  const { data: periods = [] } = useQuery<PayrollPeriod[]>({
    queryKey: ['periods', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_periods').select('*')
        .eq('factory_id', user?.factory_id ?? '').order('period_start', { ascending: false })
      if (error) throw error; return data
    }, enabled: !!user?.factory_id, staleTime: 0,
  })

  const { data: employees = [] } = useQuery<any[]>({
    queryKey: ['employees-export-pdf', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees')
        .select('id,employee_code,first_name,last_name,status')
        .eq('factory_id', user?.factory_id ?? '').order('employee_code')
      if (error) throw error; return data
    }, enabled: !!user?.factory_id && showPdfModal && pdfTarget === 'individual',
  })

  const uniqueMonths = Array.from(new Set(periods.map(p => {
    const d = new Date(p.period_start)
    return `${format(d, 'MMMM', { locale: th })} ${d.getFullYear() + 543}`
  })))

  const hasInit = useRef(false)
  useEffect(() => {
    if (!hasInit.current && periods.length > 0) {
      hasInit.current = true
      const approved = periods.find(p => p.status === 'approved')
      requestAnimationFrame(() => {
        setSelectedPeriodId(approved?.id ?? periods[0].id)
        setPdfPeriodId(approved?.id ?? periods[0].id)
      })
    }
  }, [periods])
  useEffect(() => {
    if (uniqueMonths.length > 0 && !selectedMonth)
      requestAnimationFrame(() => { setSelectedMonth(uniqueMonths[0]); setPdfMonth(uniqueMonths[0]) })
  }, [uniqueMonths, selectedMonth])

  const getPeriodsToExport = () => {
    if (exportType === 'period') return selectedPeriodId ? [selectedPeriodId] : []
    return periods.filter(p => {
      const d = new Date(p.period_start)
      return `${format(d, 'MMMM', { locale: th })} ${d.getFullYear() + 543}` === selectedMonth
    }).map(p => p.id)
  }
  const getExportLabel = () => {
    if (exportType === 'period') { const p = periods.find(p => p.id === selectedPeriodId); return p ? formatPeriodLabel(p.period_start, p.period_end) : '—' }
    return selectedMonth
  }

  // ── Payroll Excel ───────────────────────────────────────────────────────────
  const handleExportPayroll = async () => {
    const ids = getPeriodsToExport()
    if (!ids.length) { toast.error('กรุณาเลือกช่วงเวลา'); return }
    setIsExportingXlsx(true)
    try {
      const XLSX = await import('xlsx')
      const { data, error } = await supabase.from('payroll_entries').select(`
        amount_normal,amount_shift,amount_ot,amount_wood_excess,amount_film,
        amount_special,amount_diligence,amount_position,
        deduct_social_security,deduct_advance,deduct_safety_equipment,deduct_uniform,
        employee:employees(employee_code,first_name,last_name)
      `).in('period_id', ids)
      if (error) throw error
      if (!data?.length) { toast.error('ไม่พบข้อมูลในช่วงเวลานี้'); return }

      const map: Record<string, any> = {}
      ;(data as any[]).filter(r => r.employee).forEach(r => {
        const k = r.employee.employee_code
        if (!map[k]) map[k] = { emp: r.employee, n:0,s:0,ot:0,w:0,f:0,sp:0,d:0,p:0,ss:0,adv:0,safe:0,uni:0 }
        map[k].n+=r.amount_normal||0; map[k].s+=r.amount_shift||0; map[k].ot+=r.amount_ot||0
        map[k].w+=r.amount_wood_excess||0; map[k].f+=r.amount_film||0; map[k].sp+=r.amount_special||0
        map[k].d+=r.amount_diligence||0; map[k].p+=r.amount_position||0
        map[k].ss+=Math.abs(r.deduct_social_security||0); map[k].adv+=Math.abs(r.deduct_advance||0)
        map[k].safe+=Math.abs(r.deduct_safety_equipment||0); map[k].uni+=Math.abs(r.deduct_uniform||0)
      })
      const rows = Object.values(map).map((x: any) => {
        const income = x.n+x.s+x.ot+x.w+x.f+x.sp+x.d+x.p; const deduct = x.ss+x.adv+x.safe+x.uni
        return { 'รหัสพนักงาน':x.emp.employee_code,'ชื่อ-นามสกุล':`${x.emp.first_name} ${x.emp.last_name}`.trim(),
          'ค่าจ้างรวม':x.n+x.s,'ค่าจ้างปกติ':x.n,'ค่ากะ':x.s,'OT':x.ot,'ค่าไม้เกิน':x.w,'ค่าฟิล์ม':x.f,
          'ค่าพิเศษ':x.sp,'เบี้ยขยัน':x.d,'ค่าตำแหน่ง':x.p,'ประกันสังคม':x.ss,'เบิกล่วงหน้า':x.adv,
          'ค่าอุปกรณ์ความปลอดภัย':x.safe,'ค่าเสื้อพนักงาน':x.uni,'รวม':income-deduct }
      }).sort((a,b)=>String(a['รหัสพนักงาน']).localeCompare(String(b['รหัสพนักงาน'])))
      const label = getExportLabel()
      const wb = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet([[`ค่าแรง ${label}`]])
      XLSX.utils.sheet_add_json(ws, rows, { origin:'A2' }); XLSX.utils.book_append_sheet(wb, ws, 'Payroll Summary')
      XLSX.writeFile(wb, `Payroll_Summary_${label.replace(/[\s/*?:[\]]/g,'_')}.xlsx`)
      toast.success('ดาวน์โหลด Payroll Excel สำเร็จ')
    } catch(e:any) { toast.error('เกิดข้อผิดพลาด', { description: e.message }) }
    finally { setIsExportingXlsx(false) }
  }

  // ── SSO Excel ───────────────────────────────────────────────────────────────
  const handleExportSSO = async () => {
    const ids = getPeriodsToExport()
    if (!ids.length) { toast.error('กรุณาเลือกช่วงเวลา'); return }
    setIsExportingSSO(true)
    try {
      const XLSX = await import('xlsx')
      const { data, error } = await supabase.from('payroll_entries').select(`
        amount_normal,deduct_social_security,
        employee:employees(national_id,prefix,first_name,last_name,nationality)
      `).in('period_id', ids)
      if (error) throw error; if (!data?.length) { toast.error('ไม่พบข้อมูล'); return }
      const map: Record<string,any> = {}
      ;(data as any[]).filter(r=>r.employee&&(r.employee.nationality||'ไทย')==='ไทย').forEach(r=>{
        const k=r.employee.national_id||r.employee.first_name
        if(!map[k]) map[k]={emp:r.employee,n:0,ss:0}
        map[k].n+=r.amount_normal||0; map[k].ss+=r.deduct_social_security||0
      })
      const rows=Object.values(map).map((x:any)=>({'เลขบัตรประชาชน':x.emp.national_id||'','คำนำหน้า':x.emp.prefix||'','ชื่อ':x.emp.first_name||'','สกุล':x.emp.last_name||'','ค่าจ้าง':x.n,'เงินสมทบ':Math.abs(x.ss)}))
      if(!rows.length){toast.error('ไม่พบพนักงานสัญชาติไทย');return}
      const label=getExportLabel(); const wb=XLSX.utils.book_new(); const ws=XLSX.utils.json_to_sheet(rows)
      XLSX.utils.book_append_sheet(wb,ws,'ประกันสังคม')
      XLSX.writeFile(wb,`SSO_${label.replace(/[\s/*?:[\]]/g,'_')}.xlsx`)
      toast.success('ดาวน์โหลดฟอร์มประกันสังคมสำเร็จ')
    } catch(e:any){toast.error('เกิดข้อผิดพลาด',{description:e.message})}
    finally{setIsExportingSSO(false)}
  }

  // ── PDF Slips ────────────────────────────────────────────────────────────────
  const handleGeneratePDF = async () => {
    // Resolve period IDs
    let targetPeriodIds: string[] = []
    if (pdfTarget === 'all') {
      if (pdfMode === 'period') {
        if (!pdfPeriodId) { toast.error('กรุณาเลือกงวด'); return }
        targetPeriodIds = [pdfPeriodId]
      } else {
        if (!pdfMonth) { toast.error('กรุณาเลือกเดือน'); return }
        targetPeriodIds = periods.filter(p => {
          const d = new Date(p.period_start)
          return `${format(d,'MMMM',{locale:th})} ${d.getFullYear()+543}` === pdfMonth
        }).map(p => p.id)
      }
    } else {
      if (!pdfEmpId) { toast.error('กรุณาเลือกพนักงาน'); return }
      if (!pdfMonths.length) { toast.error('กรุณาเลือกเดือนอย่างน้อย 1 เดือน'); return }
      targetPeriodIds = periods.filter(p => {
        const d = new Date(p.period_start)
        return pdfMonths.includes(`${format(d,'MMMM',{locale:th})} ${d.getFullYear()+543}`)
      }).map(p => p.id)
    }
    if (!targetPeriodIds.length) { toast.error('ไม่พบรอบการจ่ายเงินที่เลือก'); return }

    setIsGeneratingPDF(true)
    try {
      // Fetch payroll entries with full employee fields
      let q = supabase.from('payroll_entries').select(`
        *,
        employee:employees(id,employee_code,first_name,last_name,position,job_title,wage_type,rate_per_12h,payment_method,bank_name,bank_account,nationality),
        period:payroll_periods(period_start,period_end)
      `).in('period_id', targetPeriodIds)
      if (pdfTarget === 'individual') q = q.eq('employee_id', pdfEmpId!)

      const { data: entries, error } = await q
      if (error) throw error
      if (!entries?.length) { toast.error('ไม่พบข้อมูลสลิปในช่วงที่เลือก'); return }

      // Fetch factory name and map to full legal name
      const { data: factoryData } = await supabase.from('factories')
        .select('id,name').eq('id', user?.factory_id ?? '').single()
      const branchName = fullFactoryName(factoryData?.name || '')

      // Fetch shift_assignments for all entries in bulk
      const empIds    = [...new Set((entries as any[]).map(e => e.employee_id))]
      const { data: allShifts = [] } = await supabase.from('shift_assignments' as any)
        .select('employee_id,period_id,work_date,is_holiday_ot,is_holiday_ot_exempt,is_half_shift,actual_hours,ot_hours')
        .in('period_id', targetPeriodIds)
        .in('employee_id', empIds)

      const sorted = [...(entries as any[])].sort((a,b)=>{
        const cmp = String(a.employee.employee_code).localeCompare(String(b.employee.employee_code))
        return cmp !== 0 ? cmp : new Date(a.period.period_start).getTime() - new Date(b.period.period_start).getTime()
      })

      const generatedAt = thaiDateTimeNow()
      const slipsHtml = sorted.map((e,i) => {
        const empShifts = (allShifts as any[]).filter(s => s.employee_id === e.employee_id && s.period_id === e.period_id)
        return `<div style="page-break-after:${i<sorted.length-1?'always':'auto'};padding:0;margin:0">${buildSlipHtml(e, e.period, empShifts, branchName, generatedAt)}</div>`
      }).join('')

      const first = sorted[0]
      const mm = String(new Date(first.period.period_start).getMonth()+1).padStart(2,'0')
      const yyyy = new Date(first.period.period_start).getFullYear()
      const filename = pdfTarget === 'individual'
        ? `${first.employee.employee_code}_${first.employee.first_name}_${mm}${yyyy}`
        : `All_Payslip_${mm}${yyyy}`

      const win = window.open('','_blank','width=900,height=700')
      if (!win) { alert('กรุณาอนุญาต popup สำหรับการพิมพ์'); return }
      win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${filename}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
body{margin:0;padding:0;background:#fff;font-family:'Sarabun','Noto Sans Thai',sans-serif}
body>div{border:none!important;box-shadow:none!important}
body>div>div{border:none!important;box-shadow:none!important;border-bottom:1px solid #e2e2e2!important}
@page{size:A4 portrait;margin:8mm 8mm}
@media print{html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head><body>${slipsHtml}</body></html>`)
      win.document.close(); win.focus()
      setTimeout(()=>{win.print();win.close()},500)
      toast.success('เปิดหน้าต่างพิมพ์แล้ว')
      setShowPdfModal(false)
    } catch(e:any) { toast.error('เกิดข้อผิดพลาด',{description:e.message}) }
    finally { setIsGeneratingPDF(false) }
  }

  const label = getExportLabel()
  const filteredEmps = employees.filter(e => {
    const q = empSearch.toLowerCase()
    if (!q) return e.status === 'active'
    return e.first_name.toLowerCase().includes(q) || (e.last_name||'').toLowerCase().includes(q) || (e.employee_code||'').toLowerCase().includes(q)
  })

  const cards = [
    { icon: Grid3x3,    color: 'var(--vk-jade)',      title: 'ตาราง Payroll รวม',        desc: 'ดาวน์โหลดข้อมูล Payroll ทุกคนในรูปแบบ .xlsx',                      btn: 'Download Excel', loading: isExportingXlsx, onClick: handleExportPayroll },
    { icon: FileText,   color: 'var(--vk-crimson)',    title: 'PDF – Pay Slip รายบุคคล',  desc: 'สร้างไฟล์ PDF Pay Slip แยกตามรายชื่อพนักงาน หรือพิมพ์ทั้งบริษัท', btn: 'Download PDF',   loading: false,           onClick: ()=>setShowPdfModal(true) },
    { icon: ShieldCheck,color: 'var(--vk-persimmon)',  title: 'ฟอร์มประกันสังคม',          desc: 'Export ข้อมูลเลขบัตร + ยอดประกันสังคม สำหรับยื่น สปส. รายเดือน',  btn: 'Download Excel', loading: isExportingSSO,  onClick: handleExportSSO },
  ]

  return (
    <div className="vk-root" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <TopBarV2 title="ส่งออกข้อมูล" subtitle={label} onMenuClick={onMenuClick} />

      <div className="vk-page">
        <div className="vk-eyebrow" style={{ marginBottom: 6 }}>EXPORT · ส่งออกข้อมูล</div>
        <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em', marginBottom: 28 }}>ดาวน์โหลดไฟล์</div>

        {/* Selectors */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 32, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={exportType} onChange={e => setExportType(e.target.value as any)}
            style={{ height: 36, fontFamily: 'var(--vk-sans)', fontSize: 13, border: '1px solid var(--vk-rule)', padding: '0 12px', background: 'var(--vk-paper)', color: 'var(--vk-ink)', outline: 'none' }}>
            <option value="month">ส่งออกรายเดือน</option>
            <option value="period">ส่งออกรายงวด</option>
          </select>
          {exportType === 'month' ? (
            <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
              style={{ height: 36, fontFamily: 'var(--vk-sans)', fontSize: 13, border: '1px solid var(--vk-rule)', padding: '0 12px', background: 'var(--vk-paper)', color: 'var(--vk-ink)', outline: 'none', minWidth: 180 }}>
              {uniqueMonths.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <select value={selectedPeriodId ?? ''} onChange={e => setSelectedPeriodId(e.target.value)}
              style={{ height: 36, fontFamily: 'var(--vk-sans)', fontSize: 13, border: '1px solid var(--vk-rule)', padding: '0 12px', background: 'var(--vk-paper)', color: 'var(--vk-ink)', outline: 'none', minWidth: 220 }}>
              {periods.map(p => <option key={p.id} value={p.id}>{formatPeriodLabel(p.period_start, p.period_end)}{p.status === 'approved' ? ' ✓' : ' (ร่าง)'}</option>)}
            </select>
          )}
          <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 13, color: 'var(--vk-ink-3)' }}>→ {label}</div>
        </div>

        {/* Cards */}
        <div className="vk-grid-3">
          {cards.map((card, i) => {
            const Icon = card.icon
            return (
              <div key={i} style={{ background: 'var(--vk-bone)', padding: '28px 24px', display: 'flex', flexDirection: 'column' }}>
                <div style={{ width: 40, height: 40, border: '1px solid var(--vk-rule)', background: 'var(--vk-paper)', display: 'grid', placeItems: 'center', marginBottom: 18, flexShrink: 0 }}>
                  <Icon style={{ width: 18, height: 18, color: card.color }} />
                </div>
                <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em', color: 'var(--vk-ink)', marginBottom: 8 }}>{card.title}</div>
                <div style={{ fontFamily: 'var(--vk-sans)', fontSize: 13, color: 'var(--vk-ink-3)', lineHeight: 1.55, flex: 1 }}>{card.desc}</div>
                <button className="vk-btn" onClick={card.onClick} disabled={card.loading}
                  style={{ marginTop: 20, borderColor: card.color, color: card.color, display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center', opacity: card.loading ? 0.6 : 1 }}>
                  {card.loading ? <><Loader2 style={{ width: 13, height: 13 }} />กำลังสร้างไฟล์...</> : <><Download style={{ width: 13, height: 13 }} />{card.btn}</>}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── PDF Modal ─────────────────────────────────────────────────────────── */}
      {showPdfModal && (
        <div className="vk-root" style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(22,19,17,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowPdfModal(false)}>
          <div style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', width: '100%', maxWidth: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}>

            {/* Modal header */}
            <div style={{ background: 'var(--vk-persimmon)', color: '#fff', padding: '18px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>PDF – Pay Slip รายบุคคล</div>
                <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>เลือกรูปแบบและช่วงเวลาที่ต้องการพิมพ์</div>
              </div>
              <button onClick={() => setShowPdfModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fff', opacity: 0.6, padding: 4 }}>
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>

            {/* Modal body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', background: 'var(--vk-bone)', display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* Target toggle */}
              <div>
                <div className="vk-eyebrow" style={{ marginBottom: 10 }}>รูปแบบการพิมพ์</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[{ v: 'individual', label: 'พนักงานรายบุคคล', sub: 'ขอสลิปย้อนหลังหลายเดือน' }, { v: 'all', label: 'พนักงานทุกคน', sub: 'พิมพ์สลิปทั้งบริษัทในงวดเดียว' }].map(opt => (
                    <div key={opt.v} onClick={() => setPdfTarget(opt.v as any)}
                      style={{ padding: '12px 14px', border: `1px solid ${pdfTarget === opt.v ? 'var(--vk-persimmon)' : 'var(--vk-rule)'}`, background: pdfTarget === opt.v ? 'var(--vk-persimmon)' : 'var(--vk-paper)', cursor: 'pointer', transition: 'all 0.12s' }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: pdfTarget === opt.v ? '#fff' : 'var(--vk-ink)' }}>{opt.label}</div>
                      <div style={{ fontSize: 11, color: pdfTarget === opt.v ? 'rgba(255,255,255,0.55)' : 'var(--vk-ink-3)', marginTop: 3 }}>{opt.sub}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* All employees mode */}
              {pdfTarget === 'all' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Mode sub-toggle */}
                  <div style={{ display: 'flex', border: '1px solid var(--vk-rule)', overflow: 'hidden', width: 'fit-content' }}>
                    {[{ v:'month', l:'รายเดือน' },{ v:'period', l:'รายงวด' }].map((t,i) => (
                      <button key={t.v} onClick={() => setPdfMode(t.v as any)}
                        style={{ padding: '5px 16px', fontSize: 12, fontFamily: 'var(--vk-sans)', fontWeight: pdfMode===t.v?700:400, border:'none', borderRight: i===0?'1px solid var(--vk-rule)':'none', cursor:'pointer', background: pdfMode===t.v?'var(--vk-persimmon)':'var(--vk-paper)', color: pdfMode===t.v?'#fff':'var(--vk-ink-3)' }}>
                        {t.l}
                      </button>
                    ))}
                  </div>
                  {pdfMode === 'month' ? (
                    <select value={pdfMonth} onChange={e => setPdfMonth(e.target.value)}
                      style={{ height: 36, fontFamily: 'var(--vk-sans)', fontSize: 13, border: '1px solid var(--vk-rule)', padding: '0 12px', background: 'var(--vk-paper)', color: 'var(--vk-ink)', outline: 'none' }}>
                      {uniqueMonths.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  ) : (
                    <select value={pdfPeriodId} onChange={e => setPdfPeriodId(e.target.value)}
                      style={{ height: 36, fontFamily: 'var(--vk-sans)', fontSize: 13, border: '1px solid var(--vk-rule)', padding: '0 12px', background: 'var(--vk-paper)', color: 'var(--vk-ink)', outline: 'none' }}>
                      {periods.map(p => <option key={p.id} value={p.id}>{formatPeriodLabel(p.period_start, p.period_end)}{p.status==='approved'?' ✓':' (ร่าง)'}</option>)}
                    </select>
                  )}
                </div>
              )}

              {/* Individual employee mode */}
              {pdfTarget === 'individual' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Employee picker */}
                  <div>
                    <div className="vk-eyebrow" style={{ marginBottom: 8 }}>1. เลือกพนักงาน</div>
                    <div style={{ position: 'relative', marginBottom: 6 }}>
                      <Search style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, color: 'var(--vk-ink-3)' }} />
                      <input value={empSearch} onChange={e => setEmpSearch(e.target.value)} placeholder="ค้นหาชื่อ / รหัส..."
                        style={{ width: '100%', paddingLeft: 28, paddingRight: 8, height: 32, fontSize: 12, fontFamily: 'var(--vk-sans)', border: '1px solid var(--vk-rule)', background: 'var(--vk-paper)', outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ border: '1px solid var(--vk-rule)', maxHeight: 160, overflowY: 'auto', background: 'var(--vk-paper)' }}>
                      {filteredEmps.length === 0
                        ? <div style={{ padding: '12px', fontSize: 12, color: 'var(--vk-ink-3)', textAlign: 'center' }}>ไม่พบพนักงาน</div>
                        : filteredEmps.map(emp => (
                          <div key={emp.id} onClick={() => setPdfEmpId(emp.id)}
                            style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', borderBottom: '1px solid var(--vk-rule-soft)', background: pdfEmpId === emp.id ? 'var(--vk-persimmon)' : 'transparent', transition: 'background 0.1s' }}>
                            <div>
                              <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 11, color: pdfEmpId===emp.id?'rgba(255,255,255,0.55)':'var(--vk-ink-3)', marginRight: 8 }}>{emp.employee_code}</span>
                              <span style={{ fontSize: 13, fontWeight: 600, color: pdfEmpId===emp.id?'#fff':'var(--vk-ink)' }}>{emp.first_name} {emp.last_name}</span>
                            </div>
                            {pdfEmpId === emp.id && <Check style={{ width: 13, height: 13, color: 'var(--vk-jade)' }} />}
                          </div>
                        ))}
                    </div>
                  </div>

                  {/* Month picker */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div className="vk-eyebrow">2. เลือกเดือน (เลือกได้หลายเดือน)</div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {[3,6].map(n => (
                          <button key={n} onClick={() => setPdfMonths(uniqueMonths.slice(0,n))}
                            style={{ fontSize: 11, padding: '2px 8px', border: '1px solid var(--vk-rule)', background: 'var(--vk-paper)', cursor: 'pointer', fontFamily: 'var(--vk-sans)', color: 'var(--vk-ink-2)' }}>
                            {n} เดือนล่าสุด
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 6 }}>
                      {uniqueMonths.map(m => {
                        const sel = pdfMonths.includes(m)
                        return (
                          <div key={m} onClick={() => setPdfMonths(prev => sel ? prev.filter(x=>x!==m) : [...prev,m])}
                            style={{ padding: '7px 10px', border: `1px solid ${sel?'var(--vk-persimmon)':'var(--vk-rule)'}`, background: sel?'var(--vk-persimmon)':'var(--vk-paper)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, transition: 'all 0.1s' }}>
                            <div style={{ width: 14, height: 14, border: `1px solid ${sel?'rgba(255,255,255,0.5)':'var(--vk-rule)'}`, background: sel?'rgba(255,255,255,0.2)':'transparent', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                              {sel && <Check style={{ width: 10, height: 10, color: '#fff' }} />}
                            </div>
                            <span style={{ fontSize: 12, fontFamily: 'var(--vk-sans)', fontWeight: sel?700:400, color: sel?'#fff':'var(--vk-ink)' }}>{m}</span>
                          </div>
                        )
                      })}
                    </div>
                    {pdfMonths.length > 0 && <div style={{ fontSize: 11, color: 'var(--vk-persimmon)', marginTop: 6 }}>เลือกแล้ว {pdfMonths.length} เดือน</div>}
                  </div>
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div style={{ padding: '14px 24px', borderTop: '1px solid var(--vk-rule)', background: 'var(--vk-paper)', display: 'flex', gap: 8, flexShrink: 0 }}>
              <button className="vk-btn vk-btn--primary" onClick={handleGeneratePDF} disabled={isGeneratingPDF}
                style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                {isGeneratingPDF ? <><Loader2 style={{ width: 13, height: 13 }} />กำลังสร้าง PDF...</> : <><Download style={{ width: 13, height: 13 }} />ดาวน์โหลด PDF</>}
              </button>
              <button className="vk-btn" onClick={() => setShowPdfModal(false)}>ยกเลิก</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
