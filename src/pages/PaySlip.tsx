import React, { useMemo } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { useState, useRef, useEffect, useCallback } from 'react'
import { Printer, Search, X, AlertTriangle } from 'lucide-react'
import { calculatePayroll } from '../lib/payrollCalc'
import { calculateTpiPayroll, type TpiShiftRow, type TpiPayrollCalculationResult } from '../features/tpi/payrollCalc'
import { employeeWageForm } from '../features/tpi/employeeWageForm'
import { referenceJobs } from '../features/tpi/referenceJobs'
import { VKSlipDocument } from '../components/VKSlipDocument'
import { formatEmployeeFullName, compareEmployeeCode, formatThaiDateDDMMYYYY } from '../lib/formatters'
import { isTpiCompany } from '../features/tpi/model'
import '../styles/tokens.css'

// ── helpers ──────────────────────────────────────────────────────────────────
function fmtNationality(n: string | null) {
  if (!n || n === 'ไทย') return null
  if (n === 'เมียนมา' || n.toLowerCase().includes('myanmar') || n.toLowerCase().includes('burma')) return 'เมียนมา'
  return n
}
function maskBank(account: string | null) {
  if (!account) return '—'
  const s = account.replace(/[-\s]/g, '')
  if (s.length <= 6) return s
  return `${s.slice(0, 3)}-${'X'.repeat(s.length - 6)}-${s.slice(-3)}`
}
function thaiDateTime() {
  const now = new Date()
  const MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']
  const d = now.getDate()
  const m = MONTHS[now.getMonth()]
  const y = now.getFullYear() + 543
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  return `${d} ${m} ${y} เวลา ${hh}:${mm} น.`
}
function thaiPeriod(start: string, end: string) {
  const MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
  const s = new Date(start), e = new Date(end)
  return `${s.getDate()} ${MONTHS[s.getMonth()]} – ${e.getDate()} ${MONTHS[e.getMonth()]} ${e.getFullYear() + 543}`
}
const mono = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Map short factory/company names → full legal names for the slip header
const COMPANY_FULL_NAME: Record<string, string> = {
  'ผลิตภัณฑ์ตราเพชร': 'บริษัท ผลิตภัณฑ์ตราเพชร จำกัด (มหาชน)',
  'ทีพีไอ โพลีน':     'บริษัท ทีพีไอ โพลีน จำกัด (มหาชน)',
}

function fullCompanyName(name: string): string {
  if (!name) return name
  for (const [key, full] of Object.entries(COMPANY_FULL_NAME)) {
    if (name.includes(key)) return full
  }
  return name
}

const POSITIONS: Record<string, string> = {
  worker: 'พนักงานทั่วไป', clerk: 'เสมียน', foreman: 'โฟร์แมน',
  office: 'พนักงานออฟฟิศ', manager: 'ผู้จัดการ',
}

