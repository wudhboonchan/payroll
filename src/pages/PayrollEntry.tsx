import { DeductionProductPicker } from '../components/payroll/DeductionProductPicker'
import React from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { useState, useMemo, useEffect } from 'react'
import { toast } from 'sonner'
import { Save, CheckCircle2, AlertCircle, Search, X, AlertTriangle } from 'lucide-react'
import { calculatePayroll } from '../lib/payrollCalc'
import type { PayrollCalculationInput } from '../lib/payrollCalc'
import { compareEmployeeCode, formatThaiDateDDMMYYYY } from '../lib/formatters'
import '../styles/tokens.css'

interface Employee {
  id: string; employee_code: string; first_name: string; last_name: string
  prefix: string | null; nationality: string | null; position: string
  job_title: string | null; wage_type: string; rate_per_12h: number
  exempt_social_security: boolean
}

interface Shift {
  employee_id: string; shift_type: string; is_holiday_ot: boolean
  is_holiday_ot_exempt: boolean; is_half_shift: boolean
  wood_excess: number; film_amount: number; ot_hours: number
  actual_hours: number; work_date: string
  is_cross_position: boolean; cross_position_title: string | null; cross_position_extra_pay: number
}

interface PayrollRow {
  employee_id: string; amount_normal: number; amount_shift: number; amount_ot: number
  amount_wood_excess: number; amount_film: number; amount_special: number
  override_special: number | null; special_note: string | null
  amount_diligence: number; amount_position: number
  deduct_social_security: number; deduct_safety_equipment: number
  deduct_uniform: number; deduct_advance: number
  override_normal: number | null; override_reason: string | null
}

function isWeekendDate(s: string) { const d = new Date(s); return d.getDay() === 0 || d.getDay() === 6 }
function getPeriodDays(start: string, end: string): number {
  const s = new Date(start + 'T00:00:00'), e = new Date(end + 'T00:00:00')
  return Math.round((e.getTime() - s.getTime()) / 86400000) + 1
}
function fmtNationality(nationality: string | null) {
  if (!nationality || nationality === 'ไทย') return null
  if (nationality === 'เมียนมา' || nationality.toLowerCase().includes('myanmar') || nationality.toLowerCase().includes('burma')) return 'เมียนมา'
  return nationality
}

