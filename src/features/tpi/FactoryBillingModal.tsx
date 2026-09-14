import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { formatPeriodLabel } from '../../lib/formatters'
import { demoJobs } from './demoData'
import type { Job } from './model'
import { calculateFactoryBilling, type FactoryBillingSummary } from './tpiBillingCalc'
import { exportFactoryBillingToExcel } from './tpiBillingExport'
import { calculateEmployeeTimesheetReport, type TimesheetBillingReport } from './tpiTimesheetCalc'
import { exportEmployeeTimesheetExcel } from './tpiTimesheetExport'
import { EmployeeTimesheetTable } from './EmployeeTimesheetTable'
import { getStoredHolidaysForFactory } from '../../pages/TpiPayrollEntry'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { th } from 'date-fns/locale'
import {
  X,
  FileSpreadsheet,
  Printer,
  Search,
  Loader2,
  Receipt,
  TrendingUp,
  DollarSign,
  Users,
  Briefcase,
  Calendar
} from 'lucide-react'

export type BillingRangeMode = '7days' | 'period' | 'month'

interface FactoryBillingModalProps {
  isOpen: boolean
  onClose: () => void
  periods: Array<{ id: string; period_start: string; period_end: string; status: string | null }>
  initialPeriodId?: string | null
  factoryId?: string
  factoryName?: string
}

