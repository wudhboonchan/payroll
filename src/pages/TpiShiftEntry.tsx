import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useOutletContext, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { toast } from 'sonner'
import {
  ChevronLeft,
  ChevronRight,
  Save,
  CheckSquare,
  Search,
  X,
  Plus,
  Trash2,
  Briefcase,
  UserX,
  ShieldAlert,
  AlertTriangle,
} from 'lucide-react'
import type { Job, Employee, Entry, QuotaStatus } from '../features/tpi/model'
import { AttendanceModal } from '../features/tpi/AttendanceModal'
import type { AttendanceLog } from '../features/tpi/attendanceApi'
import { loadDailyAttendance, formatAttendanceSummary } from '../features/tpi/attendanceApi'
import {
  SHIFTS,
  isJobAvailable,
  isClerkJob,
  wageTier,
  validateEntries,
  usage,
  getJobQuotaStatus,
  calculateEntryOt,
} from '../features/tpi/model'
import { getMainDepartment, cleanJobNotes } from '../features/tpi/referenceJobs'
import { employeeWageForm } from '../features/tpi/employeeWageForm'
import { demoJobs, demoEmployees, demoWageProfiles, demoInitialEntries } from '../features/tpi/demoData'
import { loadDay, saveDay, errorMessage } from '../features/tpi/api'
import { formatThaiBuddhistDate, compareEmployeeCode } from '../lib/formatters'
import { ThaiDatePicker } from '../components/common/ThaiDatePicker'
import '../styles/tokens.css'
import './TpiShiftEntry.css'

// ── Date Formatting Helpers ──────────────────────────────────────────
function parseLocal(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์']
function fmtDisplay(s: string) {
  const d = parseLocal(s)
  return `วัน${DAYS[d.getDay()]}ที่ ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`
}
function isWeekend(s: string) {
  const d = parseLocal(s)
  return d.getDay() === 0 || d.getDay() === 6
}

interface Period {
  id: string
  label: string
  period_start: string
  period_end: string
  status: string
}

interface TpiShiftEntryProps {
  preview?: boolean
  initialDate?: string
}

const getHolidayStorageKey = (factoryId?: string, dateStr?: string) =>
  `tpi_holiday_${factoryId || ''}_${dateStr || ''}`

export const getStoredHoliday = (factoryId?: string, dateStr?: string): boolean => {
  if (!factoryId || !dateStr) return false
  try {
    return localStorage.getItem(getHolidayStorageKey(factoryId, dateStr)) === 'true'
  } catch {
    return false
  }
}

export const setStoredHoliday = (factoryId: string | undefined, dateStr: string | undefined, val: boolean) => {
  if (!factoryId || !dateStr) return
  try {
    if (val) {
      localStorage.setItem(getHolidayStorageKey(factoryId, dateStr), 'true')
    } else {
      localStorage.removeItem(getHolidayStorageKey(factoryId, dateStr))
    }
  } catch {}
}

const isValidUuid = (str?: string): boolean =>
  !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)

const formatJobForDb = (ref: Job, factoryId: string) => {
  const quota = ref.quota || 0
  const pm = ref.planned_morning ?? null
  const pa = ref.planned_afternoon ?? null
  const pn = ref.planned_night ?? null
  const isPlanValid = pm !== null && pa !== null && pn !== null && (pm + pa + pn === quota)
  const isTemp = ref.job_type === 'temporary'
  const expiresOn = ref.expires_on || (isTemp ? '2026-12-31' : null)

  return {
    factory_id: factoryId,
    code: ref.code.trim(),
    department: ref.department ? ref.department.trim() : '',
    description: ref.description ? ref.description.trim() : '',
    job_type: (isTemp ? 'temporary' : 'regular') as 'temporary' | 'regular',
    job_group: ref.job_group || (['692021', '692032', '692041', '692050'].includes(ref.code.trim()) ? 'clerk' : 'general'),
    quota,
    planned_morning: isPlanValid ? pm : null,
    planned_afternoon: isPlanValid ? pa : null,
    planned_night: isPlanValid ? pn : null,
    normal_rate: ref.normal_rate || 357,
    skilled_rate: (ref.job_group === 'clerk' || ['692021', '692032', '692041', '692050'].includes(ref.code.trim())) ? 377 : (ref.skilled_rate ?? null),
    valid_from: ref.valid_from || null,
    expires_on: expiresOn,
    active: ref.active ?? true,
    notes: cleanJobNotes(ref.notes),
    updated_at: new Date().toISOString(),
  }
}

async function ensureValidJobUuids(
  entriesToSave: Entry[],
  factoryId: string,
  availableJobs: Job[]
): Promise<Entry[]> {
  const needsUuid = entriesToSave.some((e) => !isValidUuid(e.job_id))
  if (!needsUuid) return entriesToSave

  // Fetch DB jobs for this factory
  const { data: latestDbJobs } = await supabase
    .from('tpi_job_codes')
    .select('*')
    .eq('factory_id', factoryId)

  const codeToDbJob = new Map((latestDbJobs || []).map((j: Job) => [j.code.trim().toLowerCase(), j]))

  // Find any reference jobs that are used in entries but not yet in the DB
  const missingJobsToInsert: any[] = []
  for (const entry of entriesToSave) {
    if (!isValidUuid(entry.job_id)) {
      const ref = availableJobs.find((j) => j.id === entry.job_id) || demoJobs.find((j) => j.id === entry.job_id)
      if (ref && !codeToDbJob.has(ref.code.trim().toLowerCase())) {
        missingJobsToInsert.push(formatJobForDb(ref, factoryId))
      }
    }
  }

  if (missingJobsToInsert.length > 0) {
    const { data: inserted } = await supabase
      .from('tpi_job_codes')
      .upsert(missingJobsToInsert, { onConflict: 'factory_id,code' })
      .select('*')
    for (const j of (inserted as Job[]) || []) {
      codeToDbJob.set(j.code.trim().toLowerCase(), j)
    }
  }

  // Replace any non-UUID job_id with the real DB UUID
  return entriesToSave.map((entry) => {
    if (isValidUuid(entry.job_id)) return entry
    const ref = availableJobs.find((j) => j.id === entry.job_id) || demoJobs.find((j) => j.id === entry.job_id)
    if (ref) {
      const match = codeToDbJob.get(ref.code.trim().toLowerCase())
      if (match && match.id) {
        return { ...entry, job_id: match.id }
      }
    }
    return entry
  })
}

export const JobCodeBadge: React.FC<{
  job: Job
  style?: React.CSSProperties
}> = ({ job, style }) => {
  const isClerk = isClerkJob(job)
  const normalRateVal = job.normal_rate ?? 357
  const normalRateStr = `฿${normalRateVal.toLocaleString()}`
  const skilledRateStr = job.skilled_rate != null ? `฿${job.skilled_rate.toLocaleString()}` : 'ไม่มี (ตามเรทปกติ)'
  const clerkPrefix = isClerk ? '🏢 [กลุ่มเสมียน] ' : ''
  const nativeTitle = `${clerkPrefix}รหัสงาน: ${job.code} (${job.department})\n• เรทปกติ: ${normalRateStr} / กะ\n• เรทฝีมือ: ${skilledRateStr}${isClerk ? '\n• พนักงานกลุ่มเสมียนได้รับเรทฝีมือ ฿377 อัตโนมัติ' : ''}`

  return (
    <div className="vk-tpi-code-tag-wrapper">
      <span
        className={`vk-tpi-code-tag ${isClerk ? 'is-clerk' : ''}`}
        title={nativeTitle}
        style={style}
      >
        {isClerk && (
          <span className="vk-tpi-clerk-badge-prefix" title="รหัสงานกลุ่มเสมียน (Clerk)">
            <span className="vk-tpi-clerk-icon">🏢</span>
            <span className="vk-tpi-clerk-txt">เสมียน</span>
          </span>
        )}
        <span className="vk-tpi-code-text">{job.code}</span>
      </span>
      <div className="vk-tpi-code-tooltip" role="tooltip">
        <div className="vk-tpi-tooltip-title">
          {isClerk && <span className="vk-tpi-tooltip-clerk-icon">🏢 </span>}
          รหัสงาน {job.code}
          {isClerk && <span className="vk-tpi-tooltip-clerk-pill">กลุ่มเสมียน</span>}
        </div>
        <div className="vk-tpi-tooltip-row">
          <span className="vk-tpi-tooltip-label">เรทปกติ:</span>
          <span className="vk-tpi-tooltip-val normal">{normalRateStr} / กะ</span>
        </div>
        <div className="vk-tpi-tooltip-row">
          <span className="vk-tpi-tooltip-label">เรทฝีมือ:</span>
          <span className="vk-tpi-tooltip-val skilled">{skilledRateStr}</span>
        </div>
        {isClerk && (
          <div className="vk-tpi-tooltip-clerk-note">
            ★ พนักงานเสมียนได้รับเรทฝีมือ ฿377 อัตโนมัติ
          </div>
        )}
      </div>
    </div>
  )
}

