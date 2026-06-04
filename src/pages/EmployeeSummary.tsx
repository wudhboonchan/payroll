import React from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { useState, useEffect, useMemo } from 'react'
import { Search, X, CreditCard } from 'lucide-react'
import { format } from 'date-fns'
import { th } from 'date-fns/locale'
import { calculatePayroll } from '../lib/payrollCalc'
import '../styles/tokens.css'

// ── helpers ──────────────────────────────────────────────────────────────────
function fmtNationality(n: string | null) {
  if (!n || n === 'ไทย') return null
  if (n === 'เมียนมา' || n.toLowerCase().includes('myanmar') || n.toLowerCase().includes('burma')) return 'เมียนมา/กะเหรี่ยง'
  return n
}

function maskBank(account: string | null) {
  if (!account) return '—'
  const s = account.replace(/[-\s]/g, '')
  if (s.length <= 6) return s
  return `${s.slice(0, 3)}-${'X'.repeat(s.length - 6)}-${s.slice(-3)}`
}

const MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']

function fmtDisplayDate(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return `วัน${DAYS[date.getDay()]}ที่ ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`
}

function getDatesInRange(startStr: string, endStr: string) {
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

const POSITIONS: Record<string, string> = {
  worker: 'พนักงานทั่วไป',
  clerk: 'เสมียน',
  foreman: 'โฟร์แมน',
  office: 'พนักงานออฟฟิศ',
  manager: 'ผู้จัดการ',
}

const monoNum = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function chipStyle(color: string, bg: string): React.CSSProperties {
  return { fontSize: 10, fontWeight: 700, padding: '2px 6px', color, background: bg, whiteSpace: 'nowrap' as const }
}

export default function EmployeeSummary() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user } = useAppStore()
  const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null)
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)
  const [empSearch, setEmpSearch] = useState('')
  const [onlyWorkedFilter, setOnlyWorkedFilter] = useState(false)

  // ── 1. Fetch periods ──
  const { data: periods = [] } = useQuery<any[]>({
    queryKey: ['periods', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_periods').select('*')
        .eq('factory_id', user?.factory_id ?? '').order('period_start', { ascending: false })
      if (error) throw error
      return data
    },
    enabled: !!user?.factory_id,
  })

  // Set default period once loaded
  useEffect(() => {
    if (periods.length > 0 && !selectedPeriodId) {
      setSelectedPeriodId(periods[0].id)
    }
  }, [periods, selectedPeriodId])

  const currentPeriod = periods.find(p => p.id === selectedPeriodId) || periods[0]

  // ── 2. Fetch employees ──
  const { data: employees = [] } = useQuery<any[]>({
    queryKey: ['employees-summary', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees')
        .select('id,employee_code,first_name,last_name,nationality,position,job_title,wage_type,rate_per_12h,payment_method,bank_name,bank_account,exempt_social_security')
        .eq('factory_id', user?.factory_id ?? '').eq('status', 'active').order('employee_code')
      if (error) throw error
      return data
    },
    enabled: !!user?.factory_id,
  })

  // ── 3. Fetch shifts for the selected period ──
  const { data: allShifts = [] } = useQuery<any[]>({
    queryKey: ['summary-all-shifts', selectedPeriodId],
    queryFn: async () => {
      if (!selectedPeriodId) return []
      const PAGE = 1000
      let all: any[] = []
      let from = 0
      while (true) {
        const { data, error } = await supabase.from('shift_assignments' as any)
          .select('employee_id,work_date,shift_type,is_holiday_ot,is_holiday_ot_exempt,is_half_shift,actual_hours,ot_hours,wood_excess,film_amount,is_cross_position,cross_position_title,cross_position_extra_pay')
          .eq('period_id', selectedPeriodId)
          .range(from, from + PAGE - 1)
        if (error) throw error
        all = all.concat(data ?? [])
        if (!data || data.length < PAGE) break
        from += PAGE
      }
      return all
    },
    enabled: !!selectedPeriodId,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  })

  // ── 4. Fetch payroll entries for the selected period ──
  const { data: allEntries = [] } = useQuery<any[]>({
    queryKey: ['summary-all-entries', selectedPeriodId],
    queryFn: async () => {
      if (!selectedPeriodId) return []
      const { data, error } = await supabase.from('payroll_entries' as any)
        .select('*')
        .eq('period_id', selectedPeriodId)
      if (error) throw error
      return data
    },
    enabled: !!selectedPeriodId,
  })

  // ── 5. Fetch advance payments for the selected period ──
  const { data: allAdvances = [] } = useQuery<any[]>({
    queryKey: ['summary-all-advances', selectedPeriodId],
    queryFn: async () => {
      if (!selectedPeriodId) return []
      const { data, error } = await supabase.from('advance_payments')
        .select('employee_id,amount,request_date,notes')
        .eq('period_id', selectedPeriodId)
      if (error) throw error
      return data
    },
    enabled: !!selectedPeriodId,
  })

  // Selected employee data resolution
  const selectedEmp = employees.find(e => e.id === selectedEmpId) ?? null
  const empShifts = useMemo(() => allShifts.filter(s => s.employee_id === selectedEmpId), [allShifts, selectedEmpId])
  const empEntry = useMemo(() => allEntries.find(e => e.employee_id === selectedEmpId) ?? null, [allEntries, selectedEmpId])
  const empAdvances = useMemo(() => allAdvances.filter(a => a.employee_id === selectedEmpId), [allAdvances, selectedEmpId])

  // Quick active helper for employee list dot color
  const activeIdsThisPeriod = useMemo(() => new Set(allShifts.map(s => s.employee_id)), [allShifts])

  // Daily Wage Calculation helper mirroring payrollCalc.ts
  const isWeekendDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.getDay() === 0 || d.getDay() === 6
  }

  const dailyEstimates = useMemo(() => {
    if (!selectedEmp || !currentPeriod) return []
    const dates = getDatesInRange(currentPeriod.period_start, currentPeriod.period_end)
    const isClerk = selectedEmp.position === 'clerk'
    const rate = Number(selectedEmp.rate_per_12h) || 0
    const baseNormal = rate === 0 ? 0 : 357
    const baseShift = Math.max(0, rate - baseNormal)
    const clerkDaily = rate / 30
    const clerkHourly = clerkDaily / 8

    // Clerk base: monthly/30 × period_days, distributed evenly across worked weekdays
    const periodDays = dates.length
    const clerkWeekdaysWorked = isClerk
      ? empShifts.filter(s => !isWeekendDate(s.work_date)).length
      : 0
    const clerkPeriodBase = isClerk ? clerkDaily * periodDays : 0
    const clerkBasePerDay = clerkWeekdaysWorked > 0 ? clerkPeriodBase / clerkWeekdaysWorked : 0

    return dates.map(dateStr => {
      const shift = empShifts.find(s => s.work_date === dateStr)
      const weekend = isWeekendDate(dateStr)
      const isHoliday = shift?.is_holiday_ot ?? false
      const holidayExempt = shift?.is_holiday_ot_exempt ?? false

      let dayType: 'normal' | 'weekend' | 'holiday' = 'normal'
      if (isHoliday && !holidayExempt) dayType = 'holiday'
      else if (weekend) dayType = 'weekend'

      if (!shift) {
        return {
          workDate: dateStr,
          dayType,
          isWorked: false,
          shiftType: null,
          hours: 0,
          baseWage: 0,
          shiftAllowance: 0,
          otPay: 0,
          woodExcess: 0,
          filmAmount: 0,
          crossPay: 0,
          crossTitle: '',
          totalEarned: 0,
        }
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
          baseWage = clerkBasePerDay
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
          if (partial > 0) {
            baseWage = Math.round((baseNormal / 8) * partial * 2)
          } else if (isHalf) {
            baseWage = baseNormal * 2
          } else {
            baseWage = effectiveDailyRate * 2
          }
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

      return {
        workDate: dateStr,
        dayType,
        isWorked: true,
        shiftType: shift.shift_type,
        hours,
        baseWage,
        shiftAllowance,
        otPay,
        woodExcess,
        filmAmount,
        crossPay,
        crossTitle,
        totalEarned,
      }
    })
  }, [selectedEmp, currentPeriod, empShifts])

  // Summarize daily estimates for UI stats
  const stats = useMemo(() => {
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

    // Period-wide bonuses from payroll entry
    const entryDiligence = Number(empEntry?.amount_diligence || 0)
    const entryPosition = Number(empEntry?.amount_position || 0)
    const entrySpecial = Number(empEntry?.amount_special || 0) + Number(empEntry?.override_special || 0)

    const grossEarnings = estBaseWages + estShiftAllowances + estOtPay + estWood + estFilm + estCross + entryDiligence + entryPosition + entrySpecial

    // Deductions
    const entrySS = Number(empEntry?.deduct_social_security || 0)
    const totalAdvances = empAdvances.reduce((s, a) => s + Number(a.amount || 0), 0)
    const entrySafety = Number(empEntry?.deduct_safety_equipment || 0)
    const entryUniform = Number(empEntry?.deduct_uniform || 0)

    const totalDeductions = entrySS + totalAdvances + entrySafety + entryUniform
    const netEarnings = grossEarnings - totalDeductions

    const totalSpecialAllowances = estWood + estFilm + estCross + entryDiligence + entryPosition + entrySpecial

    return {
      totalDaysWorked,
      morningShifts,
      afternoonShifts,
      estBaseWages,
      estShiftAllowances,
      estOtPay,
      estWood,
      estFilm,
      estCross,
      entryDiligence,
      entryPosition,
      entrySpecial,
      grossEarnings,
      entrySS,
      totalAdvances,
      entrySafety,
      entryUniform,
      totalDeductions,
      netEarnings,
      totalSpecialAllowances,
    }
  }, [dailyEstimates, empEntry, empAdvances])

  // Collect itemized list of special allowances and extra pay chronologically
  const itemizedSpecialIncomes = useMemo(() => {
    const list: { date: string; type: string; detail: string; amount: number }[] = []

    dailyEstimates.forEach(day => {
      if (!day.isWorked) return

      if (day.woodExcess > 0) {
        list.push({
          date: day.workDate,
          type: 'ค่าไม้ส่วนเกิน',
          detail: 'สะสมจากกะรายวัน',
          amount: day.woodExcess,
        })
      }
      if (day.filmAmount > 0) {
        list.push({
          date: day.workDate,
          type: 'ค่าฟิล์ม',
          detail: 'สะสมจากกะรายวัน',
          amount: day.filmAmount,
        })
      }
      if (day.crossPay > 0) {
        list.push({
          date: day.workDate,
          type: 'ค่าสลับตำแหน่ง (Job Rotation)',
          detail: `สลับหน้าที่: ${day.crossTitle || 'ไม่ได้ระบุ'}`,
          amount: day.crossPay,
        })
      }
      if (day.otPay > 0) {
        const rateLabel = day.dayType === 'holiday' ? 'OT วันหยุด x2' : day.dayType === 'weekend' ? 'OT วันเสาร์-อาทิตย์ x1' : 'OT วันธรรมดา x1.5'
        list.push({
          date: day.workDate,
          type: 'ค่าล่วงเวลา (OT)',
          detail: `${rateLabel} (${day.hours - 8} ชม.)`,
          amount: day.otPay,
        })
      }
    })

    return list.sort((a, b) => a.date.localeCompare(b.date))
  }, [dailyEstimates])

  // Filtered employees for left pane search
  const filteredEmployees = useMemo(() => {
    const term = empSearch.trim().toLowerCase()
    if (!term) return employees
    return employees.filter(emp => {
      const code = emp.employee_code.toLowerCase()
      const fullName = `${emp.first_name} ${emp.last_name}`.toLowerCase()
      const nat = (emp.nationality || '').toLowerCase()
      return code.includes(term) || fullName.includes(term) || nat.includes(term)
    })
  }, [employees, empSearch])

  // Period label formatter helper
  const thaiPeriodLabel = (start: string, end: string) => {
    if (!start || !end) return '—'
    const s = new Date(start)
    const e = new Date(end)
    return `${s.getDate()} ${MONTHS_SHORT[s.getMonth()]} – ${e.getDate()} ${MONTHS_SHORT[e.getMonth()]} ${e.getFullYear() + 543}`
  }

  return (
    <>
      <TopBar title="สรุปภาพรวมพนักงาน" subtitle={currentPeriod ? currentPeriod.label : 'กำลังโหลด...'} onMenuClick={onMenuClick} />

      <div className="vk-split">
        {/* ── Left Panel (Employee Pool) ── */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}
          className={`vk-sidebar-scrollable vk-sidebar-scrollable-payroll ${selectedEmpId ? 'hidden md:block' : ''}`}>

          {/* Sticky header + search — does not scroll */}
          <div style={{ flexShrink: 0, padding: '16px 12px 0' }}>
            <div className="vk-eyebrow" style={{ marginBottom: 8 }}>พนักงาน ({employees.length})</div>
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <Search style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', width: 12, height: 12, color: 'var(--vk-ink-3)', pointerEvents: 'none' }} />
              <input
                value={empSearch}
                onChange={e => setEmpSearch(e.target.value)}
                placeholder="ค้นหาชื่อหรือรหัส..."
                style={{ width: '100%', height: 32, paddingLeft: 26, paddingRight: empSearch ? 26 : 8, fontSize: 12, fontFamily: 'var(--vk-sans)', border: '1px solid var(--vk-rule)', background: 'var(--vk-bone)', color: 'var(--vk-ink)', outline: 'none', boxSizing: 'border-box' }}
              />
              {empSearch && (
                <button onClick={() => setEmpSearch('')} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--vk-ink-3)', display: 'flex' }}>
                  <X style={{ width: 11, height: 11 }} />
                </button>
              )}
            </div>
            <hr className="vk-rule-soft" style={{ margin: 0 }} />
          </div>

          {/* Scrollable list only */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px 16px', marginRight: 1, scrollbarGutter: 'stable' } as React.CSSProperties}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {filteredEmployees.map(emp => {
              const active = emp.id === selectedEmpId
              const hasShifts = activeIdsThisPeriod.has(emp.id)
              const natLabel = fmtNationality(emp.nationality)
              return (
                <div key={emp.id} onClick={() => setSelectedEmpId(emp.id)}
                  className="vk-employee-card"
                  data-selected={active}>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                    <span style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: hasShifts ? 'var(--vk-jade)' : '#d4cfc9'
                    }} title={hasShifts ? 'มีกะการทำงานในงวดนี้' : 'ไม่มีกะการทำงานในงวดนี้'} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--vk-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {emp.first_name} {emp.last_name}{natLabel ? ` (${natLabel})` : ''}
                        </span>
                        {emp.position === 'clerk' && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: 'rgba(177,71,41,0.12)', color: 'var(--vk-persimmon)', letterSpacing: '0.04em', flexShrink: 0 }}>เสมียน</span>
                        )}
                      </div>
                      <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 10, color: 'var(--vk-ink-3)', marginTop: 1 }}>{emp.employee_code}</div>
                    </div>
                  </div>
                </div>
              )
            })}
            {filteredEmployees.length === 0 && (
              <div className="vk-small" style={{ color: 'var(--vk-ink-3)', textAlign: 'center', padding: '16px 0' }}>ไม่พบพนักงานที่ตรงเงื่อนไข</div>
            )}
          </div>
          </div>
        </div>

        {/* ── Right Panel (Ledger) ── */}
        <div style={{ overflowY: 'auto', background: 'var(--vk-bone)', padding: '20px 24px 48px' }}>
          {selectedEmp && (
            <button className="vk-btn md:hidden" style={{ marginBottom: 20, fontSize: 12, padding: '5px 12px' }}
              onClick={() => setSelectedEmpId(null)}>← กลับ</button>
          )}

          {!selectedEmp ? (
            <div style={{ paddingTop: 80, textAlign: 'center' }}>
              <div className="vk-eyebrow" style={{ marginBottom: 8 }}>เลือกพนักงานจากรายการทางซ้าย</div>
              <div className="vk-small" style={{ color: 'var(--vk-ink-3)' }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--vk-jade)', marginRight: 6 }} />
                จุดสีเขียวหมายถึงพนักงานที่มีบันทึกการเข้ากะในงวดที่เลือก
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>

              {/* ── A. Header strip ── */}
              <div style={{ padding: '16px 32px 12px', background: 'var(--vk-paper)', border: '1px solid var(--vk-ink)', borderBottom: '2px solid var(--vk-ink)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div className="vk-eyebrow" style={{ marginBottom: 3 }}>EMPLOYEE LEDGER · บัญชีรายการพนักงาน</div>
                  <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 800, fontSize: 20, letterSpacing: '-0.02em', color: 'var(--vk-ink)', lineHeight: 1.2 }}>
                    {selectedEmp.first_name} {selectedEmp.last_name}
                    {fmtNationality(selectedEmp.nationality) && (
                      <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--vk-ink-3)', marginLeft: 8 }}>({fmtNationality(selectedEmp.nationality)})</span>
                    )}
                  </div>
                  <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 11, color: 'var(--vk-ink-3)', fontWeight: 600 }}>{selectedEmp.employee_code}</span>
                    <span style={{ color: 'var(--vk-rule)', fontSize: 11 }}>·</span>
                    <span style={{ fontSize: 12, color: 'var(--vk-ink-3)' }}>{POSITIONS[selectedEmp.position] || selectedEmp.position}{selectedEmp.job_title ? ` · ${selectedEmp.job_title}` : ''}</span>
                    <span style={{ color: 'var(--vk-rule)', fontSize: 11 }}>·</span>
                    <span style={{ fontSize: 12, color: 'var(--vk-persimmon)', fontFamily: 'var(--vk-mono)' }}>฿{(Number(selectedEmp.rate_per_12h)||0).toLocaleString()}/{selectedEmp.wage_type === 'monthly' ? 'เดือน' : '12ชม.'}</span>
                    {selectedEmp.payment_method === 'bank_transfer' && selectedEmp.bank_name && (
                      <>
                        <span style={{ color: 'var(--vk-rule)', fontSize: 11 }}>·</span>
                        <span style={{ fontSize: 11, color: 'var(--vk-ink-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <CreditCard style={{ width: 11, height: 11 }} /> {selectedEmp.bank_name} {maskBank(selectedEmp.bank_account)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
                  <label className="vk-eyebrow" style={{ fontSize: 9 }}>งวดการจ่ายเงิน</label>
                  <select value={selectedPeriodId ?? ''} onChange={e => setSelectedPeriodId(e.target.value)}
                    style={{ height: 32, fontFamily: 'var(--vk-sans)', fontSize: 12, fontWeight: 600, border: '1px solid var(--vk-rule)', padding: '0 20px 0 8px', background: 'var(--vk-bone)', color: 'var(--vk-ink)', cursor: 'pointer', outline: 'none' }}>
                    {periods.map(p => <option key={p.id} value={p.id}>{p.label} {p.status === 'approved' ? '✓' : '(ร่าง)'}</option>)}
                  </select>
                </div>
              </div>

              {/* ── B. Summary bar (4 numbers) ── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', background: 'var(--vk-ink)', flexShrink: 0 }}>
                {[
                  { label: 'วันทำงาน', value: `${stats.totalDaysWorked} วัน`, sub: `เช้า ${stats.morningShifts} · บ่าย ${stats.afternoonShifts}`, light: true },
                  { label: 'รายได้รวม', value: `฿${monoNum(stats.grossEarnings)}`, sub: 'ก่อนหัก', light: true },
                  { label: 'หักรวม',    value: `฿${monoNum(stats.totalDeductions)}`, sub: 'ประกัน + เบิกล่วงหน้า + อื่นๆ', light: true, red: true },
                  { label: 'สุทธิรับจริง', value: `฿${monoNum(stats.netEarnings)}`, sub: stats.netEarnings < 0 ? 'ยอดติดลบ ยกไปงวดหน้า' : 'โอนเข้าบัญชี / จ่ายสด', light: true, highlight: true },
                ].map((s, i) => (
                  <div key={i} style={{ padding: '12px 16px', borderRight: i < 3 ? '1px solid rgba(255,255,255,0.08)' : undefined }}>
                    <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.45)', marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontFamily: 'var(--vk-mono)', fontWeight: 700, fontSize: 15, color: s.highlight ? '#f4a35a' : s.red ? '#f07070' : '#fff', letterSpacing: '-0.01em', lineHeight: 1.1 }}>{s.value}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>{s.sub}</div>
                  </div>
                ))}
              </div>

              {/* ── C. Daily Timeline ── */}
              <div style={{ padding: '0 0 4px' }}>
                {/* Section header + filter toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 32px 8px', borderBottom: '1px solid var(--vk-rule)' }}>
                  <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--vk-ink-3)' }}>
                    บันทึกรายวัน — {currentPeriod?.label}
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--vk-ink-3)', cursor: 'pointer', userSelect: 'none' }}>
                    <input type="checkbox" checked={onlyWorkedFilter} onChange={e => setOnlyWorkedFilter(e.target.checked)} style={{ accentColor: 'var(--vk-persimmon)', width: 12, height: 12 }} />
                    เฉพาะวันทำงาน
                  </label>
                </div>

                {/* Table header */}
                <div style={{ display: 'grid', gridTemplateColumns: '130px 90px 1fr 90px', padding: '7px 32px', background: 'var(--vk-paper)', borderBottom: '1px solid var(--vk-rule)', gap: 8 }}>
                  {['วันที่', 'กะ / ชั่วโมง', 'รายการ', 'รวม'].map((h, i) => (
                    <div key={i} style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--vk-ink-3)', textAlign: i === 3 ? 'right' : 'left' }}>{h}</div>
                  ))}
                </div>

                {/* Daily rows */}
                {dailyEstimates
                  .filter(day => !onlyWorkedFilter || day.isWorked)
                  .map((day, idx) => {
                    const isHoliday = day.dayType === 'holiday'
                    const isWeekend = day.dayType === 'weekend'
                    const accentColor = isHoliday ? 'var(--vk-persimmon)' : isWeekend ? '#7c3aed' : 'var(--vk-rule)'

                    return (
                      <div key={idx} style={{
                        display: 'grid', gridTemplateColumns: '130px 90px 1fr 90px', gap: 8,
                        padding: '9px 32px',
                        borderBottom: '1px solid var(--vk-rule-soft)',
                        background: day.isWorked ? 'var(--vk-paper)' : 'transparent',
                        borderLeft: `3px solid ${accentColor}`,
                        opacity: day.isWorked ? 1 : 0.45,
                        alignItems: 'center',
                      }}>
                        {/* Date */}
                        <div>
                          <div style={{ fontSize: 12, fontWeight: day.isWorked ? 700 : 400, color: isHoliday ? 'var(--vk-persimmon)' : isWeekend ? '#7c3aed' : 'var(--vk-ink)', lineHeight: 1.2 }}>
                            {fmtDisplayDate(day.workDate)}
                          </div>
                          {(isHoliday || isWeekend) && (
                            <div style={{ fontSize: 9, color: isHoliday ? 'var(--vk-persimmon)' : '#7c3aed', marginTop: 1, fontWeight: 600 }}>
                              {isHoliday ? 'วันหยุดนักขัตฤกษ์' : 'วันหยุดสัปดาห์'}
                            </div>
                          )}
                        </div>

                        {/* Shift */}
                        <div>
                          {day.isWorked ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', background: day.shiftType === 'morning' ? 'rgba(216,154,42,0.15)' : 'rgba(74,110,138,0.15)', color: day.shiftType === 'morning' ? '#a16207' : '#1e6091', display: 'inline-block' }}>
                                {day.shiftType === 'morning' ? 'เช้า' : day.shiftType === 'afternoon' ? 'บ่าย' : 'เข้า'}
                              </span>
                              <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 10, color: 'var(--vk-ink-3)' }}>{day.hours} ชม.</span>
                            </div>
                          ) : (
                            <span style={{ fontSize: 11, color: 'var(--vk-ink-3)', fontStyle: 'italic' }}>หยุด</span>
                          )}
                        </div>

                        {/* Income chips */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                          {day.isWorked ? (
                            <>
                              {day.baseWage > 0 && <span style={chipStyle('#374151', '#f3f4f6')}>ค่าจ้าง ฿{monoNum(day.baseWage)}</span>}
                              {day.shiftAllowance > 0 && <span style={chipStyle('#065f46', '#d1fae5')}>ค่ากะ +฿{monoNum(day.shiftAllowance)}</span>}
                              {day.otPay > 0 && <span style={chipStyle('#4c1d95', '#ede9fe')}>OT +฿{monoNum(day.otPay)}</span>}
                              {day.woodExcess > 0 && <span style={chipStyle('#92400e', '#fef3c7')}>ไม้ส่วนเกิน +฿{monoNum(day.woodExcess)}</span>}
                              {day.filmAmount > 0 && <span style={chipStyle('#92400e', '#fef3c7')}>ฟิล์ม +฿{monoNum(day.filmAmount)}</span>}
                              {day.crossPay > 0 && <span style={chipStyle('#065f46', '#d1fae5')} title={day.crossTitle}>สลับตำแหน่ง ({day.crossTitle}) +฿{monoNum(day.crossPay)}</span>}
                            </>
                          ) : (
                            <span style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>—</span>
                          )}
                        </div>

                        {/* Day total */}
                        <div style={{ textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 13, fontWeight: 700, color: day.totalEarned > 0 ? 'var(--vk-jade)' : 'var(--vk-ink-3)' }}>
                          {day.totalEarned > 0 ? `฿${day.totalEarned.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                        </div>
                      </div>
                    )
                  })}
              </div>

              {/* ── D. Period-level income (bonuses etc.) ── */}
              {(stats.entryDiligence > 0 || stats.entryPosition > 0 || stats.entrySpecial > 0) && (
                <div style={{ borderTop: '2px solid var(--vk-rule)', background: 'var(--vk-paper)' }}>
                  <div style={{ padding: '10px 32px 7px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--vk-jade)' }}>รายได้เพิ่มเติมประจำงวด</div>
                  </div>
                  {[
                    { label: 'เบี้ยขยัน', val: stats.entryDiligence, note: '' },
                    { label: 'ค่าตำแหน่งงาน', val: stats.entryPosition, note: '' },
                    { label: 'เงินพิเศษ / ปรับปรุง', val: stats.entrySpecial, note: empEntry?.special_note || '' },
                  ].filter(x => x.val > 0).map((item, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '130px 90px 1fr 90px', gap: 8, padding: '8px 32px', borderTop: '1px solid var(--vk-rule-soft)', alignItems: 'center', borderLeft: '3px solid var(--vk-jade)' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--vk-ink)', gridColumn: '1 / 3' }}>{item.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--vk-ink-3)', fontStyle: item.note ? 'normal' : 'italic' }}>{item.note || 'บันทึกในงวดนี้'}</div>
                      <div style={{ textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 13, fontWeight: 700, color: 'var(--vk-jade)' }}>+฿{monoNum(item.val)}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── E. Deductions ── */}
              <div style={{ borderTop: '2px solid var(--vk-rule)', background: 'var(--vk-paper)' }}>
                <div style={{ padding: '10px 32px 7px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--vk-crimson)' }}>รายการหักเงิน</div>
                </div>

                {/* Social security */}
                {stats.entrySS > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '130px 90px 1fr 90px', gap: 8, padding: '8px 32px', borderTop: '1px solid var(--vk-rule-soft)', alignItems: 'center', borderLeft: '3px solid var(--vk-crimson)' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--vk-ink)', gridColumn: '1 / 3' }}>ประกันสังคม</div>
                    <div style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>หัก ณ ที่จ่าย{selectedEmp.exempt_social_security ? ' (ยกเว้น)' : ''}</div>
                    <div style={{ textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 13, fontWeight: 700, color: 'var(--vk-crimson)' }}>−฿{monoNum(stats.entrySS)}</div>
                  </div>
                )}

                {/* Advances — expanded per item */}
                {empAdvances.length > 0 && (
                  <>
                    <div style={{ padding: '7px 32px 4px', borderTop: '1px solid var(--vk-rule-soft)', background: '#fff8f6', borderLeft: '3px solid var(--vk-crimson)' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--vk-crimson)', opacity: 0.7 }}>
                        เบิกล่วงหน้า — {empAdvances.length} รายการ
                      </div>
                    </div>
                    {empAdvances.map((adv, i) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '130px 90px 1fr 90px', gap: 8, padding: '7px 32px', borderTop: '1px solid var(--vk-rule-soft)', alignItems: 'center', borderLeft: '3px solid var(--vk-crimson)', background: '#fff8f6' }}>
                        <div style={{ fontSize: 11, color: 'var(--vk-ink-2)', fontFamily: 'var(--vk-mono)' }}>
                          {adv.request_date ? fmtDisplayDate(adv.request_date) : 'รายการ ' + (i + 1)}
                        </div>
                        <div />
                        <div style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>{adv.notes || '—'}</div>
                        <div style={{ textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 13, fontWeight: 700, color: 'var(--vk-crimson)' }}>−฿{monoNum(Number(adv.amount))}</div>
                      </div>
                    ))}
                  </>
                )}

                {/* Safety equipment */}
                {stats.entrySafety > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '130px 90px 1fr 90px', gap: 8, padding: '8px 32px', borderTop: '1px solid var(--vk-rule-soft)', alignItems: 'center', borderLeft: '3px solid var(--vk-crimson)' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--vk-ink)', gridColumn: '1 / 3' }}>อุปกรณ์ความปลอดภัย</div>
                    <div style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>หักค่าอุปกรณ์</div>
                    <div style={{ textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 13, fontWeight: 700, color: 'var(--vk-crimson)' }}>−฿{monoNum(stats.entrySafety)}</div>
                  </div>
                )}

                {/* Uniform */}
                {stats.entryUniform > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '130px 90px 1fr 90px', gap: 8, padding: '8px 32px', borderTop: '1px solid var(--vk-rule-soft)', alignItems: 'center', borderLeft: '3px solid var(--vk-crimson)' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--vk-ink)', gridColumn: '1 / 3' }}>ค่าเสื้อพนักงาน</div>
                    <div style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>หักค่าชุดทำงาน</div>
                    <div style={{ textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 13, fontWeight: 700, color: 'var(--vk-crimson)' }}>−฿{monoNum(stats.entryUniform)}</div>
                  </div>
                )}

                {stats.totalDeductions === 0 && (
                  <div style={{ padding: '12px 32px', fontSize: 12, color: 'var(--vk-ink-3)', borderTop: '1px solid var(--vk-rule-soft)' }}>ไม่มีรายการหักเงินในงวดนี้</div>
                )}
              </div>

              {/* ── F. NET PAY footer ── */}
              <div style={{ borderTop: '2px solid var(--vk-ink)', padding: '16px 20px', background: 'var(--vk-ink)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.45)' }}>NET PAY · เงินได้สุทธิ</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                    {stats.netEarnings < 0 ? 'ยอดติดลบ — ยกไปหักในงวดถัดไป จ่ายจริง ฿0' : `${stats.totalDaysWorked} วันทำงาน · หัก ฿${monoNum(stats.totalDeductions)}`}
                  </div>
                </div>
                <div style={{ fontFamily: 'var(--vk-mono)', fontWeight: 800, fontSize: 28, letterSpacing: '-0.025em', color: stats.netEarnings < 0 ? '#f07070' : '#f4a35a', fontVariantNumeric: 'tabular-nums' }}>
                  {stats.netEarnings < 0 ? `−฿${monoNum(Math.abs(stats.netEarnings))}` : `฿${monoNum(stats.netEarnings)}`}
                </div>
              </div>

            </div>
          )}
        </div>
      </div>
    </>
  )
}