function addDaysIso(dateStr: string, days: number): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dt = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dt}`
}

export function FactoryBillingModal({
  isOpen,
  onClose,
  periods,
  initialPeriodId,
  factoryId,
  factoryName = 'บริษัท ทีพีไอ โพลีน จำกัด (มหาชน)',
}: FactoryBillingModalProps) {
  // Mode: '7days' | 'period' | 'month'
  const [rangeMode, setRangeMode] = useState<BillingRangeMode>('7days')

  // Period mode state
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>(() => {
    if (initialPeriodId) return initialPeriodId
    const approved = periods.find(p => p.status === 'approved')
    return approved ? approved.id : (periods[0]?.id || '')
  })

  // Month mode state
  const uniqueMonths = useMemo(() => {
    return Array.from(new Set(periods.map(p => {
      const d = new Date(p.period_start)
      return `${format(d, 'MMMM', { locale: th })} ${d.getFullYear() + 543}`
    })))
  }, [periods])

  const [selectedMonth, setSelectedMonth] = useState<string>(() => uniqueMonths[0] || '')

  // Active Year and Month for 4-cycle calculation
  const activeYearMonth = useMemo(() => {
    for (const p of periods) {
      const d = new Date(p.period_start)
      const mStr = `${format(d, 'MMMM', { locale: th })} ${d.getFullYear() + 543}`
      if (mStr === selectedMonth) {
        const y = d.getFullYear()
        const m = d.getMonth() + 1
        const lastDay = new Date(y, m, 0).getDate()
        return { y, m, lastDay, mStr }
      }
    }
    const d = periods[0] ? new Date(periods[0].period_start) : new Date()
    const y = d.getFullYear()
    const m = d.getMonth() + 1
    const lastDay = new Date(y, m, 0).getDate()
    const mStr = `${format(d, 'MMMM', { locale: th })} ${d.getFullYear() + 543}`
    return { y, m, lastDay, mStr }
  }, [periods, selectedMonth])

  // 4 Cycles: 1-7, 8-15, 16-22, 23-สิ้นเดือน
  const fourCycles = useMemo(() => {
    const { y, m, lastDay } = activeYearMonth
    const mPad = String(m).padStart(2, '0')
    return [
      { key: '1-7', label: '1–7', start: `${y}-${mPad}-01`, end: `${y}-${mPad}-07` },
      { key: '8-15', label: '8–15', start: `${y}-${mPad}-08`, end: `${y}-${mPad}-15` },
      { key: '16-22', label: '16–22', start: `${y}-${mPad}-16`, end: `${y}-${mPad}-22` },
      { key: '23-end', label: '23–สิ้นเดือน', start: `${y}-${mPad}-23`, end: `${y}-${mPad}-${String(lastDay).padStart(2, '0')}` },
    ]
  }, [activeYearMonth])

  // Selected cycle default based on active period
  const [selectedCycle, setSelectedCycle] = useState<string>(() => {
    const active = periods.find(p => p.id === selectedPeriodId) || periods[0]
    if (active) {
      const day = parseInt(active.period_start.slice(8, 10), 10)
      if (day >= 23) return '23-end'
      if (day >= 16) return '16-22'
      if (day >= 8) return '8-15'
      return '1-7'
    }
    return '1-7'
  })

  const [searchFilter, setSearchFilter] = useState('')
  const [isExporting, setIsExporting] = useState(false)

  // Calculate Effective Start Date, End Date, and Descriptive Label
  const effectiveRange = useMemo(() => {
    if (rangeMode === '7days') {
      const cycle = fourCycles.find(c => c.key === selectedCycle) || fourCycles[0]
      const start = cycle.start
      const end = cycle.end
      const label = `รอบ: ${cycle.label} ${activeYearMonth.mStr}`
      return { start, end, label, modeLabel: `รอบ ${cycle.label}` }
    }
    if (rangeMode === 'month') {
      for (const p of periods) {
        const d = new Date(p.period_start)
        const mStr = `${format(d, 'MMMM', { locale: th })} ${d.getFullYear() + 543}`
        if (mStr === selectedMonth) {
          const y = d.getFullYear()
          const m = d.getMonth()
          const start = `${y}-${String(m + 1).padStart(2, '0')}-01`
          const lastDay = new Date(y, m + 1, 0).getDate()
          const end = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
          return { start, end, label: `ประจำเดือน: ${selectedMonth}`, modeLabel: 'รายเดือน' }
        }
      }
      return { start: '', end: '', label: selectedMonth, modeLabel: 'รายเดือน' }
    }
    // rangeMode === 'period'
    const p = periods.find(item => item.id === selectedPeriodId)
    const start = p?.period_start || ''
    const end = p?.period_end || ''
    const label = p ? formatPeriodLabel(start, end) : ''
    return { start, end, label: `งวด: ${label}`, modeLabel: 'รายงวด' }
  }, [rangeMode, fourCycles, selectedCycle, activeYearMonth, selectedMonth, selectedPeriodId, periods])

  // 1. Fetch TPI Job Codes Master
  const { data: dbJobs = [] } = useQuery<Job[]>({
    queryKey: ['tpi-billing-jobs', factoryId],
    queryFn: async () => {
      if (!factoryId) return []
      const { data, error } = await supabase
        .from('tpi_job_codes')
        .select('*')
        .eq('factory_id', factoryId)
        .order('code')
      if (error) {
        console.error('Error fetching job codes for billing:', error)
        return []
      }
      return data || []
    },
    enabled: isOpen && !!factoryId,
    staleTime: 60000,
  })

  // Merge with demoJobs so all known jobs have billing rates and descriptions
  const jobsMaster: Job[] = useMemo(() => {
    const dbMap = new Map(dbJobs.map(j => [j.code.trim().toLowerCase(), j]))
    const merged: Job[] = demoJobs.map(ref => {
      const match = dbMap.get(ref.code.trim().toLowerCase())
      if (match) {
        dbMap.delete(ref.code.trim().toLowerCase())
        return match
      }
      return ref
    })
    for (const customJob of dbMap.values()) {
      merged.push(customJob)
    }
    return merged
  }, [dbJobs])

  // 2. Fetch Active Employees
  const { data: employees = [] } = useQuery({
    queryKey: ['tpi-billing-employees', factoryId],
    queryFn: async () => {
      if (!factoryId) return []
      const { data, error } = await supabase
        .from('employees')
        .select('id, employee_code, prefix, first_name, last_name, status, nationality')
        .eq('factory_id', factoryId)
      if (error) throw error
      return data || []
    },
    enabled: isOpen && !!factoryId,
    staleTime: 60000,
  })

  // 3. Fetch Shift Entries for Effective Date Range
  const { data: shifts = [], isLoading: isLoadingShifts } = useQuery({
    queryKey: ['tpi-billing-shifts', factoryId, effectiveRange.start, effectiveRange.end],
    queryFn: async () => {
      if (!factoryId || !effectiveRange.start || !effectiveRange.end) return []

      let allShifts: any[] = []
      let from = 0
      const PAGE_SIZE = 1000

      while (true) {
        const { data, error } = await supabase
          .from('tpi_shift_entries' as any)
          .select('id, work_date, employee_id, shift_index, job_id, job_code_snapshot, rate_tier, rate_snapshot, is_half_shift, actual_hours, ot_hours, ot_pay, is_holiday_ot')
          .eq('factory_id', factoryId)
          .gte('work_date', effectiveRange.start)
          .lte('work_date', effectiveRange.end)
          .range(from, from + PAGE_SIZE - 1)

        if (error) {
          console.error('Error fetching shift entries for billing:', error)
          break
        }
        allShifts = allShifts.concat(data || [])
        if (!data || data.length < PAGE_SIZE) break
        from += PAGE_SIZE
      }

      // Apply stored factory holidays
      const storedHolidays = getStoredHolidaysForFactory(factoryId)
      if (storedHolidays.size > 0) {
        allShifts = allShifts.map(s => storedHolidays.has(s.work_date) ? { ...s, is_holiday_ot: true } : s)
      }

      return allShifts
    },
    enabled: isOpen && !!factoryId && !!effectiveRange.start && !!effectiveRange.end,
    staleTime: 30000,
  })

  // Compute Full Billing Summary (Group by Job Code)
  const billingSummary: FactoryBillingSummary = useMemo(() => {
    return calculateFactoryBilling(
      shifts,
      employees,
      jobsMaster,
      effectiveRange.label,
      factoryName
    )
  }, [shifts, employees, jobsMaster, effectiveRange.label, factoryName])

  // Compute 7-Day Employee Timesheet Billing Report (By Nationality & Employee)
  const timesheetReport: TimesheetBillingReport = useMemo(() => {
    return calculateEmployeeTimesheetReport(
      shifts,
      employees,
      effectiveRange.start,
      effectiveRange.end
    )
  }, [shifts, employees, effectiveRange.start, effectiveRange.end])

  // Filtered job groups based on search input
  const filteredGroups = useMemo(() => {
    if (!searchFilter.trim()) return billingSummary.jobGroups
    const q = searchFilter.toLowerCase().trim()
    return billingSummary.jobGroups.filter(
      g => g.jobCode.toLowerCase().includes(q) ||
           g.department.toLowerCase().includes(q) ||
           g.jobDescription.toLowerCase().includes(q)
    )
  }, [billingSummary.jobGroups, searchFilter])

  // Filtered Timesheet Workers based on search input
  const filteredThaiWorkers = useMemo(() => {
    if (!searchFilter.trim()) return timesheetReport.thaiWorkers
    const q = searchFilter.toLowerCase().trim()
    return timesheetReport.thaiWorkers.filter(
      r => r.employeeCode.toLowerCase().includes(q) || r.fullName.toLowerCase().includes(q)
    )
  }, [timesheetReport.thaiWorkers, searchFilter])

  const filteredForeignWorkers = useMemo(() => {
    if (!searchFilter.trim()) return timesheetReport.foreignWorkers
    const q = searchFilter.toLowerCase().trim()
    return timesheetReport.foreignWorkers.filter(
      r => r.employeeCode.toLowerCase().includes(q) || r.fullName.toLowerCase().includes(q)
    )
  }, [timesheetReport.foreignWorkers, searchFilter])

  // View state: 'jobSummary' (สรุปตามรหัสงาน - ค่าเริ่มต้น) vs 'timesheet' (ใบวางบิลรายบุคคล 7 วัน)
  const [activeView, setActiveView] = useState<'jobSummary' | 'timesheet'>('jobSummary')

  // Handle Download Excel
  const handleExportExcel = async () => {
    try {
      setIsExporting(true)
      if (activeView === 'timesheet') {
        if (timesheetReport.thaiWorkers.length === 0 && timesheetReport.foreignWorkers.length === 0) {
          toast.error('ไม่มีข้อมูลสำหรับส่งออก')
          return
        }
        await exportEmployeeTimesheetExcel(timesheetReport, factoryName)
        toast.success('ดาวน์โหลดไฟล์ Excel ใบวางบิลรายบุคคล 7 วันสำเร็จ')
      } else {
        if (!billingSummary || billingSummary.jobGroups.length === 0) {
          toast.error('ไม่มีข้อมูลสำหรับส่งออก')
          return
        }
        let prefix = 'Factory_Billing_7Days'
        if (rangeMode === 'month') prefix = 'Factory_Billing_Month'
        if (rangeMode === 'period') prefix = 'Factory_Billing_Period'
        const filename = `${prefix}_${effectiveRange.start}_to_${effectiveRange.end}.xlsx`
        await exportFactoryBillingToExcel(billingSummary, filename)
        toast.success('ดาวน์โหลดไฟล์ Excel สรุปวางบิลตามรหัสงานสำเร็จ')
      }
    } catch (e: any) {
      toast.error('เกิดข้อผิดพลาดในการดาวน์โหลด', { description: e.message })
    } finally {
      setIsExporting(false)
    }
  }

  // Handle Print
  const handlePrint = () => {
    window.print()
  }

  if (!isOpen) return null

  const mono = (n: number) => (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const monoInt = (n: number) => (n || 0).toLocaleString('en-US')

  return (
    <div
      className="vk-root"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(22,19,17,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        backdropFilter: 'blur(2px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--vk-paper)',
          border: '1px solid var(--vk-rule)',
          width: '100%',
          maxWidth: 1360,
          height: '92vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            background: '#0f766e',
            color: '#fff',
            padding: '16px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 6,
                background: 'rgba(255,255,255,0.15)',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <Receipt style={{ width: 20, height: 20, color: '#fff' }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.01em' }}>
                ใบสรุปยอดวางบิลเบิกค่าจ้างโรงงาน (Factory Billing Statement)
              </div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
                {factoryName} · {activeView === 'timesheet' ? 'ใบวางบิลรายบุคคล 7 วัน (แยกสัญชาติไทย-ต่างด้าว)' : 'สรุปยอดตามรหัสงาน (Group By Job Code)'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={handleExportExcel}
              disabled={
                isExporting ||
                isLoadingShifts ||
                (activeView === 'timesheet'
                  ? timesheetReport.thaiWorkers.length === 0 && timesheetReport.foreignWorkers.length === 0
                  : billingSummary.jobGroups.length === 0)
              }
              className="vk-btn"
              style={{
                background: '#fff',
                color: '#0f766e',
                borderColor: '#fff',
                height: 34,
                padding: '0 14px',
                fontSize: 12,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
              }}
            >
              {isExporting ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> : <FileSpreadsheet style={{ width: 14, height: 14 }} />}
              ดาวน์โหลด Excel ({activeView === 'timesheet' ? 'ใบวางบิลรายบุคคล 7 วัน' : effectiveRange.modeLabel})
            </button>
            <button
              onClick={handlePrint}
              className="vk-btn"
              style={{
                background: 'rgba(255,255,255,0.15)',
                color: '#fff',
                borderColor: 'rgba(255,255,255,0.3)',
                height: 34,
                padding: '0 12px',
                fontSize: 12,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
              }}
            >
              <Printer style={{ width: 14, height: 14 }} />
              พิมพ์
            </button>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#fff',
                opacity: 0.75,
                padding: 6,
                marginLeft: 4,
              }}
            >
              <X style={{ width: 20, height: 20 }} />
            </button>
          </div>
        </div>

        {/* Toolbar: 3 Modes (7 Days / Period / Month) & Range Selectors */}
        <div
          style={{
            padding: '12px 24px',
            background: 'var(--vk-paper-2)',
            borderBottom: '1px solid var(--vk-rule-soft)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'nowrap',
            gap: 12,
            flexShrink: 0,
          }}
        >
          {/* Left: Mode Switcher & Date Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'nowrap', flexShrink: 0 }}>
            {/* 3 Mode Pills */}
            <div style={{ display: 'flex', border: '1px solid var(--vk-rule)', borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setRangeMode('7days')}
                style={{
                  padding: '5px 12px',
                  fontSize: 12,
                  fontFamily: 'var(--vk-sans)',
                  fontWeight: rangeMode === '7days' ? 700 : 500,
                  background: rangeMode === '7days' ? '#0f766e' : '#fff',
                  color: rangeMode === '7days' ? '#fff' : 'var(--vk-ink)',
                  border: 'none',
                  borderRight: '1px solid var(--vk-rule)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <Calendar style={{ width: 13, height: 13 }} />
                ราย 7 วัน (วางบิลทุก 7 วัน)
              </button>
              <button
                type="button"
                onClick={() => setRangeMode('period')}
                style={{
                  padding: '5px 12px',
                  fontSize: 12,
                  fontFamily: 'var(--vk-sans)',
                  fontWeight: rangeMode === 'period' ? 700 : 500,
                  background: rangeMode === 'period' ? '#0f766e' : '#fff',
                  color: rangeMode === 'period' ? '#fff' : 'var(--vk-ink)',
                  border: 'none',
                  borderRight: '1px solid var(--vk-rule)',
                  cursor: 'pointer',
                }}
              >
                รายงวด (Payroll Period)
              </button>
              <button
                type="button"
                onClick={() => setRangeMode('month')}
                style={{
                  padding: '5px 12px',
                  fontSize: 12,
                  fontFamily: 'var(--vk-sans)',
                  fontWeight: rangeMode === 'month' ? 700 : 500,
                  background: rangeMode === 'month' ? '#0f766e' : '#fff',
                  color: rangeMode === 'month' ? '#fff' : 'var(--vk-ink)',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                รายเดือน (Monthly)
              </button>
            </div>

            {/* Mode-specific Selectors: 7 Days (4 Cycles: 1-7, 8-15, 16-22, 23-สิ้นเดือน) */}
            {rangeMode === '7days' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {uniqueMonths.length > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-2)' }}>เดือน:</span>
                    <select
                      value={selectedMonth}
                      onChange={e => setSelectedMonth(e.target.value)}
                      style={{
                        height: 30,
                        fontFamily: 'var(--vk-sans)',
                        fontSize: 12,
                        fontWeight: 600,
                        border: '1px solid var(--vk-rule)',
                        borderRadius: 3,
                        padding: '0 8px',
                        background: '#fff',
                        color: 'var(--vk-ink)',
                      }}
                    >
                      {uniqueMonths.map(m => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* 4 Cycle Buttons */}
                <div style={{ display: 'flex', gap: 4 }}>
                  {fourCycles.map(c => {
                    const isSel = selectedCycle === c.key
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => setSelectedCycle(c.key)}
                        style={{
                          padding: '4px 10px',
                          fontSize: 12,
                          fontFamily: 'var(--vk-sans)',
                          fontWeight: isSel ? 700 : 500,
                          background: isSel ? '#0f766e' : '#fff',
                          color: isSel ? '#fff' : 'var(--vk-ink)',
                          border: `1px solid ${isSel ? '#0f766e' : 'var(--vk-rule)'}`,
                          borderRadius: 3,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          transition: 'all 0.15s',
                        }}
                      >
                        {c.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {rangeMode === 'period' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-2)' }}>เลือกงวด:</span>
                <select
                  value={selectedPeriodId}
                  onChange={e => setSelectedPeriodId(e.target.value)}
                  style={{
                    height: 32,
                    fontFamily: 'var(--vk-sans)',
                    fontSize: 13,
                    fontWeight: 600,
                    border: '1px solid var(--vk-rule)',
                    padding: '0 10px',
                    background: '#fff',
                    color: 'var(--vk-ink)',
                    minWidth: 230,
                  }}
                >
                  {periods.map(p => (
                    <option key={p.id} value={p.id}>
                      {formatPeriodLabel(p.period_start, p.period_end)}
                      {p.status === 'approved' ? ' ✓' : ' (ร่าง)'}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {rangeMode === 'month' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-2)' }}>เลือกเดือน:</span>
                <select
                  value={selectedMonth}
                  onChange={e => setSelectedMonth(e.target.value)}
                  style={{
                    height: 32,
                    fontFamily: 'var(--vk-sans)',
                    fontSize: 13,
                    fontWeight: 600,
                    border: '1px solid var(--vk-rule)',
                    padding: '0 10px',
                    background: '#fff',
                    color: 'var(--vk-ink)',
                    minWidth: 180,
                  }}
                >
                  {uniqueMonths.map(m => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Right: Search Filter & Active Range Tag */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: 'var(--vk-ink-3)', fontFamily: 'var(--vk-mono)', whiteSpace: 'nowrap' }}>
              {effectiveRange.label}
            </span>
            <div style={{ position: 'relative', width: 220, flexShrink: 0 }}>
              <Search
                style={{
                  position: 'absolute',
                  left: 9,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 13,
                  height: 13,
                  color: 'var(--vk-ink-3)',
                }}
              />
              <input
                type="text"
                placeholder={activeView === 'timesheet' ? 'ค้นหาชื่อ / รหัสคนงาน...' : 'ค้นหารหัสงาน / แผนก...'}
                value={searchFilter}
                onChange={e => setSearchFilter(e.target.value)}
                style={{
                  width: '100%',
                  height: 30,
                  paddingLeft: 28,
                  paddingRight: 8,
                  fontSize: 12,
                  fontFamily: 'var(--vk-sans)',
                  border: '1px solid var(--vk-rule)',
                  background: '#fff',
                  outline: 'none',
                }}
              />
            </div>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
            background: '#fff',
            borderBottom: '1px solid var(--vk-rule-soft)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            {/* Tab 1: สรุปยอดตามรหัสงาน (หน้าหลัก / Default) */}
            <button
              type="button"
              onClick={() => setActiveView('jobSummary')}
              style={{
                padding: '11px 16px',
                fontSize: 13,
                fontWeight: 700,
                fontFamily: 'var(--vk-sans)',
                border: 'none',
                borderBottom: activeView === 'jobSummary' ? '3px solid #0f766e' : '3px solid transparent',
                background: 'none',
                color: activeView === 'jobSummary' ? '#0f766e' : 'var(--vk-ink-3)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                transition: 'all 0.15s',
              }}
            >
              <Receipt style={{ width: 16, height: 16 }} />
              สรุปยอดตามรหัสงาน (Group By Job Code)
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 7px',
                  borderRadius: 10,
                  fontWeight: 700,
                  background: activeView === 'jobSummary' ? '#ccfbf1' : '#f1f5f9',
                  color: activeView === 'jobSummary' ? '#0f766e' : 'var(--vk-ink-3)',
                }}
              >
                {billingSummary.jobGroups.length} รหัสงาน
              </span>
            </button>

            {/* Tab 2: ใบวางบิลรายบุคคล 7 วัน */}
            <button
              type="button"
              onClick={() => setActiveView('timesheet')}
              style={{
                padding: '11px 16px',
                fontSize: 13,
                fontWeight: 700,
                fontFamily: 'var(--vk-sans)',
                border: 'none',
                borderBottom: activeView === 'timesheet' ? '3px solid #0f766e' : '3px solid transparent',
                background: 'none',
                color: activeView === 'timesheet' ? '#0f766e' : 'var(--vk-ink-3)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                transition: 'all 0.15s',
              }}
            >
              <FileSpreadsheet style={{ width: 16, height: 16 }} />
              ใบวางบิลรายบุคคล 7 วัน
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 7px',
                  borderRadius: 10,
                  fontWeight: 700,
                  background: activeView === 'timesheet' ? '#ccfbf1' : '#f1f5f9',
                  color: activeView === 'timesheet' ? '#0f766e' : 'var(--vk-ink-3)',
                }}
              >
                {timesheetReport.thaiWorkers.length + timesheetReport.foreignWorkers.length} คน
              </span>
            </button>
          </div>

          <div style={{ fontSize: 12, color: 'var(--vk-ink-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>โหมดที่แสดง:</span>
            <span style={{ fontWeight: 700, color: '#0f766e', background: '#f0fdfa', padding: '2px 8px', borderRadius: 4, border: '1px solid #ccfbf1' }}>
              {activeView === 'jobSummary' ? 'สรุปตามรหัสงาน' : 'ใบวางบิลรายบุคคล 7 วัน'}
            </span>
          </div>
        </div>

        {/* Top 4 KPI Summary Cards */}
        {activeView === 'timesheet' ? (
          <div
            style={{
              padding: '14px 24px',
              background: 'var(--vk-bone)',
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 12,
              borderBottom: '1px solid var(--vk-rule-soft)',
              flexShrink: 0,
            }}
          >
            {/* Card 1: Workers count */}
            <div
              style={{
                background: '#fff',
                border: '1px solid var(--vk-rule-soft)',
                padding: '12px 16px',
                borderRadius: 4,
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--vk-ink-3)' }}>
                  1. จำนวนคนงานทั้งหมด
                </span>
                <Users style={{ width: 14, height: 14, color: '#0284c7' }} />
              </div>
              <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 20, fontWeight: 800, color: 'var(--vk-ink)', margin: '4px 0 2px' }}>
                {timesheetReport.thaiWorkers.length + timesheetReport.foreignWorkers.length} คน
              </div>
              <div style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>
                ไทย {timesheetReport.thaiWorkers.length} คน · ต่างด้าว {timesheetReport.foreignWorkers.length} คน
              </div>
            </div>

            {/* Card 2: Worker wages paid */}
            <div
              style={{
                background: '#fff',
                border: '1px solid var(--vk-rule-soft)',
                padding: '12px 16px',
                borderRadius: 4,
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--vk-ink-3)' }}>
                  2. จ่ายค่าจ้างคนงาน (รวม)
                </span>
                <DollarSign style={{ width: 14, height: 14, color: 'var(--vk-crimson)' }} />
              </div>
              <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 20, fontWeight: 800, color: 'var(--vk-crimson)', margin: '4px 0 2px' }}>
                ฿{mono(timesheetReport.grandTotal.totalWage)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>
                ปกติ ฿{mono(timesheetReport.grandTotal.normalWage)} · OT ฿{mono(timesheetReport.grandTotal.ot15Wage + timesheetReport.grandTotal.ot20Wage + timesheetReport.grandTotal.ot30Wage)}
              </div>
            </div>

            {/* Card 3: 28% Service Fee */}
            <div
              style={{
                background: '#fff',
                border: '1px solid var(--vk-rule-soft)',
                padding: '12px 16px',
                borderRadius: 4,
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--vk-ink-3)' }}>
                  3. ค่าบริการ 28% (VRK Fee)
                </span>
                <TrendingUp style={{ width: 14, height: 14, color: '#b45309' }} />
              </div>
              <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 20, fontWeight: 800, color: '#b45309', margin: '4px 0 2px' }}>
                ฿{mono(timesheetReport.grandTotal.serviceFee)}
              </div>
              <div style={{ fontSize: 11, color: '#b45309', fontWeight: 600 }}>
                จากฐานค่าจ้าง ฿{mono(timesheetReport.grandTotal.baseWageForFee)}
              </div>
            </div>

            {/* Card 4: Total Billing */}
            <div
              style={{
                background: '#fff',
                border: '1px solid var(--vk-rule-soft)',
                padding: '12px 16px',
                borderRadius: 4,
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--vk-ink-3)' }}>
                  4. รวมเงินวางบิลสุทธิ
                </span>
                <Receipt style={{ width: 14, height: 14, color: '#0f766e' }} />
              </div>
              <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 20, fontWeight: 800, color: '#0f766e', margin: '4px 0 2px' }}>
                ฿{mono(timesheetReport.grandTotal.totalBillingAmount)}
              </div>
              <div style={{ fontSize: 11, color: '#0f766e', fontWeight: 600 }}>
                (ค่าจ้าง + ค่าบริการ 28%)
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              padding: '14px 24px',
              background: 'var(--vk-bone)',
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 12,
              borderBottom: '1px solid var(--vk-rule-soft)',
              flexShrink: 0,
            }}
          >
            {/* Card 1: Wage Paid */}
            <div
              style={{
                background: '#fff',
                border: '1px solid var(--vk-rule-soft)',
                padding: '12px 16px',
                borderRadius: 4,
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--vk-ink-3)' }}>
                  1. จ่ายพนักงานรวม (ต้นทุน)
                </span>
                <DollarSign style={{ width: 14, height: 14, color: 'var(--vk-crimson)' }} />
              </div>
              <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 20, fontWeight: 800, color: 'var(--vk-crimson)', margin: '4px 0 2px' }}>
                ฿{mono(billingSummary.totalWagePaid)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>
                ปกติ ฿{mono(billingSummary.jobGroups.reduce((a, g) => a + g.totalNormalWage, 0))} · ฝีมือ ฿{mono(billingSummary.jobGroups.reduce((a, g) => a + g.totalSkilledWage, 0))}
              </div>
            </div>

            {/* Card 2: Factory Billing */}
            <div
              style={{
                background: '#fff',
                border: '1px solid var(--vk-rule-soft)',
                padding: '12px 16px',
                borderRadius: 4,
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--vk-ink-3)' }}>
                  2. ตั้งเบิกโรงงานรวม (รายรับ)
                </span>
                <Receipt style={{ width: 14, height: 14, color: '#0f766e' }} />
              </div>
              <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 20, fontWeight: 800, color: '#0f766e', margin: '4px 0 2px' }}>
                ฿{mono(billingSummary.totalBillingAmount)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>
                OT ตั้งเบิก: ฿{mono(billingSummary.jobGroups.reduce((a, g) => a + g.totalOtBillingAmount, 0))}
              </div>
            </div>

            {/* Card 3: Gross Profit Margin */}
            <div
              style={{
                background: '#fff',
                border: '1px solid var(--vk-rule-soft)',
                padding: '12px 16px',
                borderRadius: 4,
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--vk-ink-3)' }}>
                  3. กำไรส่วนต่างสุทธิ
                </span>
                <TrendingUp style={{ width: 14, height: 14, color: '#16a34a' }} />
              </div>
              <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 20, fontWeight: 800, color: '#16a34a', margin: '4px 0 2px' }}>
                ฿{mono(billingSummary.totalGrossProfit)}
              </div>
              <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>
                อัตรากำไรเฉลี่ย: {billingSummary.overallMarginPercent.toFixed(2)}%
              </div>
            </div>

            {/* Card 4: Total Man-shifts */}
            <div
              style={{
                background: '#fff',
                border: '1px solid var(--vk-rule-soft)',
                padding: '12px 16px',
                borderRadius: 4,
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--vk-ink-3)' }}>
                  4. ปริมาณแรงงาน (กะทำงาน)
                </span>
                <Users style={{ width: 14, height: 14, color: 'var(--vk-auto)' }} />
              </div>
              <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 20, fontWeight: 800, color: 'var(--vk-ink)', margin: '4px 0 2px' }}>
                {monoInt(billingSummary.totalShifts)} กะ
              </div>
              <div style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>
                รอบ: {effectiveRange.modeLabel} ({billingSummary.jobGroups.length} รหัสงาน)
              </div>
            </div>
          </div>
        )}

        {/* Interactive Data Table Area */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#fff' }}>
          {activeView === 'timesheet' ? (
            <EmployeeTimesheetTable
              report={timesheetReport}
              filteredThaiWorkers={filteredThaiWorkers}
              filteredForeignWorkers={filteredForeignWorkers}
              effectiveRangeLabel={effectiveRange.label}
              isLoading={isLoadingShifts}
            />
          ) : (
            <div style={{ flex: 1, overflow: 'auto', background: '#fff' }}>
          {isLoadingShifts ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10 }}>
              <Loader2 className="animate-spin" style={{ width: 22, height: 22, color: '#0f766e' }} />
              <span style={{ fontSize: 13, color: 'var(--vk-ink-3)' }}>กำลังคำนวณยอดสรุปวางบิล...</span>
            </div>
          ) : filteredGroups.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8 }}>
              <Briefcase style={{ width: 36, height: 36, color: 'var(--vk-ink-4)' }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--vk-ink-3)' }}>
                ไม่พบข้อมูลการปฏิบัติงานในช่วงเวลาที่เลือก ({effectiveRange.label})
              </div>
            </div>
          ) : (
            <table
              style={{
                width: 'max-content',
                minWidth: '100%',
                borderCollapse: 'separate',
                borderSpacing: 0,
                fontSize: 11.5,
                fontFamily: 'var(--vk-sans)',
                whiteSpace: 'nowrap',
              }}
            >
              <thead>
                {/* Header Level 1 (Top: 0) */}
                <tr style={{ background: '#f1f5f9' }}>
                  <th
                    style={{
                      position: 'sticky',
                      left: 0,
                      top: 0,
                      zIndex: 40,
                      height: 35,
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      textAlign: 'left',
                      fontWeight: 700,
                      background: '#f1f5f9',
                      borderBottom: '1px solid #cbd5e1',
                      borderRight: '2px solid #94a3b8',
                      boxShadow: '2px 0 4px rgba(0,0,0,0.06)',
                      minWidth: 110,
                    }}
                  >
                    รหัสงาน
                  </th>
                  <th
                    colSpan={2}
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 30,
                      height: 35,
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      textAlign: 'left',
                      fontWeight: 700,
                      background: '#f1f5f9',
                      borderBottom: '1px solid #cbd5e1',
                      borderRight: '1px solid #cbd5e1',
                    }}
                  >
                    แผนก & รายละเอียดงาน
                  </th>
                  <th
                    colSpan={7}
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 30,
                      height: 35,
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      textAlign: 'center',
                      fontWeight: 700,
                      borderBottom: '1px solid #cbd5e1',
                      borderRight: '1px solid #cbd5e1',
                      background: '#e0f2fe',
                    }}
                  >
                    จำนวนแรงงาน (กะทำงาน)
                  </th>
                  <th
                    colSpan={9}
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 30,
                      height: 35,
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      textAlign: 'center',
                      fontWeight: 700,
                      borderBottom: '1px solid #cbd5e1',
                      borderRight: '1px solid #cbd5e1',
                      background: '#fee2e2',
                    }}
                  >
                    ค่าจ้างจ่ายพนักงาน (ต้นทุน VRK)
                  </th>
                  <th
                    colSpan={8}
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 30,
                      height: 35,
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      textAlign: 'center',
                      fontWeight: 700,
                      borderBottom: '1px solid #cbd5e1',
                      borderRight: '1px solid #cbd5e1',
                      background: '#ccfbf1',
                    }}
                  >
                    ยอดตั้งเบิกโรงงานต้นสังกัด (รายรับ)
                  </th>
                  <th
                    colSpan={2}
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 30,
                      height: 35,
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      textAlign: 'center',
                      fontWeight: 700,
                      borderBottom: '1px solid #cbd5e1',
                      background: '#fef3c7',
                    }}
                  >
                    ส่วนต่างกำไร
                  </th>
                </tr>

                {/* Header Level 2 (Top: 35) */}
                <tr style={{ background: '#f8fafc', fontSize: 11 }}>
                  <th
                    style={{
                      position: 'sticky',
                      left: 0,
                      top: 35,
                      zIndex: 40,
                      height: 35,
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      textAlign: 'left',
                      fontWeight: 700,
                      background: '#f8fafc',
                      borderBottom: '2px solid #94a3b8',
                      borderRight: '2px solid #94a3b8',
                      boxShadow: '2px 0 4px rgba(0,0,0,0.06)',
                      minWidth: 110,
                    }}
                  >
                    รหัสงาน
                  </th>
                  <th
                    style={{
                      position: 'sticky',
                      top: 35,
                      zIndex: 30,
                      height: 35,
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      textAlign: 'left',
                      background: '#f8fafc',
                      borderBottom: '2px solid #94a3b8',
                      borderRight: '1px solid #e2e8f0',
                    }}
                  >
                    แผนก
                  </th>
                  <th
                    style={{
                      position: 'sticky',
                      top: 35,
                      zIndex: 30,
                      height: 35,
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      textAlign: 'left',
                      background: '#f8fafc',
                      borderBottom: '2px solid #94a3b8',
                      borderRight: '1px solid #cbd5e1',
                    }}
                  >
                    รายละเอียดงาน
                  </th>

                  {/* Shifts */}
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '8px 6px', textAlign: 'right' }}>ปกติ (ช)</th>
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '8px 6px', textAlign: 'right' }}>ปกติ (ญ)</th>
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '8px 6px', textAlign: 'right', fontWeight: 700 }}>รวมปกติ</th>
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '8px 6px', textAlign: 'right' }}>ฝีมือ (ช)</th>
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '8px 6px', textAlign: 'right' }}>ฝีมือ (ญ)</th>
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '8px 6px', textAlign: 'right', fontWeight: 700 }}>รวมฝีมือ</th>
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #cbd5e1', padding: '8px 8px', textAlign: 'right', fontWeight: 800, color: '#0284c7' }}>รวมแรงงาน</th>

                  {/* Wages Paid */}
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '8px 6px', textAlign: 'right' }}>อัตราปกติ</th>
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '8px 8px', textAlign: 'right', fontWeight: 600 }}>รวมค่าแรงปกติ</th>
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '8px 6px', textAlign: 'right' }}>อัตราฝีมือ</th>
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '8px 8px', textAlign: 'right', fontWeight: 600 }}>รวมค่าแรงฝีมือ</th>
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '8px 6px', textAlign: 'right' }}>OT 1.5x (ชม.)</th>
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '8px 8px', textAlign: 'right' }}>เงิน OT 1.5x</th>
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '8px 6px', textAlign: 'right' }} title="กะทำงานวันหยุด (ได้ 2 เท่า)">OT 2.0x (ชม.)</th>
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '8px 8px', textAlign: 'right' }} title="ค่าจ้างวันหยุด 2 เท่า">เงิน OT 2.0x</th>
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #cbd5e1', padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#b91c1c' }}>
                    รวมจ่ายพนักงาน
                  </th>

                  {/* Billing */}
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '8px 6px', textAlign: 'right' }}>ตั้งเบิกปกติ</th>
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '8px 8px', textAlign: 'right', fontWeight: 600 }}>รวมเบิกปกติ</th>
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '8px 6px', textAlign: 'right' }}>ตั้งเบิกฝีมือ</th>
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '8px 8px', textAlign: 'right', fontWeight: 600 }}>รวมเบิกฝีมือ</th>
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '8px 8px', textAlign: 'right' }}>เบิก OT 1.5x</th>
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '8px 8px', textAlign: 'right' }}>เบิก OT 2.0x</th>
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '8px 8px', textAlign: 'right', fontWeight: 700 }}>รวมเบิก OT</th>
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #cbd5e1', padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#0f766e' }}>
                    รวมตั้งเบิกทั้งหมด
                  </th>

                  {/* Margin */}
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#16a34a' }}>กำไร (บาท)</th>
                  <th style={{ position: 'sticky', top: 35, zIndex: 30, height: 35, boxSizing: 'border-box', background: '#f8fafc', borderBottom: '2px solid #94a3b8', padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>% กำไร</th>
                </tr>
              </thead>

              <tbody>
                {filteredGroups.map((g, idx) => {
                  const bg = idx % 2 === 0 ? '#fff' : '#fafafa'
                  return (
                    <tr
                      key={g.jobCode}
                      style={{
                        background: bg,
                      }}
                    >
                      {/* Job Info (Col 1: Frozen horizontally on left) */}
                      <td
                        style={{
                          position: 'sticky',
                          left: 0,
                          zIndex: 10,
                          background: bg,
                          padding: '6px 10px',
                          fontWeight: 700,
                          fontFamily: 'var(--vk-mono)',
                          borderRight: '2px solid #94a3b8',
                          borderBottom: '1px solid #e2e8f0',
                          boxShadow: '2px 0 4px rgba(0,0,0,0.06)',
                          minWidth: 110,
                        }}
                      >
                        {g.jobCode}
                      </td>
                      <td style={{ padding: '6px 10px', color: 'var(--vk-ink-3)', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>{g.department}</td>
                      <td style={{ padding: '6px 10px', borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #e2e8f0' }}>{g.jobDescription}</td>

                      {/* Shift Breakdown */}
                      <td style={{ padding: '6px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>{g.normalMaleShifts || '—'}</td>
                      <td style={{ padding: '6px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>{g.normalFemaleShifts || '—'}</td>
                      <td style={{ padding: '6px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontWeight: 600, borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>{g.totalNormalShifts || '—'}</td>
                      <td style={{ padding: '6px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>{g.skilledMaleShifts || '—'}</td>
                      <td style={{ padding: '6px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>{g.skilledFemaleShifts || '—'}</td>
                      <td style={{ padding: '6px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontWeight: 600, borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>{g.totalSkilledShifts || '—'}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontWeight: 700, color: '#0284c7', borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #e2e8f0' }}>{g.totalShifts}</td>

                      {/* Wages Paid */}
                      <td style={{ padding: '6px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>฿{monoInt(g.normalRate)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontWeight: 600, borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>฿{mono(g.totalNormalWage)}</td>
                      <td style={{ padding: '6px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>฿{monoInt(g.skilledRate)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontWeight: 600, borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>฿{mono(g.totalSkilledWage)}</td>
                      <td style={{ padding: '6px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>{g.ot15Hours || '—'}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>฿{mono(g.ot15Pay)}</td>
                      <td style={{ padding: '6px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>{g.ot20Hours || '—'}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>฿{mono(g.ot20Pay)}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontWeight: 700, color: '#b91c1c', borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #e2e8f0' }}>
                        ฿{mono(g.totalWagePaid)}
                      </td>

                      {/* Factory Billing */}
                      <td style={{ padding: '6px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>฿{monoInt(g.billingNormalRate)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontWeight: 600, borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>฿{mono(g.billingNormalAmount)}</td>
                      <td style={{ padding: '6px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>฿{monoInt(g.billingSkilledRate)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontWeight: 600, borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>฿{mono(g.billingSkilledAmount)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>฿{mono(g.ot15BillingAmount)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>฿{mono(g.ot20BillingAmount)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontWeight: 700, borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>฿{mono(g.totalOtBillingAmount)}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontWeight: 800, color: '#0f766e', borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #e2e8f0' }}>
                        ฿{mono(g.totalBillingAmount)}
                      </td>

                      {/* Margin */}
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontWeight: 800, color: '#16a34a', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>
                        ฿{mono(g.grossProfit)}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>
                        {g.marginPercent.toFixed(2)}%
                      </td>
                    </tr>
                  )
                })}
              </tbody>

              {/* Grand Total Footer (Frozen at bottom and left) */}
              <tfoot>
                <tr style={{ background: '#f8fafc', fontWeight: 800, fontSize: 12 }}>
                  <td
                    style={{
                      position: 'sticky',
                      left: 0,
                      bottom: 0,
                      zIndex: 40,
                      background: '#f8fafc',
                      padding: '10px',
                      borderTop: '2px solid #94a3b8',
                      borderRight: '2px solid #94a3b8',
                      boxShadow: '2px 0 4px rgba(0,0,0,0.06)',
                      minWidth: 110,
                    }}
                  >
                    รวมทั้งสิ้น
                  </td>
                  <td
                    colSpan={2}
                    style={{
                      position: 'sticky',
                      bottom: 0,
                      zIndex: 30,
                      background: '#f8fafc',
                      padding: '10px',
                      borderTop: '2px solid #94a3b8',
                      borderRight: '1px solid #cbd5e1',
                      color: 'var(--vk-ink-3)',
                      fontWeight: 600,
                    }}
                  >
                    (Grand Total)
                  </td>

                  {/* Shifts */}
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '10px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)' }}>
                    {monoInt(filteredGroups.reduce((a, g) => a + g.normalMaleShifts, 0))}
                  </td>
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '10px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)' }}>
                    {monoInt(filteredGroups.reduce((a, g) => a + g.normalFemaleShifts, 0))}
                  </td>
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '10px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)' }}>
                    {monoInt(filteredGroups.reduce((a, g) => a + g.totalNormalShifts, 0))}
                  </td>
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '10px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)' }}>
                    {monoInt(filteredGroups.reduce((a, g) => a + g.skilledMaleShifts, 0))}
                  </td>
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '10px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)' }}>
                    {monoInt(filteredGroups.reduce((a, g) => a + g.skilledFemaleShifts, 0))}
                  </td>
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '10px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)' }}>
                    {monoInt(filteredGroups.reduce((a, g) => a + g.totalSkilledShifts, 0))}
                  </td>
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #cbd5e1', padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', color: '#0284c7' }}>
                    {monoInt(filteredGroups.reduce((a, g) => a + g.totalShifts, 0))}
                  </td>

                  {/* Wages Paid */}
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '10px 6px', textAlign: 'right' }}>—</td>
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)' }}>
                    ฿{mono(filteredGroups.reduce((a, g) => a + g.totalNormalWage, 0))}
                  </td>
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '10px 6px', textAlign: 'right' }}>—</td>
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)' }}>
                    ฿{mono(filteredGroups.reduce((a, g) => a + g.totalSkilledWage, 0))}
                  </td>
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '10px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)' }}>
                    {monoInt(filteredGroups.reduce((a, g) => a + g.ot15Hours, 0))}
                  </td>
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)' }}>
                    ฿{mono(filteredGroups.reduce((a, g) => a + g.ot15Pay, 0))}
                  </td>
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '10px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)' }}>
                    {monoInt(filteredGroups.reduce((a, g) => a + g.ot20Hours, 0))}
                  </td>
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)' }}>
                    ฿{mono(filteredGroups.reduce((a, g) => a + g.ot20Pay, 0))}
                  </td>
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #cbd5e1', padding: '10px 10px', textAlign: 'right', fontFamily: 'var(--vk-mono)', color: '#b91c1c' }}>
                    ฿{mono(filteredGroups.reduce((a, g) => a + g.totalWagePaid, 0))}
                  </td>

                  {/* Billing */}
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '10px 6px', textAlign: 'right' }}>—</td>
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)' }}>
                    ฿{mono(filteredGroups.reduce((a, g) => a + g.billingNormalAmount, 0))}
                  </td>
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '10px 6px', textAlign: 'right' }}>—</td>
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)' }}>
                    ฿{mono(filteredGroups.reduce((a, g) => a + g.billingSkilledAmount, 0))}
                  </td>
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)' }}>
                    ฿{mono(filteredGroups.reduce((a, g) => a + g.ot15BillingAmount, 0))}
                  </td>
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)' }}>
                    ฿{mono(filteredGroups.reduce((a, g) => a + g.ot20BillingAmount, 0))}
                  </td>
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontWeight: 700 }}>
                    ฿{mono(filteredGroups.reduce((a, g) => a + g.totalOtBillingAmount, 0))}
                  </td>
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #cbd5e1', padding: '10px 10px', textAlign: 'right', fontFamily: 'var(--vk-mono)', color: '#0f766e' }}>
                    ฿{mono(filteredGroups.reduce((a, g) => a + g.totalBillingAmount, 0))}
                  </td>

                  {/* Margin */}
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', padding: '10px 10px', textAlign: 'right', fontFamily: 'var(--vk-mono)', color: '#16a34a' }}>
                    ฿{mono(filteredGroups.reduce((a, g) => a + g.grossProfit, 0))}
                  </td>
                  <td style={{ position: 'sticky', bottom: 0, zIndex: 30, background: '#f8fafc', borderTop: '2px solid #94a3b8', padding: '10px 10px', textAlign: 'right', fontFamily: 'var(--vk-mono)' }}>
                    {billingSummary.overallMarginPercent.toFixed(2)}%
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '14px 24px',
            background: 'var(--vk-paper)',
            borderTop: '1px solid var(--vk-rule)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--vk-ink-3)' }}>
            {activeView === 'timesheet' ? (
              <>
                แสดงคนงาน <strong>{filteredThaiWorkers.length + filteredForeignWorkers.length}</strong> คน (ไทย {filteredThaiWorkers.length} · ต่างด้าว {filteredForeignWorkers.length}) · ช่วงเวลา: <strong>{effectiveRange.label}</strong>
              </>
            ) : (
              <>
                แสดงรหัสงานทั้งหมด <strong>{filteredGroups.length}</strong> รายการ · ช่วงเวลา: <strong>{effectiveRange.label}</strong>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="vk-btn"
              onClick={handleExportExcel}
              disabled={
                isExporting ||
                isLoadingShifts ||
                (activeView === 'timesheet'
                  ? timesheetReport.thaiWorkers.length === 0 && timesheetReport.foreignWorkers.length === 0
                  : billingSummary.jobGroups.length === 0)
              }
              style={{
                borderColor: '#0f766e',
                background: '#0f766e',
                color: '#fff',
                height: 38,
                padding: '0 20px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontWeight: 700,
              }}
            >
              {isExporting ? <Loader2 style={{ width: 15, height: 15 }} className="animate-spin" /> : <FileSpreadsheet style={{ width: 16, height: 16 }} />}
              ดาวน์โหลดไฟล์ Excel ({activeView === 'timesheet' ? 'ใบวางบิลรายบุคคล 7 วัน' : effectiveRange.modeLabel})
            </button>
            <button
              className="vk-btn"
              onClick={onClose}
              style={{ height: 38, padding: '0 18px' }}
            >
              ปิด
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