export const TpiShiftEntry: React.FC<TpiShiftEntryProps> = ({
  preview = false,
  initialDate,
}) => {
  // Outlet context for sidebar toggle (optional if in standalone preview)
  const outletContext = useOutletContext<{ onMenuClick?: () => void } | null>()
  const onMenuClick = outletContext?.onMenuClick || (() => {})
  const navigate = useNavigate()
  const { user } = useAppStore()
  const queryClient = useQueryClient()

  // ── Periods & Dates ────────────────────────────────────────────────
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('')

  const { data: periods = [] } = useQuery<Period[]>({
    queryKey: ['periods', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll_periods')
        .select('*')
        .eq('factory_id', user?.factory_id ?? '')
        .order('period_start', { ascending: false })
      if (error) throw error
      return data
    },
    enabled: !!user?.factory_id && !preview,
  })

  const currentPeriod = useMemo(() => {
    if (selectedPeriodId) {
      return periods.find((p) => p.id === selectedPeriodId) || periods[0] || null
    }
    return periods[0] || null
  }, [periods, selectedPeriodId])

  const periodStart = currentPeriod ? parseLocal(currentPeriod.period_start) : new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const periodEnd = currentPeriod ? parseLocal(currentPeriod.period_end) : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)

  // List of all dates strictly within the current open period
  const periodDates = useMemo(() => {
    if (!currentPeriod?.period_start || !currentPeriod?.period_end) return []
    const dates: string[] = []
    const start = parseLocal(currentPeriod.period_start)
    const end = parseLocal(currentPeriod.period_end)
    const d = new Date(start)
    while (d <= end) {
      dates.push(fmtDate(d))
      d.setDate(d.getDate() + 1)
    }
    return dates
  }, [currentPeriod?.period_start, currentPeriod?.period_end])

  // Helper: Ensures a given date is strictly within the active period
  const getValidDateForPeriod = (targetDate: Date | null, period: Period | null): Date => {
    if (!period) return targetDate || new Date()
    const targetStr = targetDate ? fmtDate(targetDate) : ''
    // If targetDate is within the period, keep it
    if (targetStr >= period.period_start && targetStr <= period.period_end) {
      return targetDate!
    }
    // If today is within the period, use today
    const today = new Date()
    const todayStr = fmtDate(today)
    if (todayStr >= period.period_start && todayStr <= period.period_end) {
      return today
    }
    // Otherwise default strictly to day 1 of the period
    return parseLocal(period.period_start)
  }

  const [currentDate, setCurrentDate] = useState<Date>(() => {
    if (initialDate) {
      return parseLocal(initialDate)
    }
    const initialPeriod = periods[0]
    return getValidDateForPeriod(null, initialPeriod || null)
  })

  // Whenever currentPeriod updates or loads, clamp currentDate strictly into the period
  useEffect(() => {
    if (!currentPeriod) return
    setCurrentDate((prev) => getValidDateForPeriod(prev, currentPeriod))
  }, [currentPeriod?.id, currentPeriod?.period_start, currentPeriod?.period_end])

  const activeDateStr = fmtDate(currentDate)
  const weekend = isWeekend(activeDateStr)
  const [isHoliday, setIsHoliday] = useState(false)

  const isAtStart = currentPeriod ? activeDateStr <= currentPeriod.period_start : true
  const isAtEnd = currentPeriod ? activeDateStr >= currentPeriod.period_end : true

  const navigateDate = (dir: -1 | 1) => {
    if (!currentPeriod) return
    const d = new Date(currentDate)
    d.setDate(d.getDate() + dir)
    const dStr = fmtDate(d)
    if (dStr < currentPeriod.period_start || dStr > currentPeriod.period_end) return
    setCurrentDate(d)
    setSelectedPoolIds(new Set())
  }

  // ── Database Data vs Demo Data ─────────────────────────────────────
  const { data: dbJobs = [] } = useQuery<Job[]>({
    queryKey: ['tpi-jobs', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tpi_job_codes')
        .select('*')
        .eq('factory_id', user?.factory_id ?? '')
        .order('code')
      if (error) throw error

      const rawJobs = (data || []) as Job[]
      const cleaned = rawJobs.map((j: Job) => {
        let active = j.active
        let needsActiveFix = false
        if (!active && (['P315/69VRK', 'P322/69VRK', 'P422/69', 'Q121/69', 'Q131/69'].includes(j.code.trim()) || (j.notes && j.notes.includes('ระบุหยุด')))) {
          active = true
          needsActiveFix = true
        }

        if (needsActiveFix && j.id) {
          supabase.from('tpi_job_codes').update({ active: true }).eq('id', j.id).then(() => {})
        }
        return { ...j, active }
      })

      if ((!data || data.length === 0) && user?.factory_id) {
        try {
          const payload = demoJobs.map((ref) => formatJobForDb(ref, user.factory_id))
          const res = await supabase
            .from('tpi_job_codes')
            .upsert(payload, { onConflict: 'factory_id,code' })
            .select('*')
          if (res.data && res.data.length > 0) {
            return res.data as Job[]
          }
        } catch (e) {
          console.warn('Auto-seed jobs error:', e)
        }
      }
      return cleaned
    },
    enabled: !!user?.factory_id && !preview,
  })

  const { data: dbEmployees = [] } = useQuery<Employee[]>({
    queryKey: ['tpi-employees', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('id,employee_code,first_name,last_name,nationality,status,position')
        .eq('factory_id', user?.factory_id ?? '')
        .eq('status', 'active')
        .order('employee_code')
      if (error) throw error
      return (data || []).sort((a, b) => compareEmployeeCode(a.employee_code, b.employee_code))
    },
    enabled: !!user?.factory_id && !preview,
  })

  // Query TPI Wage Profiles
  const { data: dbWageProfiles = [] } = useQuery({
    queryKey: ['tpi-profiles', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tpi_employee_wage_profiles')
        .select('*')
        .eq('factory_id', user?.factory_id ?? '')
      if (error) return []
      return data || []
    },
    enabled: !!user?.factory_id && !preview,
  })

  // Active jobs, employees, and wage profiles (seamlessly merge DB jobs with standard jobs)
  const jobs = useMemo(() => {
    const dbMap = new Map(dbJobs.map((j) => [j.code.trim().toLowerCase(), j]))
    const merged: Job[] = demoJobs.map((refJob) => {
      const key = refJob.code.trim().toLowerCase()
      const dbMatch = dbMap.get(key)
      if (dbMatch) {
        dbMap.delete(key)
        return dbMatch
      }
      return refJob
    })
    for (const customDbJob of dbMap.values()) {
      merged.push(customDbJob)
    }
    return merged
  }, [dbJobs])
  const employees = useMemo(() => {
    const list = [...(preview ? demoEmployees : dbEmployees)]
    return list.sort((a, b) => compareEmployeeCode(a.employee_code, b.employee_code))
  }, [preview, dbEmployees])
  const wageProfiles = useMemo(() => (preview ? demoWageProfiles : dbWageProfiles), [preview, dbWageProfiles])
  const isSkilledWorker = useMemo(() => {
    const profileMap = new Map<string, WageProfile>()
    for (const p of wageProfiles) {
      profileMap.set(p.employee_id, p)
    }
    const empMap = new Map(employees.map((e) => [e.id, e]))
    const jobsList = jobs.length > 0 ? jobs : referenceJobs
    return (empId: string) => {
      const p = profileMap.get(empId)
      if (p?.rate_tier === 'skilled') {
        if (p.skilled_from && p.skilled_from > activeDateStr) return false
        return true
      }
      const emp = empMap.get(empId)
      if (emp) {
        const form = employeeWageForm(emp.job_title, p, jobsList)
        if (form.rateTier === 'skilled') {
          if (p?.skilled_from && p.skilled_from > activeDateStr) return false
          return true
        }
      }
      return false
    }
  }, [wageProfiles, activeDateStr, employees, jobs])

  // Track daily revision for optimistic concurrency control
  const [dayRevision, setDayRevision] = useState(0)

  // Local shift entries state (start empty when not in preview mode)
  const [entries, setEntries] = useState<Entry[]>(preview ? demoInitialEntries : [])

  // Daily attendance state & query
  const [isAttendanceModalOpen, setIsAttendanceModalOpen] = useState(false)
  const { data: dailyAttendance = [], refetch: refetchAttendance } = useQuery({
    queryKey: ['tpi-daily-attendance', user?.factory_id, activeDateStr],
    queryFn: async () => {
      if (!user?.factory_id || preview) return []
      return await loadDailyAttendance(user.factory_id, activeDateStr)
    },
    enabled: !!user?.factory_id && !preview,
  })

  const attendanceEmpMap = useMemo(() => {
    const map = new Map<string, AttendanceLog>()
    for (const log of dailyAttendance) {
      map.set(log.employee_id, log)
    }
    return map
  }, [dailyAttendance])

  // Load actual day's entries from Supabase
  const { data: dayData } = useQuery({
    queryKey: ['tpi-shift-day', user?.factory_id, activeDateStr],
    queryFn: async () => {
      if (!user?.factory_id || preview) return null
      const localHoliday = getStoredHoliday(user.factory_id, activeDateStr)
      try {
        const res = await loadDay(user.factory_id, activeDateStr)
        return {
          ...res,
          is_holiday: !!res.is_holiday || localHoliday,
        }
      } catch (e: any) {
        console.warn('loadDay fallback:', e)
        const { data } = await supabase
          .from('tpi_shift_entries')
          .select('employee_id, shift_index, job_id, rate_tier, rate_snapshot, job_code_snapshot, is_half_shift, actual_hours, ot_hours, ot_pay, is_holiday_ot')
          .eq('factory_id', user.factory_id)
          .eq('work_date', activeDateStr)
        const hasDbHoliday = (data || []).some((e: any) => !!e.is_holiday_ot)
        return { 
          revision: 0, 
          is_holiday: hasDbHoliday || localHoliday,
          entries: (data || []) as any 
        }
      }
    },
    enabled: !!user?.factory_id && !preview,
  })

  useEffect(() => {
    if (preview) {
      setEntries(demoInitialEntries)
      setDayRevision(0)
      setIsHoliday(false)
    } else if (dayData) {
      setEntries(dayData.entries || [])
      setDayRevision(dayData.revision || 0)
      const dbHoliday = !!dayData.is_holiday || (dayData.entries || []).some((e: any) => !!e.is_holiday_ot)
      const localHoliday = getStoredHoliday(user?.factory_id, activeDateStr)
      const finalHoliday = dbHoliday || localHoliday
      setIsHoliday(finalHoliday)
      if (dbHoliday && !localHoliday && user?.factory_id) {
        setStoredHoliday(user.factory_id, activeDateStr, true)
      }
    } else {
      setEntries([])
      setDayRevision(0)
      setIsHoliday(getStoredHoliday(user?.factory_id, activeDateStr))
    }
  }, [dayData, preview, activeDateStr, user?.factory_id])

  // Daily target requirements per job per shift (keyed by `${activeDateStr}:${job.id}`)
  const [dailyTargets, setDailyTargets] = useState<Record<string, [number, number, number]>>({})

  // Modal state for Daily Job Requirements (Step 1: Admin Paper Entry)
  const [isTargetModalOpen, setIsTargetModalOpen] = useState(false)
  const [tempDailyTargets, setTempDailyTargets] = useState<Record<string, [number, number, number]>>({})
  const [targetModalSearch, setTargetModalSearch] = useState('')

  const getShiftTargets = useCallback(
    (job: Job): [number, number, number] => {
      const key = `${activeDateStr}:${job.id}`
      if (dailyTargets[key]) {
        return dailyTargets[key]
      }
      // Default initial targets from job master quota
      const m = job.planned_morning ?? (job.quota > 0 ? job.quota : 0)
      const a = job.planned_afternoon ?? 0
      const n = job.planned_night ?? 0
      return [m, a, n]
    },
    [dailyTargets, activeDateStr]
  )

  // ── Selection and Search State (Diamond Pattern) ────────────────────
  const [selectedPoolIds, setSelectedPoolIds] = useState<Set<string>>(new Set())
  const [searchTerm, setSearchTerm] = useState('')

  // ── Modal State for Editing / Adding Shifts to a Worker ─────────────
  const [modalEmp, setModalEmp] = useState<Employee | null>(null)
  const [modalShift1JobId, setModalShift1JobId] = useState<string>('')
  const [modalShift1Index, setModalShift1Index] = useState<number>(0)
  const [modalShift1IsHalf, setModalShift1IsHalf] = useState<boolean>(false)
  const [modalShift1HasOt, setModalShift1HasOt] = useState<boolean>(false)
  const [modalShift1OtHours, setModalShift1OtHours] = useState<number>(1)
  const [modalHasShift2, setModalHasShift2] = useState<boolean>(false)
  const [modalShift2JobId, setModalShift2JobId] = useState<string>('')
  const [modalShift2Index, setModalShift2Index] = useState<number>(1)
  const [modalShift2IsHalf, setModalShift2IsHalf] = useState<boolean>(false)
  const [modalShift2HasOt, setModalShift2HasOt] = useState<boolean>(false)
  const [modalShift2OtHours, setModalShift2OtHours] = useState<number>(1)

  // ── Modal State for จป. Disciplinary Fine ────────────────────────────
  const [modalSafetyFineEnabled, setModalSafetyFineEnabled] = useState<boolean>(false)
  const [modalSafetyFineDate, setModalSafetyFineDate] = useState<string>('')
  const [modalSafetyFineReason, setModalSafetyFineReason] = useState<string>('')
  const [modalSafetyFineSubmitting, setModalSafetyFineSubmitting] = useState<boolean>(false)

  // Query all active safety fine records
  const { data: allSafetyAdvances = [], refetch: refetchSafetyAdvances } = useQuery<any[]>({
    queryKey: ['all-safety-advances'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('advance_payments')
        .select('id, employee_id, period_id, amount, notes, created_at')
        .order('created_at', { ascending: false })
      if (error) return []
      return (data || []).filter(
        (a: any) =>
          (a.notes || '').includes('[หักค่าปรับ จป.]') ||
          (a.notes || '').includes('หักค่าปรับผิดระเบียบ') ||
          (a.notes || '').includes('ค่าปรับผิดระเบียบ')
      )
    },
    enabled: !preview,
    staleTime: 10000,
  })

  // ── Dynamic Height for Split Panel (Diamond Pattern) ────────────────
  const splitRef = useRef<HTMLDivElement>(null)
  const [splitHeight, setSplitHeight] = useState<number | null>(null)

  const hasSelection = selectedPoolIds.size > 0

  useEffect(() => {
    const update = () => {
      if (!splitRef.current) return
      const footer = document.querySelector('footer')
      const footerH = footer ? footer.getBoundingClientRect().height : 0
      setSplitHeight(window.innerHeight - splitRef.current.getBoundingClientRect().top - footerH)
    }
    const raf = requestAnimationFrame(update)
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', update)
    }
  }, [hasSelection])

  // ── Employee Lookup & Usage Tracking ────────────────────────────────
  const empMap = useMemo(() => {
    return new Map<string, Employee>(employees.map((e) => [e.id, e]))
  }, [employees])

  // Count how many shifts each worker is doing today (max 2)
  const empUsageMap = useMemo(() => {
    const map = new Map<string, { count: number; shifts: Set<number>; jobIds: string[] }>()
    for (const e of entries) {
      if (!map.has(e.employee_id)) {
        map.set(e.employee_id, { count: 0, shifts: new Set(), jobIds: [] })
      }
      const u = map.get(e.employee_id)!
      u.count++
      u.shifts.add(e.shift_index)
      u.jobIds.push(e.job_id)
    }
    return map
  }, [entries])

  const totalPeopleCount = empUsageMap.size
  const doubleShiftCount = useMemo(() => Array.from(empUsageMap.values()).filter(u => u.count >= 2).length, [empUsageMap])

  const availableJobs = useMemo(() => {
    return jobs.filter((j) => isJobAvailable(j, activeDateStr))
  }, [jobs, activeDateStr])

  const regularJobs = useMemo(() => {
    return availableJobs.filter((j) => j.job_type === 'regular')
  }, [availableJobs])

  const temporaryJobs = useMemo(() => {
    return availableJobs.filter((j) => j.job_type === 'temporary')
  }, [availableJobs])

  const regularGroups = useMemo(() => {
    const map = new Map<string, Job[]>()
    for (const j of regularJobs) {
      const dept = j.department || 'อื่นๆ'
      if (!map.has(dept)) map.set(dept, [])
      map.get(dept)!.push(j)
    }
    return Array.from(map.entries()).map(([department, groupJobs]) => ({
      department,
      jobs: groupJobs,
    }))
  }, [regularJobs])

  const temporaryGroups = useMemo(() => {
    const map = new Map<string, Job[]>()
    for (const j of temporaryJobs) {
      const dept = j.department || 'อื่นๆ'
      if (!map.has(dept)) map.set(dept, [])
      map.get(dept)!.push(j)
    }
    return Array.from(map.entries()).map(([department, groupJobs]) => ({
      department,
      jobs: groupJobs,
    }))
  }, [temporaryJobs])

  const grandTotalTarget = useMemo(() => {
    return availableJobs.reduce((sum, j) => {
      const t = getShiftTargets(j)
      return sum + t[0] + t[1] + t[2]
    }, 0)
  }, [availableJobs, getShiftTargets])

  const regularTargetTotal = useMemo(() => {
    return regularJobs.reduce((sum, j) => {
      const t = getShiftTargets(j)
      return sum + t[0] + t[1] + t[2]
    }, 0)
  }, [regularJobs, getShiftTargets])

  const tempTargetTotal = useMemo(() => {
    return temporaryJobs.reduce((sum, j) => {
      const t = getShiftTargets(j)
      return sum + t[0] + t[1] + t[2]
    }, 0)
  }, [temporaryJobs, getShiftTargets])

  // Active jobs for Daily Requirements Modal
  const activeJobsList = useMemo(() => {
    return availableJobs.filter((j) => j.active)
  }, [availableJobs])

  const filteredModalJobs = useMemo(() => {
    const term = targetModalSearch.toLowerCase().trim()
    if (!term) return activeJobsList
    return activeJobsList.filter(
      (j) =>
        j.code.toLowerCase().includes(term) ||
        (j.department || '').toLowerCase().includes(term) ||
        (j.description || '').toLowerCase().includes(term)
    )
  }, [activeJobsList, targetModalSearch])

  const modalRegularTotal = useMemo(() => {
    return activeJobsList
      .filter((j) => j.job_type === 'regular')
      .reduce((sum, j) => {
        const t = tempDailyTargets[j.id] || [0, 0, 0]
        return sum + t[0] + t[1] + t[2]
      }, 0)
  }, [activeJobsList, tempDailyTargets])

  const modalTempTotal = useMemo(() => {
    return activeJobsList
      .filter((j) => j.job_type === 'temporary')
      .reduce((sum, j) => {
        const t = tempDailyTargets[j.id] || [0, 0, 0]
        return sum + t[0] + t[1] + t[2]
      }, 0)
  }, [activeJobsList, tempDailyTargets])

  const modalGrandTotal = modalRegularTotal + modalTempTotal

  const handleOpenTargetModal = () => {
    const initial: Record<string, [number, number, number]> = {}
    activeJobsList.forEach((j) => {
      const key = `${activeDateStr}:${j.id}`
      if (dailyTargets[key]) {
        initial[j.id] = [...dailyTargets[key]]
      } else {
        const m = j.planned_morning ?? (j.quota > 0 ? j.quota : 0)
        const a = j.planned_afternoon ?? 0
        const n = j.planned_night ?? 0
        initial[j.id] = [m, a, n]
      }
    })
    setTempDailyTargets(initial)
    setTargetModalSearch('')
    setIsTargetModalOpen(true)
  }

  const handleTempTargetChange = (jobId: string, shiftIndex: number, valStr: string) => {
    const num = valStr === '' ? 0 : Math.max(0, parseInt(valStr, 10) || 0)
    setTempDailyTargets((prev) => {
      const current = prev[jobId] || [0, 0, 0]
      const updated: [number, number, number] = [...current] as [number, number, number]
      updated[shiftIndex] = num
      return {
        ...prev,
        [jobId]: updated,
      }
    })
  }

  const handleFillDefaultQuotas = () => {
    const updated: Record<string, [number, number, number]> = {}
    activeJobsList.forEach((j) => {
      updated[j.id] = [j.quota, 0, 0]
    })
    setTempDailyTargets(updated)
    toast.info('เติมยอดกะเช้าตามยอดเต็มมาตรฐานเรียบร้อย')
  }

  const handleClearAllModalTargets = () => {
    const updated: Record<string, [number, number, number]> = {}
    activeJobsList.forEach((j) => {
      updated[j.id] = [0, 0, 0]
    })
    setTempDailyTargets(updated)
    toast.info('ล้างยอดเป้าหมายเป็น 0 เรียบร้อย')
  }

  const handleSaveDailyTargets = () => {
    setDailyTargets((prev) => {
      const next = { ...prev }
      Object.entries(tempDailyTargets).forEach(([jobId, targets]) => {
        next[`${activeDateStr}:${jobId}`] = targets
      })
      return next
    })
    setIsTargetModalOpen(false)
    toast.success(`✓ บันทึกความต้องการแรงงานประจำวันเรียบร้อย (รวม ${modalGrandTotal} คน)`)
  }

  const renderQuotaBadge = (status: QuotaStatus, assigned: number, target: number) => {
    if (status === 'paused') {
      return <span className="vk-tpi-badge vk-badge-paused">ยกเลิกรหัสงาน</span>
    }
    if (status === 'zero' || (target === 0 && assigned === 0)) {
      return <span className="vk-tpi-badge vk-badge-paused">0/0 งดจัดกะวันนี้</span>
    }
    if (status === 'completed') {
      return <span className="vk-tpi-badge vk-badge-completed">✓ ครบ {assigned}/{target} คน</span>
    }
    if (status === 'incomplete') {
      return <span className="vk-tpi-badge vk-badge-incomplete">ขาดอีก {Math.max(0, target - assigned)} คน ({assigned}/{target})</span>
    }
    return <span className="vk-tpi-badge vk-badge-exceeded">เกิน +{assigned - target} คน ({assigned}/{target})</span>
  }

  const filteredPool = useMemo(() => {
    const term = searchTerm.toLowerCase().trim()
    return employees.filter((emp) => {
      const code = emp.employee_code.toLowerCase()
      const fullName = `${emp.first_name} ${emp.last_name}`.toLowerCase()
      const nationality = (emp.nationality || '').toLowerCase()

      const matchSearch = !term || code.includes(term) || fullName.includes(term) || nationality.includes(term)
      return matchSearch
    })
  }, [employees, searchTerm])

  const availableEligible = useMemo(() => {
    return filteredPool.filter((emp) => {
      const u = empUsageMap.get(emp.id)
      return (u?.count || 0) < 2
    })
  }, [filteredPool, empUsageMap])

  const allEligibleSelected = useMemo(() => {
    if (availableEligible.length === 0) return false
    return availableEligible.every((e) => selectedPoolIds.has(e.id))
  }, [availableEligible, selectedPoolIds])

  const toggleSelect = (empId: string) => {
    const u = empUsageMap.get(empId)
    if ((u?.count || 0) >= 2) return

    setSelectedPoolIds((prev) => {
      const next = new Set(prev)
      if (next.has(empId)) next.delete(empId)
      else next.add(empId)
      return next
    })
  }

  const selectAll = () => {
    setSelectedPoolIds((prev) => {
      const next = new Set(prev)
      availableEligible.forEach((e) => next.add(e.id))
      return next
    })
  }

  const deselectAll = () => {
    setSelectedPoolIds(new Set())
  }

  const handleClearAll = () => {
    if (window.confirm('ล้างการจัดกะทั้งหมดของวันนี้?')) setEntries([])
  }

  const handleResetToInitial = () => {
    if (preview) {
      setEntries(demoInitialEntries)
    } else if (dayData) {
      setEntries(dayData.entries || [])
    } else {
      setEntries([])
    }
  }

  const openEmployeeModal = (emp: Employee) => {
    const empEntries = entries.filter((e) => e.employee_id === emp.id)
    const defaultJobId = availableJobs[0]?.id || jobs[0]?.id || ''
    const isClerk = emp.position === 'clerk'
    const defaultOtHours = isClerk ? 8 : 1

    if (empEntries.length === 0) {
      setModalShift1JobId(defaultJobId)
      setModalShift1Index(0)
      setModalShift1IsHalf(false)
      setModalShift1HasOt(false)
      setModalShift1OtHours(defaultOtHours)
      setModalHasShift2(false)
      setModalShift2JobId(defaultJobId)
      setModalShift2Index(1)
      setModalShift2IsHalf(false)
      setModalShift2HasOt(false)
      setModalShift2OtHours(defaultOtHours)
    } else if (empEntries.length === 1) {
      const s1 = empEntries[0]
      setModalShift1JobId(s1.job_id)
      setModalShift1Index(s1.shift_index)
      setModalShift1IsHalf(!!s1.is_half_shift)
      setModalShift1HasOt(!isClerk && !!(s1.ot_hours && s1.ot_hours > 0))
      setModalShift1OtHours(s1.ot_hours || defaultOtHours)
      setModalHasShift2(false)
      setModalShift2JobId(s1.job_id)
      setModalShift2Index((s1.shift_index + 1) % 3)
      setModalShift2IsHalf(false)
      setModalShift2HasOt(false)
      setModalShift2OtHours(defaultOtHours)
    } else {
      const s1 = empEntries[0]
      const s2 = empEntries[1]
      setModalShift1JobId(s1.job_id)
      setModalShift1Index(s1.shift_index)
      setModalShift1IsHalf(!!s1.is_half_shift)
      setModalShift1HasOt(!isClerk && !!(s1.ot_hours && s1.ot_hours > 0))
      setModalShift1OtHours(s1.ot_hours || defaultOtHours)
      setModalHasShift2(true)
      setModalShift2JobId(s2.job_id)
      setModalShift2Index(s2.shift_index)
      setModalShift2IsHalf(!!s2.is_half_shift)
      setModalShift2HasOt(!!(s2.ot_hours && s2.ot_hours > 0))
      setModalShift2OtHours(s2.ot_hours || defaultOtHours)
    }
    setModalSafetyFineEnabled(false)
    setModalSafetyFineDate(activeDateStr)
    setModalSafetyFineReason('')
    setModalEmp(emp)
  }

  const handleDeleteSafetyFine = async (fineId: string) => {
    if (!confirm('ยืนยันลบรายการหักค่าปรับ จป. นี้หรือไม่?')) return
    try {
      const { error } = await supabase.from('advance_payments').delete().eq('id', fineId)
      if (error) throw error
      toast.success('ลบรายการค่าปรับ จป. เรียบร้อยแล้ว')
      queryClient.invalidateQueries({ queryKey: ['all-safety-advances'] })
      queryClient.invalidateQueries({ queryKey: ['tpi-advances'] })
      queryClient.invalidateQueries({ queryKey: ['advances'] })
      queryClient.invalidateQueries({ queryKey: ['advances-v2'] })
      queryClient.invalidateQueries({ queryKey: ['payslip-advances'] })
      queryClient.invalidateQueries({ queryKey: ['all-payroll-entries'] })
    } catch (e: any) {
      toast.error('ลบรายการไม่สำเร็จ: ' + (e?.message || ''))
    }
  }

  const handleSaveSafetyFine = async () => {
    if (!modalEmp) return
    if (!currentPeriod) {
      toast.error('ไม่พบงวดการจ่ายเงินปัจจุบัน')
      return
    }
    if (!modalSafetyFineReason.trim()) {
      toast.error('กรุณาระบุสาเหตุความผิดระเบียบวินัยเพื่อเก็บเป็นหลักฐาน')
      return
    }
    setModalSafetyFineSubmitting(true)
    try {
      const incidentDate = modalSafetyFineDate || activeDateStr
      const [yr, mo, dy] = incidentDate.split('-')
      const thYear = Number(yr) + 543
      const thDateStr = `${dy}/${mo}/${thYear}`

      // Check existing fines in current period for this employee
      const existingInCurrent = allSafetyAdvances.filter(
        (a) => a.employee_id === modalEmp.id && a.period_id === currentPeriod.id
      )

      const sortedPeriods = [...periods].sort((a, b) => a.period_start.localeCompare(b.period_start))
      const currIdx = sortedPeriods.findIndex((p) => p.id === currentPeriod.id)
      const futurePeriods = currIdx >= 0 ? sortedPeriods.slice(currIdx + 1) : []

      if (existingInCurrent.length > 0) {
        // 2nd violation in the same period: expand to 4 installments (2,000 THB total, 500 THB/period)
        const first = existingInCurrent[0]
        const prevNotes = first.notes || ''
        const prevReasonMatch = prevNotes.match(/สาเหตุ:\s*([^\|]+)/)
        const prevReason = prevReasonMatch ? prevReasonMatch[1].trim() : ''
        const combinedReason = prevReason && !prevReason.includes(modalSafetyFineReason.trim())
          ? `${prevReason}, ${modalSafetyFineReason.trim()}`
          : (prevReason || modalSafetyFineReason.trim())

        const updatedNote = `[หักค่าปรับ จป.] หักค่าปรับผิดระเบียบ (วันที่ ${thDateStr} [1/4]) | สาเหตุ: ${combinedReason} | ยอดปรับเต็ม 2,000 บ. (ผ่อนงวดละ 500 บ.)`
        const { error: updErr } = await supabase
          .from('advance_payments')
          .update({ notes: updatedNote })
          .eq('id', first.id)
        if (updErr) throw updErr

        // Queue future installments [2/4], [3/4], [4/4] into subsequent periods if available
        if (futurePeriods[0]) {
          const note2 = `[หักค่าปรับ จป.] หักค่าปรับผิดระเบียบ (วันที่ ${thDateStr} [2/4]) | สาเหตุ: ${combinedReason} | ยอดปรับเต็ม 2,000 บ. (ผ่อนงวดละ 500 บ.)`
          await supabase.from('advance_payments').insert({
            period_id: futurePeriods[0].id,
            employee_id: modalEmp.id,
            amount: 500,
            notes: note2,
            is_carryover: false,
          })
        }
        if (futurePeriods[1]) {
          const note3 = `[หักค่าปรับ จป.] หักค่าปรับผิดระเบียบ (วันที่ ${thDateStr} [3/4]) | สาเหตุ: ${combinedReason} | ยอดปรับเต็ม 2,000 บ. (ผ่อนงวดละ 500 บ.)`
          await supabase.from('advance_payments').insert({
            period_id: futurePeriods[1].id,
            employee_id: modalEmp.id,
            amount: 500,
            notes: note3,
            is_carryover: false,
          })
        }
        if (futurePeriods[2]) {
          const note4 = `[หักค่าปรับ จป.] หักค่าปรับผิดระเบียบ (วันที่ ${thDateStr} [4/4]) | สาเหตุ: ${combinedReason} | ยอดปรับเต็ม 2,000 บ. (ผ่อนงวดละ 500 บ.)`
          await supabase.from('advance_payments').insert({
            period_id: futurePeriods[2].id,
            employee_id: modalEmp.id,
            amount: 500,
            notes: note4,
            is_carryover: false,
          })
        }

        toast.success(`บันทึกค่าปรับ จป. สำเร็จ (ยอดรวม 2,000 บ. ขยายเป็น 4 งวด หักงวดละ 500 บ. [1/4])`)
      } else {
        // 1st violation: 1,000 THB in 2 installments of 500 THB
        const note1 = `[หักค่าปรับ จป.] หักค่าปรับผิดระเบียบ (วันที่ ${thDateStr} [1/2]) | สาเหตุ: ${modalSafetyFineReason.trim()} | ยอดปรับเต็ม 1,000 บ. (ผ่อนงวดละ 500 บ.)`
        const { error: insErr } = await supabase.from('advance_payments').insert({
          period_id: currentPeriod.id,
          employee_id: modalEmp.id,
          amount: 500,
          notes: note1,
          is_carryover: false,
        })
        if (insErr) throw insErr

        if (futurePeriods[0]) {
          const note2 = `[หักค่าปรับ จป.] หักค่าปรับผิดระเบียบ (วันที่ ${thDateStr} [2/2]) | สาเหตุ: ${modalSafetyFineReason.trim()} | ยอดปรับเต็ม 1,000 บ. (ผ่อนงวดละ 500 บ.)`
          await supabase.from('advance_payments').insert({
            period_id: futurePeriods[0].id,
            employee_id: modalEmp.id,
            amount: 500,
            notes: note2,
            is_carryover: false,
          })
        }

        toast.success(`บันทึกค่าปรับ จป. สำเร็จ (ยอด 1,000 บ. หักงวดละ 500 บ. [1/2])`)
      }

      queryClient.invalidateQueries({ queryKey: ['all-safety-advances'] })
      queryClient.invalidateQueries({ queryKey: ['tpi-advances'] })
      queryClient.invalidateQueries({ queryKey: ['advances'] })
      queryClient.invalidateQueries({ queryKey: ['advances-v2'] })
      queryClient.invalidateQueries({ queryKey: ['payslip-advances'] })
      queryClient.invalidateQueries({ queryKey: ['all-payroll-entries'] })
      setModalSafetyFineEnabled(false)
      setModalSafetyFineReason('')
    } catch (err: any) {
      toast.error('บันทึกค่าปรับ จป. ไม่สำเร็จ: ' + (err?.message || ''))
    } finally {
      setModalSafetyFineSubmitting(false)
    }
  }

  const handleClearModalShifts = () => {
    if (!modalEmp) return
    setEntries((prev) => prev.filter((e) => e.employee_id !== modalEmp.id))
    toast.info(`ลบกะทั้งหมดของ ${modalEmp.first_name} ${modalEmp.last_name} แล้ว`)
    setModalEmp(null)
  }

  const handleSaveModalShifts = () => {
    if (!modalEmp) return
    if (!modalShift1JobId) {
      toast.error('กรุณาเลือกรหัสงานสำหรับกะที่ 1')
      return
    }
    const job1 = jobs.find((j) => j.id === modalShift1JobId)
    if (job1 && !job1.active) {
      toast.error(`รหัสงาน ${job1.code} ถูกยกเลิกรหัสงานแล้ว`)
      return
    }

    const isClerk = modalEmp.position === 'clerk'
    const tier1 = wageTier(wageProfiles.find((p) => p.employee_id === modalEmp.id), activeDateStr)
    const isClerkJob1 = isClerkJob(job1)
    const baseRate1 = isClerkJob1
      ? (tier1 === 'skilled' ? (job1?.skilled_rate ?? 377) : (job1?.normal_rate ?? 357))
      : ((tier1 === 'skilled' && job1?.skilled_rate) ? job1.skilled_rate : (job1?.normal_rate || 357))
    const ot1 = (!isClerk && modalShift1HasOt) ? calculateEntryOt(modalShift1OtHours, baseRate1, isClerk) : { ot_hours: 0, ot_pay: 0 }

    const updatedEntries = entries.filter((e) => e.employee_id !== modalEmp.id)
    const newEmpEntries: Entry[] = [
      {
        employee_id: modalEmp.id,
        job_id: modalShift1JobId,
        shift_index: modalShift1Index,
        is_half_shift: modalShift1IsHalf,
        actual_hours: modalShift1IsHalf ? 4 : 8,
        ot_hours: ot1.ot_hours,
        ot_pay: ot1.ot_pay,
      },
    ]

    if (modalHasShift2) {
      if (modalShift1Index === modalShift2Index) {
        toast.error('กะที่ 1 และกะที่ 2 ต้องไม่เป็นช่วงเวลาเดียวกัน')
        return
      }
      if (modalShift1Index === 2 && modalShift2Index === 0) {
        toast.error('ตามกฎหมายแรงงาน ห้ามจัดกะดึกต่อกะเช้าโดยเด็ดขาด')
        return
      }
      if (!modalShift2JobId) {
        toast.error('กรุณาเลือกรหัสงานสำหรับกะที่ 2')
        return
      }
      const job2 = jobs.find((j) => j.id === modalShift2JobId)
      if (job2 && !job2.active) {
        toast.error(`รหัสงาน ${job2.code} ถูกยกเลิกรหัสงานแล้ว`)
        return
      }

      const tier2 = wageTier(wageProfiles.find((p) => p.employee_id === modalEmp.id), activeDateStr)
      const isClerkJob2 = isClerkJob(job2)
      const baseRate2 = isClerkJob2
        ? (tier2 === 'skilled' ? (job2?.skilled_rate ?? 377) : (job2?.normal_rate ?? 357))
        : ((tier2 === 'skilled' && job2?.skilled_rate) ? job2.skilled_rate : (job2?.normal_rate || 357))
      const ot2 = modalShift2HasOt ? calculateEntryOt(modalShift2OtHours, baseRate2, isClerk) : { ot_hours: 0, ot_pay: 0 }

      newEmpEntries.push({
        employee_id: modalEmp.id,
        job_id: modalShift2JobId,
        shift_index: modalShift2Index,
        is_half_shift: modalShift2IsHalf,
        actual_hours: modalShift2IsHalf ? 4 : 8,
        ot_hours: ot2.ot_hours,
        ot_pay: ot2.ot_pay,
      })
    }

    const candidateEntries = [...updatedEntries, ...newEmpEntries]
    const err = validateEntries(candidateEntries)
    if (err) {
      toast.error(`ไม่สามารถบันทึกได้: ${err}`)
      return
    }

    setEntries(candidateEntries)
    if (modalSafetyFineEnabled && modalSafetyFineReason.trim()) {
      handleSaveSafetyFine()
    }
    toast.success(`✓ บันทึกการจัดกะของ ${modalEmp.first_name} ${modalEmp.last_name} เรียบร้อยแล้ว`)
    setModalEmp(null)
  }

  const canAssign = useCallback(
    (empId: string, shiftIndex: number, currentJobId?: string) => {
      const u = empUsageMap.get(empId)
      if (!u) return { ok: true }
      if (u.shifts.has(shiftIndex)) {
        const alreadyInThisCell = entries.some(
          (e) => e.employee_id === empId && e.shift_index === shiftIndex && e.job_id === currentJobId
        )
        if (alreadyInThisCell) {
          return { ok: false, reason: 'พนักงานอยู่ในกะนี้แล้ว' }
        }
        return { ok: false, reason: 'พนักงานลงกะนี้ในรหัสงานอื่นแล้ว' }
      }
      if (u.count >= 2) {
        return { ok: false, reason: 'พนักงานลงครบ 2 กะแล้ว' }
      }
      // ตามกฎหมายห้ามทำดึกต่อเช้า
      if (shiftIndex === 0 && u.shifts.has(2)) {
        return { ok: false, reason: 'ตามกฎหมายห้ามจัดกะดึกต่อกะเช้า' }
      }
      return { ok: true }
    },
    [empUsageMap, entries]
  )

  const handleAssignSelected = (jobId: string, shiftIndex: number) => {
    if (selectedPoolIds.size === 0) return

    const targetJob = jobs.find((j) => j.id === jobId)
    if (targetJob && !targetJob.active) {
      toast.error('รหัสงานนี้ถูกยกเลิกรหัสงานแล้ว')
      return
    }

    const newEntries = [...entries]
    let assignedCount = 0
    const errors: string[] = []

    for (const empId of selectedPoolIds) {
      const check = canAssign(empId, shiftIndex, jobId)
      if (!check.ok) {
        const emp = empMap.get(empId)
        errors.push(`${emp?.first_name || empId}: ${check.reason}`)
        continue
      }
      newEntries.push({ employee_id: empId, job_id: jobId, shift_index: shiftIndex })
      assignedCount++
    }

    const err = validateEntries(newEntries)
    if (err) {
      toast.error(`ไม่สามารถจัดลงได้: ${err}`)
      return
    }

    setEntries(newEntries)
    setSelectedPoolIds(new Set())

    if (assignedCount > 0) {
      toast.success(`✓ จัดพนักงาน ${assignedCount} คน ลงกะ${SHIFTS[shiftIndex].name} สำเร็จ`)
    }
    if (errors.length > 0) {
      toast.warning(`ไม่สามารถจัดลงได้ ${errors.length} คน: ${errors[0]}`)
    }
  }

  const handleRemove = (empId: string, jobId: string, shiftIndex: number) => {
    setEntries((prev) =>
      prev.filter((e) => !(e.employee_id === empId && e.job_id === jobId && e.shift_index === shiftIndex))
    )
  }

  // ── Render Grouped Consecutive 2-Shift Cards ───────────────────────
  const renderJobDoubleShifts = (
    jobId: string,
    doubleShiftEmps: { empId: string; span: 'morning-afternoon' | 'afternoon-night' | 'morning-night' }[]
  ) => {
    // Group & Sort: 1. เช้า+บ่าย (morning-afternoon) -> 2. บ่าย+ดึก (afternoon-night) -> 3. เช้า+ดึก (morning-night)
    const spanPriority: Record<string, number> = { 'morning-afternoon': 1, 'afternoon-night': 2, 'morning-night': 3 }
    const sorted = [...doubleShiftEmps].sort((a, b) => {
      const pA = spanPriority[a.span] ?? 99
      const pB = spanPriority[b.span] ?? 99
      if (pA !== pB) {
        return pA - pB
      }
      const empA = empMap.get(a.empId)
      const empB = empMap.get(b.empId)
      return compareEmployeeCode(empA?.employee_code, empB?.employee_code)
    })

    return sorted.map(({ empId, span }) => {
      const emp = empMap.get(empId)
      if (!emp) return null

      const empDoubleEntries = entries.filter((e) => e.employee_id === empId && e.job_id === jobId)
      const hasHalf = empDoubleEntries.some((e) => e.is_half_shift)
      const hasOt = empDoubleEntries.some((e) => (e.ot_hours ?? 0) > 0)
      const totalOtHrs = empDoubleEntries.reduce((sum, e) => sum + (e.ot_hours || 0), 0)

      const handleRemoveDouble = (e: React.MouseEvent) => {
        e.stopPropagation()
        setEntries((prev) => prev.filter((entry) => !(entry.employee_id === empId && entry.job_id === jobId)))
        toast.info(`ลบกะควบของ ${emp.first_name} ${emp.last_name} ออกจากงานนี้แล้ว`)
      }

      if (span === 'morning-afternoon') {
        return (
          <div
            key={`double-${empId}-ma`}
            className="vk-tpi-double-span-card span-morning-afternoon"
            onClick={() => openEmployeeModal(emp)}
            title="คลิกเพื่อแก้ไขการจัดกะ"
          >
            <div className="vk-tpi-double-main">
              <div className="vk-tpi-double-line1">
                <span className="vk-double-name">
                  {emp.first_name} {emp.last_name}
                  {emp.nationality ? <span className="vk-pool-nat-txt"> ({emp.nationality})</span> : null}
                </span>
                {isSkilledWorker(emp.id) && (
                  <span title="พนักงานค่าแรงฝีมือ" style={{ flexShrink: 0, fontSize: 11 }}>
                    ⭐
                  </span>
                )}
                <span className="vk-double-badge">ควบกะเช้า + กะบ่าย</span>
                {hasHalf && <span className="vk-tpi-wp-half">ครึ่งกะ</span>}
                {hasOt && (
                  <span className="vk-tpi-wp-ot">
                    {emp.position === 'clerk' ? 'OT 8 ชม.' : `OT ${totalOtHrs} ชม.`}
                  </span>
                )}
              </div>
              <div className="vk-tpi-double-line2">
                <span className="vk-double-code">{emp.employee_code}</span>
              </div>
            </div>
            <div className="vk-tpi-double-right">
              <button
                type="button"
                className="vk-tpi-btn-del"
                title="ลบออกจากการจัดกะนี้"
                onClick={handleRemoveDouble}
              >
                <X style={{ width: 14, height: 14 }} />
              </button>
            </div>
          </div>
        )
      }

      if (span === 'afternoon-night') {
        return (
          <div
            key={`double-${empId}-an`}
            className="vk-tpi-double-span-card span-afternoon-night"
            onClick={() => openEmployeeModal(emp)}
            title="คลิกเพื่อแก้ไขการจัดกะ"
          >
            <div className="vk-tpi-double-main">
              <div className="vk-tpi-double-line1">
                <span className="vk-double-name">
                  {emp.first_name} {emp.last_name}
                  {emp.nationality ? <span className="vk-pool-nat-txt"> ({emp.nationality})</span> : null}
                </span>
                {isSkilledWorker(emp.id) && (
                  <span title="พนักงานค่าแรงฝีมือ" style={{ flexShrink: 0, fontSize: 11 }}>
                    ⭐
                  </span>
                )}
                <span className="vk-double-badge">ควบกะบ่าย + กะดึก</span>
                {hasHalf && <span className="vk-tpi-wp-half">ครึ่งกะ</span>}
                {hasOt && (
                  <span className="vk-tpi-wp-ot">
                    {emp.position === 'clerk' ? 'OT 8 ชม.' : `OT ${totalOtHrs} ชม.`}
                  </span>
                )}
              </div>
              <div className="vk-tpi-double-line2">
                <span className="vk-double-code">{emp.employee_code}</span>
              </div>
            </div>
            <div className="vk-tpi-double-right">
              <button
                type="button"
                className="vk-tpi-btn-del"
                title="ลบออกจากการจัดกะนี้"
                onClick={handleRemoveDouble}
              >
                <X style={{ width: 14, height: 14 }} />
              </button>
            </div>
          </div>
        )
      }

      // span === 'morning-night' (เช้าแล้วกลับมาทำดึก)
      // Displays in column 1 (morning) and column 3 (night) with column 2 (afternoon) empty
      return (
        <div key={`double-${empId}-mn`} className="vk-tpi-split-double-row">
          {/* Column 1: Morning Shift Box */}
          <div
            className="vk-tpi-split-double-card card-morning"
            onClick={() => openEmployeeModal(emp)}
            title="คลิกเพื่อแก้ไขการจัดกะ"
          >
            <div className="vk-tpi-double-main">
              <div className="vk-tpi-double-line1">
                <span className="vk-double-name">
                  {emp.first_name} {emp.last_name}
                  {emp.nationality ? <span className="vk-pool-nat-txt"> ({emp.nationality})</span> : null}
                </span>
                {isSkilledWorker(emp.id) && (
                  <span title="พนักงานค่าแรงฝีมือ" style={{ flexShrink: 0, fontSize: 11 }}>
                    ⭐
                  </span>
                )}
                <span className="vk-double-badge">ควบเช้า + ดึก</span>
                {hasHalf && <span className="vk-tpi-wp-half">ครึ่งกะ</span>}
                {hasOt && (
                  <span className="vk-tpi-wp-ot">
                    {emp.position === 'clerk' ? 'OT 8 ชม.' : `OT ${totalOtHrs} ชม.`}
                  </span>
                )}
              </div>
              <div className="vk-tpi-double-line2">
                <span className="vk-double-code">{emp.employee_code} · กะเช้า</span>
              </div>
            </div>
            <div className="vk-tpi-double-right">
              <button
                type="button"
                className="vk-tpi-btn-del"
                title="ลบออกจากการจัดกะนี้"
                onClick={handleRemoveDouble}
              >
                <X style={{ width: 14, height: 14 }} />
              </button>
            </div>
          </div>

          {/* Column 2: Afternoon Shift (Blank / Empty lane) */}
          <div className="vk-tpi-split-double-empty" title="กะบ่าย: ไม่ได้ลงกะ (ควบเช้า+ดึก)">
            <div className="vk-tpi-split-bridge-line" />
          </div>

          {/* Column 3: Night Shift Box */}
          <div
            className="vk-tpi-split-double-card card-night"
            onClick={() => openEmployeeModal(emp)}
            title="คลิกเพื่อแก้ไขการจัดกะ"
          >
            <div className="vk-tpi-double-main">
              <div className="vk-tpi-double-line1">
                <span className="vk-double-name">
                  {emp.first_name} {emp.last_name}
                  {emp.nationality ? <span className="vk-pool-nat-txt"> ({emp.nationality})</span> : null}
                </span>
                {isSkilledWorker(emp.id) && (
                  <span title="พนักงานค่าแรงฝีมือ" style={{ flexShrink: 0, fontSize: 11 }}>
                    ⭐
                  </span>
                )}
                <span className="vk-double-badge">ควบเช้า + ดึก</span>
                {hasHalf && <span className="vk-tpi-wp-half">ครึ่งกะ</span>}
                {hasOt && (
                  <span className="vk-tpi-wp-ot">
                    {emp.position === 'clerk' ? 'OT 8 ชม.' : `OT ${totalOtHrs} ชม.`}
                  </span>
                )}
              </div>
              <div className="vk-tpi-double-line2">
                <span className="vk-double-code">{emp.employee_code} · กะดึก</span>
              </div>
            </div>
            <div className="vk-tpi-double-right">
              <button
                type="button"
                className="vk-tpi-btn-del"
                title="ลบออกจากการจัดกะนี้"
                onClick={handleRemoveDouble}
              >
                <X style={{ width: 14, height: 14 }} />
              </button>
            </div>
          </div>
        </div>
      )
    })
  }

  // ── Drag & Drop Handlers ────────────────────────────────────────────
  const [draggedEmpId, setDraggedEmpId] = useState<string | null>(null)
  const [dragSource, setDragSource] = useState<{ type: 'pool' } | { type: 'cell'; jobId: string; shiftIndex: number } | null>(null)

  const handleDragStartFromPool = (e: React.DragEvent, empId: string) => {
    setDraggedEmpId(empId)
    setDragSource({ type: 'pool' })
    e.dataTransfer.setData('text/plain', empId)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragStartFromCell = (e: React.DragEvent, empId: string, jobId: string, shiftIndex: number) => {
    setDraggedEmpId(empId)
    setDragSource({ type: 'cell', jobId, shiftIndex })
    e.dataTransfer.setData('text/plain', empId)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    e.currentTarget.classList.add('vk-drag-over')
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('vk-drag-over')
  }

  const handleDrop = (e: React.DragEvent, targetJobId: string, targetShiftIndex: number) => {
    e.preventDefault()
    e.currentTarget.classList.remove('vk-drag-over')

    const empId = draggedEmpId || e.dataTransfer.getData('text/plain')
    if (!empId) return

    const targetJob = jobs.find((j) => j.id === targetJobId)
    if (targetJob && !targetJob.active) {
      toast.error('รหัสงานนี้ถูกยกเลิกรหัสงานแล้ว')
      return
    }

    if (dragSource?.type === 'cell') {
      if (dragSource.jobId === targetJobId && dragSource.shiftIndex === targetShiftIndex) return
      const filtered = entries.filter(
        (entry) => !(entry.employee_id === empId && entry.job_id === dragSource.jobId && entry.shift_index === dragSource.shiftIndex)
      )
      const newEntries = [...filtered, { employee_id: empId, job_id: targetJobId, shift_index: targetShiftIndex }]
      const err = validateEntries(newEntries)
      if (err) {
        toast.error(`ไม่สามารถย้ายได้: ${err}`)
        return
      }
      setEntries(newEntries)
      toast.success(`✓ ย้ายพนักงานไปกะ${SHIFTS[targetShiftIndex].name} สำเร็จ`)
    } else {
      const check = canAssign(empId, targetShiftIndex, targetJobId)
      if (!check.ok) {
        toast.error(`ไม่สามารถจัดลงได้: ${check.reason}`)
        return
      }
      const newEntries = [...entries, { employee_id: empId, job_id: targetJobId, shift_index: targetShiftIndex }]
      const err = validateEntries(newEntries)
      if (err) {
        toast.error(`ไม่สามารถจัดลงได้: ${err}`)
        return
      }
      setEntries(newEntries)
      toast.success(`✓ จัดพนักงานลงกะ${SHIFTS[targetShiftIndex].name} สำเร็จ`)
    }

    setDraggedEmpId(null)
    setDragSource(null)
  }

  const handleToggleHoliday = (checked: boolean) => {
    setIsHoliday(checked)
    setStoredHoliday(user?.factory_id, activeDateStr, checked)
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const err = validateEntries(entries)
      if (err) throw new Error(err)

      // Ensure local holiday cache is firmly preserved
      setStoredHoliday(user?.factory_id, activeDateStr, isHoliday)

      if (!user?.factory_id || preview) {
        toast.info('โหมดตัวอย่าง (Preview Mode): บันทึกข้อมูลจำลองเรียบร้อย')
        return true
      }

      // Convert any reference job IDs to real database UUIDs
      const validEntries = await ensureValidJobUuids(entries, user.factory_id, jobs)
      setEntries(validEntries)

      const nextRev = await saveDay(user.factory_id, activeDateStr, {
        revision: dayRevision,
        is_holiday: isHoliday,
        entries: validEntries.map((e) => ({ ...e, is_holiday_ot: isHoliday })),
      })
      setDayRevision(nextRev)
      return true
    },
    onSuccess: () => {
      setStoredHoliday(user?.factory_id, activeDateStr, isHoliday)
      queryClient.invalidateQueries({ queryKey: ['tpi-jobs', user?.factory_id] })
      queryClient.invalidateQueries({ queryKey: ['tpi-shift-day', user?.factory_id, activeDateStr] })
      queryClient.invalidateQueries({ queryKey: ['all-tpi-period-shifts'] })
      queryClient.invalidateQueries({ queryKey: ['summary-all-shifts'] })
      queryClient.invalidateQueries({ queryKey: ['payslip-all-shifts'] })
      toast.success(`✓ บันทึกข้อมูลการจัดกะ ${fmtDisplay(activeDateStr)} สำเร็จ`)
    },
    onError: (e: any) => toast.error('บันทึกไม่สำเร็จ', { description: errorMessage(e) }),
  })

  return (
    <>
      <TopBar
        title="กรอกกะรายวัน"
        subtitle={preview ? 'โหมดจำลองข้อมูล (Preview)' : currentPeriod?.label || ''}
        onMenuClick={onMenuClick}
      />

      {!preview && !currentPeriod && (
        <div style={{ background: '#fef2f2', borderBottom: '1px solid #fecaca', padding: '12px 20px', color: '#991b1b', fontSize: 14, fontWeight: 600, textAlign: 'center' }}>
          ยังไม่มีงวดการจ่ายเงินที่เปิดอยู่ กรุณาสร้างงวดการจ่ายเงินในหน้าแดชบอร์ดก่อนดำเนินการจัดกะ
        </div>
      )}

      <div
        className="vk-date-strip"
        style={{
          borderBottom: '1px solid var(--vk-rule)',
          background: isHoliday ? 'var(--vk-marigold-tint)' : weekend ? '#FAF6FD' : 'var(--vk-bone)',
          padding: '8px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          position: 'sticky',
          top: 'var(--vk-topbar-h)',
          zIndex: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Period selector if multiple periods */}
          {periods.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--vk-ink-3)' }}>งวด:</span>
              <select
                value={currentPeriod?.id || ''}
                onChange={(e) => setSelectedPeriodId(e.target.value)}
                style={{
                  fontSize: 12,
                  padding: '3px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--vk-rule-soft)',
                  background: 'var(--vk-paper)',
                  color: 'var(--vk-ink)',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label || `${p.period_start} ถึง ${p.period_end}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, position: 'relative' }}>
            <button
              type="button"
              className="vk-btn vk-btn--ghost"
              style={{ height: 32, padding: '0 10px' }}
              disabled={isAtStart}
              onClick={() => navigateDate(-1)}
              title="วันก่อนหน้า"
            >
              <ChevronLeft style={{ width: 15, height: 15 }} />
            </button>

            {periodDates.length > 0 ? (
              <select
                value={activeDateStr}
                onChange={(e) => {
                  setCurrentDate(parseLocal(e.target.value))
                  setSelectedPoolIds(new Set())
                }}
                style={{
                  fontFamily: 'var(--vk-sans)',
                  fontWeight: 700,
                  fontSize: 16,
                  letterSpacing: '-0.01em',
                  color: isHoliday ? '#6F4A0E' : weekend ? '#5b21b6' : 'var(--vk-ink)',
                  background: 'var(--vk-paper)',
                  border: '1px solid var(--vk-rule-soft)',
                  borderRadius: 6,
                  padding: '4px 10px',
                  cursor: 'pointer',
                  outline: 'none',
                  width: 240,
                  textAlign: 'center',
                }}
                aria-label="เลือกวันที่ในงวด"
              >
                {periodDates.map((dStr) => (
                  <option key={dStr} value={dStr}>
                    {fmtDisplay(dStr)}
                  </option>
                ))}
              </select>
            ) : (
              <div
                style={{
                  fontFamily: 'var(--vk-sans)',
                  fontWeight: 700,
                  fontSize: 17,
                  letterSpacing: '-0.01em',
                  color: isHoliday ? '#6F4A0E' : weekend ? '#5b21b6' : 'var(--vk-ink)',
                  width: 240,
                  textAlign: 'center',
                }}
              >
                {fmtDisplay(activeDateStr)}
              </div>
            )}

            <button
              type="button"
              className="vk-btn vk-btn--ghost"
              style={{ height: 32, padding: '0 10px' }}
              disabled={isAtEnd}
              onClick={() => navigateDate(1)}
              title="วันถัดไป"
            >
              <ChevronRight style={{ width: 15, height: 15 }} />
            </button>

            {/* Badges positioned next to ChevronRight without shifting arrow buttons */}
            <div style={{
              position: 'absolute',
              left: '100%',
              marginLeft: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}>
              {weekend && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    color: '#5b21b6',
                    background: 'rgba(91,33,182,0.08)',
                    padding: '2px 8px',
                    borderRadius: 999,
                    whiteSpace: 'nowrap',
                  }}
                >
                  วันหยุดสุดสัปดาห์
                </span>
              )}
              {isHoliday && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    color: '#6F4A0E',
                    background: 'rgba(235,160,0,0.18)',
                    padding: '2px 8px',
                    borderRadius: 999,
                    whiteSpace: 'nowrap',
                  }}
                >
                  วันหยุดนักขัตฤกษ์
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Row 2: holiday checkbox + weekend badge (desktop) + save button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              padding: '4px 12px',
              border: `1px solid ${isHoliday ? 'var(--vk-marigold)' : 'var(--vk-rule-soft)'}`,
              borderRadius: 6,
              background: isHoliday ? 'var(--vk-marigold-tint)' : 'transparent',
              fontSize: 13,
              fontWeight: 600,
              color: isHoliday ? '#6F4A0E' : 'var(--vk-ink-2)',
            }}
          >
            <input
              type="checkbox"
              checked={isHoliday}
              onChange={(e) => handleToggleHoliday(e.target.checked)}
              style={{ accentColor: 'var(--vk-marigold)' }}
            />
            วันหยุดนักขัตฤกษ์ (OT ×2)
          </label>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="vk-btn vk-btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, background: '#ffffff', borderColor: 'var(--vk-rule-soft)' }}
              onClick={handleOpenTargetModal}
              title="เปิดหน้าต่างกำหนดความต้องการแรงงานประจำวันตามเอกสารกระดาษ"
            >
              <Briefcase style={{ width: 14, height: 14, color: 'var(--vk-persimmon)' }} />
              จัดการรหัสงานประจำวัน (กำหนดเป้าหมาย)
            </button>

            <button
              type="button"
              className="vk-btn vk-btn-secondary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                background: dailyAttendance.length > 0 ? '#fef2f2' : '#ffffff',
                borderColor: dailyAttendance.length > 0 ? '#fca5a5' : 'var(--vk-rule-soft)',
                color: dailyAttendance.length > 0 ? '#b91c1c' : 'var(--vk-ink-2)',
                fontWeight: dailyAttendance.length > 0 ? 600 : 500
              }}
              onClick={() => setIsAttendanceModalOpen(true)}
              title="บันทึกพนักงานที่ ขาด ลา มาสาย ประจำวันนี้"
            >
              <UserX style={{ width: 14, height: 14, color: dailyAttendance.length > 0 ? '#b91c1c' : 'var(--vk-persimmon)' }} />
              {dailyAttendance.length > 0 ? `ขาด/ลา/มาสาย (${dailyAttendance.length})` : 'บันทึก ขาด/ลา/มาสาย'}
            </button>

            <button
              type="button"
              className="vk-btn vk-btn--primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              <Save style={{ width: 14, height: 14 }} />
              {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกวันนี้'}
            </button>
          </div>
        </div>
      </div>

      {/* 3. Selection Bar (Diamond Pattern: Appears when workers selected in Pool) */}
      {hasSelection && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '8px 20px',
            background: 'var(--vk-ink)',
            color: 'var(--vk-bone)',
            fontFamily: 'var(--vk-sans)',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            position: 'sticky',
            top: 'calc(var(--vk-topbar-h) + 85px)',
            zIndex: 19,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--vk-persimmon)',
              flexShrink: 0,
            }}
          >
            เลือกแล้ว {selectedPoolIds.size} คน
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, flexShrink: 0, color: '#fde68a' }}>
            → คลิกที่ช่องกะในตารางที่ต้องการลง
          </span>
          <span
            style={{
              fontSize: 11,
              color: 'rgba(255,255,255,0.6)',
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {employees
              .filter((e) => selectedPoolIds.has(e.id))
              .map((e) => `${e.first_name} ${e.last_name}`)
              .join(', ')}
          </span>
          <button
            type="button"
            onClick={deselectAll}
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--vk-bone)',
              padding: '3px 10px',
              borderRadius: 4,
              fontSize: 12,
              flexShrink: 0,
            }}
          >
            ยกเลิก
          </button>
        </div>
      )}

      {/* 4. Two-Panel Split Layout (Diamond vk-shift-split structure) */}
      <div
        ref={splitRef}
        className="vk-shift-split vk-tpi-split-container"
        style={splitHeight ? { height: splitHeight } : undefined}
      >
        {/* Left Panel: Employee Pool (2-line layout consistent for all workers) */}
        <div className="vk-pool-wrapper">
          <div className="vk-pool-header">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div className="vk-eyebrow">
                POOL · พนักงาน ({availableEligible.length}/{employees.length})
              </div>
              {availableEligible.length > 0 && (
                <button
                  type="button"
                  onClick={allEligibleSelected ? deselectAll : selectAll}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    color: allEligibleSelected ? 'var(--vk-persimmon)' : 'var(--vk-ink-3)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '2px 0',
                    textTransform: 'uppercase',
                  }}
                >
                  <CheckSquare style={{ width: 12, height: 12 }} />
                  {allEligibleSelected ? 'ยกเลิก' : 'เลือกทั้งหมด'}
                </button>
              )}
            </div>

            {/* Search Input Box */}
            <div className="vk-search-container">
              <Search className="vk-search-icon" />
              <input
                type="text"
                placeholder="ค้นหาชื่อ, รหัส, สัญชาติ..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="vk-search-input"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="vk-search-clear"
                  title="ล้างคำค้นหา"
                >
                  <X style={{ width: 12, height: 12 }} />
                </button>
              )}
            </div>
          </div>

            {/* Pool List */}
          <div className="vk-pool-list">
            {filteredPool.length === 0 ? (
              <div className="vk-small" style={{ color: 'var(--vk-ink-3)', padding: '16px 8px', textAlign: 'center', lineHeight: 1.5 }}>
                {searchTerm
                  ? 'ไม่พบพนักงานที่ตรงกับที่ค้นหา'
                  : employees.length === 0
                  ? 'ยังไม่มีรายชื่อพนักงานในระบบ (กรุณาเพิ่มพนักงานที่เมนู "ฐานข้อมูลพนักงาน")'
                  : 'จัดกะครบทุกคนแล้ว ✓'}
              </div>
            ) : (
              filteredPool.map((emp) => {
                const isSelected = selectedPoolIds.has(emp.id)
                const u = empUsageMap.get(emp.id)
                const count = u?.count || 0
                const isMaxed = count >= 2

                return (
                  <div
                    key={emp.id}
                    onClick={() => !isMaxed && toggleSelect(emp.id)}
                    className={`vk-employee-card ${isMaxed ? 'is-maxed' : ''}`}
                    data-selected={isSelected}
                    data-blocked={isMaxed}
                    draggable={!isMaxed}
                    onDragStart={(e) => handleDragStartFromPool(e, emp.id)}
                  >
                    {/* Checkbox indicator */}
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 4,
                        flexShrink: 0,
                        border: `2px solid ${isSelected ? 'var(--vk-persimmon)' : 'var(--vk-rule-soft)'}`,
                        background: isSelected ? 'var(--vk-persimmon)' : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginTop: 2,
                      }}
                    >
                      {isSelected && (
                        <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                          <path
                            d="M1 3.5L3.5 6L8 1"
                            stroke="white"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </div>

                    {/* Employee Info - STRICT 2-LINE CONSISTENT LAYOUT (Diamond Style) */}
                    <div className="vk-pool-card-content">
                      {/* Line 1: Name + Badges */}
                      <div className="vk-pool-card-line1">
                        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, gap: 4, flex: 1 }}>
                          <span className="vk-pool-emp-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {emp.first_name} {emp.last_name}
                            {emp.nationality ? <span className="vk-pool-nat-txt"> ({emp.nationality})</span> : null}
                          </span>
                          {isSkilledWorker(emp.id) && (
                            <span title="พนักงานค่าแรงฝีมือ" style={{ flexShrink: 0, fontSize: 12 }}>
                              ⭐
                            </span>
                          )}
                          {(emp.position === 'clerk' || (emp.position && String(emp.position).toLowerCase() === 'clerk')) && (
                            <span className="vk-pool-clerk-badge" style={{ flexShrink: 0 }}>
                              เสมียน
                            </span>
                          )}
                        </div>
                        <div className="vk-pool-badges-group">
                          {count === 1 && (
                            <span className="vk-badge-shift-1">
                              1 กะ
                            </span>
                          )}
                          {count >= 2 && (
                            <span className="vk-badge-shift-2">
                              2 กะ
                            </span>
                          )}
                          {attendanceEmpMap.has(emp.id) && (
                            <span
                              style={{
                                fontSize: 9,
                                fontWeight: 700,
                                padding: '1px 5px',
                                borderRadius: 4,
                                background: attendanceEmpMap.get(emp.id)?.type === 'absent' ? '#fee2e2' : attendanceEmpMap.get(emp.id)?.type === 'leave' ? '#fef3c7' : '#f3f4f6',
                                color: attendanceEmpMap.get(emp.id)?.type === 'absent' ? '#b91c1c' : attendanceEmpMap.get(emp.id)?.type === 'leave' ? '#b45309' : '#374151',
                                border: `1px solid ${attendanceEmpMap.get(emp.id)?.type === 'absent' ? '#fca5a5' : attendanceEmpMap.get(emp.id)?.type === 'leave' ? '#fcd34d' : '#d1d5db'}`
                              }}
                              title={formatAttendanceSummary(attendanceEmpMap.get(emp.id)!)}
                            >
                              {attendanceEmpMap.get(emp.id)?.type === 'absent' ? 'ขาด' : attendanceEmpMap.get(emp.id)?.type === 'leave' ? 'ลา' : 'สาย'}
                            </span>
                          )}
                          {entries.some(e => e.employee_id === emp.id && (e.ot_hours ?? 0) > 0) && (
                            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: '#ffedd5', color: '#c2410c', border: '1px solid #fed7aa' }}>
                              OT
                            </span>
                          )}
                          {allSafetyAdvances.some(a => a.employee_id === emp.id && a.period_id === currentPeriod?.id) && (
                            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#ede9fe', color: '#6d28d9', border: '1px solid #c4b5fd' }} title="มีบันทึกค่าปรับผิดระเบียบ จป. ในงวดนี้">
                              จป.
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Line 2: Code & Manage Button */}
                      <div className="vk-pool-card-line2">
                        <span className="vk-emp-code-txt">{emp.employee_code}</span>
                        <button
                          type="button"
                          className="vk-pool-btn-manage"
                          title="คลิกเพื่อจัดการกะ หรือเพิ่มเป็น 2 กะ"
                          onClick={(e) => {
                            e.stopPropagation()
                            openEmployeeModal(emp)
                          }}
                        >
                          จัดการกะ
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Right Panel: TPI 3-Shift Job Matrix */}
        <div className="vk-tpi-matrix-wrapper">
          {/* Sticky Matrix Header */}
          <div className="vk-tpi-matrix-sticky-header">
            <div className="vk-tpi-th-info">
              <span>รหัสงาน / แผนก / ความต้องการแรงงาน (เป้าหมาย {grandTotalTarget} คน)</span>
            </div>
            {SHIFTS.map((shift, idx) => {
              const shiftAssignedTotal = entries.filter((e) => e.shift_index === idx).length
              return (
                <div key={idx} className="vk-tpi-th-shift">
                  <div className="vk-tpi-shift-h-title">กะ{shift.name}</div>
                  <div className="vk-tpi-shift-h-time">{shift.time}</div>
                  <div className="vk-tpi-shift-h-stat">จัดแล้ว: <strong>{shiftAssignedTotal}</strong> คน</div>
                </div>
              )
            })}
          </div>

          <div className="vk-tpi-matrix-scroll-area">
            {/* Section 1: ประเภทงานประจำ (Regular Jobs) */}
            <div className="vk-tpi-group-section">
              <div className="vk-tpi-group-banner banner-regular">
                <div className="vk-tpi-banner-title">
                  <h2>1. ประเภทงานประจำ (Regular Jobs)</h2>
                  <span className="vk-tpi-banner-tag">เป้าหมายรวม: {regularTargetTotal} คน</span>
                </div>
                <div className="vk-tpi-banner-stat">
                  จัดแล้ว: <strong>{entries.filter((e) => regularJobs.some((j) => j.id === e.job_id)).length}</strong> / {regularTargetTotal} คน
                </div>
              </div>

              {regularGroups.map((group) => {
                const deptTarget = group.jobs.reduce((sum, j) => {
                  const t = getShiftTargets(j)
                  return sum + t[0] + t[1] + t[2]
                }, 0)
                const deptAssigned = group.jobs.reduce((sum, j) => sum + usage(entries, j.id).total, 0)
                const isDeptComplete = deptAssigned >= deptTarget && deptTarget > 0

                return (
                  <div key={group.department} className="vk-tpi-dept-block">
                    <div className="vk-tpi-dept-bar">
                      <span className="vk-tpi-dept-name">{group.department}</span>
                      <span className="vk-tpi-dept-info">
                        ยอดแผนก: <strong>{deptAssigned}/{deptTarget}</strong> คน
                        <span className={`vk-tpi-dept-pill ${deptTarget === 0 && deptAssigned === 0 ? 'pill-zero' : isDeptComplete ? 'pill-done' : 'pill-pend'}`}>
                          {deptTarget === 0 && deptAssigned === 0 ? '— ไม่ใช้วันนี้' : isDeptComplete ? '✓ ครบ' : `ขาดอีก ${Math.max(0, deptTarget - deptAssigned)}`}
                        </span>
                      </span>
                    </div>

                    {group.jobs.map((job) => {
                      const { total } = usage(entries, job.id)
                      const targets = getShiftTargets(job)
                      const todayTarget = targets[0] + targets[1] + targets[2]
                      const quotaStatus = getJobQuotaStatus(job, total, todayTarget)
                      const isPaused = quotaStatus === 'paused'

                      // Check for employees doing double shifts in this exact same job
                      const jobEntries = entries.filter((e) => e.job_id === job.id)
                      const empShiftMapInJob = new Map<string, Set<number>>()
                      jobEntries.forEach((e) => {
                        if (!empShiftMapInJob.has(e.employee_id)) empShiftMapInJob.set(e.employee_id, new Set())
                        empShiftMapInJob.get(e.employee_id)!.add(e.shift_index)
                      })

                      // Double-shift worker IDs in this job
                      const doubleShiftEmps: { empId: string; span: 'morning-afternoon' | 'afternoon-night' | 'morning-night' }[] = []
                      const handledDoubleEmpIds = new Set<string>()

                      empShiftMapInJob.forEach((shiftsSet, empId) => {
                        if (shiftsSet.has(0) && shiftsSet.has(1)) {
                          doubleShiftEmps.push({ empId, span: 'morning-afternoon' })
                          handledDoubleEmpIds.add(empId)
                        } else if (shiftsSet.has(1) && shiftsSet.has(2)) {
                          doubleShiftEmps.push({ empId, span: 'afternoon-night' })
                          handledDoubleEmpIds.add(empId)
                        } else if (shiftsSet.has(0) && shiftsSet.has(2)) {
                          doubleShiftEmps.push({ empId, span: 'morning-night' })
                          handledDoubleEmpIds.add(empId)
                        }
                      })

                      return (
                        <div key={job.id} className={`vk-tpi-row ${isPaused ? 'row-paused' : ''} status-${quotaStatus}`}>
                          {/* Left Column: Job Info */}
                          <div className="vk-tpi-cell-info">
                            <div className="vk-tpi-code-line">
                              <JobCodeBadge job={job} />
                              <span className="vk-tpi-dept-tag">{job.department}</span>
                            </div>
                            <div className="vk-tpi-desc">{job.description}</div>
                            <div className="vk-tpi-quota-line">
                              <span className="vk-tpi-quota-label">ยอดที่ต้องใช้:</span>
                              <strong>{todayTarget}</strong> คน
                              {renderQuotaBadge(quotaStatus, total, todayTarget)}
                            </div>
                          </div>

                          {/* Right Side: 3-Shift Grid with 2-Column Spanning for Double Shifts */}
                          <div className="vk-tpi-shifts-grid">
                            {/* Prominent Shift Headers Row */}
                            <div className="vk-tpi-shifts-row-header">
                              {SHIFTS.map((shift, shiftIndex) => {
                                const totalShiftCount = jobEntries.filter((e) => e.shift_index === shiftIndex).length
                                const targetForShift = targets[shiftIndex]

                                const isZero = targetForShift === 0 && totalShiftCount === 0
                                const isMet = targetForShift > 0 && totalShiftCount >= targetForShift
                                const statClass = isZero ? 'is-zero' : isMet ? 'is-met' : ''

                                return (
                                  <div key={shiftIndex} className="vk-tpi-shift-col-header">
                                    <span className="vk-tpi-shift-col-title">กะ{shift.name}</span>
                                    <span className={`vk-tpi-shift-col-stat ${statClass}`}>
                                      {totalShiftCount}/{targetForShift}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>

                            {/* Spanning 2-Column Double Shifts in this Job (Grouped & Sorted) */}
                            {renderJobDoubleShifts(job.id, doubleShiftEmps)}

                            {/* 3 Individual Shift Columns */}
                            {SHIFTS.map((shift, shiftIndex) => {
                              // Filter entries for this shift that are NOT part of a double-shift in this same job
                              const singleShiftEntries = jobEntries.filter(
                                (e) => e.shift_index === shiftIndex && !handledDoubleEmpIds.has(e.employee_id)
                              )
                              const totalShiftCount = jobEntries.filter((e) => e.shift_index === shiftIndex).length
                              const canDrop = hasSelection && !isPaused

                              return (
                                <div
                                  key={shiftIndex}
                                  onClick={() => {
                                    if (canDrop) handleAssignSelected(job.id, shiftIndex)
                                  }}
                                  className={`vk-tpi-cell-shift col-${shiftIndex} ${canDrop ? 'can-drop' : ''} ${isPaused ? 'cell-paused' : ''}`}
                                  onDragOver={isPaused ? undefined : handleDragOver}
                                  onDragLeave={isPaused ? undefined : handleDragLeave}
                                  onDrop={isPaused ? undefined : (e) => handleDrop(e, job.id, shiftIndex)}
                                >
                                  <div className="vk-tpi-workers-stack">
                                    {singleShiftEntries.map((entry) => {
                                      const emp = empMap.get(entry.employee_id)
                                      if (!emp) return null
                                      const u = empUsageMap.get(emp.id)
                                      const totalWorkerShifts = u?.count || 1

                                      return (
                                        <div
                                          key={`${entry.employee_id}-${shiftIndex}`}
                                          className="vk-tpi-worker-pill"
                                          draggable={!isPaused}
                                          onDragStart={(e) => handleDragStartFromCell(e, emp.id, job.id, shiftIndex)}
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            openEmployeeModal(emp)
                                          }}
                                          title="คลิกเพื่อจัดการกะ หรือเพิ่มกะที่ 2"
                                        >
                                          <div className="vk-tpi-worker-pill-main">
                                            <div className="vk-tpi-worker-pill-line1">
                                              <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, gap: 3 }}>
                                                <span className="vk-tpi-wp-name">
                                                  {emp.first_name} {emp.last_name}
                                                </span>
                                                {isSkilledWorker(emp.id) && <span title="พนักงานค่าแรงฝีมือ" style={{ flexShrink: 0, fontSize: 11 }}>⭐</span>}
                                              </div>
                                              {totalWorkerShifts > 1 && (
                                                <span className="vk-tpi-wp-2shift" title="มีอีก 1 กะในรหัสงานอื่น">
                                                  2 กะ
                                                </span>
                                              )}
                                              {entry.is_half_shift && (
                                                <span className="vk-tpi-wp-half" title="ทำงานครึ่งกะ (4 ชม.) ลาครึ่งวัน">
                                                  ครึ่งกะ 4 ชม.
                                                </span>
                                              )}
                                              {(Number(entry.ot_hours) || 0) > 0 && (
                                                <span className="vk-tpi-wp-ot" title={emp.position === 'clerk' ? 'OT เสมียนเต็มกะ 8 ชม. (2 เท่า)' : `OT ${entry.ot_hours} ชม. (1.5 เท่า/ชม.)`}>
                                                  {emp.position === 'clerk' ? 'OT 8 ชม. (2x)' : `OT ${entry.ot_hours} ชม. (1.5x)`}
                                                </span>
                                              )}
                                              {allSafetyAdvances.some(a => a.employee_id === emp.id && a.period_id === currentPeriod?.id) && (
                                                <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#ede9fe', color: '#6d28d9', border: '1px solid #c4b5fd' }} title="มีบันทึกค่าปรับผิดระเบียบ จป. ในงวดนี้">
                                                  จป.
                                                </span>
                                              )}
                                            </div>
                                            <div className="vk-tpi-worker-pill-line2">
                                              <span className="vk-tpi-wp-code">{emp.employee_code}</span>
                                            </div>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              handleRemove(emp.id, job.id, shiftIndex)
                                            }}
                                            className="vk-tpi-btn-del"
                                            title="ลบออกจากกะ"
                                          >
                                            <X style={{ width: 14, height: 14 }} />
                                          </button>
                                        </div>
                                      )
                                    })}

                                    {canDrop && (
                                      <div className="vk-tpi-drop-target">
                                        + วาง {selectedPoolIds.size} คน ที่นี่
                                      </div>
                                    )}

                                    {singleShiftEntries.length === 0 && totalShiftCount === 0 && !canDrop && (
                                      <div className="vk-tpi-cell-empty">
                                        {isPaused ? 'ยกเลิก' : 'ว่าง'}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>

            {/* Section 2: ประเภทงานชั่วคราว (Temporary Jobs) */}
            <div className="vk-tpi-group-section">
              <div className="vk-tpi-group-banner banner-temp">
                <div className="vk-tpi-banner-title">
                  <h2>2. ประเภทงานชั่วคราว (Temporary Jobs)</h2>
                  <span className="vk-tpi-banner-tag">เป้าหมายรวม: {tempTargetTotal} คน</span>
                </div>
                <div className="vk-tpi-banner-stat">
                  จัดแล้ว: <strong>{entries.filter((e) => temporaryJobs.some((j) => j.id === e.job_id)).length}</strong> / {tempTargetTotal} คน
                </div>
              </div>

              {temporaryGroups.map((group) => {
                const deptTarget = group.jobs.reduce((sum, j) => {
                  const t = getShiftTargets(j)
                  return sum + t[0] + t[1] + t[2]
                }, 0)
                const deptAssigned = group.jobs.reduce((sum, j) => sum + usage(entries, j.id).total, 0)
                const isDeptComplete = deptAssigned >= deptTarget && deptTarget > 0

                return (
                  <div key={group.department} className="vk-tpi-dept-block">
                    <div className="vk-tpi-dept-bar">
                      <span className="vk-tpi-dept-name">{group.department}</span>
                      <span className="vk-tpi-dept-info">
                        ยอดแผนก: <strong>{deptAssigned}/{deptTarget}</strong> คน
                        <span className={`vk-tpi-dept-pill ${deptTarget === 0 && deptAssigned === 0 ? 'pill-zero' : isDeptComplete ? 'pill-done' : 'pill-pend'}`}>
                          {deptTarget === 0 && deptAssigned === 0 ? '— ไม่ใช้วันนี้' : isDeptComplete ? '✓ ครบ' : `ขาดอีก ${Math.max(0, deptTarget - deptAssigned)}`}
                        </span>
                      </span>
                    </div>

                    {group.jobs.map((job) => {
                      const { total } = usage(entries, job.id)
                      const targets = getShiftTargets(job)
                      const todayTarget = targets[0] + targets[1] + targets[2]
                      const quotaStatus = getJobQuotaStatus(job, total, todayTarget)
                      const isPaused = quotaStatus === 'paused'

                      // Check for employees doing double shifts in this exact same job
                      const jobEntries = entries.filter((e) => e.job_id === job.id)
                      const empShiftMapInJob = new Map<string, Set<number>>()
                      jobEntries.forEach((e) => {
                        if (!empShiftMapInJob.has(e.employee_id)) empShiftMapInJob.set(e.employee_id, new Set())
                        empShiftMapInJob.get(e.employee_id)!.add(e.shift_index)
                      })

                      const doubleShiftEmps: { empId: string; span: 'morning-afternoon' | 'afternoon-night' | 'morning-night' }[] = []
                      const handledDoubleEmpIds = new Set<string>()

                      empShiftMapInJob.forEach((shiftsSet, empId) => {
                        if (shiftsSet.has(0) && shiftsSet.has(1)) {
                          doubleShiftEmps.push({ empId, span: 'morning-afternoon' })
                          handledDoubleEmpIds.add(empId)
                        } else if (shiftsSet.has(1) && shiftsSet.has(2)) {
                          doubleShiftEmps.push({ empId, span: 'afternoon-night' })
                          handledDoubleEmpIds.add(empId)
                        } else if (shiftsSet.has(0) && shiftsSet.has(2)) {
                          doubleShiftEmps.push({ empId, span: 'morning-night' })
                          handledDoubleEmpIds.add(empId)
                        }
                      })

                      return (
                        <div key={job.id} className={`vk-tpi-row ${isPaused ? 'row-paused' : ''} status-${quotaStatus}`}>
                          {/* Left Column: Job Info */}
                          <div className="vk-tpi-cell-info">
                            <div className="vk-tpi-code-line">
                              <JobCodeBadge job={job} />
                              <span className="vk-tpi-dept-tag">{job.department}</span>
                              {job.expires_on && (
                                <span className="vk-tpi-exp-tag">ถึง {formatThaiBuddhistDate(job.expires_on)}</span>
                              )}
                            </div>
                            <div className="vk-tpi-desc">{job.description}</div>
                            <div className="vk-tpi-quota-line">
                              <span className="vk-tpi-quota-label">ยอดที่ต้องใช้:</span>
                              <strong>{todayTarget}</strong> คน
                              {renderQuotaBadge(quotaStatus, total, todayTarget)}
                            </div>
                          </div>

                          {/* Right Side: 3-Shift Grid with 2-Column Spanning for Double Shifts */}
                          <div className="vk-tpi-shifts-grid">
                            {/* Prominent Shift Headers Row */}
                            <div className="vk-tpi-shifts-row-header">
                              {SHIFTS.map((shift, shiftIndex) => {
                                const totalShiftCount = jobEntries.filter((e) => e.shift_index === shiftIndex).length
                                const targetForShift = targets[shiftIndex]

                                const isZero = targetForShift === 0 && totalShiftCount === 0
                                const isMet = targetForShift > 0 && totalShiftCount >= targetForShift
                                const statClass = isZero ? 'is-zero' : isMet ? 'is-met' : ''

                                return (
                                  <div key={shiftIndex} className="vk-tpi-shift-col-header">
                                    <span className="vk-tpi-shift-col-title">กะ{shift.name}</span>
                                    <span className={`vk-tpi-shift-col-stat ${statClass}`}>
                                      {totalShiftCount}/{targetForShift}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>

                            {/* Spanning 2-Column Double Shifts in this Job (Grouped & Sorted) */}
                            {renderJobDoubleShifts(job.id, doubleShiftEmps)}

                            {/* 3 Individual Shift Columns */}
                            {SHIFTS.map((shift, shiftIndex) => {
                              const singleShiftEntries = jobEntries.filter(
                                (e) => e.shift_index === shiftIndex && !handledDoubleEmpIds.has(e.employee_id)
                              )
                              const totalShiftCount = jobEntries.filter((e) => e.shift_index === shiftIndex).length
                              const canDrop = hasSelection && !isPaused

                              return (
                                <div
                                  key={shiftIndex}
                                  onClick={() => {
                                    if (canDrop) handleAssignSelected(job.id, shiftIndex)
                                  }}
                                  className={`vk-tpi-cell-shift col-${shiftIndex} ${canDrop ? 'can-drop' : ''} ${isPaused ? 'cell-paused' : ''}`}
                                  onDragOver={isPaused ? undefined : handleDragOver}
                                  onDragLeave={isPaused ? undefined : handleDragLeave}
                                  onDrop={isPaused ? undefined : (e) => handleDrop(e, job.id, shiftIndex)}
                                >
                                  <div className="vk-tpi-workers-stack">
                                    {singleShiftEntries.map((entry) => {
                                      const emp = empMap.get(entry.employee_id)
                                      if (!emp) return null
                                      const u = empUsageMap.get(emp.id)
                                      const totalWorkerShifts = u?.count || 1

                                      return (
                                        <div
                                          key={`${entry.employee_id}-${shiftIndex}`}
                                          className="vk-tpi-worker-pill"
                                          draggable={!isPaused}
                                          onDragStart={(e) => handleDragStartFromCell(e, emp.id, job.id, shiftIndex)}
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            openEmployeeModal(emp)
                                          }}
                                          title="คลิกเพื่อจัดการกะ หรือเพิ่มกะที่ 2"
                                        >
                                          <div className="vk-tpi-worker-pill-main">
                                            <div className="vk-tpi-worker-pill-line1">
                                              <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, gap: 3 }}>
                                                <span className="vk-tpi-wp-name">
                                                  {emp.first_name} {emp.last_name}
                                                </span>
                                                {isSkilledWorker(emp.id) && <span title="พนักงานค่าแรงฝีมือ" style={{ flexShrink: 0, fontSize: 11 }}>⭐</span>}
                                              </div>
                                              {totalWorkerShifts > 1 && (
                                                <span className="vk-tpi-wp-2shift" title="มีอีก 1 กะในรหัสงานอื่น">
                                                  2 กะ
                                                </span>
                                              )}
                                              {entry.is_half_shift && (
                                                <span className="vk-tpi-wp-half" title="ทำงานครึ่งกะ (4 ชม.) ลาครึ่งวัน">
                                                  ครึ่งกะ 4 ชม.
                                                </span>
                                              )}
                                              {(Number(entry.ot_hours) || 0) > 0 && (
                                                <span className="vk-tpi-wp-ot" title={emp.position === 'clerk' ? 'OT เสมียนเต็มกะ 8 ชม. (2 เท่า)' : `OT ${entry.ot_hours} ชม. (1.5 เท่า/ชม.)`}>
                                                  {emp.position === 'clerk' ? 'OT 8 ชม. (2x)' : `OT ${entry.ot_hours} ชม. (1.5x)`}
                                                </span>
                                              )}
                                              {allSafetyAdvances.some(a => a.employee_id === emp.id && a.period_id === currentPeriod?.id) && (
                                                <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#ede9fe', color: '#6d28d9', border: '1px solid #c4b5fd' }} title="มีบันทึกค่าปรับผิดระเบียบ จป. ในงวดนี้">
                                                  จป.
                                                </span>
                                              )}
                                            </div>
                                            <div className="vk-tpi-worker-pill-line2">
                                              <span className="vk-tpi-wp-code">{emp.employee_code}</span>
                                            </div>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              handleRemove(emp.id, job.id, shiftIndex)
                                            }}
                                            className="vk-tpi-btn-del"
                                            title="ลบออกจากกะ"
                                          >
                                            <X style={{ width: 14, height: 14 }} />
                                          </button>
                                        </div>
                                      )
                                    })}

                                    {canDrop && (
                                      <div className="vk-tpi-drop-target">
                                        + วาง {selectedPoolIds.size} คน ที่นี่
                                      </div>
                                    )}

                                    {singleShiftEntries.length === 0 && totalShiftCount === 0 && !canDrop && (
                                      <div className="vk-tpi-cell-empty">
                                        {isPaused ? 'ยกเลิก' : 'ว่าง'}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 5. Employee Shift Modal (Clicking on worker card to manage 1 or 2 consecutive shifts) */}
      {modalEmp && (() => {
        const modalIsClerk = modalEmp.position === 'clerk'
        const modalJob1 = jobs.find((j) => j.id === modalShift1JobId)
        const modalJob2 = jobs.find((j) => j.id === modalShift2JobId)
        const modalTier = wageTier(
          wageProfiles.find((p) => p.employee_id === modalEmp.id),
          activeDateStr
        )
        const isClerkJob1 = isClerkJob(modalJob1)
        const modalBaseRate1 = isClerkJob1
          ? (modalTier === 'skilled' ? (modalJob1?.skilled_rate ?? 377) : (modalJob1?.normal_rate ?? 357))
          : (modalTier === 'skilled' && modalJob1?.skilled_rate ? modalJob1.skilled_rate : (modalJob1?.normal_rate || 357))

        const isClerkJob2 = isClerkJob(modalJob2)
        const modalBaseRate2 = isClerkJob2
          ? (modalTier === 'skilled' ? (modalJob2?.skilled_rate ?? 377) : (modalJob2?.normal_rate ?? 357))
          : (modalTier === 'skilled' && modalJob2?.skilled_rate ? modalJob2.skilled_rate : (modalJob2?.normal_rate || 357))

        const modalShift1Wage = modalShift1IsHalf ? modalBaseRate1 / 2 : modalBaseRate1
        const modalShift1OtCalc = (!modalIsClerk && modalShift1HasOt)
          ? calculateEntryOt(modalShift1OtHours, modalBaseRate1, modalIsClerk)
          : { ot_hours: 0, ot_pay: 0 }

        const modalShift2Wage = modalShift2IsHalf ? modalBaseRate2 / 2 : modalBaseRate2
        const modalShift2OtCalc = modalShift2HasOt
          ? calculateEntryOt(modalShift2OtHours, modalBaseRate2, modalIsClerk)
          : { ot_hours: 0, ot_pay: 0 }

        return (
          <div className="vk-modal-backdrop" onClick={() => setModalEmp(null)}>
            <div className="vk-modal-window" onClick={(e) => e.stopPropagation()}>
              <div className="vk-modal-top">
                <div className="vk-modal-header-info">
                  <h3 className="vk-modal-emp-title">
                    {modalEmp.first_name} {modalEmp.last_name}
                    {isSkilledWorker(modalEmp.id) && (
                      <span title="พนักงานค่าแรงฝีมือ" style={{ marginLeft: 6, fontSize: 16 }}>⭐</span>
                    )}
                  </h3>
                  <div className="vk-modal-emp-meta">
                    <span className="vk-meta-code">{modalEmp.employee_code}</span>
                    {modalEmp.nationality && <span className="vk-meta-nat">{modalEmp.nationality}</span>}
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 999,
                        background: modalIsClerk ? 'rgba(177,71,41,0.12)' : 'var(--vk-bone-2)',
                        color: modalIsClerk ? 'var(--vk-persimmon)' : 'var(--vk-ink-2)',
                      }}
                    >
                      {modalIsClerk ? 'พนักงานกลุ่มเสมียน' : 'พนักงานทั่วไป'}
                    </span>
                  </div>

                </div>
                <button
                  type="button"
                  className="vk-modal-close-btn"
                  onClick={() => setModalEmp(null)}
                >
                  ×
                </button>
              </div>

              <div className="vk-modal-content">
                {/* Quick Consecutive Presets */}
                <div className="vk-modal-presets-section">
                  <span className="vk-presets-label">ทางลัดจัด 2 กะต่อเนื่อง (ควบกะ):</span>
                  <div className="vk-presets-btns">
                    <button
                      type="button"
                      className="vk-preset-chip"
                      onClick={() => {
                        setModalShift1Index(0)
                        setModalHasShift2(true)
                        setModalShift2Index(1)
                        if (!modalShift2JobId) setModalShift2JobId(modalShift1JobId)
                      }}
                    >
                      เช้า + บ่าย (07:40–00:00)
                    </button>
                    <button
                      type="button"
                      className="vk-preset-chip"
                      onClick={() => {
                        setModalShift1Index(1)
                        setModalHasShift2(true)
                        setModalShift2Index(2)
                        if (!modalShift2JobId) setModalShift2JobId(modalShift1JobId)
                      }}
                    >
                      บ่าย + ดึก (15:40–08:00)
                    </button>
                    <button
                      type="button"
                      className="vk-preset-chip"
                      onClick={() => {
                        setModalShift1Index(0)
                        setModalHasShift2(true)
                        setModalShift2Index(2)
                        if (!modalShift2JobId) setModalShift2JobId(modalShift1JobId)
                      }}
                    >
                      เช้าแล้วกลับมาทำดึก (เว้นบ่าย)
                    </button>
                  </div>
                </div>

                {/* Shift 1 Configuration */}
                <div className="vk-shift-config-card">
                  <div className="vk-shift-card-head">
                    <span className="vk-shift-card-num">กะที่ 1 (Shift 1)</span>
                    <span className="vk-shift-card-tag">จำเป็น</span>
                  </div>
                  <div className="vk-shift-config-grid">
                    <div className="vk-field-group">
                      <label>รหัสงาน:</label>
                      <select
                        className="vk-modal-select"
                        value={modalShift1JobId}
                        onChange={(e) => setModalShift1JobId(e.target.value)}
                      >
                        <optgroup label="1. ประเภทงานประจำ">
                          {regularJobs.map((j) => (
                            <option key={j.id} value={j.id}>
                              {isClerkJob(j) ? '🏢 [เสมียน] ' : ''}{j.code} - {j.description.substring(0, 32)}... (ปกติ ฿{j.normal_rate ?? 357}{j.skilled_rate != null ? ` | ฝีมือ ฿${j.skilled_rate}` : ''})
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="2. ประเภทงานชั่วคราว">
                          {temporaryJobs.map((j) => (
                            <option key={j.id} value={j.id}>
                              {isClerkJob(j) ? '🏢 [เสมียน] ' : ''}{j.code} - {j.description.substring(0, 32)}... (ปกติ ฿{j.normal_rate ?? 357}{j.skilled_rate != null ? ` | ฝีมือ ฿${j.skilled_rate}` : ''})
                            </option>
                          ))}
                        </optgroup>
                      </select>
                      {modalJob1 && (
                        <div style={{ fontSize: 11, color: 'var(--vk-ink-3)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {isClerkJob(modalJob1) && (
                            <span className="vk-tpi-clerk-badge-prefix" style={{ fontSize: 10 }}>
                              🏢 รหัสงานกลุ่มเสมียน
                            </span>
                          )}
                          <span>
                            เรทงานนี้: เรทปกติ <strong style={{ color: 'var(--vk-ink)' }}>฿{modalJob1.normal_rate ?? 357}</strong> / กะ · เรทฝีมือ <strong style={{ color: modalJob1.skilled_rate ? '#b45309' : 'var(--vk-ink-3)' }}>{modalJob1.skilled_rate != null ? `฿${modalJob1.skilled_rate}` : 'ไม่มี (ตามเรทปกติ)'}</strong>
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="vk-field-group">
                      <label>ช่วงเวลากะ:</label>
                      <select
                        className="vk-modal-select"
                        value={modalShift1Index}
                        onChange={(e) => {
                          const newIdx = Number(e.target.value)
                          setModalShift1Index(newIdx)
                          if (modalShift2Index === newIdx) {
                            setModalShift2Index((newIdx + 1) % 3)
                          } else if (newIdx === 2 && modalShift2Index === 0) {
                            // According to labor law, night-to-morning is prohibited
                            setModalShift2Index(1)
                          }
                        }}
                      >
                        {SHIFTS.map((s, idx) => (
                          <option key={idx} value={idx}>
                            กะ{s.name} ({s.time})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Half-Shift / Leave Option */}
                  <div
                    style={{
                      marginTop: 10,
                      padding: '8px 12px',
                      background: modalShift1IsHalf ? '#fef3c7' : '#f8fafc',
                      border: `1px solid ${modalShift1IsHalf ? '#f59e0b' : '#e2e8f0'}`,
                      borderRadius: 6,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        cursor: 'pointer',
                        userSelect: 'none',
                        fontSize: 12,
                        fontWeight: 600,
                        color: modalShift1IsHalf ? '#92400e' : 'var(--vk-ink-2)',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={modalShift1IsHalf}
                        onChange={(e) => setModalShift1IsHalf(e.target.checked)}
                        style={{ accentColor: '#d97706', width: 15, height: 15 }}
                      />
                      <span>ทำงานครึ่งกะ / ลาครึ่งวัน (4 ชม.)</span>
                    </label>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: modalShift1IsHalf ? '#b45309' : '#64748b',
                      }}
                    >
                      {modalShift1IsHalf ? 'คิดค่าแรง 50% (4 ชม.)' : 'เต็มกะ (8 ชม.)'}
                    </span>
                  </div>

                  {/* OT Section for Shift 1 — Hidden for clerks (Clerks must work 8h Shift 1; OT is only allowed in Shift 2) */}
                  {!modalIsClerk && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: '10px 12px',
                        background: modalShift1HasOt ? '#fff7ed' : '#f8fafc',
                        border: `1px solid ${modalShift1HasOt ? '#f97316' : '#e2e8f0'}`,
                        borderRadius: 6,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                        <label
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            cursor: 'pointer',
                            userSelect: 'none',
                            fontSize: 12,
                            fontWeight: 600,
                            color: modalShift1HasOt ? '#9a3412' : 'var(--vk-ink-2)',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={modalShift1HasOt}
                            onChange={(e) => {
                              setModalShift1HasOt(e.target.checked)
                              if (e.target.checked && modalShift1OtHours <= 0) {
                                setModalShift1OtHours(1)
                              }
                            }}
                            style={{ accentColor: '#ea580c', width: 15, height: 15 }}
                          />
                          <span>OT (จ่าย 1.5 เท่าต่อชั่วโมง)</span>
                        </label>
                        {modalShift1HasOt && (
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#c2410c' }}>
                            +฿{modalShift1OtCalc.ot_pay.toFixed(2)}
                          </span>
                        )}
                      </div>

                      {modalShift1HasOt && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #fed7aa' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 11, color: '#9a3412', fontWeight: 600 }}>จำนวนชั่วโมง OT:</span>
                              {[1, 2, 3, 4].map((h) => (
                                <button
                                  key={h}
                                  type="button"
                                  onClick={() => setModalShift1OtHours(h)}
                                  style={{
                                    fontSize: 11,
                                    fontWeight: modalShift1OtHours === h ? 700 : 500,
                                    padding: '2px 8px',
                                    borderRadius: 4,
                                    border: `1px solid ${modalShift1OtHours === h ? '#ea580c' : '#fdba74'}`,
                                    background: modalShift1OtHours === h ? '#ea580c' : '#ffffff',
                                    color: modalShift1OtHours === h ? '#ffffff' : '#9a3412',
                                    cursor: 'pointer',
                                  }}
                                >
                                  {h} ชม.
                                </button>
                              ))}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                <input
                                  type="number"
                                  min={0.5}
                                  max={12}
                                  step={0.5}
                                  value={modalShift1OtHours}
                                  onChange={(e) => setModalShift1OtHours(Math.max(0, Number(e.target.value)))}
                                  style={{
                                    width: 48,
                                    height: 24,
                                    fontSize: 11,
                                    textAlign: 'center',
                                    borderRadius: 4,
                                    border: '1px solid #fdba74',
                                    padding: '0 4px',
                                  }}
                                />
                                <span style={{ fontSize: 11, color: '#9a3412' }}>ชม.</span>
                              </div>
                            </div>
                            <div style={{ fontSize: 11, color: '#c2410c' }}>
                              (อัตรา (฿{modalBaseRate1}/8 × 1.5) = ฿{(modalBaseRate1 / 8 * 1.5).toFixed(2)}/ชม.)
                            </div>
                          </div>
                        </div>
                      )}

                      {modalShift1HasOt && (
                        <div style={{ marginTop: 6, fontSize: 11, color: '#9a3412', background: 'rgba(254, 215, 170, 0.4)', padding: '4px 8px', borderRadius: 4 }}>
                          <span>ค่าแรงกะ ฿{modalShift1Wage.toFixed(2)} + OT {modalShift1OtHours} ชม. ฿{modalShift1OtCalc.ot_pay.toFixed(2)} = <strong>รวม ฿{(modalShift1Wage + modalShift1OtCalc.ot_pay).toFixed(2)}</strong></span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Shift 2 (Optional Double Shift) Configuration — hidden when Shift 1 is half-shift */}
                {!modalShift1IsHalf && (
                <div className={`vk-shift-config-card ${modalHasShift2 ? 'is-active' : 'is-disabled'}`}>
                  <div className="vk-shift-card-head">
                    <label className="vk-shift2-toggle-label">
                      <input
                        type="checkbox"
                        checked={modalHasShift2}
                        onChange={(e) => {
                          setModalHasShift2(e.target.checked)
                          if (e.target.checked) {
                            if (!modalShift2JobId) setModalShift2JobId(modalShift1JobId)
                            if (modalShift2Index === modalShift1Index) {
                              setModalShift2Index((modalShift1Index + 1) % 3)
                            }
                          }
                        }}
                      />
                      <span className="vk-shift-card-num">กะที่ 2 (Shift 2 — ควบ 2 กะ)</span>
                    </label>
                    {modalHasShift2 ? (
                      <span className="vk-shift-badge-active">เปิดทำงาน 2 กะ</span>
                    ) : (
                      <span className="vk-shift-badge-off">ยังไม่เปิด</span>
                    )}
                  </div>

                  {modalHasShift2 && (
                    <>
                      <div className="vk-shift-config-grid">
                        <div className="vk-field-group">
                          <label>รหัสงานกะที่ 2:</label>
                          <select
                            className="vk-modal-select"
                            value={modalShift2JobId}
                            onChange={(e) => setModalShift2JobId(e.target.value)}
                          >
                            <optgroup label="1. ประเภทงานประจำ">
                              {regularJobs.map((j) => (
                                <option key={j.id} value={j.id}>
                                  {isClerkJob(j) ? '🏢 [เสมียน] ' : ''}{j.code} - {j.description.substring(0, 32)}... (ปกติ ฿{j.normal_rate ?? 357}{j.skilled_rate != null ? ` | ฝีมือ ฿${j.skilled_rate}` : ''})
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="2. ประเภทงานชั่วคราว">
                              {temporaryJobs.map((j) => (
                                <option key={j.id} value={j.id}>
                                  {isClerkJob(j) ? '🏢 [เสมียน] ' : ''}{j.code} - {j.description.substring(0, 32)}... (ปกติ ฿{j.normal_rate ?? 357}{j.skilled_rate != null ? ` | ฝีมือ ฿${j.skilled_rate}` : ''})
                                </option>
                              ))}
                            </optgroup>
                          </select>
                          {modalJob2 && (
                            <div style={{ fontSize: 11, color: 'var(--vk-ink-3)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              {isClerkJob(modalJob2) && (
                                <span className="vk-tpi-clerk-badge-prefix" style={{ fontSize: 10 }}>
                                  🏢 รหัสงานกลุ่มเสมียน
                                </span>
                              )}
                              <span>
                                เรทงานนี้: เรทปกติ <strong style={{ color: 'var(--vk-ink)' }}>฿{modalJob2.normal_rate ?? 357}</strong> / กะ · เรทฝีมือ <strong style={{ color: modalJob2.skilled_rate ? '#b45309' : 'var(--vk-ink-3)' }}>{modalJob2.skilled_rate != null ? `฿${modalJob2.skilled_rate}` : 'ไม่มี (ตามเรทปกติ)'}</strong>
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="vk-field-group">
                          <label>ช่วงเวลากะที่ 2:</label>
                          <select
                            className="vk-modal-select"
                            value={modalShift2Index}
                            onChange={(e) => setModalShift2Index(Number(e.target.value))}
                          >
                            {SHIFTS.map((s, idx) => {
                              const isSameShift = idx === modalShift1Index
                              const isIllegalNightToMorning = modalShift1Index === 2 && idx === 0
                              const isDisabled = isSameShift || isIllegalNightToMorning
                              let labelSuffix = ''
                              if (isSameShift) labelSuffix = ' (ซ้ำกับกะที่ 1)'
                              else if (isIllegalNightToMorning) labelSuffix = ' (ห้ามดึกต่อเช้าตามกฎหมาย)'

                              return (
                                <option key={idx} value={idx} disabled={isDisabled}>
                                  กะ{s.name} ({s.time}){labelSuffix}
                                </option>
                              )
                            })}
                          </select>
                        </div>
                      </div>

                      {/* Half-Shift / Leave Option for Shift 2 */}
                      <div
                        style={{
                          marginTop: 10,
                          padding: '8px 12px',
                          background: modalShift2IsHalf ? '#fef3c7' : '#f8fafc',
                          border: `1px solid ${modalShift2IsHalf ? '#f59e0b' : '#e2e8f0'}`,
                          borderRadius: 6,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <label
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            cursor: 'pointer',
                            userSelect: 'none',
                            fontSize: 12,
                            fontWeight: 600,
                            color: modalShift2IsHalf ? '#92400e' : 'var(--vk-ink-2)',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={modalShift2IsHalf}
                            onChange={(e) => setModalShift2IsHalf(e.target.checked)}
                            style={{ accentColor: '#d97706', width: 15, height: 15 }}
                          />
                          <span>ทำงานครึ่งกะ / ลาครึ่งวัน (4 ชม.)</span>
                        </label>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: modalShift2IsHalf ? '#b45309' : '#64748b',
                          }}
                        >
                          {modalShift2IsHalf ? 'คิดค่าแรง 50% (4 ชม.)' : 'เต็มกะ (8 ชม.)'}
                        </span>
                      </div>

                      {/* OT Section for Shift 2 */}
                      <div
                        style={{
                          marginTop: 10,
                          padding: '10px 12px',
                          background: modalShift2HasOt ? '#fff7ed' : '#f8fafc',
                          border: `1px solid ${modalShift2HasOt ? '#f97316' : '#e2e8f0'}`,
                          borderRadius: 6,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                          <label
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              cursor: 'pointer',
                              userSelect: 'none',
                              fontSize: 12,
                              fontWeight: 600,
                              color: modalShift2HasOt ? '#9a3412' : 'var(--vk-ink-2)',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={modalShift2HasOt}
                              onChange={(e) => {
                                setModalShift2HasOt(e.target.checked)
                                if (e.target.checked && modalShift2OtHours <= 0) {
                                  setModalShift2OtHours(modalIsClerk ? 8 : 1)
                                }
                              }}
                              style={{ accentColor: '#ea580c', width: 15, height: 15 }}
                            />
                            <span>
                              {modalIsClerk ? 'ทำ OT เต็มกะ (8 ชม.) — ได้รับเงิน 2 เท่าจากค่าแรง' : 'OT (จ่าย 1.5 เท่าต่อชั่วโมง)'}
                            </span>
                          </label>
                          {modalShift2HasOt && (
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#c2410c' }}>
                              +฿{modalShift2OtCalc.ot_pay.toFixed(2)}
                            </span>
                          )}
                        </div>

                        {modalShift2HasOt && !modalIsClerk && (
                          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #fed7aa' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 11, color: '#9a3412', fontWeight: 600 }}>จำนวนชั่วโมง OT:</span>
                                {[1, 2, 3, 4].map((h) => (
                                  <button
                                    key={h}
                                    type="button"
                                    onClick={() => setModalShift2OtHours(h)}
                                    style={{
                                      fontSize: 11,
                                      fontWeight: modalShift2OtHours === h ? 700 : 500,
                                      padding: '2px 8px',
                                      borderRadius: 4,
                                      border: `1px solid ${modalShift2OtHours === h ? '#ea580c' : '#fdba74'}`,
                                      background: modalShift2OtHours === h ? '#ea580c' : '#ffffff',
                                      color: modalShift2OtHours === h ? '#ffffff' : '#9a3412',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {h} ชม.
                                  </button>
                                ))}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                  <input
                                    type="number"
                                    min={0.5}
                                    max={12}
                                    step={0.5}
                                    value={modalShift2OtHours}
                                    onChange={(e) => setModalShift2OtHours(Math.max(0, Number(e.target.value)))}
                                    style={{
                                      width: 48,
                                      height: 24,
                                      fontSize: 11,
                                      textAlign: 'center',
                                      borderRadius: 4,
                                      border: '1px solid #fdba74',
                                      padding: '0 4px',
                                    }}
                                  />
                                  <span style={{ fontSize: 11, color: '#9a3412' }}>ชม.</span>
                                </div>
                              </div>
                              <div style={{ fontSize: 11, color: '#c2410c' }}>
                                (อัตรา (฿{modalBaseRate2}/8 × 1.5) = ฿{(modalBaseRate2 / 8 * 1.5).toFixed(2)}/ชม.)
                              </div>
                            </div>
                          </div>
                        )}

                        {modalShift2HasOt && (
                          <div style={{ marginTop: 6, fontSize: 11, color: '#9a3412', background: 'rgba(254, 215, 170, 0.4)', padding: '4px 8px', borderRadius: 4 }}>
                            {modalIsClerk ? (
                              <span>OT เสมียนเต็มกะ 8 ชม. (จ่าย 2 เท่า): <strong>฿{modalShift2OtCalc.ot_pay.toFixed(2)}</strong> <span style={{ fontSize: 10, color: '#b45309', marginLeft: 4 }}>(คิดเป็น OT 2 เท่า และไม่นำไปรวมกับค่ากะซ้ำซ้อน)</span></span>
                            ) : (
                              <span>ค่าแรงกะ ฿{modalShift2Wage.toFixed(2)} + OT {modalShift2OtHours} ชม. ฿{modalShift2OtCalc.ot_pay.toFixed(2)} = <strong>รวม ฿{(modalShift2Wage + modalShift2OtCalc.ot_pay).toFixed(2)}</strong></span>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
                )} {/* end !modalShift1IsHalf */}

              {/* ── Safety Disciplinary Fine Section ── */}
              <div
                style={{
                  marginTop: 4,
                  padding: '14px 16px',
                  borderRadius: 8,
                  background: '#faf5ff',
                  border: '1.5px solid #d8b4fe',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ShieldAlert style={{ width: 18, height: 18, color: '#7c3aed' }} />
                    <span style={{ fontWeight: 700, fontSize: 13, color: '#581c87' }}>
                      รายงานความผิดระเบียบวินัยจาก จป.
                    </span>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', background: '#ede9fe', padding: '2px 8px', borderRadius: 999, border: '1px solid #ddd6fe' }}>
                    ปรับครั้งละ 1,000 บ. · หักงวดละ 500 บ.
                  </span>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', fontSize: 13, fontWeight: 600, color: '#4c1d95', marginBottom: modalSafetyFineEnabled ? 12 : 6 }}>
                  <input
                    type="checkbox"
                    checked={modalSafetyFineEnabled}
                    onChange={(e) => setModalSafetyFineEnabled(e.target.checked)}
                    style={{ accentColor: '#7c3aed', width: 16, height: 16 }}
                  />
                  <span>บันทึกความผิดระเบียบวินัยจาก จป. ในงวดนี้ (หักเงินงวดละ 500 บาท)</span>
                </label>

                {modalSafetyFineEnabled && (
                  <div style={{ marginTop: 10, paddingTop: 12, borderTop: '1px dashed #d8b4fe', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6d28d9', marginBottom: 4 }}>
                          วันที่เกิดเหตุ:
                        </label>
                        <ThaiDatePicker
                          value={modalSafetyFineDate}
                          onChange={(val) => setModalSafetyFineDate(val || '')}
                          placeholder="วว/ดด/ปปปป (พ.ศ.)"
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6d28d9', marginBottom: 4 }}>
                          เลือกสาเหตุด่วน:
                        </label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {[
                            'แอบใช้โทรศัพท์มือถือในพื้นที่ผลิต',
                            'สูบบุหรี่ในพื้นที่ห้ามสูบ',
                            'ไม่สวมใส่อุปกรณ์คุ้มครองความปลอดภัย (PPE)',
                            'ละทิ้งจุดปฏิบัติงานโดยไม่ได้รับอนุญาต',
                          ].map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setModalSafetyFineReason(preset)}
                              style={{
                                fontSize: 11,
                                padding: '3px 8px',
                                borderRadius: 4,
                                border: `1px solid ${modalSafetyFineReason === preset ? '#7c3aed' : '#ddd6fe'}`,
                                background: modalSafetyFineReason === preset ? '#7c3aed' : '#ffffff',
                                color: modalSafetyFineReason === preset ? '#ffffff' : '#581c87',
                                cursor: 'pointer',
                              }}
                            >
                              {preset}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6d28d9', marginBottom: 4 }}>
                        ระบุสาเหตุ / รายละเอียดความผิด (ใช้เป็นหลักฐาน):
                      </label>
                      <input
                        type="text"
                        placeholder="เช่น แอบใช้โทรศัพท์มือถือขณะเดินเครื่องจักร..."
                        value={modalSafetyFineReason}
                        onChange={(e) => setModalSafetyFineReason(e.target.value)}
                        style={{
                          width: '100%',
                          height: 34,
                          padding: '0 10px',
                          fontSize: 12,
                          borderRadius: 6,
                          border: '1px solid #c4b5fd',
                          background: '#ffffff',
                          color: '#1e1b4b',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>

                    <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: '#5b21b6', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                      <div>
                        💡 <strong>ระบบผ่อนชำระ:</strong> ยอดปรับเต็ม 1,000 บาท · ระบบจะหักงวดละ 500 บาท และส่งต่องวดถัดไปให้อัตโนมัติ (แสดงงวด [X/Y])
                      </div>
                      <button
                        type="button"
                        disabled={modalSafetyFineSubmitting || !modalSafetyFineReason.trim()}
                        onClick={handleSaveSafetyFine}
                        style={{
                          background: modalSafetyFineReason.trim() ? '#7c3aed' : '#d8b4fe',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: 4,
                          padding: '4px 12px',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: modalSafetyFineReason.trim() ? 'pointer' : 'not-allowed',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        {modalSafetyFineSubmitting ? 'กำลังบันทึก...' : 'บันทึกค่าปรับ จป. ทันที'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Existing safety fines list for this employee */}
                {(() => {
                  const empFines = allSafetyAdvances.filter((a) => a.employee_id === modalEmp.id)
                  if (empFines.length === 0) return null
                  return (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #d8b4fe' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#6d28d9', marginBottom: 6 }}>
                        ประวัติรายการค่าปรับ จป. ของพนักงานคนนี้ ({empFines.length} รายการ):
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {empFines.map((fine) => {
                          const isCurrent = fine.period_id === currentPeriod?.id
                          return (
                            <div
                              key={fine.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: '#ffffff',
                                padding: '6px 10px',
                                borderRadius: 4,
                                border: `1px solid ${isCurrent ? '#c4b5fd' : '#e9d5ff'}`,
                                fontSize: 11,
                                gap: 8,
                              }}
                            >
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, color: '#4c1d95', display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span>{fine.notes?.replace(/\[หักค่าปรับ จป\.\]/g, '').trim() || 'ค่าปรับ จป.'}</span>
                                  {isCurrent && (
                                    <span style={{ fontSize: 9, fontWeight: 700, background: '#ede9fe', color: '#6d28d9', padding: '1px 5px', borderRadius: 4 }}>
                                      งวดปัจจุบัน
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                <span style={{ fontFamily: 'var(--vk-mono)', fontWeight: 700, color: '#7c3aed' }}>
                                  ฿{Number(fine.amount).toFixed(2)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSafetyFine(fine.id)}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#b91c1c',
                                    cursor: 'pointer',
                                    padding: 2,
                                    display: 'flex',
                                  }}
                                  title="ลบรายการนี้"
                                >
                                  <Trash2 style={{ width: 13, height: 13 }} />
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>

              {/* Modal Bottom Actions */}
              <div className="vk-modal-bottom-actions">
                <button
                  type="button"
                  className="vk-btn vk-btn-danger-outline"
                  onClick={handleClearModalShifts}
                >
                  <Trash2 style={{ width: 14, height: 14 }} />
                  ลบกะทั้งหมดของคนนี้
                </button>

                <div className="vk-modal-bottom-right">
                  <button
                    type="button"
                    className="vk-btn vk-btn-secondary"
                    onClick={() => setModalEmp(null)}
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="button"
                    className="vk-btn vk-btn-primary"
                    onClick={handleSaveModalShifts}
                  >
                    <Plus style={{ width: 14, height: 14 }} />
                    บันทึกการจัดกะ ({modalHasShift2 ? '2 กะ' : '1 กะ'})
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Daily Job Requirements Modal (Step 1: Admin Paper Entry) ── */}
      {isTargetModalOpen && (
        <div className="vk-modal-backdrop" onClick={() => setIsTargetModalOpen(false)}>
          <div
            className="vk-targets-modal-container"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="vk-modal-header">
              <div className="vk-modal-header-left">
                <div className="vk-modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Briefcase style={{ width: 18, height: 18, color: 'var(--vk-persimmon)' }} />
                  กำหนดความต้องการแรงงานประจำวัน (Daily Job Requirements)
                </div>
                <div className="vk-modal-subtitle">
                  วันที่: <strong>{fmtDisplay(activeDateStr)}</strong> · กรอกจำนวนแรงงานที่ต้องการแยกรายกะตามเอกสารรายวัน (เฉพาะรหัสงานที่เปิดใช้งาน)
                </div>
              </div>
              <button
                type="button"
                className="vk-modal-btn-close"
                onClick={() => setIsTargetModalOpen(false)}
                title="ปิดหน้าต่าง"
              >
                <X style={{ width: 20, height: 20 }} />
              </button>
            </div>

            {/* Modal Summary Bar & Quick Tools */}
            <div className="vk-targets-summary-bar">
              <div className="vk-targets-pills-wrap">
                <div className="vk-target-pill">
                  งานประจำ: <strong>{modalRegularTotal}</strong> คน
                </div>
                <div className="vk-target-pill">
                  งานชั่วคราว: <strong>{modalTempTotal}</strong> คน
                </div>
                <div className="vk-target-pill" style={{ background: '#fef3c7', borderColor: '#fde68a' }}>
                  รวมความต้องการวันนี้: <strong style={{ fontSize: 14 }}>{modalGrandTotal}</strong> คน
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ position: 'relative' }}>
                  <Search style={{ position: 'absolute', left: 8, top: 7, width: 14, height: 14, color: 'var(--vk-ink-3)' }} />
                  <input
                    type="text"
                    placeholder="ค้นหารหัสงาน / แผนก..."
                    value={targetModalSearch}
                    onChange={(e) => setTargetModalSearch(e.target.value)}
                    className="vk-input"
                    style={{ height: 28, fontSize: 12, paddingLeft: 26, width: 180 }}
                  />
                </div>
                <button
                  type="button"
                  className="vk-btn vk-btn-secondary"
                  style={{ height: 28, padding: '0 8px', fontSize: 11 }}
                  onClick={handleFillDefaultQuotas}
                  title="เติมยอดกะเช้าตามยอดเต็มมาตรฐานของรหัสงาน"
                >
                  เติมตามยอดเต็มปกติ
                </button>
                <button
                  type="button"
                  className="vk-btn vk-btn-secondary"
                  style={{ height: 28, padding: '0 8px', fontSize: 11 }}
                  onClick={handleClearAllModalTargets}
                  title="รีเซ็ตยอดทุกกะเป็น 0"
                >
                  ล้างเป็น 0 ทั้งหมด
                </button>
              </div>
            </div>

            {/* Modal Table Area */}
            <div className="vk-target-table-wrap">
              <table className="vk-targets-table">
                <thead>
                  <tr>
                    <th style={{ width: 85 }}>รหัสงาน</th>
                    <th style={{ width: 130 }}>แผนก / ฝ่าย</th>
                    <th>รายละเอียดงาน</th>
                    <th style={{ width: 85, textAlign: 'center' }}>ประเภท</th>
                    <th style={{ width: 85, textAlign: 'center' }}>ยอดเต็มปกติ</th>
                    <th style={{ width: 85, textAlign: 'center', background: '#25201b' }}>กะเช้า (A)</th>
                    <th style={{ width: 85, textAlign: 'center', background: '#25201b' }}>กะบ่าย (B)</th>
                    <th style={{ width: 85, textAlign: 'center', background: '#25201b' }}>กะดึก (C)</th>
                    <th style={{ width: 90, textAlign: 'center' }}>รวมวันนี้</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredModalJobs.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ padding: '30px', textAlign: 'center', color: 'var(--vk-ink-3)' }}>
                        ไม่พบรหัสงานที่ตรงกับการค้นหา
                      </td>
                    </tr>
                  ) : (
                    filteredModalJobs.map((job) => {
                      const targets = tempDailyTargets[job.id] || [0, 0, 0]
                      const todaySum = targets[0] + targets[1] + targets[2]
                      const isZero = todaySum === 0

                      return (
                        <tr key={job.id} style={{ background: isZero ? '#fafafa' : '#ffffff' }}>
                          {/* รหัสงาน */}
                          <td style={{ fontWeight: 700, fontFamily: 'var(--vk-mono)' }}>
                            <JobCodeBadge job={job} style={{ fontSize: 11 }} />
                          </td>

                          {/* แผนก */}
                          <td style={{ fontWeight: 600, color: 'var(--vk-ink)', fontSize: 12 }}>
                            {job.department}
                          </td>

                          {/* รายละเอียด */}
                          <td style={{ color: 'var(--vk-ink-2)', fontSize: 12 }}>
                            {job.description}
                          </td>

                          {/* ประเภท */}
                          <td style={{ textAlign: 'center' }}>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: '2px 6px',
                                borderRadius: 4,
                                background: job.job_type === 'regular' ? '#fef3c7' : '#dbeafe',
                                color: job.job_type === 'regular' ? '#92400e' : '#1e40af',
                              }}
                            >
                              {job.job_type === 'regular' ? 'ประจำ' : 'ชั่วคราว'}
                            </span>
                          </td>

                          {/* ยอดเต็ม */}
                          <td style={{ textAlign: 'center', fontFamily: 'var(--vk-mono)', fontSize: 12, color: 'var(--vk-ink-3)' }}>
                            {job.quota} คน
                          </td>

                          {/* Input กะเช้า */}
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="number"
                              min={0}
                              step={1}
                              className="vk-target-input-shift"
                              value={targets[0] === 0 ? '' : targets[0]}
                              placeholder="0"
                              onChange={(e) => handleTempTargetChange(job.id, 0, e.target.value)}
                            />
                          </td>

                          {/* Input กะบ่าย */}
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="number"
                              min={0}
                              step={1}
                              className="vk-target-input-shift"
                              value={targets[1] === 0 ? '' : targets[1]}
                              placeholder="0"
                              onChange={(e) => handleTempTargetChange(job.id, 1, e.target.value)}
                            />
                          </td>

                          {/* Input กะดึก */}
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="number"
                              min={0}
                              step={1}
                              className="vk-target-input-shift"
                              value={targets[2] === 0 ? '' : targets[2]}
                              placeholder="0"
                              onChange={(e) => handleTempTargetChange(job.id, 2, e.target.value)}
                            />
                          </td>

                          {/* รวมวันนี้ */}
                          <td style={{ textAlign: 'center', fontFamily: 'var(--vk-mono)', fontWeight: 800, fontSize: 13, color: isZero ? 'var(--vk-ink-3)' : '#15803d' }}>
                            {todaySum} คน
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Modal Footer */}
            <div className="vk-modal-bottom-actions">
              <button
                type="button"
                className="vk-btn vk-btn-secondary"
                onClick={() => setIsTargetModalOpen(false)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="vk-btn vk-btn-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                onClick={handleSaveDailyTargets}
              >
                <CheckSquare style={{ width: 14, height: 14 }} />
                บันทึกและนำไปใช้ในการจัดกะ (รวม {modalGrandTotal} คน)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Daily Attendance Modal (Absent / Leave / Late) */}
      <AttendanceModal
        isOpen={isAttendanceModalOpen}
        onClose={() => setIsAttendanceModalOpen(false)}
        factoryId={user?.factory_id || ''}
        workDate={activeDateStr}
        employees={employees}
        onChanged={() => {
          refetchAttendance()
        }}
      />
    </>
  )
}

export default TpiShiftEntry