export default function PaySlip() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user, companyContext } = useAppStore()
  const [searchParams] = useSearchParams()
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)
  const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null)
  const [empSearch, setEmpSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'has_slip' | 'no_slip' | 'override' | null>(null)
  const slipRef = useRef<HTMLDivElement>(null)
  const scalerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const empParam = searchParams.get('emp') || searchParams.get('employee_id')
    const periodParam = searchParams.get('period') || searchParams.get('period_id')
    if (empParam) setSelectedEmpId(empParam)
    if (periodParam) setSelectedPeriodId(periodParam)
  }, [searchParams])

  const applyScale = useCallback(() => {
    const scaler = scalerRef.current
    const inner = innerRef.current
    if (!scaler || !inner) return
    const availW = scaler.offsetWidth
    const slipW = 680
    const scale = Math.min(1, availW / slipW)
    if (scale < 1) {
      inner.style.transform = `scale(${scale})`
      inner.style.transformOrigin = 'top left'
      scaler.style.height = `${inner.offsetHeight * scale}px`
    } else {
      inner.style.transform = ''
      scaler.style.height = ''
    }
  }, [])

  useEffect(() => {
    const inner = innerRef.current
    if (!inner) return
    applyScale()
    const ro = new ResizeObserver(applyScale)
    ro.observe(inner)
    window.addEventListener('resize', applyScale)
    return () => { ro.disconnect(); window.removeEventListener('resize', applyScale) }
  }, [applyScale, selectedEmpId])

  const { data: periods = [] } = useQuery<any[]>({
    queryKey: ['periods', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_periods').select('*')
        .eq('factory_id', user?.factory_id ?? '').order('period_start', { ascending: false })
      if (error) throw error; return data
    }, enabled: !!user?.factory_id, staleTime: 0,
  })

  // Auto-select initial period (latest) once periods are loaded
  useEffect(() => {
    if (periods.length > 0 && !selectedPeriodId) {
      setSelectedPeriodId(periods[0].id)
    }
  }, [periods, selectedPeriodId])

  const currentPeriod = periods.find(p => p.id === selectedPeriodId) || periods[0]

  const handlePrint = () => {
    const el = slipRef.current
    if (!el) return
    const win = window.open('', '_blank', 'width=900,height=700')
    if (!win) { alert('กรุณาอนุญาต popup สำหรับการพิมพ์'); return }
    const periodStart = currentPeriod ? new Date(currentPeriod.period_start) : new Date()
    const periodDay = currentPeriod ? new Date(currentPeriod.period_start).getDate() : 1
    const half = periodDay <= 15 ? 'A' : 'B'
    const mm = String(periodStart.getMonth() + 1).padStart(2, '0')
    const yyyy = periodStart.getFullYear()
    const empName = selectedEmp ? `${selectedEmp.first_name}_${selectedEmp.last_name}` : 'slip'
    const filename = `Payslip_${empName}_${half}${mm}${yyyy}`
    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${filename}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: white; font-family: sans-serif; }
    body > div {
      max-width: 100% !important;
      width: 100% !important;
      box-shadow: none !important;
      border: none !important;
      border-bottom: 1px solid #e2e2e2 !important;
    }
    @page { size: A4 portrait; margin: 8mm 8mm; }
    @media print {
      html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>${el.outerHTML}</body>
</html>`)
    win.document.close()
    win.focus()
    setTimeout(() => { win.print(); win.close() }, 400)
  }

  const { data: employees = [] } = useQuery<any[]>({
    queryKey: ['employees-payslip', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees')
        .select('id,employee_code,prefix,first_name,last_name,nationality,position,job_title,wage_type,rate_per_12h,payment_method,bank_name,bank_account,exempt_social_security,status')
        .eq('factory_id', user?.factory_id ?? '').order('employee_code')
      if (error) throw error
      return (data || []).sort((a: any, b: any) => compareEmployeeCode(a.employee_code, b.employee_code))
    }, enabled: !!user?.factory_id, staleTime: 0,
  })

  const { data: allEntries = [] } = useQuery<any[]>({
    queryKey: ['all-payroll-entries', currentPeriod?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_entries' as any)
        .select('employee_id, override_normal, override_shift, override_ot, override_special, amount_special, override_reason').eq('period_id', currentPeriod.id)
      if (error) throw error; return data
    }, enabled: !!currentPeriod?.id, staleTime: 0,
  })

  const { data: factoryData } = useQuery<any>({
    queryKey: ['factory-info', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('factories')
        .select('id, name, company_id, companies(name)').eq('id', user?.factory_id ?? '').single()
      if (error) throw error; return data
    }, enabled: !!user?.factory_id,
  })

  // companies join may come back as object or array depending on relationship type
  const companiesJoin = factoryData?.companies
  const companyName = (Array.isArray(companiesJoin) ? companiesJoin[0]?.name : companiesJoin?.name) || ''
  const branchName  = factoryData?.name || ''
  const isTpi = isTpiCompany(companyContext?.factoryName) ||
                isTpiCompany(companyContext?.name) ||
                isTpiCompany(companyName) ||
                isTpiCompany(branchName)

  // Query TPI Wage Profiles
  const { data: dbWageProfiles = [] } = useQuery<any[]>({
    queryKey: ['tpi-profiles', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tpi_employee_wage_profiles')
        .select('*')
        .eq('factory_id', user?.factory_id ?? '')
      if (error) return []
      return data || []
    },
    enabled: !!user?.factory_id && isTpi,
  })

  // Query TPI Job Codes for fallback identification
  const { data: dbTpiJobCodes = [] } = useQuery<any[]>({
    queryKey: ['tpi-job-codes', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tpi_job_codes')
        .select('*')
        .eq('factory_id', user?.factory_id ?? '')
      if (error) return []
      return data || []
    },
    enabled: !!user?.factory_id && isTpi,
  })

  const isSkilledEmp = useMemo(() => {
    if (!isTpi) return (_emp?: any) => false
    const profileMap = new Map<string, any>()
    for (const p of dbWageProfiles) {
      profileMap.set(p.employee_id, p)
    }
    const jobsList = dbTpiJobCodes.length > 0 ? dbTpiJobCodes : referenceJobs
    return (emp?: any) => {
      if (!emp) return false
      const profile = profileMap.get(emp.id)
      if (profile?.rate_tier === 'skilled') return true
      const form = employeeWageForm(emp.job_title, profile, jobsList)
      return form.rateTier === 'skilled'
    }
  }, [isTpi, dbWageProfiles, dbTpiJobCodes])

  const { data: entry } = useQuery<any>({
    queryKey: ['payslip-entry', currentPeriod?.id, selectedEmpId],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_entries' as any)
        .select('*').eq('period_id', currentPeriod.id).eq('employee_id', selectedEmpId!)
      if (error) throw error
      return data?.[0] ?? null   // use array fetch to avoid .single() error on no-row
    }, enabled: !!currentPeriod?.id && !!selectedEmpId, staleTime: 0,
  })

  const { data: empAdvances = [] } = useQuery<any[]>({
    queryKey: ['payslip-advances', currentPeriod?.id, selectedEmpId],
    queryFn: async () => {
      if (!currentPeriod?.id || !selectedEmpId) return []
      const { data, error } = await supabase
        .from('advance_payments')
        .select('*')
        .eq('period_id', currentPeriod.id)
        .eq('employee_id', selectedEmpId)
        .order('created_at', { ascending: true })
      if (error) return []
      return data || []
    },
    enabled: !!currentPeriod?.id && !!selectedEmpId,
    staleTime: 0,
  })

  // Fetch ALL shifts for period (Diamond), filter by employee in JS
  const { data: allShifts = [] } = useQuery<any[]>({
    queryKey: ['payslip-all-shifts', currentPeriod?.id],
    queryFn: async () => {
      const PAGE = 1000
      let all: any[] = []
      let from = 0
      while (true) {
        const { data, error } = await supabase.from('shift_assignments' as any)
          .select('employee_id,work_date,is_holiday_ot,is_holiday_ot_exempt,is_half_shift,actual_hours,ot_hours')
          .eq('period_id', currentPeriod.id)
          .range(from, from + PAGE - 1)
        if (error) throw error
        all = all.concat(data ?? [])
        if (!data || data.length < PAGE) break
        from += PAGE
      }
      return all
    }, enabled: !!currentPeriod?.id && !isTpi, staleTime: 0,
  })
  const empShifts = allShifts.filter((s: any) => s.employee_id === selectedEmpId)

  // Fetch ALL shifts for period (TPI)
  const { data: allTpiShifts = [] } = useQuery<TpiShiftRow[]>({
    queryKey: ['payslip-all-tpi-shifts', currentPeriod?.id, user?.factory_id],
    queryFn: async () => {
      if (!currentPeriod?.period_start || !currentPeriod?.period_end) return []
      const PAGE = 1000
      let all: any[] = []
      let from = 0
      while (true) {
        try {
          const { data, error } = await supabase
            .from('tpi_shift_entries' as any)
            .select('id,work_date,employee_id,shift_index,job_id,job_code_snapshot,rate_tier,rate_snapshot,is_half_shift,actual_hours,ot_hours,ot_pay,is_holiday_ot')
            .eq('factory_id', user?.factory_id ?? '')
            .gte('work_date', currentPeriod.period_start)
            .lte('work_date', currentPeriod.period_end)
            .range(from, from + PAGE - 1)

          if (error) {
            const fallback = await supabase
              .from('tpi_shift_entries' as any)
              .select('id,work_date,employee_id,shift_index,job_id,job_code_snapshot,rate_tier,rate_snapshot')
              .eq('factory_id', user?.factory_id ?? '')
              .gte('work_date', currentPeriod.period_start)
              .lte('work_date', currentPeriod.period_end)
              .range(from, from + PAGE - 1)
            if (fallback.error) break
            all = all.concat(fallback.data ?? [])
            if (!fallback.data || fallback.data.length < PAGE) break
          } else {
            all = all.concat(data ?? [])
            if (!data || data.length < PAGE) break
          }
        } catch {
          break
        }
        from += PAGE
      }
      return all as TpiShiftRow[]
    },
    enabled: !!currentPeriod?.id && !!user?.factory_id && isTpi,
    staleTime: 0,
  })
  const empTpiShifts = allTpiShifts.filter((s: any) => s.employee_id === selectedEmpId)

  const selectedEmp = employees.find(e => e.id === selectedEmpId) ?? null
  const savedIds = new Set(allEntries.map((e: any) => e.employee_id))

  const checkIsOverridden = (e: any) => {
    if (!e) return false
    return (
      e.override_normal != null ||
      e.override_shift != null ||
      e.override_ot != null ||
      (e.override_special != null && e.amount_special != null && Number(e.override_special) !== Number(e.amount_special)) ||
      (e.override_reason && String(e.override_reason).trim() !== '')
    )
  }

  const overriddenIds = useMemo(() => {
    const set = new Set<string>()
    for (const e of allEntries) {
      if (checkIsOverridden(e)) set.add(e.employee_id)
    }
    return set
  }, [allEntries])

  const overrideInfo = useMemo(() => {
    if (!entry) return { isOverridden: false, details: [] as string[] }
    const details: string[] = []
    if (entry.override_normal != null) {
      details.push(`ค่าจ้างปกติ (฿${Number(entry.override_normal).toLocaleString()})`)
    }
    if (entry.override_shift != null) {
      details.push(`ค่ากะ (฿${Number(entry.override_shift).toLocaleString()})`)
    }
    if (entry.override_ot != null) {
      details.push(`ค่า OT (฿${Number(entry.override_ot).toLocaleString()})`)
    }
    if (entry.override_special != null && entry.amount_special != null && Number(entry.override_special) !== Number(entry.amount_special)) {
      details.push(`เงินพิเศษ (฿${Number(entry.override_special).toLocaleString()})`)
    }
    if (entry.override_reason && String(entry.override_reason).trim() !== '') {
      const reasonParts = String(entry.override_reason).split(',').map((s: string) => s.trim()).filter(Boolean)
      for (const p of reasonParts) {
        if (p.startsWith('ค่าตำแหน่ง:') || p.startsWith('ค่า จป.:') || p.startsWith('ค่าจ้างปกติกะแรก:') || p.startsWith('ค่ากะ:') || p.startsWith('เบี้ยขยัน:')) {
          const [lbl, val] = p.split(':')
          if (!details.some(d => d.includes(lbl.trim()))) {
            details.push(`${lbl.trim()} (${val?.trim() || ''})`)
          }
        } else if (!details.some(d => d.includes(p))) {
          details.push(`เหตุผล: ${p}`)
        }
      }
    }
    return {
      isOverridden: details.length > 0,
      details
    }
  }, [entry])

  // ── shift breakdown (mirrors PayrollEntry logic exactly) ──
  const isWeekend = (d: string) => { const day = new Date(d).getDay(); return day === 0 || day === 6 }
  const empIsClerk = selectedEmp?.position === 'clerk'
  const normShifts = empShifts.filter((s: any) => !s.is_holiday_ot || s.is_holiday_ot_exempt)
  const holShifts  = empShifts.filter((s: any) => s.is_holiday_ot && !s.is_holiday_ot_exempt)
  const normDays   = normShifts.filter((s: any) => !s.is_half_shift && !s.actual_hours).length
  const halfDays   = normShifts.filter((s: any) => s.is_half_shift && !s.actual_hours).length
  const partialHrs = normShifts.reduce((a: number, s: any) => a + Number(s.actual_hours || 0), 0)
  const holFull    = holShifts.filter((s: any) => !s.is_half_shift).length
  const holHalf    = holShifts.filter((s: any) => s.is_half_shift).length
  const clerkNorm  = normShifts.filter((s: any) => !isWeekend(s.work_date)).length
  const clerkOt    = empShifts.filter((s: any) => !isWeekend(s.work_date)).reduce((a: number, s: any) => a + Number(s.ot_hours || 0), 0)
  const clerkOt1x  = empShifts.filter((s: any) => isWeekend(s.work_date)).reduce((a: number, s: any) => a + Number(s.ot_hours || 0), 0)
  const workerNormalDays = normDays
  // For display labels
  const daysShift = empIsClerk
    ? normShifts.filter((s: any) => isWeekend(s.work_date)).length
    : workerNormalDays

  // ── rate breakdown ──
  const empRate     = Number(selectedEmp?.rate_per_12h) || 0
  const baseNormal  = empRate === 0 ? 0 : 357
  const baseShift   = Math.max(0, empRate - baseNormal)
  const clerkDaily  = empRate / 30
  const clerkHourly = clerkDaily / 8
  const isThai      = !selectedEmp?.nationality || selectedEmp.nationality === 'ไทย'

  // ── outdated detection ──
  let isOutdated = false
  if (entry && selectedEmp) {
    if (isTpi) {
      if (empTpiShifts.length > 0 && currentPeriod) {
        const c = calculateTpiPayroll({
          employee: selectedEmp,
          shifts: empTpiShifts,
          advances: entry.deduct_advance ? [{ amount: Number(entry.deduct_advance) }] : [],
          period: currentPeriod,
          overrides: {
            override_normal: entry.override_normal != null ? Number(entry.override_normal) : null,
            override_shift: entry.override_shift != null ? Number(entry.override_shift) : null,
          },
          extras: {
            amount_diligence: Number(entry.amount_diligence || 0),
            amount_position: Number(entry.amount_position || 0),
            amount_special: Number(entry.amount_special || 0),
            special_note: entry.special_note || '',
            deduct_safety_equipment: Number(entry.deduct_safety_equipment || 0),
            deduct_uniform: Number(entry.deduct_uniform || 0),
          },
        })
        const eps = 0.5
        const checks: [number, number][] = [
          [c.effectiveNormal, Number(entry.amount_normal || 0)],
          [c.effectiveShift,  Number(entry.amount_shift || 0)],
          [c.totalOtPay,     Number(entry.amount_ot || 0)],
          [c.deductSocialSecurity, Number(entry.deduct_social_security || 0)],
        ]
        isOutdated = checks.some(([a, b]) => Math.abs(a - b) > eps)
      }
    } else if (empShifts.length > 0) {
      const periodDays = currentPeriod ? (() => {
        const s = new Date(currentPeriod.period_start + 'T00:00:00')
        const e = new Date(currentPeriod.period_end + 'T00:00:00')
        return Math.round((e.getTime() - s.getTime()) / 86400000) + 1
      })() : undefined
      const c = calculatePayroll({
        position: selectedEmp.position as 'worker' | 'clerk',
        wage_type: selectedEmp.wage_type as 'daily' | 'monthly',
        rate_per_12h: empRate,
        normal_days: empIsClerk ? clerkNorm : normDays,
        period_days: empIsClerk ? periodDays : undefined,
        half_shift_days: empIsClerk ? 0 : halfDays,
        holiday_ot_full_days: holFull, holiday_ot_half_days: holHalf,
        partial_hours_total: empIsClerk ? 0 : partialHrs,
        clerk_ot_hours: clerkOt, clerk_ot_1x_hours: clerkOt1x,
        override_normal: entry.override_normal != null ? Number(entry.override_normal) : null,
        override_special: null,
        amount_wood_excess: 0, amount_film: 0, amount_special: 0,
        amount_diligence: 0, amount_position: 0,
        social_security_rate: (isThai && !selectedEmp?.exempt_social_security) ? Number(currentPeriod?.social_security_rate ?? 0.05) : 0,
        deduct_advance: 0, deduct_safety_equipment: 0, deduct_uniform: 0,
      })
      const eps = 0.5
      const checks: [number, number][] = [
        [c.amount_normal,              Number(entry.amount_normal)],
        [c.amount_shift,               Number(entry.amount_shift)],
        [c.amount_ot + c.amount_ot_1x, Number(entry.amount_ot)],
        [c.deduct_social_security,     Number(entry.deduct_social_security)],
      ]
      isOutdated = checks.some(([a, b]) => Math.abs(a - b) > eps)
    }
  }

  // ── computed fields ──
  let workingDays = 0
  const income = entry ? (() => {
    const amtNormal  = Number(entry.amount_normal  || 0)
    const amtShift   = Number(entry.amount_shift   || 0)
    const amtOtRaw   = Number(entry.amount_ot      || 0)  // combined OT in DB for clerks
    const amtOt1xRaw = Number(entry.amount_ot_1x   || 0)
    const amtSpecial = Number(entry.amount_special  || 0) + Number(entry.override_special || 0)

    if (isTpi) {
      let tpiCalc: TpiPayrollCalculationResult | null = null
      if (selectedEmp && currentPeriod && empTpiShifts.length > 0) {
        tpiCalc = calculateTpiPayroll({
          employee: selectedEmp,
          shifts: empTpiShifts,
          advances: entry.deduct_advance ? [{ amount: Number(entry.deduct_advance) }] : [],
          period: currentPeriod,
          overrides: {
            override_normal: entry.override_normal != null ? Number(entry.override_normal) : null,
            override_shift: entry.override_shift != null ? Number(entry.override_shift) : null,
          }
        })
      }

      // Base rate for TPI
      const tpiFallbackRate = empRate > 0 ? empRate : 357

      // Normal days
      const tpiDnDays = tpiCalc ? tpiCalc.workDaysCount : (amtNormal > 0 ? Math.round(amtNormal / tpiFallbackRate) : 0)
      const tpiNormalRate = tpiDnDays > 0 ? Math.round(amtNormal / tpiDnDays) : tpiFallbackRate

      // Shift (2nd shift / ควบกะ)
      const tpiDsDays = amtShift > 0
        ? (tpiCalc
            ? Math.max(0, tpiCalc.totalShiftsCount - tpiCalc.workDaysCount)
            : Math.round(amtShift / tpiFallbackRate))
        : 0
      const tpiShiftRate = tpiDsDays > 0 ? Math.round(amtShift / tpiDsDays) : tpiFallbackRate

      workingDays = tpiDnDays

      const detailNormal = !isOutdated && tpiDnDays > 0
        ? `฿${tpiNormalRate} × ${tpiDnDays} วัน`
        : null

      const detailShift = !isOutdated && tpiDsDays > 0
        ? `฿${tpiShiftRate} × ${tpiDsDays} วัน`
        : null

      // ── Separate OT: Holiday OT (2x) vs Regular OT (1.5x for worker, 2x for clerk) ──
      let amtHolidayOt = 0
      let amtRegularOt = 0
      if (tpiCalc) {
        const calcH = tpiCalc.amountHolidayOt
        const calcR = tpiCalc.regularOtPay
        if (entry.override_ot != null) {
          const ovr = Number(entry.override_ot)
          if (calcH + calcR > 0) {
            const ratio = calcH / (calcH + calcR)
            amtHolidayOt = Math.round(ovr * ratio)
            amtRegularOt = ovr - amtHolidayOt
          } else {
            amtHolidayOt = 0
            amtRegularOt = ovr
          }
        } else {
          amtHolidayOt = calcH
          amtRegularOt = calcR
        }
      } else {
        // Fallback when no shift detail rows in DB
        amtHolidayOt = 0
        amtRegularOt = amtOtRaw
      }

      // Holiday OT detail (2x base rate)
      let detailHolidayOt: string | null = null
      if (!isOutdated && amtHolidayOt > 0) {
        const hCount = tpiCalc ? tpiCalc.holidayShiftsCount : (tpiNormalRate > 0 ? Math.round(amtHolidayOt / (tpiNormalRate * 2)) : 0)
        if (hCount > 0) {
          detailHolidayOt = `฿${tpiNormalRate} × 2 × ${hCount} วัน`
        }
      }

      // Regular OT detail: 1.5x hourly for worker, 2x full 8h shift for clerk
      let detailRegularOt: string | null = null
      if (!isOutdated && amtRegularOt > 0) {
        if (empIsClerk) {
          const clerkOtShifts = tpiNormalRate > 0 ? Math.round(amtRegularOt / (tpiNormalRate * 2)) : 0
          if (clerkOtShifts > 0) {
            detailRegularOt = `฿${tpiNormalRate} × 2 × ${clerkOtShifts} วัน (กะ 8 ชม.)`
          }
        } else {
          const otHrs = tpiCalc ? tpiCalc.totalOtHours : (tpiNormalRate > 0 ? Math.round(amtRegularOt / ((tpiNormalRate / 8) * 1.5)) : 0)
          if (otHrs > 0) {
            detailRegularOt = `(฿${tpiNormalRate} ÷ 8) × 1.5 × ${otHrs} ชม.`
          }
        }
      }

      // ── Special Allowance Category (เงินพิเศษ) & Sub-categories (ค่าตำแหน่ง, ค่า จป., เงินพิเศษอื่นๆ) ──
      const amtPos = Number(entry.amount_position || 0)
      const amtSpec = Number(entry.amount_special || 0)
      const totalSpecial = amtPos + amtSpec

      const specialSubs: string[] = []
      if (amtPos > 0) {
        specialSubs.push(`ค่าตำแหน่ง ฿${amtPos.toLocaleString()}`)
      }
      if (entry.special_note) {
        const notes = (entry.special_note as string).split(',').map(s => s.trim()).filter(Boolean)
        notes.forEach(n => {
          if (!n.includes('ค่าตำแหน่ง') && !specialSubs.includes(n)) {
            specialSubs.push(n)
          }
        })
      } else if (amtSpec > 0) {
        specialSubs.push(`ค่า จป. ฿${amtSpec.toLocaleString()}`)
      }

      return [
        { label: 'ค่าจ้างปกติ (8 ชม.)',                   value: amtNormal,    detail: detailNormal,    subs: [] as string[] },
        { label: 'ค่ากะ',                                 value: amtShift,     detail: detailShift,     subs: [] },
        { label: 'OT วันหยุดนักขัตฤกษ์ (×2)',              value: amtHolidayOt, detail: detailHolidayOt, subs: [] },
        { label: empIsClerk ? 'OT ล่วงเวลา (×2)' : 'OT ล่วงเวลา (×1.5)', value: amtRegularOt, detail: detailRegularOt, subs: [] },
        { label: 'เบี้ยขยัน',                             value: Number(entry.amount_diligence || 0),   detail: null, subs: [] },
        { label: 'เงินพิเศษ',                             value: totalSpecial,                          detail: null, subs: specialSubs },
      ].filter(r => r.value > 0 && r.label !== '')
    }

    // For clerks: DB stores combined OT (1.5x weekday + 1x weekend) in amount_ot.
    // Split it back using shift hour counts when not outdated.
    const clerkOtAmt   = empIsClerk && !isOutdated ? clerkHourly * 1.5 * clerkOt   : 0
    const clerkOt1xAmt = empIsClerk && !isOutdated ? clerkHourly * 1.0 * clerkOt1x : 0
    // For outdated or worker, use raw stored values
    const amtOt   = empIsClerk && !isOutdated ? clerkOtAmt   : amtOtRaw
    const amtOt1x = empIsClerk && !isOutdated ? clerkOt1xAmt : amtOt1xRaw

    // Derive day/hour counts from amounts ÷ current rate for display
    const dnDays  = baseNormal > 0 ? Math.round(amtNormal / (empIsClerk ? clerkDaily  : baseNormal)) : 0
    const dsDays  = baseShift  > 0 ? Math.round(amtShift  / baseShift)  : 0
    const otHrs   = clerkHourly > 0 && empIsClerk ? Math.round(amtOt   / (clerkHourly * 1.5)) : 0
    const ot1Hrs  = clerkHourly > 0 && empIsClerk ? Math.round(amtOt1x / clerkHourly)         : 0
    const otDays  = !empIsClerk && empRate > 0 ? Math.round(amtOtRaw / (empRate * 2)) : 0
    workingDays = empIsClerk ? (dnDays + daysShift + holFull + holHalf) : (dnDays + holFull + holHalf)

    // Detail lines with formula for all employee types
    const detailNormal = !isOutdated && dnDays > 0
      ? (empIsClerk ? `฿${Math.round(clerkDaily)} × ${dnDays} วัน` : `฿${baseNormal} × ${dnDays} วัน`)
      : null
    const detailShift  = !isOutdated && dsDays > 0 && !empIsClerk ? `฿${Math.round(baseShift)} × ${dsDays} วัน` : null
    const detailOt     = !isOutdated
      ? (empIsClerk && otHrs  > 0 ? `฿${clerkHourly.toFixed(2)} × 1.5 × ${otHrs} ชม.`  : null)
      || (!empIsClerk && otDays > 0 ? `฿${empRate} × 2 × ${otDays} วัน`                 : null)
      : null
    const detailOt1x   = !isOutdated && empIsClerk && ot1Hrs > 0
      ? `฿${clerkHourly.toFixed(2)} × 1.0 × ${ot1Hrs} ชม. (${daysShift} วัน)` : null

    // split special_note by comma into individual sub-lines
    const specialSubs = entry.special_note
      ? (entry.special_note as string).split(',').map((s: string) => s.trim()).filter(Boolean)
      : []
    return [
      { label: empIsClerk ? 'ค่าจ้างปกติ (วันธรรมดา)' : 'ค่าจ้างปกติ (8 ชม.)', value: Number(entry.amount_normal || 0), detail: detailNormal, subs: [] as string[] },
      { label: 'ค่ากะ (4 ชม.)',                                             value: !empIsClerk ? amtShift : 0,           detail: detailShift,  subs: [] },
      { label: empIsClerk ? 'OT ล่วงเวลา (×1.5)' : 'OT วันหยุดนักขัตฤกษ์ (×2)', value: amtOt,                           detail: detailOt,     subs: [] },
      { label: empIsClerk && !isTpi ? 'OT วันหยุดสัปดาห์ (×1)' : '',        value: (empIsClerk && !isTpi) ? amtOt1x : 0, detail: detailOt1x,   subs: [] },
      { label: 'ค่าไม้ส่วนเกิน',  value: Number(entry.amount_wood_excess || 0), detail: null, subs: [] },
      { label: 'ค่าฟิล์ม',        value: Number(entry.amount_film || 0),        detail: null, subs: [] },
      { label: 'เงินพิเศษ',       value: amtSpecial,                            detail: null, subs: specialSubs },
      { label: 'เบี้ยขยัน',       value: Number(entry.amount_diligence || 0),   detail: null, subs: [] },
      { label: 'ค่าตำแหน่ง',      value: Number(entry.amount_position || 0),    detail: null, subs: [] },
    ].filter(r => r.value > 0 && r.label !== '')
  })() : []

  const deductions = entry ? (() => {
    const list: SlipDeductRow[] = []
    if (Number(entry.deduct_social_security || 0) > 0) {
      list.push({ label: 'ประกันสังคม', value: Number(entry.deduct_social_security) })
    }

    if (empAdvances.length > 0) {
      const regAdvances = empAdvances.filter(a => {
        const n = a.notes || ''
        return !n.includes('[สแกนหน้าไม่สำเร็จ]') &&
          !n.includes('สแกนหน้าไม่สำเร็จ') &&
          !n.includes('[ลงโทษ ขาดงานไม่มีคนแทน]') &&
          !n.includes('ลงโทษ ขาดงาน') &&
          !n.includes('[ลงโทษ ขาด/ลา/มาสาย]') &&
          !n.includes('ลงโทษ ขาด/ลา/มาสาย') &&
          !n.includes('[หักค่าปรับ จป.]') &&
          !n.includes('หักค่าปรับผิดระเบียบ') &&
          !n.includes('ค่าปรับผิดระเบียบ')
      })
      const scanAdvances = empAdvances.filter(a => (a.notes || '').includes('[สแกนหน้าไม่สำเร็จ]') || (a.notes || '').includes('สแกนหน้าไม่สำเร็จ'))
      const discAdvances = empAdvances.filter(a => {
        const n = a.notes || ''
        return n.includes('[ลงโทษ ขาดงานไม่มีคนแทน]') || n.includes('ลงโทษ ขาดงาน') || n.includes('[ลงโทษ ขาด/ลา/มาสาย]') || n.includes('ลงโทษ ขาด/ลา/มาสาย')
      })
      const safetyAdvances = empAdvances.filter(a => {
        const n = a.notes || ''
        return n.includes('[หักค่าปรับ จป.]') || n.includes('หักค่าปรับผิดระเบียบ') || n.includes('ค่าปรับผิดระเบียบ')
      })

      const sumAdv = (arr: any[]) => arr.reduce((s, a) => s + Number(a.amount || 0), 0)

      if (regAdvances.length > 0) {
        list.push({ label: 'เบิกล่วงหน้า', value: sumAdv(regAdvances) })
      }
      if (scanAdvances.length > 0) {
        list.push({ label: 'หักสแกนหน้าไม่ผ่าน', value: sumAdv(scanAdvances), detail: `${scanAdvances.length} รายการ` })
      }
      if (discAdvances.length > 0) {
        for (const d of discAdvances) {
          const m = (d.notes || '').match(/วันที่:\s*([\d\/\-]+)/)
          const thaiDate = m ? formatThaiDateDDMMYYYY(m[1]) : ''

          let baseRate = 0
          const rateMatch = (d.notes || '').match(/(?:ปกติ|ช่างฝีมือ|ค่าแรงฝีมือ)\s*฿([\d,]+(?:\.\d+)?)/)
          if (rateMatch) {
            baseRate = parseFloat(rateMatch[1].replace(/,/g, ''))
          } else if (d.amount) {
            baseRate = Number(d.amount) / 2
          }

          const rateStr = baseRate > 0 ? `฿${baseRate.toLocaleString('th-TH')}` : ''
          const calcParts: string[] = []
          if (rateStr) {
            calcParts.push(`${rateStr} × 2 เท่า`)
          } else {
            calcParts.push('หัก 2 เท่า')
          }
          if (thaiDate) {
            calcParts.push(`(วันที่ ${thaiDate})`)
          }

          list.push({
            label: 'หักลงโทษขาดงานไม่มีคนแทน',
            value: Number(d.amount || 0),
            detail: calcParts.join(' '),
          })
        }
      }
      if (safetyAdvances.length > 0) {
        for (const s of safetyAdvances) {
          const infoMatch = (s.notes || '').match(/หักค่าปรับผิดระเบียบ\s*(\([^\)]+\))/)
          let infoStr = infoMatch ? infoMatch[1] : ''
          if (infoStr && /วันที่\s*\d{4}[-\/]/.test(infoStr)) {
            infoStr = infoStr.replace(/วันที่\s*([\d\/\-]+)/, (_, d) => `วันที่ ${formatThaiDateDDMMYYYY(d)}`)
          }
          const label = infoStr
            ? `หักค่าปรับผิดระเบียบ\n${infoStr}`
            : ((s.notes || '').match(/(หักค่าปรับผิดระเบียบ\s*\([^\)]+\))/)?.[1] || 'หักค่าปรับผิดระเบียบ')
          const reasonMatch = (s.notes || '').match(/สาเหตุ:\s*([^\|]+)/)
          const reason = reasonMatch ? `สาเหตุ: ${reasonMatch[1].trim()}` : null
          list.push({
            label,
            value: Number(s.amount || 0),
            detail: reason,
          })
        }
      }
    } else if (Number(entry.deduct_advance || 0) > 0) {
      list.push({ label: 'เบิกล่วงหน้า', value: Number(entry.deduct_advance) })
    }

    if (Number(entry.deduct_safety_equipment || 0) > 0) {
      list.push({ label: 'ค่าอุปกรณ์ความปลอดภัย', value: Number(entry.deduct_safety_equipment) })
    }
    if (Number(entry.deduct_uniform || 0) > 0) {
      list.push({ label: 'ค่าเสื้อพนักงาน', value: Number(entry.deduct_uniform) })
    }
    return list
  })() : []

  const totalIncome = income.reduce((s, r) => s + r.value, 0)
  const totalDeduct = deductions.reduce((s, r) => s + r.value, 0)
  const netPay = totalIncome - totalDeduct

  const posLabel = selectedEmp ? (POSITIONS[selectedEmp.position] || selectedEmp.position || '') : ''

  return (
    <>
      <TopBar title="สลิปเงินเดือน" subtitle={currentPeriod?.label} onMenuClick={onMenuClick} />

      <div className="vk-split">

        {/* ── Left panel — hidden on mobile when employee is selected ── */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}
          className={`vk-sidebar-scrollable vk-sidebar-scrollable-payroll ${selectedEmpId ? 'hidden md:block' : ''}`}>

          {/* Sticky header — does not scroll */}
          <div style={{ flexShrink: 0, padding: '16px 12px 0' }}>
            {/* Period Selector */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span className="vk-eyebrow" style={{ fontSize: 10 }}>งวดการจ่ายเงิน</span>
                {currentPeriod && (
                  <span style={{ fontSize: 10, color: currentPeriod.status === 'approved' ? 'var(--vk-jade)' : 'var(--vk-ink-3)', fontWeight: 600 }}>
                    {currentPeriod.status === 'approved' ? 'อนุมัติแล้ว' : 'ฉบับร่าง'}
                  </span>
                )}
              </div>
              <select
                value={selectedPeriodId ?? ''}
                onChange={e => setSelectedPeriodId(e.target.value)}
                style={{
                  width: '100%',
                  height: 32,
                  fontFamily: 'var(--vk-sans)',
                  fontSize: 12,
                  fontWeight: 600,
                  border: '1px solid var(--vk-rule)',
                  padding: '0 8px',
                  background: 'var(--vk-bone)',
                  color: 'var(--vk-ink)',
                  outline: 'none',
                  cursor: 'pointer',
                  boxSizing: 'border-box'
                }}
              >
                {periods.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.label} {p.status === 'approved' ? '✓' : '(ร่าง)'}
                  </option>
                ))}
              </select>
            </div>

            <div className="vk-eyebrow" style={{ marginBottom: 8 }}>พนักงาน ({employees.length})</div>
            <div style={{ display: 'flex', gap: 6, fontSize: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              {([
                { key: 'has_slip', color: 'var(--vk-jade)', label: 'มีสลิป' },
                { key: 'override', color: '#d97706',        label: `มี Override (${overriddenIds.size})` },
                { key: 'no_slip',  color: '#d4cfc9',        label: 'ยังไม่มี' },
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
            const hasSaved = savedIds.has(emp.id)
            const hasOvr = overriddenIds.has(emp.id)
            const matchStatus = !statusFilter
              ? true
              : statusFilter === 'has_slip'
              ? hasSaved
              : statusFilter === 'override'
              ? hasOvr
              : !hasSaved
            return matchSearch && matchStatus
          }).map(emp => {
            const hasSaved = savedIds.has(emp.id)
            const hasOvr = overriddenIds.has(emp.id)
            const active = emp.id === selectedEmpId
            const n = fmtNationality(emp.nationality)
            const isInactive = emp.status === 'inactive'
            return (
              <div key={emp.id} onClick={() => setSelectedEmpId(emp.id)}
                className="vk-employee-card"
                data-selected={active}>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: hasOvr ? '#f59e0b' : (hasSaved ? 'var(--vk-jade)' : '#d4cfc9') }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, gap: 4 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--vk-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {formatEmployeeFullName(emp, isTpi)}{n ? ` (${n})` : ''}
                        </span>
                        {isSkilledEmp(emp) && (
                          <span title="พนักงานค่าแรงฝีมือ" style={{ flexShrink: 0, fontSize: 13 }}>
                            ⭐
                          </span>
                        )}
                      </div>
                      {hasOvr && (
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#fffbeb', color: '#b45309', border: '1px solid #fcd34d', flexShrink: 0 }}>
                          Override
                        </span>
                      )}
                      {emp.position === 'clerk' && (
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: 'rgba(177,71,41,0.12)', color: 'var(--vk-persimmon)', letterSpacing: '0.04em', flexShrink: 0 }}>เสมียน</span>
                      )}
                      {isInactive && (
                        <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 4, background: '#fee2e2', color: '#991b1b', flexShrink: 0 }}>ไม่ใช้งาน</span>
                      )}
                    </div>
                    <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 10, color: 'var(--vk-ink-3)', marginTop: 1 }}>{emp.employee_code}</div>
                  </div>
                </div>
              </div>
            )
          })}
          </div>
        </div>

        {/* ── Right panel ── */}
        <div style={{ overflowY: 'auto', padding: '16px', background: 'var(--vk-bone)' }} className="md:px-8 md:py-6">
          {selectedEmp && (
            <button className="vk-btn md:hidden" style={{ marginBottom: 12, fontSize: 12, padding: '5px 12px' }}
              onClick={() => setSelectedEmpId(null)}>← กลับ</button>
          )}
          {!selectedEmp ? (
            <div style={{ paddingTop: 60, textAlign: 'center' }}>
              <div className="vk-eyebrow" style={{ marginBottom: 8 }}>เลือกพนักงานจากรายการทางซ้าย</div>
              <div className="vk-small" style={{ color: 'var(--vk-ink-3)' }}>จุดสีเขียวหมายถึงมีสลิปในงวดที่เลือก พร้อมพิมพ์</div>
            </div>
          ) : (
            <>
              {/* Header bar with Period selector & Print button */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="vk-eyebrow" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>งวด:</span>
                  <select
                    value={selectedPeriodId ?? ''}
                    onChange={e => setSelectedPeriodId(e.target.value)}
                    style={{
                      height: 32,
                      fontFamily: 'var(--vk-sans)',
                      fontSize: 12,
                      fontWeight: 600,
                      border: '1px solid var(--vk-rule)',
                      padding: '0 8px',
                      background: 'var(--vk-paper)',
                      color: 'var(--vk-ink)',
                      outline: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    {periods.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.label} {p.status === 'approved' ? '✓' : '(ร่าง)'}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {entry && (
                    <button className="vk-btn vk-btn--primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={handlePrint}>
                      <Printer style={{ width: 14, height: 14 }} />พิมพ์สลิป
                    </button>
                  )}
                </div>
              </div>

              {!entry ? (
                <div style={{ padding: 40, textAlign: 'center', border: '1px solid var(--vk-rule)', background: 'var(--vk-paper)' }}>
                  <div className="vk-eyebrow" style={{ marginBottom: 6 }}>ยังไม่มีข้อมูลค่าจ้างใน{currentPeriod?.label || 'งวดนี้'}</div>
                  <div className="vk-small" style={{ color: 'var(--vk-ink-3)' }}>พนักงานท่านนี้ยังไม่มีข้อมูลค่าจ้างในงวดที่เลือก หรือกรุณาบันทึกค่าจ้างที่หน้า "กรอกค่าจ้าง" ก่อน</div>
                </div>
              ) : (
                <>
                  {/* OVERRIDE warning banner */}
                  {overrideInfo.isOverridden && (
                    <div style={{ marginBottom: 12, background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 6, padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 18 }}>⚠️</span>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13, color: '#92400e' }}>สลิปนี้มีการปรับแก้ตัวเลขค่าจ้างด้วยตนเอง (Manual Override)</div>
                          <div style={{ fontSize: 11, color: '#b45309', marginTop: 2 }}>
                            รายการที่ปรับแก้: {overrideInfo.details.join(' · ')}
                          </div>
                        </div>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                        MANUAL OVERRIDE
                      </span>
                    </div>
                  )}

                  {/* OUTDATED warning */}
                  {isOutdated && (
                    <div style={{ marginBottom: 12, background: '#fff3cd', border: '1px solid #f5c842', borderRadius: 6, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 16 }}>⚠️</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: '#7a5c00' }}>ข้อมูลค่าจ้างไม่ตรงกับอัตราปัจจุบัน</div>
                        <div style={{ fontSize: 11, color: '#9a7500', marginTop: 2 }}>อัตราค่าจ้างถูกแก้ไขหลังจากบันทึก กรุณาไปที่หน้า "กรอกค่าจ้าง" แล้วบันทึกใหม่อีกครั้งก่อนพิมพ์สลิป</div>
                      </div>
                    </div>
                  )}

                  {/* ══ SLIP ══════════════════════════════════════════════════════ */}
                  {/* On mobile: scale the slip to fit viewport width */}
                  <div className="vk-slip-scaler" ref={scalerRef}>
                    <div id="slip-print" ref={(el) => { (slipRef as any).current = el; (innerRef as any).current = el }} style={{ width: 680, minWidth: 680 }}>
                    <VKSlipDocument
                      branchName={branchName ? fullCompanyName(branchName) : undefined}
                      employeeName={formatEmployeeFullName(selectedEmp, isTpi)}
                      employeeCode={selectedEmp.employee_code}
                      isSkilled={isSkilledEmp(selectedEmp)}
                      positionLabel={posLabel}
                      jobTitle={selectedEmp.job_title}
                      periodLabel={currentPeriod ? thaiPeriod(currentPeriod.period_start, currentPeriod.period_end) : '—'}
                      paymentMethod={selectedEmp.payment_method === 'bank_transfer' ? 'bank_transfer' : 'cash'}
                      bankName={selectedEmp.bank_name}
                      bankAccount={maskBank(selectedEmp.bank_account)}
                      income={income}
                      deductions={deductions}
                      totalIncome={totalIncome}
                      totalDeduct={totalDeduct}
                      netPay={netPay}
                      workingDays={workingDays}
                      isOutdated={isOutdated}
                    />
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
