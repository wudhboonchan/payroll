import { useState, useEffect, useRef } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { toast } from 'sonner'
import { Download, FileText, Grid3x3, ShieldCheck, Loader2, Search, Check, X, Users, FileSpreadsheet, Printer } from 'lucide-react'
import { format } from 'date-fns'
import { th } from 'date-fns/locale'
import { formatPeriodLabel } from '../lib/formatters'
import '../styles/tokens.css'

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

  // ── shift breakdown (mirrors PaySlip exactly) ──
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
  const baseNormal = empRate === 0 ? 0 : 357
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
  const detailOt1x   = isClerk && ot1Hrs > 0   ? `฿${clerkHourly.toFixed(2)} × 1.0 × ${ot1Hrs} ชม. (${daysShift} วัน)` : null

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

function fmtDisplayDateStr(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']
  return `วัน${DAYS[date.getDay()]}ที่ ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`
}

function getDatesInRangeList(startStr: string, endStr: string) {
  const dates = []
  const start = new Date(startStr + 'T00:00:00')
  const end = new Date(endStr + 'T00:00:00')
  const curr = new Date(start)
  while (curr <= end) {
    const y = curr.getFullYear()
    const m = String(curr.getMonth() + 1).padStart(2, '0')
    const d = String(curr.getDate()).padStart(2, '0')
    dates.push(`${y}-${m}-${d}`)
    curr.setDate(curr.getDate() + 1)
  }
  return dates
}

function calcEmpSummaryStats(emp: any, period: any, shifts: any[], entry: any, advances: any[]) {
  const dates = getDatesInRangeList(period.period_start, period.period_end)
  const isClerk = emp.position === 'clerk'
  const rate = Number(emp.rate_per_12h) || 0
  const baseNormal = rate === 0 ? 0 : 357
  const baseShift = Math.max(0, rate - baseNormal)
  const clerkDaily = rate / 30
  const clerkHourly = clerkDaily / 8

  const dailyEstimates = dates.map(dateStr => {
    const shift = shifts.find(s => s.work_date === dateStr)
    const d = new Date(dateStr)
    const weekend = d.getDay() === 0 || d.getDay() === 6
    const isHoliday = shift?.is_holiday_ot ?? false
    const holidayExempt = shift?.is_holiday_ot_exempt ?? false

    let dayType: 'normal' | 'weekend' | 'holiday' = 'normal'
    if (isHoliday && !holidayExempt) dayType = 'holiday'
    else if (weekend) dayType = 'weekend'

    if (!shift) {
      return { workDate: dateStr, dayType, isWorked: false, shiftType: null, hours: 0, baseWage: 0, shiftAllowance: 0, otPay: 0, woodExcess: 0, filmAmount: 0, crossPay: 0, crossTitle: '', totalEarned: 0 }
    }

    let hours = 12
    let baseWage = 0
    let shiftAllowance = 0
    let otPay = 0

    if (isClerk) {
      hours = weekend ? (shift.ot_hours || 0) : 8 + (shift.ot_hours || 0)
      if (weekend) {
        baseWage = 0
        otPay = clerkHourly * 1.0 * (shift.ot_hours || 0)
      } else {
        baseWage = 0
        otPay = clerkHourly * 1.5 * (shift.ot_hours || 0)
      }
    } else {
      const isHalf = shift.is_half_shift
      const partial = shift.actual_hours || 0

      if (partial > 0) hours = partial
      else if (isHalf) hours = 8
      else hours = 12

      if (isHoliday && !holidayExempt) {
        const effectiveDailyRate = Math.max(rate, baseNormal)
        if (partial > 0) baseWage = Math.round((baseNormal / 8) * partial * 2)
        else if (isHalf) baseWage = baseNormal * 2
        else baseWage = effectiveDailyRate * 2
        shiftAllowance = 0
        otPay = 0
      } else {
        if (partial > 0) {
          baseWage = Math.round((baseNormal / 8) * partial)
          shiftAllowance = 0
        } else if (isHalf) {
          baseWage = baseNormal
          shiftAllowance = 0
        } else {
          baseWage = baseNormal
          shiftAllowance = baseShift
        }
      }
    }

    const woodExcess = Number(shift.wood_excess || 0)
    const filmAmount = Number(shift.film_amount || 0)
    const crossPay = Number(shift.cross_position_extra_pay || 0)
    const crossTitle = shift.cross_position_title || ''
    const totalEarned = baseWage + shiftAllowance + otPay + woodExcess + filmAmount + crossPay

    return { workDate: dateStr, dayType, isWorked: true, shiftType: shift.shift_type, hours, baseWage, shiftAllowance, otPay, woodExcess, filmAmount, crossPay, crossTitle, totalEarned }
  })

  const clerkPeriodBase = isClerk ? rate / 2 : 0
  const workedDaysList = dailyEstimates.filter(d => d.isWorked)
  const totalDaysWorked = workedDaysList.length
  const morningShifts = workedDaysList.filter(d => d.shiftType === 'morning').length
  const afternoonShifts = workedDaysList.filter(d => d.shiftType === 'afternoon').length

  const estBaseWages = dailyEstimates.reduce((s, d) => s + d.baseWage, 0)
  const estShiftAllowances = dailyEstimates.reduce((s, d) => s + d.shiftAllowance, 0)
  const estOtPay = dailyEstimates.reduce((s, d) => s + d.otPay, 0)
  const estWood = dailyEstimates.reduce((s, d) => s + d.woodExcess, 0)
  const estFilm = dailyEstimates.reduce((s, d) => s + d.filmAmount, 0)
  const estCross = dailyEstimates.reduce((s, d) => s + d.crossPay, 0)

  const entryDiligence = Number(entry?.amount_diligence || 0)
  const entryPosition = Number(entry?.amount_position || 0)
  const entrySpecial = Number(entry?.amount_special || 0) + Number(entry?.override_special || 0)

  const grossEarnings = clerkPeriodBase + estBaseWages + estShiftAllowances + estOtPay + estWood + estFilm + estCross + entryDiligence + entryPosition + entrySpecial

  const entrySS = Number(entry?.deduct_social_security || 0)
  const totalAdvances = advances.reduce((s, a) => s + Number(a.amount || 0), 0)
  const entrySafety = Number(entry?.deduct_safety_equipment || 0)
  const entryUniform = Number(entry?.deduct_uniform || 0)

  const totalDeductions = entrySS + totalAdvances + entrySafety + entryUniform
  const netEarnings = grossEarnings - totalDeductions

  return {
    dailyEstimates, clerkPeriodBase, totalDaysWorked, morningShifts, afternoonShifts,
    grossEarnings, entrySS, totalAdvances, entrySafety, entryUniform,
    totalDeductions, netEarnings, entryDiligence, entryPosition, entrySpecial
  }
}