export default function PayrollEntry() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user } = useAppStore()
  const queryClient = useQueryClient()
  const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null)
  const [empSearch, setEmpSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'saved' | 'outdated' | 'unsaved' | null>(null)

  // ── data queries ──
  const { data: periods = [] } = useQuery<any[]>({
    queryKey: ['periods', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_periods').select('*').eq('factory_id', user?.factory_id ?? '').order('period_start', { ascending: false })
      if (error) throw error; return data
    }, enabled: !!user?.factory_id,
  })
  const currentPeriod = periods[0]

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ['employees-payroll', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees')
        .select('id,employee_code,first_name,last_name,prefix,nationality,position,job_title,wage_type,rate_per_12h,exempt_social_security')
        .eq('factory_id', user?.factory_id ?? '').eq('status','active').order('employee_code')
      if (error) throw error
      return (data || []).sort((a: any, b: any) => compareEmployeeCode(a.employee_code, b.employee_code))
    }, enabled: !!user?.factory_id, staleTime: 0,
  })

  const { data: allShifts = [] } = useQuery<Shift[]>({
    queryKey: ['all-period-shifts', currentPeriod?.id],
    queryFn: async () => {
      const PAGE = 1000
      let all: any[] = []
      let from = 0
      while (true) {
        const { data, error } = await supabase.from('shift_assignments' as any)
          .select('employee_id,shift_type,is_holiday_ot,is_holiday_ot_exempt,is_half_shift,wood_excess,film_amount,ot_hours,actual_hours,work_date,is_cross_position,cross_position_title,cross_position_extra_pay')
          .eq('period_id', currentPeriod.id)
          .range(from, from + PAGE - 1)
        if (error) throw error
        all = all.concat(data ?? [])
        if (!data || data.length < PAGE) break
        from += PAGE
      }
      return all as any
    }, enabled: !!currentPeriod?.id, staleTime: 0,
  })

  const { data: allEntries = [] } = useQuery<PayrollRow[]>({
    queryKey: ['all-payroll-entries', currentPeriod?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_entries' as any)
        .select('employee_id,amount_normal,amount_shift,amount_ot,amount_wood_excess,amount_film,amount_special,override_special,special_note,amount_diligence,amount_position,deduct_social_security,deduct_safety_equipment,deduct_uniform,deduct_advance,override_normal,override_reason')
        .eq('period_id', currentPeriod.id)
        .limit(10000)
      if (error) throw error; return data as any
    }, enabled: !!currentPeriod?.id, staleTime: 0,
  })

  const { data: allAdvances = [] } = useQuery<any[]>({
    queryKey: ['advances', 'all', currentPeriod?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('advance_payments').select('employee_id,amount').eq('period_id', currentPeriod.id)
        .limit(10000)
      if (error) throw error; return data
    }, enabled: !!currentPeriod?.id, staleTime: 30_000,
  })

  // ── selected employee data ──
  const selectedEmp = employees.find(e => e.id === selectedEmpId) ?? null
  const existingEntry = allEntries.find(e => e.employee_id === selectedEmpId) ?? null
  const empShifts = allShifts.filter(s => s.employee_id === selectedEmpId)
  const empAdvances = allAdvances.filter(a => a.employee_id === selectedEmpId)
  const ssRate = currentPeriod?.social_security_rate ?? 0.05
  const isThai = !selectedEmp?.nationality || selectedEmp.nationality === 'ไทย'
  const ssRateForEmp = isThai && !selectedEmp?.exempt_social_security ? ssRate : 0

  // ── local overrides ──
  const [overrideNormal, setOverrideNormal] = useState<number | null>(null)
  const [overrideSpecial, setOverrideSpecial] = useState<number | null>(null)
  const [specialNote, setSpecialNote] = useState('')
  const [extraEntries, setExtraEntries] = useState({ amount_diligence: 0, amount_position: 0, amount_special: 0, deduct_safety_equipment: 0, deduct_uniform: 0 })

  useEffect(() => {
    if (existingEntry) {
      setOverrideNormal(existingEntry.override_normal != null ? Number(existingEntry.override_normal) : null)
      setOverrideSpecial(existingEntry.override_special != null ? Number(existingEntry.override_special) : null)
      setSpecialNote(existingEntry.special_note || '')
      setExtraEntries({
        amount_diligence: Number(existingEntry.amount_diligence || 0),
        amount_position: Number(existingEntry.amount_position || 0),
        amount_special: Number(existingEntry.override_special || 0),
        deduct_safety_equipment: Number(existingEntry.deduct_safety_equipment || 0),
        deduct_uniform: Number(existingEntry.deduct_uniform || 0),
      })
    } else {
      setOverrideNormal(null); setOverrideSpecial(null); setSpecialNote('')
      setExtraEntries({ amount_diligence: 0, amount_position: 0, amount_special: 0, deduct_safety_equipment: 0, deduct_uniform: 0 })
    }
  }, [existingEntry, selectedEmpId])

  // ── calculation ──
  const { calc, totalAdvance, regAdv, scanAdv, discAdv, safetyAdv, regAdvTotal, scanAdvTotal, discAdvTotal, safetyAdvTotal, autoWood, autoFilm, autoSpecial, autoSpecialNote, crossPositions, isClerk, clerkOtHours, clerkOt1xHours, clerkOtDays, clerkWeekdayDays, clerkWeekendDays, shiftPayDays, holidayOtFullDays, holidayOtHalfDays, baseNormal, baseShift, clerkDaily, clerkHourly } = useMemo(() => {
    const empty = { calc: null, totalAdvance: 0, regAdv: [] as typeof empAdvances, scanAdv: [] as typeof empAdvances, discAdv: [] as typeof empAdvances, safetyAdv: [] as typeof empAdvances, regAdvTotal: 0, scanAdvTotal: 0, discAdvTotal: 0, safetyAdvTotal: 0, autoWood: 0, autoFilm: 0, autoSpecial: 0, autoSpecialNote: '', crossPositions: [] as { title: string; amount: number }[], isClerk: false, clerkOtHours: 0, clerkOt1xHours: 0, clerkOtDays: 0, clerkWeekdayDays: 0, clerkWeekendDays: 0, shiftPayDays: 0, holidayOtFullDays: 0, holidayOtHalfDays: 0, baseNormal: 357, baseShift: 0, clerkDaily: 0, clerkHourly: 0 }
    if (!selectedEmp) return empty
    const isClerk = selectedEmp.position === 'clerk'
    const advTotal = empAdvances.reduce((s, a) => s + Number(a.amount), 0)

    const regAdv = empAdvances.filter(a => {
      const note = a.note || ''
      const isScan = note.includes('[สแกนหน้าไม่สำเร็จ]') || note.includes('สแกนหน้าไม่สำเร็จ')
      const isDisc = note.includes('[ลงโทษ ขาดงานไม่มีคนแทน]') || note.includes('ลงโทษ ขาดงาน') || note.includes('[ลงโทษ ขาด/ลา/มาสาย]') || note.includes('ลงโทษ ขาด/ลา/มาสาย')
      const isSafety = note.includes('[หักค่าปรับ จป.]') || note.includes('หักค่าปรับผิดระเบียบ') || note.includes('ค่าปรับผิดระเบียบ')
      return !isScan && !isDisc && !isSafety
    })
    const scanAdv = empAdvances.filter(a => {
      const note = a.note || ''
      return note.includes('[สแกนหน้าไม่สำเร็จ]') || note.includes('สแกนหน้าไม่สำเร็จ')
    })
    const discAdv = empAdvances.filter(a => {
      const note = a.note || ''
      return note.includes('[ลงโทษ ขาดงานไม่มีคนแทน]') || note.includes('ลงโทษ ขาดงาน') || note.includes('[ลงโทษ ขาด/ลา/มาสาย]') || note.includes('ลงโทษ ขาด/ลา/มาสาย')
    })
    const safetyAdv = empAdvances.filter(a => {
      const note = a.note || ''
      return note.includes('[หักค่าปรับ จป.]') || note.includes('หักค่าปรับผิดระเบียบ') || note.includes('ค่าปรับผิดระเบียบ')
    })
    const regAdvTotal = regAdv.reduce((s, a) => s + Number(a.amount || 0), 0)
    const scanAdvTotal = scanAdv.reduce((s, a) => s + Number(a.amount || 0), 0)
    const discAdvTotal = discAdv.reduce((s, a) => s + Number(a.amount || 0), 0)
    const safetyAdvTotal = safetyAdv.reduce((s, a) => s + Number(a.amount || 0), 0)

    const normShifts = empShifts.filter(s => !s.is_holiday_ot || s.is_holiday_ot_exempt)
    const holShifts  = empShifts.filter(s => s.is_holiday_ot && !s.is_holiday_ot_exempt)
    const normDays = normShifts.filter(s => !s.is_half_shift && !s.actual_hours).length
    const halfDays = normShifts.filter(s => s.is_half_shift && !s.actual_hours).length
    const partialHrs = normShifts.reduce((s, sh) => s + Number(sh.actual_hours || 0), 0)
    const holFull = holShifts.filter(s => !s.is_half_shift).length
    const holHalf = holShifts.filter(s => s.is_half_shift).length
    // Clerk: weekday shifts = ค่าจ้างปกติ; weekend shifts = OT (tracked via ot_hours)
    const clerkWeekdayShifts = normShifts.filter(s => !isWeekendDate(s.work_date))
    const clerkWeekendShifts = normShifts.filter(s => isWeekendDate(s.work_date))
    const clerkNormDays = clerkWeekdayShifts.length  // only weekday shifts count as normal pay
    const clerkOt  = empShifts.filter(s => !isWeekendDate(s.work_date)).reduce((s, sh) => s + Number(sh.ot_hours || 0), 0)
    const clerkOt1x = empShifts.filter(s => isWeekendDate(s.work_date)).reduce((s, sh) => s + Number(sh.ot_hours || 0), 0)
    const clerkOtDays = empShifts.filter(s => !isWeekendDate(s.work_date) && Number(s.ot_hours || 0) > 0).length
    const autoW = empShifts.reduce((s, sh) => s + Number(sh.wood_excess || 0), 0)
    const autoF = empShifts.reduce((s, sh) => s + Number(sh.film_amount || 0), 0)
    const crossPos = empShifts.filter(s => s.is_cross_position)
    const autoSp = crossPos.reduce((s, sh) => s + Number(sh.cross_position_extra_pay || 0), 0)
    // Group cross-positions by title, sum amounts
    const posMap = new Map<string, number>()
    crossPos.forEach(s => {
      const title = s.cross_position_title || 'สลับตำแหน่ง'
      posMap.set(title, (posMap.get(title) || 0) + Number(s.cross_position_extra_pay || 0))
    })
    const crossPositions = Array.from(posMap.entries()).map(([title, amount]) => ({ title, amount }))
    const autoSpNote = crossPositions.map(p => `${p.title} (${p.amount}฿)`).join(', ')
    const input: PayrollCalculationInput = {
      position: selectedEmp.position as 'worker' | 'clerk',
      wage_type: selectedEmp.wage_type as 'daily' | 'monthly',
      rate_per_12h: Number(selectedEmp.rate_per_12h) || 0,
      normal_days: isClerk ? clerkNormDays : normDays,
      period_days: isClerk && currentPeriod ? getPeriodDays(currentPeriod.period_start, currentPeriod.period_end) : undefined,
      half_shift_days: isClerk ? 0 : halfDays,
      holiday_ot_full_days: holFull,
      holiday_ot_half_days: holHalf,
      partial_hours_total: isClerk ? 0 : partialHrs,
      clerk_ot_hours: clerkOt,
      clerk_ot_1x_hours: clerkOt1x,
      override_normal: overrideNormal,
      override_special: null,
      amount_wood_excess: isClerk ? 0 : autoW,
      amount_film: isClerk ? 0 : autoF,
      amount_special: autoSp + extraEntries.amount_special,
      amount_diligence: extraEntries.amount_diligence,
      amount_position: extraEntries.amount_position,
      social_security_rate: ssRateForEmp,
      deduct_advance: advTotal,
      deduct_safety_equipment: extraEntries.deduct_safety_equipment,
      deduct_uniform: extraEntries.deduct_uniform,
    }
    // Rate breakdown values for display
    const rate = Number(selectedEmp.rate_per_12h) || 0
    const baseNormal = rate === 0 ? 0 : 357
    const baseShift  = Math.max(0, rate - baseNormal)
    const clerkDaily = rate / 30
    const clerkHourly = clerkDaily / 8
    return { calc: calculatePayroll(input), totalAdvance: advTotal, regAdv, scanAdv, discAdv, safetyAdv, regAdvTotal, scanAdvTotal, discAdvTotal, safetyAdvTotal, autoWood: autoW, autoFilm: autoF, autoSpecial: autoSp, autoSpecialNote: autoSpNote, crossPositions, isClerk, clerkOtHours: clerkOt, clerkOt1xHours: clerkOt1x, clerkOtDays, clerkWeekdayDays: clerkNormDays, clerkWeekendDays: clerkWeekendShifts.length, shiftPayDays: normDays, holidayOtFullDays: holFull, holidayOtHalfDays: holHalf, baseNormal, baseShift, clerkDaily, clerkHourly, holFull, holHalf }
  }, [selectedEmp, empShifts, empAdvances, overrideNormal, overrideSpecial, extraEntries, ssRate, isThai])

  // ── outdated detection — computed for ALL employees upfront ──
  // So dots update immediately without requiring the user to click each employee.
  const outdatedSet = useMemo(() => {
    const set = new Set<string>()
    const eps = 0.5
    for (const entry of allEntries) {
      const emp = employees.find(e => e.id === entry.employee_id)
      if (!emp) continue
      const shifts   = allShifts.filter(s => s.employee_id === emp.id)
      const advances = allAdvances.filter(a => a.employee_id === emp.id)
      const isEmpClerk = emp.position === 'clerk'
      const empIsThai  = !emp.nationality || emp.nationality === 'ไทย'
      const empSsRate  = empIsThai && !emp.exempt_social_security ? (currentPeriod?.social_security_rate ?? 0.05) : 0
      const normShifts  = shifts.filter(s => !s.is_holiday_ot || s.is_holiday_ot_exempt)
      const holShifts   = shifts.filter(s => s.is_holiday_ot && !s.is_holiday_ot_exempt)
      const normDays    = normShifts.filter(s => !s.is_half_shift && !s.actual_hours).length
      const halfDays    = normShifts.filter(s => s.is_half_shift  && !s.actual_hours).length
      const partialHrs  = normShifts.reduce((s, sh) => s + Number(sh.actual_hours || 0), 0)
      const holFull     = holShifts.filter(s => !s.is_half_shift).length
      const holHalf     = holShifts.filter(s =>  s.is_half_shift).length
      const clerkNorm   = normShifts.filter(s => !isWeekendDate(s.work_date)).length
      const clerkOt     = shifts.filter(s => !isWeekendDate(s.work_date)).reduce((s, sh) => s + Number(sh.ot_hours || 0), 0)
      const clerkOt1x   = shifts.filter(s =>  isWeekendDate(s.work_date)).reduce((s, sh) => s + Number(sh.ot_hours || 0), 0)
      const autoW  = shifts.reduce((s, sh) => s + Number(sh.wood_excess           || 0), 0)
      const autoF  = shifts.reduce((s, sh) => s + Number(sh.film_amount           || 0), 0)
      const autoSp = shifts.filter(s => s.is_cross_position).reduce((s, sh) => s + Number(sh.cross_position_extra_pay || 0), 0)
      const advTotal = advances.reduce((s, a) => s + Number(a.amount), 0)
      const c = calculatePayroll({
        position: emp.position as 'worker' | 'clerk',
        wage_type: emp.wage_type as 'daily' | 'monthly',
        rate_per_12h: Number(emp.rate_per_12h) || 0,
        normal_days: isEmpClerk ? clerkNorm : normDays,
        period_days: isEmpClerk && currentPeriod ? getPeriodDays(currentPeriod.period_start, currentPeriod.period_end) : undefined,
        half_shift_days: isEmpClerk ? 0 : halfDays,
        holiday_ot_full_days: holFull, holiday_ot_half_days: holHalf,
        partial_hours_total: isEmpClerk ? 0 : partialHrs,
        clerk_ot_hours: clerkOt, clerk_ot_1x_hours: clerkOt1x,
        override_normal: entry.override_normal != null ? Number(entry.override_normal) : null, override_special: null,
        amount_wood_excess: isEmpClerk ? 0 : autoW,
        amount_film: isEmpClerk ? 0 : autoF,
        amount_special: autoSp,
        amount_diligence: 0, amount_position: 0,
        social_security_rate: empSsRate,
        deduct_advance: advTotal, deduct_safety_equipment: 0, deduct_uniform: 0,
      })
      const checks: [number, number][] = [
        [c.amount_normal,              Number(entry.amount_normal)],
        [c.amount_shift,               Number(entry.amount_shift)],
        [c.amount_ot + c.amount_ot_1x, Number(entry.amount_ot)],
        [autoW,                        Number(entry.amount_wood_excess)],
        [autoF,                        Number(entry.amount_film)],
        [autoSp,                       Number(entry.amount_special)],
        [advTotal,                     Number(entry.deduct_advance)],
        [c.deduct_social_security,     Number(entry.deduct_social_security)],
      ]
      if (checks.some(([a, b]) => Math.abs(a - b) > eps)) set.add(emp.id)
    }
    return set
  }, [allEntries, allShifts, allAdvances, employees, currentPeriod])

  const isOutdated = outdatedSet.has(selectedEmpId ?? '')

  // ── status indicator per employee ──
  function empStatus(empId: string): 'saved' | 'unsaved' | 'outdated' | 'none' {
    const hasShifts = allShifts.some(s => s.employee_id === empId)
    if (!hasShifts) return 'none'
    const hasEntry = allEntries.some(e => e.employee_id === empId)
    if (!hasEntry) return 'unsaved'
    return outdatedSet.has(empId) ? 'outdated' : 'saved'
  }

  // ── save mutation ──
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEmpId || !currentPeriod?.id || !calc) return
      const payload = {
        period_id: currentPeriod.id, employee_id: selectedEmpId,
        amount_normal: Math.round(calc.amount_normal * 100) / 100,
        amount_shift: Math.round(calc.amount_shift * 100) / 100,
        amount_ot: Math.round((calc.amount_ot + calc.amount_ot_1x) * 100) / 100,
        amount_wood_excess: Math.round(autoWood * 100) / 100,
        amount_film: Math.round(autoFilm * 100) / 100,
        amount_special: Math.round(autoSpecial * 100) / 100,
        override_special: extraEntries.amount_special || null,
        special_note: (specialNote || autoSpecialNote || '').trim(),
        amount_diligence: extraEntries.amount_diligence,
        amount_position: extraEntries.amount_position,
        deduct_social_security: Math.round(calc.deduct_social_security * 100) / 100,
        deduct_safety_equipment: extraEntries.deduct_safety_equipment,
        deduct_uniform: extraEntries.deduct_uniform,
        deduct_advance: Math.round(totalAdvance * 100) / 100,
        override_normal: overrideNormal,
        override_reason: '',
      }
      const { error } = await supabase.from('payroll_entries' as any).upsert([payload], { onConflict: 'period_id,employee_id' })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-payroll-entries', currentPeriod?.id] })
      queryClient.invalidateQueries({ queryKey: ['v2-stats'] })
      queryClient.invalidateQueries({ queryKey: ['payment-channel-stats'] })
      queryClient.invalidateQueries({ queryKey: ['superuser-overrides'] })
      toast.success('บันทึกข้อมูลค่าจ้างสำเร็จ')
    },
    onError: (e: Error) => toast.error('บันทึกไม่สำเร็จ', { description: e.message }),
  })

  const monoNum = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2 })

  return (
    <>
      <TopBar title="กรอกค่าจ้าง" subtitle={currentPeriod?.label} onMenuClick={onMenuClick} />

      <div className="vk-split">
        {/* Left panel — hidden on mobile when employee is selected */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}
          className={`vk-sidebar-scrollable vk-sidebar-scrollable-payroll ${selectedEmpId ? 'hidden md:block' : ''}`}>

          {/* Sticky header — does not scroll */}
          <div style={{ flexShrink: 0, padding: '16px 12px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div className="vk-eyebrow">พนักงาน ({employees.length})</div>
            </div>
            <div style={{ display: 'flex', gap: 6, fontSize: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              {([
                { key: 'saved',    color: 'var(--vk-jade)',      label: 'บันทึกแล้ว' },
                { key: 'outdated', color: 'var(--vk-persimmon)', label: 'มีการเปลี่ยนแปลง' },
                { key: 'unsaved',  color: '#d4cfc9',             label: 'ยังไม่บันทึก' },
              ] as const).map(s => {
                const active = statusFilter === s.key
                return (
                  <button key={s.key} onClick={() => setStatusFilter(active ? null : s.key)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', border: `1px solid ${active ? s.color : 'var(--vk-rule-soft)'}`, borderRadius: 999, cursor: 'pointer', background: active ? `${s.color}22` : 'transparent', color: active ? 'var(--vk-ink)' : 'var(--vk-ink-3)', fontFamily: 'var(--vk-sans)', fontWeight: active ? 700 : 400, fontSize: 10, transition: 'all 120ms' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, display: 'inline-block', flexShrink: 0 }} />
                    {s.label}
                  </button>
                )
              })}
            </div>
            {/* Search */}
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

          {/* Scrollable list */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px 16px', marginRight: 1, scrollbarGutter: 'stable' } as React.CSSProperties}>
          {employees.filter(emp => {
            const q = empSearch.toLowerCase()
            const matchSearch = !q || emp.employee_code.toLowerCase().includes(q) || emp.first_name.toLowerCase().includes(q) || (emp.last_name || '').toLowerCase().includes(q)
            const matchStatus = !statusFilter || empStatus(emp.id) === statusFilter
            return matchSearch && matchStatus
          }).map(emp => {
            const status = empStatus(emp.id)
            const active = emp.id === selectedEmpId
            return (
              <div key={emp.id} onClick={() => setSelectedEmpId(emp.id)}
                className="vk-employee-card"
                data-selected={active}>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: status === 'saved' ? 'var(--vk-jade)' : status === 'outdated' ? 'var(--vk-persimmon)' : '#d4cfc9',
                  }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--vk-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {emp.first_name} {emp.last_name}{fmtNationality(emp.nationality) ? ` (${fmtNationality(emp.nationality)})` : ''}
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
          {employees.length === 0 && <div className="vk-small" style={{ color: 'var(--vk-ink-3)' }}>ไม่พบพนักงาน</div>}
          {employees.length > 0 && empSearch && employees.filter(emp => {
            const q = empSearch.toLowerCase()
            return emp.employee_code.toLowerCase().includes(q) || emp.first_name.toLowerCase().includes(q) || (emp.last_name || '').toLowerCase().includes(q)
          }).length === 0 && (
            <div className="vk-small" style={{ color: 'var(--vk-ink-3)', textAlign: 'center', padding: '12px 0' }}>ไม่พบพนักงานที่ค้นหา</div>
          )}
          </div>
        </div>

        {/* Right panel */}
        <div style={{ overflowY: 'auto', padding: '16px' }} className="md:px-8 md:py-6">
          {selectedEmp && (
            <button className="vk-btn md:hidden" style={{ marginBottom: 12, fontSize: 12, padding: '5px 12px' }}
              onClick={() => setSelectedEmpId(null)}>← กลับ</button>
          )}
          {!selectedEmp ? (
            <div style={{ paddingTop: 60, textAlign: 'center' }}>
              <div className="vk-eyebrow" style={{ marginBottom: 10 }}>เลือกพนักงานจากรายการทางซ้าย</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 32, justifyContent: 'center' }}>
                {([
                  { color: 'var(--vk-jade)',      label: 'บันทึกแล้ว' },
                  { color: 'var(--vk-persimmon)', label: 'มีการเปลี่ยนแปลง' },
                  { color: '#d4cfc9',             label: 'ยังไม่บันทึก' },
                ] as { color: string; label: string }[]).map(({ color, label }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: color }} />
                    <span className="vk-small" style={{ color: 'var(--vk-ink-3)', whiteSpace: 'nowrap' }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div style={{ marginBottom: 20 }}>
                {(() => {
                  const hasOvr = overrideNormal !== null || existingEntry?.override_normal != null
                  const norm = overrideNormal !== null ? overrideNormal : (existingEntry?.override_normal != null ? Number(existingEntry.override_normal) : null)

                  return (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="vk-eyebrow" style={{ marginBottom: 2 }}>PAYROLL ENTRY · {currentPeriod?.label}</div>
                        <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 18, letterSpacing: '-0.02em', wordBreak: 'break-word' }}>
                          {selectedEmp.first_name} <span style={{ fontWeight: 400, color: 'var(--vk-ink-3)' }}>{selectedEmp.last_name}</span>
                          {fmtNationality(selectedEmp.nationality) && (
                            <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--vk-ink-3)', marginLeft: 6 }}>({fmtNationality(selectedEmp.nationality)})</span>
                          )}
                        </div>
                        <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 11, color: 'var(--vk-ink-3)', marginTop: 2 }}>
                          {selectedEmp.employee_code}
                          {' · '}
                          {selectedEmp.position === 'clerk' ? 'เสมียน' : selectedEmp.position === 'foreman' ? 'โฟร์แมน' : selectedEmp.position === 'office' ? 'พนักงานออฟฟิศ' : selectedEmp.position === 'manager' ? 'ผู้จัดการ' : 'พนักงานทั่วไป'}
                          {selectedEmp.job_title ? ` – ${selectedEmp.job_title}` : ''}
                          {' · '}฿{(Number(selectedEmp.rate_per_12h) || 0).toLocaleString()}/{selectedEmp.wage_type === 'monthly' ? 'เดือน' : 'วัน'}
                        </div>
                      </div>

                      {/* ── TOP RIGHT CORNER (มุมขวาบนที่ว่างอยู่) ── */}
                      {hasOvr && (
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-end',
                          gap: 4,
                          flexShrink: 0,
                        }}>
                          <div style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '6px 14px',
                            background: '#fffbeb',
                            border: '1px solid #f59e0b',
                            borderRadius: 6,
                            color: '#b45309',
                            fontSize: 12,
                            fontWeight: 700,
                            boxShadow: '0 1px 3px rgba(245, 158, 11, 0.12)',
                          }}>
                            <AlertTriangle style={{ width: 15, height: 15, color: '#d97706', flexShrink: 0 }} />
                            <span>มีการปรับแก้ตัวเลขค่าจ้างด้วยตนเอง (Override)</span>
                          </div>
                          {norm !== null && (
                            <span style={{ fontSize: 11, color: '#92400e', fontWeight: 600 }}>
                              (ค่าจ้างปกติ: ฿{norm.toLocaleString()})
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })()}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12, alignItems: 'center' }}>
                  {existingEntry && !isOutdated && <span className="vk-pill" data-tone="approved"><CheckCircle2 style={{ width: 11, height: 11, display: 'inline', marginRight: 4 }} />บันทึกแล้ว</span>}
                  {existingEntry && isOutdated && (
                    <span className="vk-pill" style={{ background: 'rgba(177,71,41,0.10)', color: 'var(--vk-persimmon)', border: '1px solid var(--vk-persimmon)', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'normal' }}>
                      <AlertCircle style={{ width: 11, height: 11, flexShrink: 0 }} />
                      OUTDATED · ข้อมูลเปลี่ยนแปลง กรุณาบันทึกใหม่
                    </span>
                  )}
                  <button className="vk-btn vk-btn--primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !calc}>
                    <Save style={{ width: 14, height: 14 }} />
                    {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกค่าจ้าง'}
                  </button>
                </div>
              </div>

              {empShifts.length === 0 ? (
                <div style={{ border: '1px solid var(--vk-rule)', padding: '40px', textAlign: 'center', background: 'var(--vk-bone)' }}>
                  <div className="vk-eyebrow" style={{ marginBottom: 6 }}>ยังไม่มีข้อมูลกะ</div>
                  <div className="vk-small" style={{ color: 'var(--vk-ink-3)' }}>กรุณากรอกกะที่หน้า "กรอกกะรายวัน" ก่อน</div>
                </div>
              ) : calc ? (
                <>
                  {/* Income + Deduct */}
                  <div className="vk-income-grid" style={{ border: '1px solid var(--vk-rule)', marginBottom: 0, width: '100%' }}>
                    {/* ── Income column ── */}
                    <div className="vk-income-col" style={{ padding: '20px 24px', background: 'var(--vk-bone)', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <div className="vk-eyebrow" style={{ color: 'var(--vk-jade)', marginBottom: 14 }}>INCOME · รายได้</div>

                      {/* Calculated rows */}
                      {[
                        {
                          label: 'ค่าจ้างปกติ (8 ชม.)',
                          sub: isClerk ? null : `${calc.normal_days} วัน` as string|null,
                          detail: isClerk ? null : `฿${baseNormal} × ${calc.normal_days} วัน` as string|null,
                          value: calc.effective_normal, isOverridden: overrideNormal !== null,
                        },
                        ...(!isClerk ? [{
                          label: 'ค่ากะ (4 ชม.)',
                          sub: `${shiftPayDays} วัน` as string|null,
                          detail: `฿${Math.round(baseShift)} × ${shiftPayDays} วัน`,
                          value: Number(calc.effective_shift) || 0, isOverridden: false,
                        }] : []),
                        ...(!isClerk && calc.effective_ot > 0 ? [{
                          label: 'OT วันหยุดนักขัตฤกษ์ (×2)',
                          sub: `${holidayOtFullDays + holidayOtHalfDays} วัน` as string|null,
                          detail: `฿${Math.round(baseNormal + baseShift)} × 2 × ${holidayOtFullDays + holidayOtHalfDays} วัน`,
                          value: Number(calc.effective_ot) || 0, isOverridden: false,
                        }] : []),
                        ...(isClerk && clerkOtHours > 0 ? [{
                          label: 'OT ล่วงเวลา (×1.5)',
                          sub: `${clerkOtHours} ชั่วโมง · ${clerkOtDays} วัน` as string|null,
                          detail: `฿${monoNum(clerkHourly)} × 1.5 × ${clerkOtHours} ชม. (${clerkOtDays} วัน)`,
                          value: Number(calc.effective_ot) || 0, isOverridden: false,
                        }] : []),
                        ...(isClerk && clerkOt1xHours > 0 ? [{
                          label: 'OT วันหยุดสัปดาห์ (×1)',
                          sub: `${clerkOt1xHours} ชั่วโมง · ${clerkWeekendDays} วัน`,
                          detail: `฿${monoNum(clerkHourly)} × 1.0 × ${clerkOt1xHours} ชม. (${clerkWeekendDays} วัน)`,
                          value: Number(calc.effective_ot_1x) || 0, isOverridden: false,
                        }] : []),
                        ...(!isClerk && autoWood > 0 ? [{
                          label: 'ค่าไม้ส่วนเกิน', sub: null as string|null, detail: null as string|null,
                          value: autoWood, isOverridden: false,
                        }] : []),
                        ...(!isClerk && autoFilm > 0 ? [{
                          label: 'ค่าฟิล์ม', sub: null as string|null, detail: null as string|null,
                          value: autoFilm, isOverridden: false,
                        }] : []),
                      ].map((r, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 0', borderBottom: '1px dashed var(--vk-rule-soft)' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13 }}>{r.label}</div>
                            {'detail' in r && r.detail && (
                              <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 10, color: 'var(--vk-persimmon)', marginTop: 1, letterSpacing: '0.01em' }}>{r.detail}</div>
                            )}
                          </div>
                          <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 13, fontVariantNumeric: 'tabular-nums', textAlign: 'right', color: r.isOverridden ? 'var(--vk-marigold)' : 'var(--vk-ink)' }}>
                            {monoNum(r.value)}
                          </div>
                        </div>
                      ))}

                      {/* ค่าทำงานข้ามตำแหน่ง — grouped with sub-items per position, no sub-dividers */}
                      {crossPositions.length > 0 && (
                        <div style={{ padding: '7px 0', borderBottom: '1px dashed var(--vk-rule-soft)' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                            <div style={{ flex: 1, fontSize: 13 }}>ค่าทำงานข้ามตำแหน่ง</div>
                            <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 13, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
                              {monoNum(crossPositions.reduce((s, p) => s + p.amount, 0))}
                            </div>
                          </div>
                          {crossPositions.map((p, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4, paddingLeft: 12 }}>
                              <span style={{ color: 'var(--vk-ink-3)', fontSize: 11, flexShrink: 0 }}>·</span>
                              <div style={{ flex: 1, fontSize: 12, color: 'var(--vk-ink-2)' }}>{p.title}</div>
                              <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--vk-ink-3)' }}>
                                {monoNum(p.amount)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Income input fields */}
                      <div style={{ marginTop: 14, borderTop: '1px solid var(--vk-rule-soft)', paddingTop: 14, paddingBottom: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div className="vk-eyebrow" style={{ marginBottom: 2 }}>รายการรายได้เพิ่มเติม</div>
                        {[
                          { key: 'amount_diligence', label: 'เบี้ยขยัน (฿)' },
                          { key: 'amount_position',  label: 'ค่าตำแหน่ง (฿)' },
                          { key: 'amount_special',   label: 'เงินพิเศษ (฿)' },
                        ].map(f => (
                          <div key={f.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <label style={{ fontSize: 12, color: 'var(--vk-ink-2)' }}>{f.label}</label>
                            <input type="number" min="0"
                              value={extraEntries[f.key as keyof typeof extraEntries] || ''}
                              onChange={e => setExtraEntries(prev => ({ ...prev, [f.key]: Number(e.target.value) || 0 }))}
                              style={{ width: 90, fontFamily: 'var(--vk-mono)', fontSize: 13, textAlign: 'right', border: '1px solid var(--vk-rule)', background: 'var(--vk-paper)', padding: '4px 8px' }}
                              placeholder="0" />
                          </div>
                        ))}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0 0', marginTop: 'auto', borderTop: '2px solid var(--vk-rule)' }}>
                        <div className="vk-eyebrow">รวมรายได้</div>
                        <div style={{ fontFamily: 'var(--vk-mono)', fontWeight: 700, fontSize: 16, color: 'var(--vk-jade)' }}>+ {monoNum(calc.total_income)}</div>
                      </div>
                    </div>

                    {/* ── Deduct column ── */}
                    <div className="vk-deduct-col" style={{ padding: '20px 24px', background: 'var(--vk-bone)', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <div className="vk-eyebrow" style={{ color: 'var(--vk-crimson)', marginBottom: 14 }}>DEDUCT · รายการหัก</div>
                      {[
                        { label: selectedEmp?.exempt_social_security ? 'ประกันสังคม (ยกเว้น)' : `ประกันสังคม ${(ssRate*100).toFixed(0)}%`, value: calc.deduct_social_security, showAlways: true },
                        { label: 'เบิกล่วงหน้า', value: regAdvTotal, sub: regAdv.length > 0 ? `${regAdv.length} รายการเบิกเงินล่วงหน้า` : null, showAlways: true },
                        { label: 'หักสแกนหน้าไม่ผ่าน', value: scanAdvTotal, sub: scanAdv.length > 0 ? `${scanAdv.length} รายการสแกนหน้าไม่สำเร็จ` : null, showAlways: false },
                        { label: 'หักลงโทษขาดงานไม่มีคนแทน', value: discAdvTotal, sub: discAdv.length > 0 ? `${discAdv.length} รายการลงโทษขาดงาน (2 เท่า)` : null, showAlways: false },
                        ...(safetyAdv.length > 0 ? safetyAdv.map((adv) => {
                          const infoMatch = (adv.note || '').match(/หักค่าปรับผิดระเบียบ\s*(\([^\)]+\))/)
                          let infoStr = infoMatch ? infoMatch[1] : ''
                          if (infoStr && /วันที่\s*\d{4}[-\/]/.test(infoStr)) {
                            infoStr = infoStr.replace(/วันที่\s*([\d\/\-]+)/, (_, d) => `วันที่ ${formatThaiDateDDMMYYYY(d)}`)
                          }
                          const label = infoStr
                            ? `หักค่าปรับผิดระเบียบ\n${infoStr}`
                            : ((adv.note || '').match(/(หักค่าปรับผิดระเบียบ\s*\([^\)]+\))/)?.[1] || 'หักค่าปรับผิดระเบียบ')
                          const reasonMatch = (adv.note || '').match(/สาเหตุ:\s*([^\|]+)/)
                          const sub = reasonMatch ? `สาเหตุ: ${reasonMatch[1].trim()} (ยอดหักงวดละ ฿${monoNum(Number(adv.amount))})` : `ยอดหัก ฿${monoNum(Number(adv.amount))}`
                          return {
                            label,
                            value: Number(adv.amount),
                            sub,
                            showAlways: false,
                          }
                        }) : []),
                        { label: 'หักอุปกรณ์ความปลอดภัย', value: extraEntries.deduct_safety_equipment, sub: null, showAlways: false },
                        { label: 'หักเครื่องแบบ', value: extraEntries.deduct_uniform, sub: null, showAlways: false },
                      ].filter(r => r.value !== 0 || r.showAlways).map((r, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderBottom: '1px dashed var(--vk-rule-soft)' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'pre-line' }}>{r.label}</div>
                            {r.sub && <div style={{ fontSize: 11, color: 'var(--vk-ink-3)', marginTop: 1, wordBreak: 'break-word', whiteSpace: 'normal' }}>{r.sub}</div>}
                          </div>
                          <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 13, fontVariantNumeric: 'tabular-nums', color: 'var(--vk-crimson)', fontWeight: 700, flexShrink: 0 }}>
                            {monoNum(r.value)}
                          </div>
                        </div>
                      ))}

                      {/* Advance Breakdown Sub-items */}
                      {regAdv.length > 0 && (
                        <div style={{ padding: '8px 10px', background: 'rgba(162, 35, 27, 0.04)', borderRadius: 6, marginTop: 8, border: '1px dashed rgba(162, 35, 27, 0.25)' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--vk-crimson)', marginBottom: 6 }}>
                            รายละเอียดเบิกล่วงหน้า ({regAdv.length} รายการ):
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {regAdv.map((adv, idx) => (
                              <div key={idx} style={{ padding: '7px 10px', background: '#ffffff', borderRadius: 4, border: '1px solid #fee2e2' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--vk-crimson)' }}>
                                    รายการที่ {idx + 1}
                                  </span>
                                  <span style={{ fontFamily: 'var(--vk-mono)', fontWeight: 700, fontSize: 12, color: 'var(--vk-crimson)' }}>
                                    –฿{monoNum(Number(adv.amount))}
                                  </span>
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--vk-ink-2)', lineHeight: 1.45, wordBreak: 'break-word', whiteSpace: 'normal' }}>
                                  {adv.note || 'เบิกเงินสดทั่วไป'}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {scanAdv.length > 0 && (
                        <div style={{ padding: '8px 10px', background: 'rgba(234, 88, 12, 0.05)', borderRadius: 6, marginTop: 8, border: '1px dashed #fed7aa' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#c2410c', marginBottom: 6 }}>
                            รายละเอียดหักสแกนหน้าไม่ผ่าน ({scanAdv.length} รายการ):
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {scanAdv.map((adv, idx) => {
                              const cleanNote = (adv.note || '').replace(/\[สแกนหน้าไม่สำเร็จ\]/g, '').trim()
                              const parts = cleanNote.split('|').map(p => p.trim()).filter(Boolean)
                              return (
                                <div key={idx} style={{ padding: '7px 10px', background: '#ffffff', borderRadius: 4, border: '1px solid #ffedd5' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: '#c2410c' }}>
                                      รายการที่ {idx + 1}
                                    </span>
                                    <span style={{ fontFamily: 'var(--vk-mono)', fontWeight: 700, fontSize: 12, color: '#ea580c' }}>
                                      –฿{monoNum(Number(adv.amount))}
                                    </span>
                                  </div>
                                  {parts.length > 1 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, color: 'var(--vk-ink-2)', lineHeight: 1.45 }}>
                                      {parts.map((p, pIdx) => (
                                        <div key={pIdx} style={{ wordBreak: 'break-word', whiteSpace: 'normal', display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                                          <span style={{ color: '#ea580c', flexShrink: 0 }}>•</span>
                                          <span style={{ flex: 1 }}>{p}</span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: 11, color: 'var(--vk-ink-2)', lineHeight: 1.45, wordBreak: 'break-word', whiteSpace: 'normal' }}>
                                      {cleanNote || 'สแกนหน้าไม่สำเร็จ'}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {discAdv.length > 0 && (
                        <div style={{ padding: '8px 10px', background: 'rgba(153, 27, 27, 0.05)', borderRadius: 6, marginTop: 8, border: '1px dashed #fca5a5' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#991b1b', marginBottom: 6 }}>
                            รายละเอียดหักลงโทษขาดงานไม่มีคนแทน ({discAdv.length} รายการ):
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {discAdv.map((adv, idx) => {
                              const cleanNote = (adv.note || '')
                                .replace(/\[ลงโทษ\s*(ขาดงานไม่มีคนแทน|ขาด\/ลา\/มาสาย|ขาดงาน)\]/g, '')
                                .replace(/วันที่:\s*([\d\/\-]+)/, (_, d) => `วันที่: ${formatThaiDateDDMMYYYY(d)}`)
                                .trim()
                              const parts = cleanNote.split('|').map(p => p.trim()).filter(Boolean)
                              return (
                                <div key={idx} style={{ padding: '7px 10px', background: '#ffffff', borderRadius: 4, border: '1px solid #fee2e2' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: '#991b1b' }}>
                                      รายการที่ {idx + 1}
                                    </span>
                                    <span style={{ fontFamily: 'var(--vk-mono)', fontWeight: 700, fontSize: 12, color: 'var(--vk-crimson)' }}>
                                      –฿{monoNum(Number(adv.amount))}
                                    </span>
                                  </div>
                                  {parts.length > 1 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, color: 'var(--vk-ink-2)', lineHeight: 1.45 }}>
                                      {parts.map((p, pIdx) => (
                                        <div key={pIdx} style={{ wordBreak: 'break-word', whiteSpace: 'normal', display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                                          <span style={{ color: '#991b1b', flexShrink: 0 }}>•</span>
                                          <span style={{ flex: 1 }}>{p}</span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: 11, color: 'var(--vk-ink-2)', lineHeight: 1.45, wordBreak: 'break-word', whiteSpace: 'normal' }}>
                                      {cleanNote || 'หักลงโทษ 2 เท่า'}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {safetyAdv.length > 0 && (
                        <div style={{ padding: '8px 10px', background: 'rgba(124, 58, 237, 0.05)', borderRadius: 6, marginTop: 8, border: '1px dashed #c4b5fd' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#6d28d9', marginBottom: 6 }}>
                            รายละเอียดหักค่าปรับผิดระเบียบวินัย จป. ({safetyAdv.length} รายการ):
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {safetyAdv.map((adv, idx) => {
                              const cleanNote = (adv.note || '').replace(/\[หักค่าปรับ จป\.\]/g, '').trim()
                              const parts = cleanNote.split('|').map(p => p.trim()).filter(Boolean)
                              return (
                                <div key={idx} style={{ padding: '7px 10px', background: '#ffffff', borderRadius: 4, border: '1px solid #ede9fe' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: '#6d28d9' }}>
                                      รายการที่ {idx + 1}
                                    </span>
                                    <span style={{ fontFamily: 'var(--vk-mono)', fontWeight: 700, fontSize: 12, color: '#7c3aed' }}>
                                      –฿{monoNum(Number(adv.amount))}
                                    </span>
                                  </div>
                                  {parts.length > 1 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, color: 'var(--vk-ink-2)', lineHeight: 1.45 }}>
                                      {parts.map((p, pIdx) => (
                                        <div key={pIdx} style={{ wordBreak: 'break-word', whiteSpace: 'normal', display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                                          <span style={{ color: '#7c3aed', flexShrink: 0 }}>•</span>
                                          <span style={{ flex: 1 }}>{p}</span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: 11, color: 'var(--vk-ink-2)', lineHeight: 1.45, wordBreak: 'break-word', whiteSpace: 'normal' }}>
                                      {cleanNote || 'หักค่าปรับผิดระเบียบวินัย จป.'}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Deduct input fields */}
                      <div style={{ marginTop: 14, borderTop: '1px solid var(--vk-rule-soft)', paddingTop: 14, paddingBottom: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div className="vk-eyebrow" style={{ marginBottom: 2 }}>รายการหักเพิ่มเติม</div>
                        <DeductionProductPicker
                          key={`${selectedEmpId}:${currentPeriod?.id}`}
                          onAdd={(field, amount) => setExtraEntries(prev => ({ ...prev, [field]: Math.max(0, prev[field] + amount) }))}
                        />

                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0 0', marginTop: 'auto', borderTop: '2px solid var(--vk-rule)' }}>
                        <div className="vk-eyebrow">รวมรายการหัก</div>
                        <div style={{ fontFamily: 'var(--vk-mono)', fontWeight: 700, fontSize: 16, color: 'var(--vk-crimson)' }}>– {monoNum(calc.total_deductions)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Net pay hero */}
                  <div style={{ borderTop: '2px solid var(--vk-ink)', borderBottom: '2px solid var(--vk-rule)', padding: '16px 20px', background: 'var(--vk-paper)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <div className="vk-eyebrow">NET PAY · เงินได้สุทธิ</div>
                      <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 11, color: 'var(--vk-ink-3)', marginTop: 3 }}>
                        {isClerk ? clerkWeekdayDays + clerkWeekendDays + holidayOtFullDays + holidayOtHalfDays : calc.normal_days + holidayOtFullDays + holidayOtHalfDays} วันทำงาน
                      </div>
                    </div>
                    <div className="vk-netpay-num" style={{ fontFamily: 'var(--vk-mono)', fontWeight: 700, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', color: 'var(--vk-ink)' }}>
                      {Math.floor(calc.net_pay).toLocaleString()}
                      <span style={{ fontWeight: 500, fontSize: 16, color: 'var(--vk-ink-3)' }}>
                        .{(calc.net_pay % 1).toFixed(2).slice(2)}
                      </span>
                      <span style={{ fontFamily: 'var(--vk-sans)', fontSize: 12, color: 'var(--vk-ink-3)', marginLeft: 6 }}>บาท</span>
                    </div>
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
    </>
  )
}
