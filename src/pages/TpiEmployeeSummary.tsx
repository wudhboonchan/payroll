import React, { useState, useEffect, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { Search, X, CreditCard, FileSpreadsheet, Printer, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatPeriodLabel, formatEmployeeFullName, compareEmployeeCode, filterActivePeriods } from '../lib/formatters'
import { SHIFTS, isTpiJobCode } from '../features/tpi/model'
import { employeeWageForm } from '../features/tpi/employeeWageForm'
import { referenceJobs } from '../features/tpi/referenceJobs'
import { calculateTpiPayroll, type TpiShiftRow } from '../features/tpi/payrollCalc'
import { getStoredHolidaysForFactory } from './TpiPayrollEntry'
import { buildTpiEmployeeSummaryFullHtml, buildTpiEmployeeSummaryExcelRows } from '../features/tpi/tpiSummaryExport'
import '../styles/tokens.css'

// ── Helpers ──────────────────────────────────────────────────────────────────
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

const MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']

function fmtDisplayDate(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return `วัน${DAYS[date.getDay()]}ที่ ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`
}

function getDatesInRange(startStr: string, endStr: string) {
  const dates: string[] = []
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

const monoNum = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function chipStyle(color: string, bg: string): React.CSSProperties {
  return { fontSize: 10, fontWeight: 700, padding: '2px 6px', color, background: bg, whiteSpace: 'nowrap' as const, borderRadius: 2 }
}

function thaiDateTimeNow() {
  const now = new Date()
  const MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']
  const hh = String(now.getHours()).padStart(2, '0'), mm = String(now.getMinutes()).padStart(2, '0')
  return `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear() + 543} เวลา ${hh}:${mm} น.`
}

// ── PDF / Print HTML Builder for TPI ─────────────────────────────────────────
const buildTpiEmployeeSummaryPdfHtml = buildTpiEmployeeSummaryFullHtml

export default function TpiEmployeeSummary() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user } = useAppStore()
  const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null)
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)
  const [empSearch, setEmpSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'worked' | 'not_worked' | null>(null)
  const [onlyWorkedFilter, setOnlyWorkedFilter] = useState(false)
  const [isExportingExcel, setIsExportingExcel] = useState(false)
  const [isExportingPdf, setIsExportingPdf] = useState(false)

  // ── 1. Fetch Payroll Periods ──
  const { data: rawPeriods = [] } = useQuery<any[]>({
    queryKey: ['periods', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_periods').select('*')
        .eq('factory_id', user?.factory_id ?? '').order('period_start', { ascending: false })
      if (error) throw error
      return data
    },
    enabled: !!user?.factory_id,
  })

  const periods = useMemo(() => filterActivePeriods(rawPeriods), [rawPeriods])

  // Set default period once loaded
  useEffect(() => {
    if (periods.length > 0 && (!selectedPeriodId || !periods.some(p => p.id === selectedPeriodId))) {
      setSelectedPeriodId(periods[0].id)
    }
  }, [periods, selectedPeriodId])

  const currentPeriod = periods.find(p => p.id === selectedPeriodId) || periods[0]

  // ── 2. Fetch TPI Job Codes ──
  const { data: dbTpiJobCodes = [] } = useQuery<any[]>({
    queryKey: ['tpi-job-codes', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('tpi_job_codes')
        .select('*').eq('factory_id', user?.factory_id ?? '')
      if (error) return []
      return data || []
    },
    enabled: !!user?.factory_id,
  })

  const jobMap = useMemo(() => {
    const map = new Map<string, any>()
    const list = dbTpiJobCodes.length > 0 ? dbTpiJobCodes : referenceJobs
    list.forEach(j => map.set(j.code, j))
    return map
  }, [dbTpiJobCodes])

  // ── 3. Fetch TPI Wage Profiles ──
  const { data: dbWageProfiles = [] } = useQuery<any[]>({
    queryKey: ['tpi-profiles', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('tpi_employee_wage_profiles')
        .select('*').eq('factory_id', user?.factory_id ?? '')
      if (error) return []
      return data || []
    },
    enabled: !!user?.factory_id,
  })

  const isSkilledEmp = useMemo(() => {
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
  }, [dbWageProfiles, dbTpiJobCodes])

  // ── 4. Fetch Employees ──
  const { data: employees = [] } = useQuery<any[]>({
    queryKey: ['employees-summary-tpi', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees')
        .select('id,employee_code,prefix,first_name,last_name,nationality,position,job_title,wage_type,rate_per_12h,payment_method,bank_name,bank_account,exempt_social_security,is_safety_officer,has_position_allowance,national_id,social_security_number,data_complete')
        .eq('factory_id', user?.factory_id ?? '').eq('status', 'active').order('employee_code')
      if (error) throw error
      return (data || []).sort((a: any, b: any) => compareEmployeeCode(a.employee_code, b.employee_code))
    },
    enabled: !!user?.factory_id,
  })

  // ── 5. Fetch Shifts for Period (tpi_shift_entries) ──
  const { data: rawShifts = [] } = useQuery<TpiShiftRow[]>({
    queryKey: ['all-tpi-period-shifts-summary', currentPeriod?.id, user?.factory_id],
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
    enabled: !!currentPeriod?.id && !!user?.factory_id,
    staleTime: 0,
  })

  // 5.1. Fetch shift days from DB to detect factory holidays across all devices
  const { data: dbShiftDays = [] } = useQuery<{ work_date: string; is_holiday: boolean }[]>({
    queryKey: ['tpi-shift-days-period', currentPeriod?.id, user?.factory_id],
    queryFn: async () => {
      if (!currentPeriod?.period_start || !currentPeriod?.period_end || !user?.factory_id) return []
      try {
        const { data, error } = await supabase
          .from('tpi_shift_days')
          .select('work_date, is_holiday')
          .eq('factory_id', user.factory_id)
          .gte('work_date', currentPeriod.period_start)
          .lte('work_date', currentPeriod.period_end)
        if (error) return []
        return (data || []) as { work_date: string; is_holiday: boolean }[]
      } catch {
        return []
      }
    },
    enabled: !!currentPeriod?.id && !!user?.factory_id,
    staleTime: 0,
  })

  // Factory holiday dates resolved from DB days + DB shift entries + localStorage
  const factoryHolidayDates = useMemo(() => {
    const set = new Set<string>()
    dbShiftDays.forEach(d => {
      if (d.is_holiday) set.add(d.work_date)
    })
    rawShifts.forEach(s => {
      if (s.is_holiday_ot) set.add(s.work_date)
    })
    const storedHolidays = getStoredHolidaysForFactory(user?.factory_id)
    storedHolidays.forEach(d => set.add(d))
    return set
  }, [dbShiftDays, rawShifts, user?.factory_id])

  // Apply factory holidays
  const allTpiShifts = useMemo(() => {
    if (factoryHolidayDates.size === 0) return rawShifts
    return rawShifts.map(s => {
      if (factoryHolidayDates.has(s.work_date)) {
        return { ...s, is_holiday_ot: true }
      }
      return s
    })
  }, [rawShifts, factoryHolidayDates])

  // ── 6. Fetch Payroll Entries for Period ──
  const { data: allEntries = [] } = useQuery<any[]>({
    queryKey: ['summary-all-entries-tpi', currentPeriod?.id],
    queryFn: async () => {
      if (!currentPeriod?.id) return []
      const { data, error } = await supabase.from('payroll_entries' as any)
        .select('*').eq('period_id', currentPeriod.id)
      if (error) throw error
      return data || []
    },
    enabled: !!currentPeriod?.id,
  })

  // ── 7. Fetch Advances for Period ──
  const { data: allAdvances = [] } = useQuery<any[]>({
    queryKey: ['summary-all-advances-tpi', currentPeriod?.id],
    queryFn: async () => {
      if (!currentPeriod?.id) return []
      const { data, error } = await supabase.from('advance_payments')
        .select('employee_id,amount,request_date,notes,created_at')
        .eq('period_id', currentPeriod.id)
      if (error) throw error
      return data || []
    },
    enabled: !!currentPeriod?.id,
  })

  // Selected employee data resolution
  const selectedEmp = employees.find(e => e.id === selectedEmpId) ?? null
  const empShifts = useMemo(() => allTpiShifts.filter(s => s.employee_id === selectedEmpId), [allTpiShifts, selectedEmpId])
  const empEntry = useMemo(() => allEntries.find(e => e.employee_id === selectedEmpId) ?? null, [allEntries, selectedEmpId])
  const empAdvances = useMemo(() => allAdvances.filter(a => a.employee_id === selectedEmpId), [allAdvances, selectedEmpId])
  const activeIdsThisPeriod = useMemo(() => new Set(allTpiShifts.map(s => s.employee_id)), [allTpiShifts])

  // Calculate full TPI payroll result
  const payrollResult = useMemo(() => {
    if (!selectedEmp || !currentPeriod) return null

    return calculateTpiPayroll({
      employee: selectedEmp,
      shifts: empShifts,
      advances: empAdvances,
      period: currentPeriod,
      overrides: {
        override_normal: empEntry?.override_normal != null ? Number(empEntry.override_normal) : null,
        override_shift: empEntry?.override_shift != null ? Number(empEntry.override_shift) : null,
        override_ot: empEntry?.override_ot != null ? Number(empEntry.override_ot) : null,
        override_special: empEntry?.override_special != null ? Number(empEntry.override_special) : null,
      },
      extras: {
        amount_diligence: empEntry?.amount_diligence !== undefined ? Number(empEntry.amount_diligence) : undefined,
        amount_position: empEntry?.amount_position !== undefined ? Number(empEntry.amount_position) : undefined,
        amount_special: empEntry?.amount_special !== undefined ? Number(empEntry.amount_special) : undefined,
        special_note: empEntry?.special_note || '',
        deduct_safety_equipment: Number(empEntry?.deduct_safety_equipment || 0),
        deduct_uniform: Number(empEntry?.deduct_uniform || 0),
      }
    })
  }, [selectedEmp, currentPeriod, empShifts, empAdvances, empEntry])

  // Build full dates range with audit info for the timeline
  const fullDailyAudit = useMemo(() => {
    if (!currentPeriod) return []
    const dates = getDatesInRange(currentPeriod.period_start, currentPeriod.period_end)
    const auditMap = new Map<string, any>()
    payrollResult?.dailyAudit.forEach(a => auditMap.set(a.date, a))

    return dates.map(dStr => {
      const existing = auditMap.get(dStr)
      if (existing) return existing

      const isHoliday = factoryHolidayDates.has(dStr)
      return {
        date: dStr,
        isHoliday,
        shifts: [],
        dayTotalWage: 0,
        dayTotalOt: 0,
      }
    })
  }, [currentPeriod, payrollResult, factoryHolidayDates])

  // Filtered employees for left pane search
  const filteredEmployees = useMemo(() => {
    let list = employees
    if (statusFilter === 'worked') {
      list = list.filter(emp => activeIdsThisPeriod.has(emp.id))
    } else if (statusFilter === 'not_worked') {
      list = list.filter(emp => !activeIdsThisPeriod.has(emp.id))
    }
    const term = empSearch.trim().toLowerCase()
    if (!term) return list
    return list.filter(emp => {
      const code = emp.employee_code.toLowerCase()
      const fullName = `${emp.first_name} ${emp.last_name}`.toLowerCase()
      const nat = (emp.nationality || '').toLowerCase()
      return code.includes(term) || fullName.includes(term) || nat.includes(term)
    })
  }, [employees, empSearch, statusFilter, activeIdsThisPeriod])

  // ── PDF Export Handler ──
  const handleExportPdf = async () => {
    if (!selectedEmp || !currentPeriod || !payrollResult) return
    setIsExportingPdf(true)
    try {
      const generatedAt = thaiDateTimeNow()
      const periodLabelStr = currentPeriod ? formatPeriodLabel(currentPeriod.period_start, currentPeriod.period_end) : '—'
      const isSkilled = isSkilledEmp(selectedEmp)

      const html = buildTpiEmployeeSummaryPdfHtml(
        selectedEmp,
        periodLabelStr,
        payrollResult,
        fullDailyAudit,
        empAdvances,
        generatedAt,
        isSkilled,
        jobMap
      )

      const win = window.open('', '_blank', 'width=900,height=750')
      if (!win) {
        toast.error('กรุณาอนุญาต popup สำหรับการพิมพ์')
        return
      }
      win.document.write(html)
      win.document.close()
      win.focus()
      setTimeout(() => {
        win.print()
        win.close()
      }, 500)
      toast.success('เปิดหน้าต่างพิมพ์ PDF แล้ว')
    } catch (e: any) {
      toast.error('เกิดข้อผิดพลาดในการสร้าง PDF', { description: e.message })
    } finally {
      setIsExportingPdf(false)
    }
  }

  // ── Excel Export Handler ──
  const handleExportExcel = async () => {
    if (!selectedEmp || !currentPeriod || !payrollResult) return
    setIsExportingExcel(true)
    try {
      const XLSX = await import('xlsx')
      const periodLabelStr = currentPeriod ? formatPeriodLabel(currentPeriod.period_start, currentPeriod.period_end) : '—'
      const isSkilled = isSkilledEmp(selectedEmp)
      const rows = buildTpiEmployeeSummaryExcelRows(
        selectedEmp,
        periodLabelStr,
        payrollResult,
        fullDailyAudit,
        empAdvances,
        isSkilled,
        jobMap
      )

      const wb = XLSX.utils.book_new()
      const ws = XLSX.utils.aoa_to_sheet(rows)

      ws['!cols'] = [
        { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 22 }, { wch: 18 },
        { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 18 }
      ]

      XLSX.utils.book_append_sheet(wb, ws, 'TPI Summary')
      const safeName = `${selectedEmp.employee_code}_${selectedEmp.first_name}`.replace(/[\s/*?:[\]]/g, '_')
      const safePeriod = periodLabelStr.replace(/[\s/*?:[\]]/g, '_')
      XLSX.writeFile(wb, `TPI_Summary_${safeName}_${safePeriod}.xlsx`)
      toast.success('ดาวน์โหลด Excel สรุปพนักงานสำเร็จ')
    } catch (e: any) {
      toast.error('เกิดข้อผิดพลาดในการสร้าง Excel', { description: e.message })
    } finally {
      setIsExportingExcel(false)
    }
  }

  const isSelectedSkilled = selectedEmp ? isSkilledEmp(selectedEmp) : false

  return (
    <>
      <TopBar title="สรุปภาพรวมพนักงาน" subtitle={currentPeriod ? currentPeriod.label : 'กำลังโหลด...'} onMenuClick={onMenuClick} />

      <div className="vk-split">
        {/* ── Left Panel (Employee Pool) ── */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}
          className={`vk-sidebar-scrollable vk-sidebar-scrollable-payroll ${selectedEmpId ? 'hidden md:block' : ''}`}>

          {/* Sticky header + search */}
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

            {/* Filter chips */}
            <div style={{ display: 'flex', gap: 6, fontSize: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              {([
                { key: 'worked',     color: 'var(--vk-jade)', label: `มีกะทำงาน (${allTpiShifts.length > 0 ? activeIdsThisPeriod.size : 0})` },
                { key: 'not_worked', color: '#d4cfc9',        label: `ไม่มีกะ (${Math.max(0, employees.length - (allTpiShifts.length > 0 ? activeIdsThisPeriod.size : 0))})` },
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

            {/* Search Box */}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {filteredEmployees.map(emp => {
                const active = emp.id === selectedEmpId
                const hasShifts = activeIdsThisPeriod.has(emp.id)
                const natLabel = fmtNationality(emp.nationality)
                const skilled = isSkilledEmp(emp)

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
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--vk-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {formatEmployeeFullName(emp, true)}{natLabel ? ` (${natLabel})` : ''}
                          </span>
                          {skilled && (
                            <span style={{ flexShrink: 0, fontSize: 13 }} title="พนักงานเรทฝีมือ (฿377)">⭐</span>
                          )}
                          {emp.position === 'clerk' && (
                            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 999, background: 'rgba(177,71,41,0.12)', color: 'var(--vk-persimmon)', letterSpacing: '0.04em', flexShrink: 0 }}>เสมียน</span>
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
        <div style={{ overflowY: 'auto', overflowX: 'hidden', background: 'var(--vk-bone)', padding: '20px 24px 48px', minWidth: 0, boxSizing: 'border-box' }}>
          {selectedEmp && (
            <button className="vk-btn md:hidden" style={{ marginBottom: 20, fontSize: 12, padding: '5px 12px' }}
              onClick={() => setSelectedEmpId(null)}>← กลับ</button>
          )}

          {!selectedEmp || !payrollResult ? (
            <div style={{ paddingTop: 80, textAlign: 'center' }}>
              <div className="vk-eyebrow" style={{ marginBottom: 8 }}>เลือกพนักงานจากรายการทางซ้าย</div>
              <div className="vk-small" style={{ color: 'var(--vk-ink-3)' }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--vk-jade)', marginRight: 6 }} />
                จุดสีเขียวหมายถึงพนักงานที่มีบันทึกการเข้ากะในงวดที่เลือก
              </div>
            </div>
          ) : (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              border: '1px solid var(--vk-ink)',
              background: 'var(--vk-paper)',
              width: '100%',
              maxWidth: '100%',
              boxSizing: 'border-box',
              overflow: 'hidden'
            }}>

              {/* ── A. Header strip ── */}
              <div style={{ padding: '16px 24px 12px', background: 'var(--vk-paper)', borderBottom: '2px solid var(--vk-ink)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, boxSizing: 'border-box', width: '100%' }}>
                <div>
                  <div className="vk-eyebrow" style={{ marginBottom: 3 }}>EMPLOYEE LEDGER · บัญชีรายการพนักงาน</div>
                  <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 800, fontSize: 20, letterSpacing: '-0.02em', color: 'var(--vk-ink)', lineHeight: 1.2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span>{formatEmployeeFullName(selectedEmp, true)}</span>
                    {isSelectedSkilled && (
                      <span style={{ flexShrink: 0, fontSize: 18 }} title="พนักงานเรทฝีมือ">⭐</span>
                    )}
                    {fmtNationality(selectedEmp.nationality) && (
                      <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--vk-ink-3)' }}>({fmtNationality(selectedEmp.nationality)})</span>
                    )}
                  </div>
                  <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 11, color: 'var(--vk-ink-3)', fontWeight: 600 }}>{selectedEmp.employee_code}</span>
                    <span style={{ color: 'var(--vk-rule)', fontSize: 11 }}>·</span>
                    <span style={{ fontSize: 12, color: 'var(--vk-ink-3)' }}>
                      {selectedEmp.position === 'clerk' ? 'กลุ่มงานเสมียน' : 'กลุ่มงานทั่วไป'}
                      {selectedEmp.job_title && !isTpiJobCode(selectedEmp.job_title) ? ` · ${selectedEmp.job_title}` : ''}
                    </span>
                    <span style={{ color: 'var(--vk-rule)', fontSize: 11 }}>·</span>
                    <span style={{ fontSize: 12, color: 'var(--vk-persimmon)', fontFamily: 'var(--vk-mono)' }}>
                      {isSelectedSkilled ? '฿377/กะ (เรทฝีมือ ⭐)' : '฿357/กะ (เรทปกติ)'}
                    </span>
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

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button className="vk-btn" onClick={handleExportExcel} disabled={isExportingExcel}
                      style={{ fontSize: 11, padding: '4px 10px', height: 28, borderColor: 'var(--vk-jade)', color: 'var(--vk-jade)', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', background: 'var(--vk-paper)', opacity: isExportingExcel ? 0.6 : 1 }}>
                      {isExportingExcel ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <FileSpreadsheet style={{ width: 12, height: 12 }} />}
                      Excel
                    </button>
                    <button className="vk-btn" onClick={handleExportPdf} disabled={isExportingPdf}
                      style={{ fontSize: 11, padding: '4px 10px', height: 28, borderColor: 'var(--vk-crimson)', color: 'var(--vk-crimson)', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', background: 'var(--vk-paper)', opacity: isExportingPdf ? 0.6 : 1 }}>
                      {isExportingPdf ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <Printer style={{ width: 12, height: 12 }} />}
                      PDF
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
                    <label className="vk-eyebrow" style={{ fontSize: 9 }}>งวดการจ่ายเงิน</label>
                    <select value={selectedPeriodId ?? ''} onChange={e => setSelectedPeriodId(e.target.value)}
                      style={{ height: 28, fontFamily: 'var(--vk-sans)', fontSize: 12, fontWeight: 600, border: '1px solid var(--vk-rule)', padding: '0 20px 0 8px', background: 'var(--vk-bone)', color: 'var(--vk-ink)', cursor: 'pointer', outline: 'none' }}>
                      {periods.map(p => <option key={p.id} value={p.id}>{p.label} {p.status === 'approved' ? '✓' : '(ร่าง)'}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* ── B. Summary bar (4 KPIs) ── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', background: 'var(--vk-ink)', flexShrink: 0, width: '100%', boxSizing: 'border-box' }}>
                {[
                  {
                    label: 'กะทำงาน / วันทำงาน',
                    value: `${payrollResult.totalShiftsCount} กะ (${payrollResult.workDaysCount} วัน)`,
                    sub: `กะ 1: ${payrollResult.workDaysCount} · ควบกะ: ${Math.max(0, payrollResult.totalShiftsCount - payrollResult.workDaysCount)}${payrollResult.halfShiftsCount > 0 ? ` · ครึ่ง: ${payrollResult.halfShiftsCount}` : ''}`,
                    light: true
                  },
                  {
                    label: 'รายได้รวม',
                    value: `฿${monoNum(payrollResult.totalIncome)}`,
                    sub: 'ก่อนหัก',
                    light: true
                  },
                  {
                    label: 'หักรวม',
                    value: `฿${monoNum(payrollResult.totalDeductions)}`,
                    sub: 'ปกส. + เบิก + อื่นๆ',
                    light: true,
                    red: true
                  },
                  {
                    label: 'สุทธิรับจริง',
                    value: `฿${monoNum(payrollResult.netPay)}`,
                    sub: payrollResult.netPay < 0 ? 'ยอดติดลบ ยกไปงวดหน้า' : 'โอนเข้าบัญชี / จ่ายสด',
                    light: true,
                    highlight: true
                  },
                ].map((s, i) => (
                  <div key={i} style={{ padding: '12px 14px', borderRight: i < 3 ? '1px solid rgba(255,255,255,0.08)' : undefined, minWidth: 0, overflow: 'hidden' }}>
                    <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.45)', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</div>
                    <div style={{ fontFamily: 'var(--vk-mono)', fontWeight: 700, fontSize: 15, color: s.highlight ? '#f4a35a' : s.red ? '#f07070' : '#fff', letterSpacing: '-0.01em', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.value}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.sub}</div>
                  </div>
                ))}
              </div>

              {/* ── C. Daily Timeline ── */}
              <div style={{ padding: '0 0 4px', width: '100%', boxSizing: 'border-box' }}>
                {/* Section header + filter toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px 8px', borderBottom: '1px solid var(--vk-rule)', boxSizing: 'border-box' }}>
                  <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--vk-ink-3)' }}>
                    บันทึกรายวัน — {currentPeriod?.label}
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--vk-ink-3)', cursor: 'pointer', userSelect: 'none' }}>
                    <input type="checkbox" checked={onlyWorkedFilter} onChange={e => setOnlyWorkedFilter(e.target.checked)} style={{ accentColor: 'var(--vk-persimmon)', width: 12, height: 12 }} />
                    เฉพาะวันทำงาน
                  </label>
                </div>

                {/* Table header */}
                <div style={{ display: 'grid', gridTemplateColumns: '120px 110px minmax(0, 1fr) 90px', padding: '7px 24px', background: 'var(--vk-paper)', borderBottom: '1px solid var(--vk-rule)', gap: 8, boxSizing: 'border-box' }}>
                  {['วันที่', 'กะ / รหัสงาน', 'รายการรายได้', 'รวมรายวัน'].map((h, i) => (
                    <div key={i} style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--vk-ink-3)', textAlign: i === 3 ? 'right' : 'left' }}>{h}</div>
                  ))}
                </div>

                {/* Daily rows */}
                {fullDailyAudit
                  .filter(day => !onlyWorkedFilter || (day.shifts && day.shifts.length > 0))
                  .map((day, idx) => {
                    const isWorked = day.shifts && day.shifts.length > 0
                    const isHoliday = day.isHoliday
                    const accentColor = isHoliday ? 'var(--vk-crimson)' : isWorked ? 'var(--vk-jade)' : 'var(--vk-rule)'
                    const totalDayEarned = (day.dayTotalWage || 0) + (day.dayTotalOt || 0)

                    return (
                      <div key={idx} style={{
                        display: 'grid', gridTemplateColumns: '120px 110px minmax(0, 1fr) 90px', gap: 8,
                        padding: '9px 24px',
                        borderBottom: '1px solid var(--vk-rule-soft)',
                        background: isWorked ? 'var(--vk-paper)' : 'transparent',
                        borderLeft: `3px solid ${accentColor}`,
                        opacity: isWorked ? 1 : 0.45,
                        alignItems: 'center',
                        boxSizing: 'border-box',
                      }}>
                        {/* Date */}
                        <div>
                          <div style={{ fontSize: 12, fontWeight: isWorked ? 700 : 400, color: isHoliday ? 'var(--vk-crimson)' : 'var(--vk-ink)', lineHeight: 1.2 }}>
                            {fmtDisplayDate(day.date)}
                          </div>
                          {isHoliday && (
                            <div style={{ fontSize: 9, color: 'var(--vk-crimson)', marginTop: 1, fontWeight: 700 }}>
                              วันหยุดนักขัตฤกษ์
                            </div>
                          )}
                        </div>

                        {/* Shift & Job Code Pills */}
                        <div>
                          {isWorked ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              {day.shifts.map((s: any, sIdx: number) => {
                                const isFirst = s.isFirstShiftOfDay
                                const isSkilledTier = s.tier === 'skilled'
                                return (
                                  <div key={sIdx} style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                    <span style={{
                                      fontSize: 10,
                                      fontWeight: 700,
                                      padding: '1px 5px',
                                      borderRadius: 2,
                                      background: isFirst ? 'rgba(216,154,42,0.15)' : 'rgba(74,110,138,0.15)',
                                      color: isFirst ? '#a16207' : '#1e6091'
                                    }}>
                                      {s.shiftName}
                                    </span>
                                    <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 10, color: 'var(--vk-ink-2)', fontWeight: 600 }}>
                                      {s.jobCode}
                                    </span>
                                    {isSkilledTier && <span style={{ fontSize: 10 }}>⭐</span>}
                                    {s.isHalf && (
                                      <span style={{ fontSize: 9, background: '#fee2e2', color: '#dc2626', padding: '0 4px', borderRadius: 2 }}>ครึ่งกะ</span>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            <span style={{ fontSize: 11, color: 'var(--vk-ink-3)', fontStyle: 'italic' }}>หยุด</span>
                          )}
                        </div>

                        {/* Wage chips */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                          {isWorked ? (
                            <>
                              {day.shifts.map((s: any, sIdx: number) => {
                                const isFirst = s.isFirstShiftOfDay
                                const isSkilledTier = s.tier === 'skilled'
                                const starText = isSkilledTier ? ' ⭐' : ''
                                return (
                                  <React.Fragment key={sIdx}>
                                    <span style={chipStyle(isFirst ? '#374151' : '#065f46', isFirst ? '#f3f4f6' : '#d1fae5')}>
                                      {isFirst ? `กะ 1: ฿${monoNum(s.totalShiftWage)}${starText}` : `กะ 2: +฿${monoNum(s.totalShiftWage)}${starText}`}
                                    </span>
                                    {s.otPay > 0 && (
                                      <span style={chipStyle('#4c1d95', '#ede9fe')}>
                                        OT ({s.otHours} ชม.) +฿${monoNum(s.otPay)}
                                      </span>
                                    )}
                                  </React.Fragment>
                                )
                              })}
                              {day.isHoliday && (
                                <span style={chipStyle('#991b1b', '#fee2e2')}>
                                  เรทวันหยุด x2
                                </span>
                              )}
                            </>
                          ) : (
                            <span style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>—</span>
                          )}
                        </div>

                        {/* Day total */}
                        <div style={{ textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 13, fontWeight: 700, color: totalDayEarned > 0 ? 'var(--vk-jade)' : 'var(--vk-ink-3)' }}>
                          {totalDayEarned > 0 ? `฿${monoNum(totalDayEarned)}` : '—'}
                        </div>
                      </div>
                    )
                  })}
              </div>

              {/* ── D. Period-level income (TPI Allowances) ── */}
              {(payrollResult.amountDiligence > 0 || payrollResult.amountSpecial > 0) && (
                <div style={{ borderTop: '2px solid var(--vk-rule)', background: 'var(--vk-paper)', width: '100%', boxSizing: 'border-box' }}>
                  <div style={{ padding: '10px 24px 7px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--vk-jade)' }}>รายได้ประจำงวด (ทีพีไอ)</div>
                  </div>

                  {[
                    { label: 'เบี้ยขยันประจำงวด (สิ้นเดือน)', val: payrollResult.amountDiligence, note: '300 บาท/เดือน' },
                    { label: 'เงินพิเศษ / ปรับปรุง', val: payrollResult.amountSpecial, note: payrollResult.specialNote || 'บันทึกในงวดนี้' },
                  ].filter(x => x.val > 0).map((item, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '120px 110px minmax(0, 1fr) 90px', gap: 8, padding: '8px 24px', borderTop: '1px solid var(--vk-rule-soft)', alignItems: 'center', borderLeft: '3px solid var(--vk-jade)', boxSizing: 'border-box' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--vk-ink)', gridColumn: '1 / 3' }}>{item.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--vk-ink-3)', fontStyle: item.note ? 'normal' : 'italic' }}>{item.note}</div>
                      <div style={{ textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 13, fontWeight: 700, color: 'var(--vk-jade)' }}>+฿{monoNum(item.val)}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── E. Deductions ── */}
              <div style={{ borderTop: '2px solid var(--vk-rule)', background: 'var(--vk-paper)', width: '100%', boxSizing: 'border-box' }}>
                <div style={{ padding: '10px 24px 7px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--vk-crimson)' }}>รายการหักเงิน</div>
                </div>

                {/* Social Security */}
                {payrollResult.deductSocialSecurity > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '120px 110px minmax(0, 1fr) 90px', gap: 8, padding: '8px 24px', borderTop: '1px solid var(--vk-rule-soft)', alignItems: 'center', borderLeft: '3px solid var(--vk-crimson)', boxSizing: 'border-box' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--vk-ink)', gridColumn: '1 / 3' }}>ประกันสังคม (5%)</div>
                    <div style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>
                      คำนวณจากค่าจ้างปกติกะแรก (ฐาน ฿{monoNum(payrollResult.effectiveNormal)})
                    </div>
                    <div style={{ textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 13, fontWeight: 700, color: 'var(--vk-crimson)' }}>−฿{monoNum(payrollResult.deductSocialSecurity)}</div>
                  </div>
                )}

                {/* Advances breakdown */}
                {empAdvances.length > 0 && (
                  <>
                    <div style={{ padding: '7px 24px 4px', borderTop: '1px solid var(--vk-rule-soft)', background: '#fff8f6', borderLeft: '3px solid var(--vk-crimson)', boxSizing: 'border-box' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--vk-crimson)', opacity: 0.7 }}>
                        เบิกล่วงหน้า — {empAdvances.length} รายการ
                      </div>
                    </div>
                    {empAdvances.map((adv: any, i: number) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '120px 110px minmax(0, 1fr) 90px', gap: 8, padding: '7px 24px', borderTop: '1px solid var(--vk-rule-soft)', alignItems: 'center', borderLeft: '3px solid var(--vk-crimson)', background: '#fff8f6', boxSizing: 'border-box' }}>
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
                {payrollResult.deductSafetyEquipment > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '120px 110px minmax(0, 1fr) 90px', gap: 8, padding: '8px 24px', borderTop: '1px solid var(--vk-rule-soft)', alignItems: 'center', borderLeft: '3px solid var(--vk-crimson)', boxSizing: 'border-box' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--vk-ink)', gridColumn: '1 / 3' }}>อุปกรณ์ความปลอดภัย</div>
                    <div style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>หักค่าอุปกรณ์</div>
                    <div style={{ textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 13, fontWeight: 700, color: 'var(--vk-crimson)' }}>−฿{monoNum(payrollResult.deductSafetyEquipment)}</div>
                  </div>
                )}

                {/* Uniform */}
                {payrollResult.deductUniform > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '120px 110px minmax(0, 1fr) 90px', gap: 8, padding: '8px 24px', borderTop: '1px solid var(--vk-rule-soft)', alignItems: 'center', borderLeft: '3px solid var(--vk-crimson)', boxSizing: 'border-box' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--vk-ink)', gridColumn: '1 / 3' }}>ค่าเสื้อพนักงาน</div>
                    <div style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>หักค่าชุดทำงาน</div>
                    <div style={{ textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 13, fontWeight: 700, color: 'var(--vk-crimson)' }}>−฿{monoNum(payrollResult.deductUniform)}</div>
                  </div>
                )}

                {payrollResult.totalDeductions === 0 && (
                  <div style={{ padding: '12px 24px', fontSize: 12, color: 'var(--vk-ink-3)', borderTop: '1px solid var(--vk-rule-soft)' }}>ไม่มีรายการหักเงินในงวดนี้</div>
                )}
              </div>

              {/* ── F. NET PAY footer ── */}
              <div style={{ borderTop: '2px solid var(--vk-ink)', padding: '16px 24px', background: 'var(--vk-ink)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', boxSizing: 'border-box' }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.45)' }}>NET PAY · เงินได้สุทธิ</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                    {payrollResult.netPay < 0 ? 'ยอดติดลบ — ยกไปหักในงวดถัดไป จ่ายจริง ฿0' : `${payrollResult.totalShiftsCount} กะทำงาน (${payrollResult.workDaysCount} วัน) · หัก ฿${monoNum(payrollResult.totalDeductions)}`}
                  </div>
                </div>
                <div style={{ fontFamily: 'var(--vk-mono)', fontWeight: 800, fontSize: 28, letterSpacing: '-0.025em', color: payrollResult.netPay < 0 ? '#f07070' : '#f4a35a', fontVariantNumeric: 'tabular-nums' }}>
                  {payrollResult.netPay < 0 ? `−฿${monoNum(Math.abs(payrollResult.netPay))}` : `฿${monoNum(payrollResult.netPay)}`}
                </div>
              </div>

            </div>
          )}
        </div>
      </div>
    </>
  )
}