function buildSummarySinglePdfHtml(emp: any, period: any, stats: any, advances: any[], generatedAt: string): string {
  const posLabel = POSITIONS[emp.position] || emp.position || ''
  const periodLabelStr = thaiPeriod(period.period_start, period.period_end)
  const payMethodLabel = emp.payment_method === 'bank_transfer' ? 'โอนผ่านธนาคาร' : 'เงินสด'
  const bankDetails = emp.payment_method === 'bank_transfer' && emp.bank_name
    ? `${emp.bank_name} ${maskBank(emp.bank_account) || ''}`
    : '—'

  const dailyRowsHtml = stats.dailyEstimates.map((day: any) => {
    const isHoliday = day.dayType === 'holiday'
    const isWeekend = day.dayType === 'weekend'
    const dayLabel = isHoliday ? 'วันหยุดนักขัตฤกษ์' : isWeekend ? 'วันหยุดสัปดาห์' : 'วันธรรมดา'
    const shiftLabel = day.isWorked
      ? (emp.position === 'clerk' ? 'ทำงานปกติ' : (day.shiftType === 'morning' ? 'กะเช้า' : day.shiftType === 'afternoon' ? 'กะบ่าย' : 'เข้ากะ'))
      : 'หยุด'

    const items: string[] = []
    if (day.isWorked) {
      if (day.baseWage > 0) items.push(`ค่าจ้าง ฿${mono(day.baseWage)}`)
      if (day.shiftAllowance > 0) items.push(`ค่ากะ ฿${mono(day.shiftAllowance)}`)
      if (day.otPay > 0) items.push(`OT ฿${mono(day.otPay)}`)
      if (day.woodExcess > 0) items.push(`ไม้เกิน ฿${mono(day.woodExcess)}`)
      if (day.filmAmount > 0) items.push(`ฟิล์ม ฿${mono(day.filmAmount)}`)
      if (day.crossPay > 0) items.push(`สลับตำแหน่ง (${day.crossTitle || ''}) ฿${mono(day.crossPay)}`)
    }

    return `
      <tr style="${!day.isWorked ? 'opacity:0.55;background:#fafafa' : ''}">
        <td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px">${fmtDisplayDateStr(day.workDate)}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px;color:#666">${dayLabel}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px">${shiftLabel}${day.isWorked && emp.position !== 'clerk' ? ` (${day.hours} ชม.)` : ''}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px">${items.join(' · ') || '—'}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px;text-align:right;font-family:monospace;font-weight:600">
          ${day.totalEarned > 0 ? '฿' + mono(day.totalEarned) : '—'}
        </td>
      </tr>
    `
  }).join('')

  const periodIncomeRowsHtml = [
    stats.clerkPeriodBase > 0 ? `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee">ค่าจ้างพื้นฐาน (ครึ่งเดือน)</td><td style="padding:5px 8px;border-bottom:1px solid #eee">เงินเดือน ÷ 2</td><td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">฿${mono(stats.clerkPeriodBase)}</td></tr>` : '',
    stats.entryDiligence > 0 ? `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee">เบี้ยขยัน</td><td style="padding:5px 8px;border-bottom:1px solid #eee">เบี้ยขยันประจำงวด</td><td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">฿${mono(stats.entryDiligence)}</td></tr>` : '',
    stats.entryPosition > 0 ? `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee">ค่าตำแหน่ง</td><td style="padding:5px 8px;border-bottom:1px solid #eee">ค่าตำแหน่งประจำงวด</td><td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">฿${mono(stats.entryPosition)}</td></tr>` : '',
    stats.entrySpecial > 0 ? `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee">เงินพิเศษ / ปรับปรุง</td><td style="padding:5px 8px;border-bottom:1px solid #eee">บันทึกในงวดนี้</td><td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">฿${mono(stats.entrySpecial)}</td></tr>` : '',
  ].join('')

  const deductionRowsHtml = [
    stats.entrySS > 0 ? `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#c0392b">ประกันสังคม</td><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#666">หัก ณ ที่จ่าย</td><td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace;color:#c0392b">−฿${mono(stats.entrySS)}</td></tr>` : '',
    ...advances.map((adv: any, i: number) => `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#c0392b">เบิกล่วงหน้า (#${i+1})</td><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#666">${adv.request_date ? fmtDisplayDateStr(adv.request_date) + ' ' : ''}${adv.notes || ''}</td><td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace;color:#c0392b">−฿${mono(Number(adv.amount))}</td></tr>`),
    stats.entrySafety > 0 ? `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#c0392b">อุปกรณ์ความปลอดภัย</td><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#666">หักค่าอุปกรณ์</td><td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace;color:#c0392b">−฿${mono(stats.entrySafety)}</td></tr>` : '',
    stats.entryUniform > 0 ? `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#c0392b">ค่าเสื้อพนักงาน</td><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#666">หักค่าชุดทำงาน</td><td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace;color:#c0392b">−฿${mono(stats.entryUniform)}</td></tr>` : '',
  ].join('')

  return `
<div style="background:#fff;font-family:'Sarabun',sans-serif;color:#1a1a1a;font-size:12px;padding:12px">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:10px;border-bottom:2px solid #1a1a1a;margin-bottom:14px">
    <div>
      <div style="font-weight:800;font-size:17px">ห้างหุ้นส่วนจำกัด วิราญกร</div>
      <div style="font-size:13px;font-weight:700;color:#555;margin-top:2px">รายงานสรุปภาพรวมพนักงาน (Employee Ledger Summary)</div>
    </div>
    <div style="text-align:right;font-size:10px;color:#666">
      <div>งวดเงินเดือน: <strong>${periodLabelStr}</strong></div>
      <div>พิมพ์เมื่อ: ${generatedAt}</div>
    </div>
  </div>

  <div style="background:#f8f9fa;border:1px solid #e9ecef;padding:10px 14px;margin-bottom:14px;display:grid;grid-template-columns:1fr 1fr;gap:6px">
    <div>
      <div><strong>ชื่อ-นามสกุล:</strong> ${emp.first_name} ${emp.last_name}</div>
      <div><strong>รหัสพนักงาน:</strong> <span style="font-family:monospace">${emp.employee_code}</span></div>
      <div><strong>ตำแหน่ง:</strong> ${posLabel}${emp.job_title ? ' - ' + emp.job_title : ''}</div>
    </div>
    <div>
      <div><strong>อัตราค่าจ้าง:</strong> ฿${(Number(emp.rate_per_12h)||0).toLocaleString()}/${emp.wage_type==='monthly'?'เดือน':'12ชม.'}</div>
      <div><strong>วิธีรับเงิน:</strong> ${payMethodLabel}</div>
      <div><strong>ธนาคาร/เลขบัญชี:</strong> ${bankDetails}</div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:14px">
    <div style="background:#1a1a1a;color:#fff;padding:8px 10px;border-radius:4px">
      <div style="font-size:9px;text-transform:uppercase;color:#aaa">วันทำงาน</div>
      <div style="font-size:15px;font-weight:700;font-family:monospace">${stats.totalDaysWorked} วัน</div>
      <div style="font-size:8px;color:#aaa">เช้า ${stats.morningShifts} · บ่าย ${stats.afternoonShifts}</div>
    </div>
    <div style="background:#1a1a1a;color:#fff;padding:8px 10px;border-radius:4px">
      <div style="font-size:9px;text-transform:uppercase;color:#aaa">รายได้รวม</div>
      <div style="font-size:15px;font-weight:700;font-family:monospace;color:#6ee7b7">฿${mono(stats.grossEarnings)}</div>
      <div style="font-size:8px;color:#aaa">ก่อนหักรายการ</div>
    </div>
    <div style="background:#1a1a1a;color:#fff;padding:8px 10px;border-radius:4px">
      <div style="font-size:9px;text-transform:uppercase;color:#aaa">หักรวม</div>
      <div style="font-size:15px;font-weight:700;font-family:monospace;color:#fca5a5">฿${mono(stats.totalDeductions)}</div>
      <div style="font-size:8px;color:#aaa">ประกัน + เบิก + อื่นๆ</div>
    </div>
    <div style="background:#1a1a1a;color:#fff;padding:8px 10px;border-radius:4px">
      <div style="font-size:9px;text-transform:uppercase;color:#aaa">สุทธิรับจริง</div>
      <div style="font-size:15px;font-weight:700;font-family:monospace;color:#fde047">฿${mono(stats.netEarnings)}</div>
      <div style="font-size:8px;color:#aaa">NET PAY</div>
    </div>
  </div>

  <div style="font-weight:700;font-size:12px;margin-bottom:5px">1. บันทึกรายวัน (Daily Log)</div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
    <thead>
      <tr>
        <th style="background:#f1f3f5;text-align:left;padding:6px;font-size:10px;font-weight:700;border-bottom:1px solid #dee2e6">วันที่</th>
        <th style="background:#f1f3f5;text-align:left;padding:6px;font-size:10px;font-weight:700;border-bottom:1px solid #dee2e6">ประเภทวัน</th>
        <th style="background:#f1f3f5;text-align:left;padding:6px;font-size:10px;font-weight:700;border-bottom:1px solid #dee2e6">กะ / ชั่วโมง</th>
        <th style="background:#f1f3f5;text-align:left;padding:6px;font-size:10px;font-weight:700;border-bottom:1px solid #dee2e6">รายการรายได้</th>
        <th style="background:#f1f3f5;text-align:right;padding:6px;font-size:10px;font-weight:700;border-bottom:1px solid #dee2e6">รวมรายวัน</th>
      </tr>
    </thead>
    <tbody>
      ${dailyRowsHtml}
    </tbody>
  </table>

  ${(periodIncomeRowsHtml || deductionRowsHtml) ? `
    <div style="font-weight:700;font-size:12px;margin-bottom:5px">2. รายการประจำงวด & รายการหักเงิน</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
      <thead>
        <tr>
          <th style="background:#f1f3f5;text-align:left;padding:6px;font-size:10px;font-weight:700;border-bottom:1px solid #dee2e6">รายการ</th>
          <th style="background:#f1f3f5;text-align:left;padding:6px;font-size:10px;font-weight:700;border-bottom:1px solid #dee2e6">รายละเอียด / หมายเหตุ</th>
          <th style="background:#f1f3f5;text-align:right;padding:6px;font-size:10px;font-weight:700;border-bottom:1px solid #dee2e6">จำนวนเงิน</th>
        </tr>
      </thead>
      <tbody>
        ${periodIncomeRowsHtml}
        ${deductionRowsHtml}
      </tbody>
    </table>
  ` : ''}

  <div style="background:#1a1a1a;color:#fff;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;margin-top:14px">
    <div>
      <div style="font-size:10px;color:#aaa;text-transform:uppercase">NET PAY · สุทธิรับจริง</div>
      <div style="font-size:10px;color:#ccc;margin-top:2px">${stats.totalDaysWorked} วันทำงาน · รายได้ ฿${mono(stats.grossEarnings)} · หัก ฿${mono(stats.totalDeductions)}</div>
    </div>
    <div style="font-family:monospace;font-size:22px;font-weight:800;color:#fde047">
      ฿${mono(stats.netEarnings)}
    </div>
  </div>
</div>
  `
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Export() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user } = useAppStore()
  const isNormalUser = user?.role === 'normalUser'

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

  // Summary modal state
  const [showSummaryModal,    setShowSummaryModal]    = useState(false)
  const [summaryTarget,       setSummaryTarget]       = useState<'all' | 'individual'>('individual')
  const [summaryMode,         setSummaryMode]         = useState<'month' | 'period'>('month')
  const [summaryMonth,        setSummaryMonth]        = useState('')
  const [summaryPeriodId,     setSummaryPeriodId]     = useState('')
  const [summaryEmpId,        setSummaryEmpId]        = useState<string | null>(null)
  const [summaryMonths,       setSummaryMonths]       = useState<string[]>([])
  const [summaryEmpSearch,    setSummaryEmpSearch]    = useState('')
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false)

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
    }, enabled: !!user?.factory_id && (showPdfModal || showSummaryModal),
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
        setSummaryPeriodId(approved?.id ?? periods[0].id)
      })
    }
  }, [periods])
  useEffect(() => {
    if (uniqueMonths.length > 0 && !selectedMonth)
      requestAnimationFrame(() => {
        setSelectedMonth(uniqueMonths[0]); setPdfMonth(uniqueMonths[0]); setSummaryMonth(uniqueMonths[0])
      })
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
        employee:employees(employee_code,first_name,last_name,payment_method,bank_name,bank_account,status)
      `).in('period_id', ids).limit(10000)
      if (error) throw error
      if (!data?.length) { toast.error('ไม่พบข้อมูลในช่วงเวลานี้'); return }

      const map: Record<string, any> = {}
      ;(data as any[]).filter(r => r.employee && r.employee.status !== 'inactive').forEach(r => {
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
        const payMethod = x.emp.payment_method === 'bank_transfer' ? 'โอนธนาคาร' : (x.emp.payment_method === 'cash' ? 'เงินสด' : (x.emp.payment_method || '-'))
        const bankName = x.emp.payment_method === 'bank_transfer' ? (x.emp.bank_name || '-') : '-'
        const bankAccount = x.emp.payment_method === 'bank_transfer' ? (x.emp.bank_account || '-') : '-'
        return {
          'รหัสพนักงาน': x.emp.employee_code,
          'ชื่อ-นามสกุล': `${x.emp.first_name} ${x.emp.last_name}`.trim(),
          'วิธีการรับเงิน': payMethod,
          'ธนาคาร': bankName,
          'เลขที่บัญชี': bankAccount,
          'ค่าจ้างรวม': x.n+x.s,
          'ค่าจ้างปกติ': x.n,
          'ค่ากะ': x.s,
          'OT': x.ot,
          'ค่าไม้เกิน': x.w,
          'ค่าฟิล์ม': x.f,
          'ค่าพิเศษ': x.sp,
          'เบี้ยขยัน': x.d,
          'ค่าตำแหน่ง': x.p,
          'ประกันสังคม': x.ss,
          'เบิกล่วงหน้า': x.adv,
          'ค่าอุปกรณ์ความปลอดภัย': x.safe,
          'ค่าเสื้อพนักงาน': x.uni,
          'รวม': income-deduct
        }
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
        employee:employees(national_id,prefix,first_name,last_name,nationality,status)
      `).in('period_id', ids).limit(10000)
      if (error) throw error; if (!data?.length) { toast.error('ไม่พบข้อมูล'); return }
      const map: Record<string,any> = {}
      ;(data as any[]).filter(r=>r.employee&&r.employee.status!=='inactive'&&(r.employee.nationality||'ไทย')==='ไทย').forEach(r=>{
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
  // For normalUser: active period = most recent period in list
  const activePeriod = periods[0] ?? null

  const handleGeneratePDF = async () => {
    // Resolve period IDs
    let targetPeriodIds: string[] = []
    if (isNormalUser) {
      // Locked to active period only, all employees
      if (!activePeriod) { toast.error('ไม่พบงวดปัจจุบัน'); return }
      targetPeriodIds = [activePeriod.id]
    } else if (pdfTarget === 'all') {
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
        employee:employees(id,employee_code,first_name,last_name,position,job_title,wage_type,rate_per_12h,payment_method,bank_name,bank_account,nationality,status),
        period:payroll_periods(period_start,period_end)
      `).in('period_id', targetPeriodIds).limit(10000)
      if (!isNormalUser && pdfTarget === 'individual') q = q.eq('employee_id', pdfEmpId!)

      const { data: rawEntries, error } = await q
      if (error) throw error
      if (!rawEntries?.length) { toast.error('ไม่พบข้อมูลสลิปในช่วงที่เลือก'); return }
      const entries = (rawEntries as any[]).filter(e => e.employee?.status !== 'inactive')

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
        .limit(10000)

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

  // ── Employee Summary Export (PDF & Excel) ───────────────────────────────────
  const handleGenerateSummaryExport = async (fileType: 'pdf' | 'excel') => {
    let targetPeriodIds: string[] = []
    if (isNormalUser) {
      if (!activePeriod) { toast.error('ไม่พบงวดปัจจุบัน'); return }
      targetPeriodIds = [activePeriod.id]
    } else if (summaryTarget === 'all') {
      if (summaryMode === 'period') {
        if (!summaryPeriodId) { toast.error('กรุณาเลือกงวด'); return }
        targetPeriodIds = [summaryPeriodId]
      } else {
        if (!summaryMonth) { toast.error('กรุณาเลือกเดือน'); return }
        targetPeriodIds = periods.filter(p => {
          const d = new Date(p.period_start)
          return `${format(d,'MMMM',{locale:th})} ${d.getFullYear()+543}` === summaryMonth
        }).map(p => p.id)
      }
    } else {
      if (!summaryEmpId) { toast.error('กรุณาเลือกพนักงาน'); return }
      if (!summaryMonths.length) { toast.error('กรุณาเลือกเดือนอย่างน้อย 1 เดือน'); return }
      targetPeriodIds = periods.filter(p => {
        const d = new Date(p.period_start)
        return summaryMonths.includes(`${format(d,'MMMM',{locale:th})} ${d.getFullYear()+543}`)
      }).map(p => p.id)
    }
    if (!targetPeriodIds.length) { toast.error('ไม่พบรอบการจ่ายเงินที่เลือก'); return }

    setIsGeneratingSummary(true)
    try {
      // 1. Fetch payroll entries
      let q = supabase.from('payroll_entries').select(`
        *,
        employee:employees(id,employee_code,first_name,last_name,position,job_title,wage_type,rate_per_12h,payment_method,bank_name,bank_account,nationality,status,exempt_social_security),
        period:payroll_periods(id,period_start,period_end)
      `).in('period_id', targetPeriodIds).limit(10000)
      if (!isNormalUser && summaryTarget === 'individual') q = q.eq('employee_id', summaryEmpId!)

      const { data: rawEntries, error: errEntries } = await q
      if (errEntries) throw errEntries
      if (!rawEntries?.length) { toast.error('ไม่พบข้อมูลในช่วงที่เลือก'); return }
      const entries = (rawEntries as any[]).filter(e => e.employee?.status !== 'inactive')
      if (!entries.length) { toast.error('ไม่พบข้อมูลพนักงานในช่วงที่เลือก'); return }

      const empIds = [...new Set(entries.map(e => e.employee_id))]

      // 2. Fetch shift_assignments
      const { data: allShifts = [] } = await supabase.from('shift_assignments' as any)
        .select('employee_id,period_id,work_date,shift_type,is_holiday_ot,is_holiday_ot_exempt,is_half_shift,actual_hours,ot_hours,wood_excess,film_amount,is_cross_position,cross_position_title,cross_position_extra_pay')
        .in('period_id', targetPeriodIds)
        .in('employee_id', empIds)
        .limit(10000)

      // 3. Fetch advance_payments
      const { data: allAdvances = [] } = await supabase.from('advance_payments')
        .select('employee_id,period_id,amount,request_date,notes')
        .in('period_id', targetPeriodIds)
        .in('employee_id', empIds)

      const sortedEntries = [...entries].sort((a,b)=>{
        const cmp = String(a.employee.employee_code).localeCompare(String(b.employee.employee_code))
        return cmp !== 0 ? cmp : new Date(a.period.period_start).getTime() - new Date(b.period.period_start).getTime()
      })

      const generatedAt = thaiDateTimeNow()

      if (fileType === 'pdf') {
        const pagesHtml = sortedEntries.map((e, i) => {
          const empShifts = allShifts.filter((s: any) => s.employee_id === e.employee_id && s.period_id === e.period_id)
          const empAdvances = allAdvances.filter((a: any) => a.employee_id === e.employee_id && a.period_id === e.period_id)
          const stats = calcEmpSummaryStats(e.employee, e.period, empShifts, e, empAdvances)
          const pageContent = buildSummarySinglePdfHtml(e.employee, e.period, stats, empAdvances, generatedAt)
          return `<div style="page-break-after:${i < sortedEntries.length - 1 ? 'always' : 'auto'};padding:0;margin:0">${pageContent}</div>`
        }).join('')

        const first = sortedEntries[0]
        const mm = String(new Date(first.period.period_start).getMonth()+1).padStart(2,'0')
        const yyyy = new Date(first.period.period_start).getFullYear()
        const filename = summaryTarget === 'individual'
          ? `Summary_${first.employee.employee_code}_${first.employee.first_name}_${mm}${yyyy}`
          : `All_Employee_Summary_${mm}${yyyy}`

        const win = window.open('','_blank','width=900,height=750')
        if (!win) { toast.error('กรุณาอนุญาต popup สำหรับการพิมพ์'); return }
        win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${filename}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
body{margin:0;padding:0;background:#fff;font-family:'Sarabun',sans-serif}
@page{size:A4 portrait;margin:6mm 6mm}
@media print{html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head><body>${pagesHtml}</body></html>`)
        win.document.close(); win.focus()
        setTimeout(()=>{win.print();win.close()},500)
        toast.success('เปิดหน้าต่างพิมพ์ PDF สรุปพนักงานแล้ว')
        setShowSummaryModal(false)
      } else {
        // Excel Export
        const XLSX = await import('xlsx')
        const wb = XLSX.utils.book_new()
        const allRows: any[] = []

        sortedEntries.forEach((e, idx) => {
          const emp = e.employee
          const period = e.period
          const empShifts = allShifts.filter((s: any) => s.employee_id === e.employee_id && s.period_id === e.period_id)
          const empAdvances = allAdvances.filter((a: any) => a.employee_id === e.employee_id && a.period_id === e.period_id)
          const stats = calcEmpSummaryStats(emp, period, empShifts, e, empAdvances)
          const posLabel = POSITIONS[emp.position] || emp.position || ''
          const periodLabelStr = thaiPeriod(period.period_start, period.period_end)
          const payMethodLabel = emp.payment_method === 'bank_transfer' ? 'โอนผ่านธนาคาร' : 'เงินสด'
          const bankName = emp.payment_method === 'bank_transfer' ? (emp.bank_name || '-') : '-'
          const bankAccount = emp.payment_method === 'bank_transfer' ? (emp.bank_account || '-') : '-'

          if (idx > 0) {
            allRows.push([])
            allRows.push(['==================================================================================================='])
            allRows.push([])
          }

          allRows.push(['รายงานสรุปภาพรวมพนักงาน (Employee Ledger Summary)'])
          allRows.push(['งวดเงินเดือน:', periodLabelStr])
          allRows.push([])

          allRows.push(['รหัสพนักงาน', emp.employee_code, 'ชื่อ-นามสกุล', `${emp.first_name} ${emp.last_name}`.trim()])
          allRows.push(['ตำแหน่ง', posLabel, 'อัตราค่าจ้าง', emp.rate_per_12h])
          allRows.push(['วิธีการรับเงิน', payMethodLabel, 'ธนาคาร', bankName, 'เลขที่บัญชี', bankAccount])
          allRows.push([])

          allRows.push(['สรุปยอดงวดนี้'])
          allRows.push(['วันทำงานทั้งหมด (วัน)', stats.totalDaysWorked, 'กะเช้า', stats.morningShifts, 'กะบ่าย', stats.afternoonShifts])
          allRows.push(['รายได้รวม (บาท)', stats.grossEarnings, 'รายการหักรวม (บาท)', stats.totalDeductions, 'สุทธิรับจริง NET PAY (บาท)', stats.netEarnings])
          allRows.push([])

          allRows.push(['1. บันทึกรายวัน (Daily Log)'])
          allRows.push(['วันที่', 'ประเภทวัน', 'กะ/สถานะ', 'จำนวนชั่วโมง', 'ค่าจ้างปกติ', 'ค่ากะ', 'OT', 'ไม้ส่วนเกิน', 'ค่าฟิล์ม', 'สลับตำแหน่ง', 'รวมรายได้วัน'])

          stats.dailyEstimates.forEach((day: any) => {
            const isHoliday = day.dayType === 'holiday'
            const isWeekend = day.dayType === 'weekend'
            const dayTypeLabel = isHoliday ? 'วันหยุดนักขัตฤกษ์' : isWeekend ? 'วันหยุดสัปดาห์' : 'วันธรรมดา'
            const shiftLabel = day.isWorked
              ? (emp.position === 'clerk' ? 'ทำงานปกติ' : (day.shiftType === 'morning' ? 'เช้า' : day.shiftType === 'afternoon' ? 'บ่าย' : 'เข้ากะ'))
              : 'หยุด'

            allRows.push([
              day.workDate,
              dayTypeLabel,
              shiftLabel,
              day.isWorked ? day.hours : 0,
              day.baseWage,
              day.shiftAllowance,
              day.otPay,
              day.woodExcess,
              day.filmAmount,
              day.crossPay > 0 ? `${day.crossPay} (${day.crossTitle || ''})` : 0,
              day.totalEarned
            ])
          })

          allRows.push([])

          allRows.push(['2. รายการประจำงวด & รายการหักเงิน'])
          allRows.push(['ประเภทรายการ', 'รายละเอียด / หมายเหตุ', 'จำนวนเงิน (บาท)'])

          if (stats.clerkPeriodBase > 0) allRows.push(['รายได้', 'ค่าจ้างพื้นฐาน (ครึ่งเดือน)', stats.clerkPeriodBase])
          if (stats.entryDiligence > 0) allRows.push(['รายได้', 'เบี้ยขยันประจำงวด', stats.entryDiligence])
          if (stats.entryPosition > 0) allRows.push(['รายได้', 'ค่าตำแหน่งประจำงวด', stats.entryPosition])
          if (stats.entrySpecial > 0) allRows.push(['รายได้', `เงินพิเศษ / ปรับปรุง (${e.special_note || ''})`, stats.entrySpecial])

          if (stats.entrySS > 0) allRows.push(['รายการหัก', 'ประกันสังคม', -stats.entrySS])
          empAdvances.forEach((adv: any, i: number) => {
            allRows.push(['รายการหัก', `เบิกล่วงหน้า (#${i+1}) ${adv.notes || ''}`, -Number(adv.amount || 0)])
          })
          if (stats.entrySafety > 0) allRows.push(['รายการหัก', 'อุปกรณ์ความปลอดภัย', -stats.entrySafety])
          if (stats.entryUniform > 0) allRows.push(['รายการหัก', 'ค่าเสื้อพนักงาน', -stats.entryUniform])

          allRows.push([])
          allRows.push(['ยอดเงินสุทธิรับจริง (NET PAY)', '', stats.netEarnings])
        })

        const ws = XLSX.utils.aoa_to_sheet(allRows)
        ws['!cols'] = [
          { wch: 16 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
          { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 16 }
        ]

        XLSX.utils.book_append_sheet(wb, ws, 'Employee Summary')
        const first = sortedEntries[0]
        const mm = String(new Date(first.period.period_start).getMonth()+1).padStart(2,'0')
        const yyyy = new Date(first.period.period_start).getFullYear()
        const filename = summaryTarget === 'individual'
          ? `Summary_${first.employee.employee_code}_${first.employee.first_name}_${mm}${yyyy}.xlsx`
          : `All_Employee_Summary_${mm}${yyyy}.xlsx`

        XLSX.writeFile(wb, filename)
        toast.success('ดาวน์โหลด Excel สรุปพนักงานสำเร็จ')
        setShowSummaryModal(false)
      }
    } catch(e: any) {
      toast.error('เกิดข้อผิดพลาดในการสร้างไฟล์', { description: e.message })
    } finally {
      setIsGeneratingSummary(false)
    }
  }

  const label = getExportLabel()
  const filteredEmps = employees.filter(e => {
    const q = empSearch.toLowerCase()
    if (!q) return e.status === 'active'
    return e.first_name.toLowerCase().includes(q) || (e.last_name||'').toLowerCase().includes(q) || (e.employee_code||'').toLowerCase().includes(q)
  })

  const summaryFilteredEmps = employees.filter(e => {
    const q = summaryEmpSearch.toLowerCase()
    if (!q) return e.status === 'active'
    return e.first_name.toLowerCase().includes(q) || (e.last_name||'').toLowerCase().includes(q) || (e.employee_code||'').toLowerCase().includes(q)
  })

  const allCards = [
    { icon: Grid3x3,      color: 'var(--vk-jade)',      title: 'ตาราง Payroll รวม',        desc: 'ดาวน์โหลดข้อมูล Payroll ทุกคนในรูปแบบ .xlsx',                      btn: 'Download Excel', loading: isExportingXlsx, onClick: handleExportPayroll, adminOnly: true  },
    { icon: FileText,     color: 'var(--vk-crimson)',    title: 'PDF – Pay Slip รายบุคคล',  desc: 'สร้างไฟล์ PDF Pay Slip แยกตามรายชื่อพนักงาน หรือพิมพ์ทั้งบริษัท', btn: 'Download PDF',   loading: false,           onClick: ()=>setShowPdfModal(true), adminOnly: false },
    { icon: Users,        color: 'var(--vk-jade)',      title: 'สรุปภาพรวมพนักงาน',       desc: 'ส่งออกรายงานสรุปรายได้และบันทึกรายวัน (PDF/Excel) รายบุคคล หรือทั้งบริษัท', btn: 'ส่งออกข้อมูล',  loading: false,           onClick: ()=>setShowSummaryModal(true), adminOnly: false },
    { icon: ShieldCheck,  color: 'var(--vk-persimmon)',  title: 'ฟอร์มประกันสังคม',          desc: 'Export ข้อมูลเลขบัตร + ยอดประกันสังคม สำหรับยื่น สปส. รายเดือน',  btn: 'Download Excel', loading: isExportingSSO,  onClick: handleExportSSO,          adminOnly: true  },
  ]
  const cards = isNormalUser ? allCards.filter(c => !c.adminOnly) : allCards

  return (
    <>
      <TopBar title="ส่งออกข้อมูล" subtitle={label} onMenuClick={onMenuClick} />

      <div className="vk-page">
        <div className="vk-eyebrow" style={{ marginBottom: 6 }}>EXPORT · ส่งออกข้อมูล</div>
        <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em', marginBottom: 28 }}>ดาวน์โหลดไฟล์</div>

        {/* Selectors — hidden for normalUser */}
        {!isNormalUser && (
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
        )}

        {/* Cards */}
        <div style={isNormalUser ? { display: 'flex', maxWidth: 360, border: '1px solid var(--vk-rule)' } : undefined} className={isNormalUser ? undefined : 'vk-grid-3'}>
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

              {/* normalUser: locked view — active period only, all employees */}
              {isNormalUser ? (
                <div>
                  <div className="vk-eyebrow" style={{ marginBottom: 10 }}>งวดที่จะ Export</div>
                  <div style={{ padding: '14px 16px', border: '1px solid var(--vk-rule)', background: 'var(--vk-paper)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--vk-ink)' }}>
                        {activePeriod ? formatPeriodLabel(activePeriod.period_start, activePeriod.period_end) : '—'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--vk-ink-3)', marginTop: 3 }}>พนักงานทุกคน · งวดปัจจุบันเท่านั้น</div>
                    </div>
                    <FileText style={{ width: 18, height: 18, color: 'var(--vk-crimson)', flexShrink: 0 }} />
                  </div>
                </div>
              ) : (
              <>
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
              </>
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

      {/* ── Summary Modal ─────────────────────────────────────────────────────── */}
      {showSummaryModal && (
        <div className="vk-root" style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(22,19,17,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowSummaryModal(false)}>
          <div style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', width: '100%', maxWidth: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}>

            {/* Modal header */}
            <div style={{ background: 'var(--vk-jade)', color: '#fff', padding: '18px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>สรุปภาพรวมพนักงาน (PDF & Excel)</div>
                <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>ส่งออกรายงานสรุปรายได้และบันทึกรายวัน</div>
              </div>
              <button onClick={() => setShowSummaryModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fff', opacity: 0.6, padding: 4 }}>
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>

            {/* Modal body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', background: 'var(--vk-bone)', display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* normalUser: locked view — active period only, all employees */}
              {isNormalUser ? (
                <div>
                  <div className="vk-eyebrow" style={{ marginBottom: 10 }}>งวดที่จะ Export</div>
                  <div style={{ padding: '14px 16px', border: '1px solid var(--vk-rule)', background: 'var(--vk-paper)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--vk-ink)' }}>
                        {activePeriod ? formatPeriodLabel(activePeriod.period_start, activePeriod.period_end) : '—'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--vk-ink-3)', marginTop: 3 }}>พนักงานทุกคน · งวดปัจจุบันเท่านั้น</div>
                    </div>
                    <Users style={{ width: 18, height: 18, color: 'var(--vk-jade)', flexShrink: 0 }} />
                  </div>
                </div>
              ) : (
              <>
              {/* Target toggle */}
              <div>
                <div className="vk-eyebrow" style={{ marginBottom: 10 }}>รูปแบบการส่งออก</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[{ v: 'individual', label: 'พนักงานรายบุคคล', sub: 'ขอสรุปย้อนหลังหลายเดือน' }, { v: 'all', label: 'พนักงานทุกคน', sub: 'พิมพ์สรุปทั้งบริษัทในงวดเดียว' }].map(opt => (
                    <div key={opt.v} onClick={() => setSummaryTarget(opt.v as any)}
                      style={{ padding: '12px 14px', border: `1px solid ${summaryTarget === opt.v ? 'var(--vk-jade)' : 'var(--vk-rule)'}`, background: summaryTarget === opt.v ? 'var(--vk-jade)' : 'var(--vk-paper)', cursor: 'pointer', transition: 'all 0.12s' }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: summaryTarget === opt.v ? '#fff' : 'var(--vk-ink)' }}>{opt.label}</div>
                      <div style={{ fontSize: 11, color: summaryTarget === opt.v ? 'rgba(255,255,255,0.75)' : 'var(--vk-ink-3)', marginTop: 3 }}>{opt.sub}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* All employees mode */}
              {summaryTarget === 'all' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Mode sub-toggle */}
                  <div style={{ display: 'flex', border: '1px solid var(--vk-rule)', overflow: 'hidden', width: 'fit-content' }}>
                    {[{ v:'month', l:'รายเดือน' },{ v:'period', l:'รายงวด' }].map((t,i) => (
                      <button key={t.v} onClick={() => setSummaryMode(t.v as any)}
                        style={{ padding: '5px 16px', fontSize: 12, fontFamily: 'var(--vk-sans)', fontWeight: summaryMode===t.v?700:400, border:'none', borderRight: i===0?'1px solid var(--vk-rule)':'none', cursor:'pointer', background: summaryMode===t.v?'var(--vk-jade)':'var(--vk-paper)', color: summaryMode===t.v?'#fff':'var(--vk-ink-3)' }}>
                        {t.l}
                      </button>
                    ))}
                  </div>
                  {summaryMode === 'month' ? (
                    <select value={summaryMonth} onChange={e => setSummaryMonth(e.target.value)}
                      style={{ height: 36, fontFamily: 'var(--vk-sans)', fontSize: 13, border: '1px solid var(--vk-rule)', padding: '0 12px', background: 'var(--vk-paper)', color: 'var(--vk-ink)', outline: 'none' }}>
                      {uniqueMonths.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  ) : (
                    <select value={summaryPeriodId} onChange={e => setSummaryPeriodId(e.target.value)}
                      style={{ height: 36, fontFamily: 'var(--vk-sans)', fontSize: 13, border: '1px solid var(--vk-rule)', padding: '0 12px', background: 'var(--vk-paper)', color: 'var(--vk-ink)', outline: 'none' }}>
                      {periods.map(p => <option key={p.id} value={p.id}>{formatPeriodLabel(p.period_start, p.period_end)}{p.status==='approved'?' ✓':' (ร่าง)'}</option>)}
                    </select>
                  )}
                </div>
              )}

              {/* Individual employee mode */}
              {summaryTarget === 'individual' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Employee picker */}
                  <div>
                    <div className="vk-eyebrow" style={{ marginBottom: 8 }}>1. เลือกพนักงาน</div>
                    <div style={{ position: 'relative', marginBottom: 6 }}>
                      <Search style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, color: 'var(--vk-ink-3)' }} />
                      <input value={summaryEmpSearch} onChange={e => setSummaryEmpSearch(e.target.value)} placeholder="ค้นหาชื่อ / รหัส..."
                        style={{ width: '100%', paddingLeft: 28, paddingRight: 8, height: 32, fontSize: 12, fontFamily: 'var(--vk-sans)', border: '1px solid var(--vk-rule)', background: 'var(--vk-paper)', outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ border: '1px solid var(--vk-rule)', maxHeight: 160, overflowY: 'auto', background: 'var(--vk-paper)' }}>
                      {summaryFilteredEmps.length === 0
                        ? <div style={{ padding: '12px', fontSize: 12, color: 'var(--vk-ink-3)', textAlign: 'center' }}>ไม่พบพนักงาน</div>
                        : summaryFilteredEmps.map(emp => (
                          <div key={emp.id} onClick={() => setSummaryEmpId(emp.id)}
                            style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', borderBottom: '1px solid var(--vk-rule-soft)', background: summaryEmpId === emp.id ? 'var(--vk-jade)' : 'transparent', transition: 'background 0.1s' }}>
                            <div>
                              <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 11, color: summaryEmpId===emp.id?'rgba(255,255,255,0.75)':'var(--vk-ink-3)', marginRight: 8 }}>{emp.employee_code}</span>
                              <span style={{ fontSize: 13, fontWeight: 600, color: summaryEmpId===emp.id?'#fff':'var(--vk-ink)' }}>{emp.first_name} {emp.last_name}</span>
                            </div>
                            {summaryEmpId === emp.id && <Check style={{ width: 13, height: 13, color: '#fff' }} />}
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
                          <button key={n} onClick={() => setSummaryMonths(uniqueMonths.slice(0,n))}
                            style={{ fontSize: 11, padding: '2px 8px', border: '1px solid var(--vk-rule)', background: 'var(--vk-paper)', cursor: 'pointer', fontFamily: 'var(--vk-sans)', color: 'var(--vk-ink-2)' }}>
                            {n} เดือนล่าสุด
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 6 }}>
                      {uniqueMonths.map(m => {
                        const sel = summaryMonths.includes(m)
                        return (
                          <div key={m} onClick={() => setSummaryMonths(prev => sel ? prev.filter(x=>x!==m) : [...prev,m])}
                            style={{ padding: '7px 10px', border: `1px solid ${sel?'var(--vk-jade)':'var(--vk-rule)'}`, background: sel?'var(--vk-jade)':'var(--vk-paper)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, transition: 'all 0.1s' }}>
                            <div style={{ width: 14, height: 14, border: `1px solid ${sel?'rgba(255,255,255,0.5)':'var(--vk-rule)'}`, background: sel?'rgba(255,255,255,0.2)':'transparent', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                              {sel && <Check style={{ width: 10, height: 10, color: '#fff' }} />}
                            </div>
                            <span style={{ fontSize: 12, fontFamily: 'var(--vk-sans)', fontWeight: sel?700:400, color: sel?'#fff':'var(--vk-ink)' }}>{m}</span>
                          </div>
                        )
                      })}
                    </div>
                    {summaryMonths.length > 0 && <div style={{ fontSize: 11, color: 'var(--vk-jade)', marginTop: 6 }}>เลือกแล้ว {summaryMonths.length} เดือน</div>}
                  </div>
                </div>
              )}
              </>
              )}
            </div>

            {/* Modal footer with 2 download buttons */}
            <div style={{ padding: '14px 24px', borderTop: '1px solid var(--vk-rule)', background: 'var(--vk-paper)', display: 'flex', gap: 8, flexShrink: 0 }}>
              <button className="vk-btn" onClick={() => handleGenerateSummaryExport('pdf')} disabled={isGeneratingSummary}
                style={{ flex: 1, borderColor: 'var(--vk-crimson)', color: 'var(--vk-crimson)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                {isGeneratingSummary ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> : <Printer style={{ width: 13, height: 13 }} />}
                ดาวน์โหลด PDF
              </button>
              <button className="vk-btn" onClick={() => handleGenerateSummaryExport('excel')} disabled={isGeneratingSummary}
                style={{ flex: 1, borderColor: 'var(--vk-jade)', color: 'var(--vk-jade)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                {isGeneratingSummary ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> : <FileSpreadsheet style={{ width: 13, height: 13 }} />}
                ดาวน์โหลด Excel
              </button>
              <button className="vk-btn" onClick={() => setShowSummaryModal(false)}>ยกเลิก</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
