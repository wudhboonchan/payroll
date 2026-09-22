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
  Calendar,
  Check,
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
  getShiftOtTimeRange,
} from '../features/tpi/model'
import { getMainDepartment, cleanJobNotes } from '../features/tpi/referenceJobs'
import { employeeWageForm } from '../features/tpi/employeeWageForm'
import { demoJobs, demoEmployees, demoWageProfiles, demoInitialEntries } from '../features/tpi/demoData'
import { loadDay, saveDay, preassignShifts, errorMessage } from '../features/tpi/api'
import { formatThaiBuddhistDate, compareEmployeeCode, formatPeriodLabel, filterActivePeriods } from '../lib/formatters'
import { ThaiDatePicker } from '../components/common/ThaiDatePicker'
import type { SafetyIncident } from '../features/tpi/safetyFines'
import {
  groupSafetyAdvancesToIncidents,
  formatIsoToThaiDate,
  formatSafetyFineNote,
  calculateFineInstallments,
} from '../features/tpi/safetyFines'
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
  const { data: rawPeriods = [] } = useQuery<Period[]>({
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

  const periods = useMemo(() => filterActivePeriods(rawPeriods), [rawPeriods])
  const currentPeriod = periods[0] || null

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
    try {
      const savedDate = localStorage.getItem('tpi_selected_date')
      if (savedDate) return parseLocal(savedDate)
    } catch {}
    const initialPeriod = currentPeriod
    return getValidDateForPeriod(null, initialPeriod || null)
  })

  const handleSelectDate = (d: Date) => {
    setCurrentDate(d)
    try {
      localStorage.setItem('tpi_selected_date', fmtDate(d))
    } catch {}
  }

  // Whenever currentPeriod updates or loads, clamp currentDate strictly into the period
  useEffect(() => {
    if (!currentPeriod) return
    setCurrentDate((prev) => {
      const valid = getValidDateForPeriod(prev, currentPeriod)
      try {
        localStorage.setItem('tpi_selected_date', fmtDate(valid))
      } catch {}
      return valid
    })
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
    handleSelectDate(d)
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

  // Pre-assign shifts to other dates in the period
  const [isPreassignModalOpen, setIsPreassignModalOpen] = useState(false)
  const [preassignSelectedEmpIds, setPreassignSelectedEmpIds] = useState<Set<string>>(new Set())
  const [preassignTargetDates, setPreassignTargetDates] = useState<Set<string>>(new Set())
  const [isPreassignSubmitting, setIsPreassignSubmitting] = useState(false)
  const [preassignEmpSearch, setPreassignEmpSearch] = useState('')

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
          .select('employee_id, shift_index, job_id, rate_tier, rate_snapshot, job_code_snapshot, is_half_shift, actual_hours, ot_hours, ot_pay, is_holiday_ot, is_ot_before_shift, ot_job_id, ot_job_code_snapshot, is_pending')
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
  const [modalShift1OtBeforeShift, setModalShift1OtBeforeShift] = useState<boolean>(false)
  const [modalShift1OtJobId, setModalShift1OtJobId] = useState<string>('')
  const [modalHasShift2, setModalHasShift2] = useState<boolean>(false)
  const [modalShift2JobId, setModalShift2JobId] = useState<string>('')
  const [modalShift2Index, setModalShift2Index] = useState<number>(1)
  const [modalShift2IsHalf, setModalShift2IsHalf] = useState<boolean>(false)
  const [modalShift2HasOt, setModalShift2HasOt] = useState<boolean>(false)
  const [modalShift2OtHours, setModalShift2OtHours] = useState<number>(1)

  // ── Modal State for จป. & HR Disciplinary Fine & Incident ─────────
  const [modalSafetyFineEnabled, setModalSafetyFineEnabled] = useState<boolean>(false)
  const [modalSafetyFineDate, setModalSafetyFineDate] = useState<string>('')
  const [modalSafetyFineReason, setModalSafetyFineReason] = useState<string>('')
  const [modalSafetyFineSafetyAmount, setModalSafetyFineSafetyAmount] = useState<number>(1000)
  const [modalSafetyFineIncludeHr, setModalSafetyFineIncludeHr] = useState<boolean>(false)
  const [modalSafetyFineShiftRate, setModalSafetyFineShiftRate] = useState<number>(357)
  const [modalSafetyFineSubmitting, setModalSafetyFineSubmitting] = useState<boolean>(false)
  const [editingIncident, setEditingIncident] = useState<SafetyIncident | null>(null)

  // Confirm delete safety incident modal state
  const [deleteIncidentTarget, setDeleteIncidentTarget] = useState<SafetyIncident | null>(null)
  const [isDeletingIncident, setIsDeletingIncident] = useState<boolean>(false)

  const hrFineAmount = useMemo(() => {
    return modalSafetyFineIncludeHr ? Math.round(modalSafetyFineShiftRate * 3 * 100) / 100 : 0
  }, [modalSafetyFineIncludeHr, modalSafetyFineShiftRate])

  const totalFineAmount = useMemo(() => {
    return Math.round(((modalSafetyFineSafetyAmount || 0) + hrFineAmount) * 100) / 100
  }, [modalSafetyFineSafetyAmount, hrFineAmount])

  const fineInstallments = useMemo(() => {
    return calculateFineInstallments(totalFineAmount)
  }, [totalFineAmount])

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

  // Group daily entries by unique employee for Preassign Modal (one card per employee)
  const preassignUniqueEmployees = useMemo(() => {
    const map = new Map<string, { emp: Employee | undefined; entries: Entry[] }>()
    for (const entry of entries) {
      if (!map.has(entry.employee_id)) {
        map.set(entry.employee_id, {
          emp: empMap.get(entry.employee_id),
          entries: [],
        })
      }
      map.get(entry.employee_id)!.entries.push(entry)
    }
    return Array.from(map.entries())
      .map(([empId, data]) => ({
        empId,
        emp: data.emp,
        entries: data.entries.sort((a, b) => a.shift_index - b.shift_index),
      }))
      .sort((a, b) => compareEmployeeCode(a.emp?.employee_code, b.emp?.employee_code))
  }, [entries, empMap])

  const filteredPreassignEmployees = useMemo(() => {
    const term = preassignEmpSearch.toLowerCase().trim()
    if (!term) return preassignUniqueEmployees
    return preassignUniqueEmployees.filter(({ empId, emp, entries: empEntries }) => {
      const code = (emp?.employee_code || '').toLowerCase()
      const firstName = (emp?.first_name || '').toLowerCase()
      const lastName = (emp?.last_name || '').toLowerCase()
      const fullName = `${firstName} ${lastName}`.trim()
      const altFullName = `${firstName}${lastName}`.trim()
      const nationality = (emp?.nationality || '').toLowerCase()
      const id = empId.toLowerCase()
      const jobCodes = empEntries
        .map((e) => {
          const j = jobs.find((x) => x.id === e.job_id) || demoJobs.find((x) => x.id === e.job_id)
          return j?.code || e.job_code_snapshot || ''
        })
        .join(' ')
        .toLowerCase()

      return (
        code.includes(term) ||
        firstName.includes(term) ||
        lastName.includes(term) ||
        fullName.includes(term) ||
        altFullName.includes(term) ||
        nationality.includes(term) ||
        id.includes(term) ||
        jobCodes.includes(term)
      )
    })
  }, [preassignUniqueEmployees, preassignEmpSearch, jobs])

  const isAllFilteredPreassignSelected = useMemo(() => {
    if (filteredPreassignEmployees.length === 0) return false
    return filteredPreassignEmployees.every((u) => preassignSelectedEmpIds.has(u.empId))
  }, [filteredPreassignEmployees, preassignSelectedEmpIds])

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
    const defaultOtHours = 1

    if (empEntries.length === 0) {
      setModalShift1JobId(defaultJobId)
      setModalShift1Index(0)
      setModalShift1IsHalf(false)
      setModalShift1HasOt(false)
      setModalShift1OtHours(defaultOtHours)
      setModalShift1OtBeforeShift(false)
      setModalShift1OtJobId(defaultJobId)
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
      setModalShift1HasOt(!!(s1.ot_hours && s1.ot_hours > 0))
      setModalShift1OtHours(s1.ot_hours || defaultOtHours)
      setModalShift1OtBeforeShift(!!s1.is_ot_before_shift)
      setModalShift1OtJobId(s1.ot_job_id || s1.job_id || defaultJobId)
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
      // 2 shifts (16h) cannot do OT
      setModalShift1HasOt(false)
      setModalShift1OtHours(defaultOtHours)
      setModalShift1OtBeforeShift(false)
      setModalShift1OtJobId(s1.ot_job_id || s1.job_id || defaultJobId)
      setModalHasShift2(true)
      setModalShift2JobId(s2.job_id)
      setModalShift2Index(s2.shift_index)
      setModalShift2IsHalf(!!s2.is_half_shift)
      setModalShift2HasOt(false)
      setModalShift2OtHours(defaultOtHours)
    }
    const prof = wageProfiles.find((p) => p.employee_id === emp.id)
    const isSkilled = prof?.rate_tier === 'skilled'
    const s1Job = empEntries[0] ? jobs.find((j) => j.id === empEntries[0].job_id) : (availableJobs[0] || jobs[0])
    const defaultShiftRate = isSkilled
      ? (s1Job?.skilled_rate ?? (prof?.daily_rate && prof.daily_rate > 357 ? prof.daily_rate : 377))
      : (s1Job?.normal_rate ?? 357)
    // Check existing safety fine incidents for this worker
    const empAdvances = allSafetyAdvances.filter((a) => a.employee_id === emp.id)
    const empIncidents = groupSafetyAdvancesToIncidents(empAdvances, currentPeriod?.id)

    if (empIncidents.length > 0) {
      const activeInc = empIncidents[0]
      setEditingIncident(activeInc)
      setModalSafetyFineEnabled(true)
      setModalSafetyFineDate(activeInc.incidentDate || activeDateStr)
      setModalSafetyFineReason(activeInc.reason)
      setModalSafetyFineSafetyAmount(activeInc.safetyAmount)
      setModalSafetyFineIncludeHr(activeInc.includeHr)
      setModalSafetyFineShiftRate(activeInc.shiftRate || defaultShiftRate)
    } else {
      setEditingIncident(null)
      setModalSafetyFineShiftRate(defaultShiftRate)
      setModalSafetyFineSafetyAmount(1000)
      setModalSafetyFineIncludeHr(false)
      setModalSafetyFineEnabled(false)
      setModalSafetyFineDate(activeDateStr)
      setModalSafetyFineReason('')
    }
    setModalEmp(emp)
  }

  const handleLoadIncidentForEdit = (inc: SafetyIncident) => {
    setEditingIncident(inc)
    setModalSafetyFineEnabled(true)
    setModalSafetyFineDate(inc.incidentDate || activeDateStr)
    setModalSafetyFineReason(inc.reason)
    setModalSafetyFineSafetyAmount(inc.safetyAmount)
    setModalSafetyFineIncludeHr(inc.includeHr)
    if (inc.shiftRate) {
      setModalSafetyFineShiftRate(inc.shiftRate)
    }
  }

  const handleStartNewIncident = (defaultRate: number) => {
    setEditingIncident(null)
    setModalSafetyFineEnabled(true)
    setModalSafetyFineDate(activeDateStr)
    setModalSafetyFineReason('')
    setModalSafetyFineSafetyAmount(1000)
    setModalSafetyFineIncludeHr(false)
    setModalSafetyFineShiftRate(defaultRate)
  }

  const handleConfirmDeleteIncident = async () => {
    if (!deleteIncidentTarget) return
    setIsDeletingIncident(true)
    try {
      const { error } = await supabase
        .from('advance_payments')
        .delete()
        .in('id', deleteIncidentTarget.rowIds)
      if (error) throw error
      toast.success(`ลบรายการค่าปรับสำเร็จ (ทั้งหมด ${deleteIncidentTarget.installments.length} งวด)`)
      queryClient.invalidateQueries({ queryKey: ['all-safety-advances'] })
      queryClient.invalidateQueries({ queryKey: ['tpi-advances'] })
      queryClient.invalidateQueries({ queryKey: ['advances'] })
      queryClient.invalidateQueries({ queryKey: ['advances-v2'] })
      queryClient.invalidateQueries({ queryKey: ['payslip-advances'] })
      queryClient.invalidateQueries({ queryKey: ['all-payroll-entries'] })

      if (editingIncident?.id === deleteIncidentTarget.id) {
        setEditingIncident(null)
        setModalSafetyFineEnabled(false)
        setModalSafetyFineReason('')
      }
      setDeleteIncidentTarget(null)
    } catch (e: any) {
      toast.error('ลบรายการไม่สำเร็จ: ' + (e?.message || ''))
    } finally {
      setIsDeletingIncident(false)
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
    if (totalFineAmount <= 0) {
      toast.error('ยอดค่าปรับต้องมากกว่า 0 บาท')
      return
    }

    setModalSafetyFineSubmitting(true)
    try {
      const incidentDate = modalSafetyFineDate || activeDateStr
      const thDateStr = formatIsoToThaiDate(incidentDate)

      const installments = fineInstallments
      const totalSteps = installments.length

      // Only link to periods that actually exist in the database; NEVER auto-insert future payroll_periods
      const allSorted = [...periods].sort((a, b) => a.period_start.localeCompare(b.period_start))
      const currIdx = allSorted.findIndex((p) => p.id === currentPeriod.id)
      const targetPeriodIds: (string | null)[] = [currentPeriod.id]

      for (let i = 1; i < totalSteps; i++) {
        if (currIdx >= 0 && currIdx + i < allSorted.length) {
          targetPeriodIds.push(allSorted[currIdx + i].id)
        } else {
          targetPeriodIds.push(null)
        }
      }

      // If updating an existing incident, delete its previous installment rows first
      if (editingIncident && editingIncident.rowIds.length > 0) {
        const { error: delOldErr } = await supabase
          .from('advance_payments')
          .delete()
          .in('id', editingIncident.rowIds)
        if (delOldErr) throw delOldErr
      }

      const caseId = editingIncident?.id || `case_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

      // Insert installments for existing periods only (never forge fake future payroll periods)
      const insertRows = installments
        .map((amt, idx) => {
          const step = idx + 1
          const targetPeriodId = targetPeriodIds[idx]
          // If future period does not exist yet in database, only record installment 1 for current period
          if (!targetPeriodId && idx > 0) return null

          const note = formatSafetyFineNote({
            caseId,
            thDateStr,
            step,
            totalSteps,
            reason: modalSafetyFineReason,
            totalAmount: totalFineAmount,
            safetyAmount: modalSafetyFineSafetyAmount,
            includeHr: modalSafetyFineIncludeHr,
            hrAmount: hrFineAmount,
            shiftRate: modalSafetyFineShiftRate,
            installmentAmount: amt,
          })
          return {
            period_id: targetPeriodId || currentPeriod.id,
            employee_id: modalEmp.id,
            amount: amt,
            notes: note,
            is_carryover: false,
          }
        })
        .filter(Boolean) as any[]

      const { error: insErr } = await supabase.from('advance_payments').insert(insertRows)
      if (insErr) throw insErr

      toast.success(
        editingIncident
          ? `อัปเดตรายการค่าปรับสำเร็จ ยอดรวม ฿${totalFineAmount.toLocaleString()} แบ่งผ่อน ${totalSteps} งวด`
          : `บันทึกค่าปรับสำเร็จ ยอดรวม ฿${totalFineAmount.toLocaleString()} แบ่งผ่อน ${totalSteps} งวด (งวดแรก ฿${installments[0].toLocaleString()}${totalSteps > 1 ? `, งวดสุดท้าย ฿${installments[totalSteps - 1].toLocaleString()}` : ''})`
      )

      queryClient.invalidateQueries({ queryKey: ['all-safety-advances'] })
      queryClient.invalidateQueries({ queryKey: ['tpi-advances'] })
      queryClient.invalidateQueries({ queryKey: ['advances'] })
      queryClient.invalidateQueries({ queryKey: ['advances-v2'] })
      queryClient.invalidateQueries({ queryKey: ['payslip-advances'] })
      queryClient.invalidateQueries({ queryKey: ['all-payroll-entries'] })
      queryClient.invalidateQueries({ queryKey: ['periods'] })
      setEditingIncident(null)
      setModalSafetyFineEnabled(false)
      setModalSafetyFineReason('')
    } catch (err: any) {
      toast.error('บันทึกค่าปรับไม่สำเร็จ: ' + (err?.message || ''))
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

    const otJobId = modalShift1HasOt ? (modalShift1OtJobId || modalShift1JobId) : null
    const otJob = otJobId ? jobs.find((j) => j.id === otJobId) : undefined
    const otTier = wageTier(wageProfiles.find((p) => p.employee_id === modalEmp.id), activeDateStr)
    const isClerkOt = isClerkJob(otJob)
    const otBaseRate = isClerkOt
      ? (otTier === 'skilled' ? (otJob?.skilled_rate ?? 377) : (otJob?.normal_rate ?? 357))
      : ((otTier === 'skilled' && otJob?.skilled_rate) ? otJob.skilled_rate : (otJob?.normal_rate || 357))

    const ot1 = (!modalHasShift2 && modalShift1HasOt) ? calculateEntryOt(modalShift1OtHours, otBaseRate) : { ot_hours: 0, ot_pay: 0 }

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
        is_ot_before_shift: (!modalHasShift2 && modalShift1HasOt) ? modalShift1OtBeforeShift : false,
        ot_job_id: (!modalHasShift2 && modalShift1HasOt) ? (otJobId || null) : null,
        ot_job_code_snapshot: (!modalHasShift2 && modalShift1HasOt) ? (otJob?.code || null) : null,
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

      newEmpEntries.push({
        employee_id: modalEmp.id,
        job_id: modalShift2JobId,
        shift_index: modalShift2Index,
        is_half_shift: modalShift2IsHalf,
        actual_hours: modalShift2IsHalf ? 4 : 8,
        ot_hours: 0,
        ot_pay: 0,
        is_ot_before_shift: false,
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

  const handleConfirmPending = (empId: string, jobId: string, shiftIndex: number) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.employee_id === empId && e.job_id === jobId && e.shift_index === shiftIndex
          ? { ...e, is_pending: false }
          : e
      )
    )
    const emp = empMap.get(empId)
    toast.success(`✓ ยืนยันการเข้างานของ ${emp ? `${emp.first_name} ${emp.last_name}` : 'พนักงาน'} แล้ว`)
  }

  const handleConfirmAllPending = async () => {
    const pendingCount = entries.filter((e) => !!e.is_pending).length
    if (pendingCount === 0) return

    const updatedEntries = entries.map((e) => (e.is_pending ? { ...e, is_pending: false } : e))
    setEntries(updatedEntries)

    if (!user?.factory_id || preview) {
      toast.success(`✓ ยืนยันการเข้างานพนักงานทั้งหมด ${pendingCount} คนเรียบร้อย`)
      return
    }

    try {
      const validEntries = await ensureValidJobUuids(updatedEntries, user.factory_id, jobs)
      const nextRev = await saveDay(user.factory_id, activeDateStr, {
        revision: dayRevision,
        is_holiday: isHoliday,
        entries: validEntries.map((e) => ({ ...e, is_holiday_ot: isHoliday })),
      })
      setDayRevision(nextRev)
      queryClient.invalidateQueries({ queryKey: ['tpi-shift-day', user.factory_id, activeDateStr] })
      queryClient.invalidateQueries({ queryKey: ['all-tpi-period-shifts'] })
      queryClient.invalidateQueries({ queryKey: ['summary-all-shifts'] })
      toast.success(`✓ ยืนยันและบันทึกการเข้างานพนักงานทั้งหมด ${pendingCount} คนเรียบร้อย`)
    } catch (err: any) {
      console.error('Confirm all pending error:', err)
      toast.error('ยืนยันไม่สำเร็จ', { description: errorMessage(err) })
    }
  }

  const handleOpenPreassignModal = () => {
    if (entries.length === 0) {
      toast.warning('ไม่พบข้อมูลการจัดกะในวันนี้', {
        description: 'กรุณาจัดกะในวันนี้ก่อน จึงจะสามารถคัดลอกหรือจัดกะล่วงหน้าไปวันอื่นๆ ได้',
      })
      return
    }
    setPreassignSelectedEmpIds(new Set())
    setPreassignTargetDates(new Set())
    setPreassignEmpSearch('')
    setIsPreassignModalOpen(true)
  }

  const handleConfirmPreassign = async () => {
    if (preassignSelectedEmpIds.size === 0) {
      toast.error('กรุณาเลือกพนักงานอย่างน้อย 1 คน')
      return
    }
    if (preassignTargetDates.size === 0) {
      toast.error('กรุณาเลือกวันที่ต้องการจัดกะล่วงหน้าอย่างน้อย 1 วัน')
      return
    }

    const selectedEntries = entries.filter((e) =>
      preassignSelectedEmpIds.has(e.employee_id)
    )
    if (selectedEntries.length === 0) return

    setIsPreassignSubmitting(true)
    try {
      if (!user?.factory_id || preview) {
        toast.info('โหมดตัวอย่าง: จำลองการจัดกะล่วงหน้าเรียบร้อย')
        setIsPreassignModalOpen(false)
        return
      }

      const validEntries = await ensureValidJobUuids(selectedEntries, user.factory_id, jobs)
      await preassignShifts(user.factory_id, Array.from(preassignTargetDates), validEntries)

      await queryClient.invalidateQueries({ queryKey: ['tpi-shift-day'] })
      await queryClient.invalidateQueries({ queryKey: ['all-tpi-period-shifts'] })
      await queryClient.invalidateQueries({ queryKey: ['summary-all-shifts'] })

      toast.success(
        `✓ จัดกะล่วงหน้าให้พนักงาน ${preassignSelectedEmpIds.size} คน (${selectedEntries.length} กะ) ไปยัง ${preassignTargetDates.size} วันเรียบร้อยแล้ว`,
        { description: 'พนักงานจะมีสถานะ "รอยืนยัน" ในวันที่ถูกจัดกะ' }
      )
      setIsPreassignModalOpen(false)
    } catch (err: any) {
      console.error('Preassign error:', err)
      toast.error('จัดกะล่วงหน้าไม่สำเร็จ', { description: errorMessage(err) })
    } finally {
      setIsPreassignSubmitting(false)
    }
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
      const isAnyPending = empDoubleEntries.some((e) => !!e.is_pending)

      const handleConfirmDouble = (e: React.MouseEvent) => {
        e.stopPropagation()
        setEntries((prev) =>
          prev.map((entry) =>
            entry.employee_id === empId && entry.job_id === jobId
              ? { ...entry, is_pending: false }
              : entry
          )
        )
        toast.success(`✓ ยืนยันการเข้างานของ ${emp.first_name} ${emp.last_name} แล้ว`)
      }

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
            style={isAnyPending ? { borderLeft: '3px solid #10b981', background: '#f0fdf4' } : undefined}
            onClick={() => openEmployeeModal(emp)}
            title={isAnyPending ? 'รอยืนยันเข้างาน (คลิกเพื่อแก้ไขการจัดกะ)' : 'คลิกเพื่อแก้ไขการจัดกะ'}
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
                {isAnyPending && (
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: 999,
                      background: 'rgba(0,120,80,0.1)',
                      color: '#065f46',
                      border: '1px solid rgba(0,120,80,0.25)',
                      letterSpacing: '0.04em',
                      flexShrink: 0,
                    }}
                    title="จัดกะล่วงหน้ามา - รอยืนยันเข้างาน"
                  >
                    รอยืนยัน
                  </span>
                )}
                <span className="vk-double-badge">ควบกะเช้า + กะบ่าย</span>
                {hasHalf && <span className="vk-tpi-wp-half">ครึ่งกะ</span>}
                {hasOt && (
                  <span className="vk-tpi-wp-ot">
                    OT {totalOtHrs} ชม.
                  </span>
                )}
              </div>
              <div className="vk-tpi-double-line2">
                <span className="vk-double-code">{emp.employee_code}</span>
              </div>
            </div>
            <div className="vk-tpi-double-right">
              {isAnyPending && (
                <button
                  type="button"
                  onClick={handleConfirmDouble}
                  title="ยืนยันเข้างาน"
                  style={{
                    background: 'rgba(0,120,80,0.12)',
                    border: '1px solid rgba(0,120,80,0.3)',
                    cursor: 'pointer',
                    color: '#065f46',
                    padding: '2px 7px',
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 4,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#059669'
                    e.currentTarget.style.color = '#ffffff'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(0,120,80,0.12)'
                    e.currentTarget.style.color = '#065f46'
                  }}
                >
                  ✓
                </button>
              )}
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
            style={isAnyPending ? { borderLeft: '3px solid #10b981', background: '#f0fdf4' } : undefined}
            onClick={() => openEmployeeModal(emp)}
            title={isAnyPending ? 'รอยืนยันเข้างาน (คลิกเพื่อแก้ไขการจัดกะ)' : 'คลิกเพื่อแก้ไขการจัดกะ'}
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
                {isAnyPending && (
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: 999,
                      background: 'rgba(0,120,80,0.1)',
                      color: '#065f46',
                      border: '1px solid rgba(0,120,80,0.25)',
                      letterSpacing: '0.04em',
                      flexShrink: 0,
                    }}
                    title="จัดกะล่วงหน้ามา - รอยืนยันเข้างาน"
                  >
                    รอยืนยัน
                  </span>
                )}
                <span className="vk-double-badge">ควบกะบ่าย + กะดึก</span>
                {hasHalf && <span className="vk-tpi-wp-half">ครึ่งกะ</span>}
                {hasOt && (
                  <span className="vk-tpi-wp-ot">
                    OT {totalOtHrs} ชม.
                  </span>
                )}
              </div>
              <div className="vk-tpi-double-line2">
                <span className="vk-double-code">{emp.employee_code}</span>
              </div>
            </div>
            <div className="vk-tpi-double-right">
              {isAnyPending && (
                <button
                  type="button"
                  onClick={handleConfirmDouble}
                  title="ยืนยันเข้างาน"
                  style={{
                    background: 'rgba(0,120,80,0.12)',
                    border: '1px solid rgba(0,120,80,0.3)',
                    cursor: 'pointer',
                    color: '#065f46',
                    padding: '2px 7px',
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 4,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#059669'
                    e.currentTarget.style.color = '#ffffff'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(0,120,80,0.12)'
                    e.currentTarget.style.color = '#065f46'
                  }}
                >
                  ✓
                </button>
              )}
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
            style={isAnyPending ? { borderLeft: '3px solid #10b981', background: '#f0fdf4' } : undefined}
            onClick={() => openEmployeeModal(emp)}
            title={isAnyPending ? 'รอยืนยันเข้างาน (คลิกเพื่อแก้ไขการจัดกะ)' : 'คลิกเพื่อแก้ไขการจัดกะ'}
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
                {isAnyPending && (
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: 999,
                      background: 'rgba(0,120,80,0.1)',
                      color: '#065f46',
                      border: '1px solid rgba(0,120,80,0.25)',
                      letterSpacing: '0.04em',
                      flexShrink: 0,
                    }}
                    title="จัดกะล่วงหน้ามา - รอยืนยันเข้างาน"
                  >
                    รอยืนยัน
                  </span>
                )}
                <span className="vk-double-badge">ควบเช้า + ดึก</span>
                {hasHalf && <span className="vk-tpi-wp-half">ครึ่งกะ</span>}
                {hasOt && (
                  <span className="vk-tpi-wp-ot">
                    OT {totalOtHrs} ชม.
                  </span>
                )}
              </div>
              <div className="vk-tpi-double-line2">
                <span className="vk-double-code">{emp.employee_code} · กะเช้า</span>
              </div>
            </div>
            <div className="vk-tpi-double-right">
              {isAnyPending && (
                <button
                  type="button"
                  onClick={handleConfirmDouble}
                  title="ยืนยันเข้างาน"
                  style={{
                    background: 'rgba(0,120,80,0.12)',
                    border: '1px solid rgba(0,120,80,0.3)',
                    cursor: 'pointer',
                    color: '#065f46',
                    padding: '2px 7px',
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 4,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#059669'
                    e.currentTarget.style.color = '#ffffff'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(0,120,80,0.12)'
                    e.currentTarget.style.color = '#065f46'
                  }}
                >
                  ✓
                </button>
              )}
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
            style={isAnyPending ? { borderLeft: '3px solid #10b981', background: '#f0fdf4' } : undefined}
            onClick={() => openEmployeeModal(emp)}
            title={isAnyPending ? 'รอยืนยันเข้างาน (คลิกเพื่อแก้ไขการจัดกะ)' : 'คลิกเพื่อแก้ไขการจัดกะ'}
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
                {isAnyPending && (
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: 999,
                      background: 'rgba(0,120,80,0.1)',
                      color: '#065f46',
                      border: '1px solid rgba(0,120,80,0.25)',
                      letterSpacing: '0.04em',
                      flexShrink: 0,
                    }}
                    title="จัดกะล่วงหน้ามา - รอยืนยันเข้างาน"
                  >
                    รอยืนยัน
                  </span>
                )}
                <span className="vk-double-badge">ควบเช้า + ดึก</span>
                {hasHalf && <span className="vk-tpi-wp-half">ครึ่งกะ</span>}
                {hasOt && (
                  <span className="vk-tpi-wp-ot">
                    OT {totalOtHrs} ชม.
                  </span>
                )}
              </div>
              <div className="vk-tpi-double-line2">
                <span className="vk-double-code">{emp.employee_code} · กะดึก</span>
              </div>
            </div>
            <div className="vk-tpi-double-right">
              {isAnyPending && (
                <button
                  type="button"
                  onClick={handleConfirmDouble}
                  title="ยืนยันเข้างาน"
                  style={{
                    background: 'rgba(0,120,80,0.12)',
                    border: '1px solid rgba(0,120,80,0.3)',
                    cursor: 'pointer',
                    color: '#065f46',
                    padding: '2px 7px',
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 4,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#059669'
                    e.currentTarget.style.color = '#ffffff'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(0,120,80,0.12)'
                    e.currentTarget.style.color = '#065f46'
                  }}
                >
                  ✓
                </button>
              )}
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
      queryClient.invalidateQueries({ queryKey: ['tpi-shift-days-period'] })
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, position: 'relative' }}>
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
                handleSelectDate(parseLocal(e.target.value))
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
              className="vk-btn vk-btn-secondary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                background: '#ffffff',
                borderColor: 'var(--vk-rule-soft)',
                color: 'var(--vk-ink-2)',
              }}
              onClick={handleOpenPreassignModal}
              title="คัดลอกหรือจัดกะล่วงหน้าให้พนักงานในวันนี้ไปวันอื่นๆ ในงวด"
            >
              <Calendar style={{ width: 14, height: 14, color: '#059669' }} />
              จัดกะล่วงหน้าไปวันอื่น
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

      {/* Pending Attendance Confirmation Banner (DRT Pattern) */}
      {entries.some((e) => !!e.is_pending) && (
        <div
          style={{
            margin: '10px 16px 0',
            padding: '10px 18px',
            borderRadius: 8,
            background: 'linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%)',
            border: '1px solid #a7f3d0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            boxShadow: '0 1px 3px rgba(16,185,129,0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>📋</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#065f46' }}>
                มีพนักงานรอยืนยันเข้างานในวันนี้ {entries.filter((e) => !!e.is_pending).length} คน
              </div>
              <div style={{ fontSize: 12, color: '#047857', marginTop: 1 }}>
                พนักงานถูกจัดกะล่วงหน้ามาจากวันอื่น กรุณากดปุ่ม [✓] สีเขียวที่รายชื่อพนักงาน หรือกดยืนยันทั้งหมด
              </div>
            </div>
          </div>
          <button
            type="button"
            className="vk-btn"
            onClick={handleConfirmAllPending}
            style={{
              background: '#059669',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: 13,
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              boxShadow: '0 1px 2px rgba(5,150,105,0.2)',
            }}
            title="ยืนยันการเข้างานของพนักงานรอยืนยันทั้งหมดในวันนี้และบันทึกข้อมูล"
          >
            <Check style={{ width: 15, height: 15 }} />
            ✓ ยืนยันพนักงานทั้งหมด ({entries.filter((e) => !!e.is_pending).length} คน)
          </button>
        </div>
      )}

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
                            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#fef2f2', color: '#b91c1c', border: '1px solid #fca5a5' }} title="มีบันทึกค่าปรับผิดระเบียบ จป. ในงวดนี้">
                              ปรับ จป.
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
                                          style={entry.is_pending ? { borderLeft: '3px solid #10b981', background: '#f0fdf4' } : undefined}
                                          draggable={!isPaused}
                                          onDragStart={(e) => handleDragStartFromCell(e, emp.id, job.id, shiftIndex)}
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            openEmployeeModal(emp)
                                          }}
                                          title={entry.is_pending ? 'พนักงานรอยืนยันเข้างาน (คลิกเพื่อจัดการกะ)' : 'คลิกเพื่อจัดการกะ หรือเพิ่มกะที่ 2'}
                                        >
                                          <div className="vk-tpi-worker-pill-main">
                                            <div className="vk-tpi-worker-pill-line1">
                                              <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, gap: 3 }}>
                                                <span className="vk-tpi-wp-name">
                                                  {emp.first_name} {emp.last_name}
                                                </span>
                                                {isSkilledWorker(emp.id) && <span title="พนักงานค่าแรงฝีมือ" style={{ flexShrink: 0, fontSize: 11 }}>⭐</span>}
                                              </div>
                                              {entry.is_pending && (
                                                <span
                                                  style={{
                                                    fontSize: 9,
                                                    fontWeight: 700,
                                                    padding: '1px 6px',
                                                    borderRadius: 999,
                                                    background: 'rgba(0,120,80,0.1)',
                                                    color: '#065f46',
                                                    border: '1px solid rgba(0,120,80,0.25)',
                                                    letterSpacing: '0.04em',
                                                    flexShrink: 0,
                                                  }}
                                                  title="จัดกะล่วงหน้ามา - รอยืนยันเข้างาน"
                                                >
                                                  รอยืนยัน
                                                </span>
                                              )}
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
                                                <span
                                                  className="vk-tpi-wp-ot"
                                                  title={`OT ${entry.is_ot_before_shift ? "ก่อนเข้ากะ " : "หลังเลิกกะ "}${entry.ot_hours} ชม. ${entry.ot_job_code_snapshot && entry.ot_job_code_snapshot !== entry.job_code_snapshot ? `(รหัสงาน OT: ${entry.ot_job_code_snapshot}) ` : ""}(${getShiftOtTimeRange(entry.shift_index, entry.ot_hours || 0, !!entry.is_ot_before_shift)}) 1.5 เท่า`}
                                                >
                                                  OT {entry.is_ot_before_shift ? "ก่อนกะ " : ""}{entry.ot_hours} ชม.
                                                  {entry.ot_job_code_snapshot && entry.ot_job_code_snapshot !== entry.job_code_snapshot && (
                                                    <span style={{ fontSize: 9, opacity: 0.9, marginLeft: 3, fontWeight: 700 }}>[{entry.ot_job_code_snapshot}]</span>
                                                  )}
                                                </span>
                                              )}
                                              {allSafetyAdvances.some(a => a.employee_id === emp.id && a.period_id === currentPeriod?.id) && (
                                                <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#fef2f2', color: '#b91c1c', border: '1px solid #fca5a5' }} title="มีบันทึกค่าปรับผิดระเบียบ จป. ในงวดนี้">
                                                  ปรับ จป.
                                                </span>
                                              )}
                                            </div>
                                            <div className="vk-tpi-worker-pill-line2">
                                              <span className="vk-tpi-wp-code">{emp.employee_code}</span>
                                            </div>
                                          </div>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                            {entry.is_pending && (
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  handleConfirmPending(emp.id, job.id, shiftIndex)
                                                }}
                                                title="ยืนยันเข้างาน"
                                                style={{
                                                  background: 'rgba(0,120,80,0.12)',
                                                  border: '1px solid rgba(0,120,80,0.3)',
                                                  cursor: 'pointer',
                                                  color: '#065f46',
                                                  padding: '2px 7px',
                                                  borderRadius: 4,
                                                  fontSize: 12,
                                                  fontWeight: 700,
                                                  display: 'flex',
                                                  alignItems: 'center',
                                                  justifyContent: 'center',
                                                  transition: 'all 0.15s ease',
                                                }}
                                                onMouseEnter={(e) => {
                                                  e.currentTarget.style.background = '#059669'
                                                  e.currentTarget.style.color = '#ffffff'
                                                }}
                                                onMouseLeave={(e) => {
                                                  e.currentTarget.style.background = 'rgba(0,120,80,0.12)'
                                                  e.currentTarget.style.color = '#065f46'
                                                }}
                                              >
                                                ✓
                                              </button>
                                            )}
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
                                          style={entry.is_pending ? { borderLeft: '3px solid #10b981', background: '#f0fdf4' } : undefined}
                                          draggable={!isPaused}
                                          onDragStart={(e) => handleDragStartFromCell(e, emp.id, job.id, shiftIndex)}
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            openEmployeeModal(emp)
                                          }}
                                          title={entry.is_pending ? 'พนักงานรอยืนยันเข้างาน (คลิกเพื่อจัดการกะ)' : 'คลิกเพื่อจัดการกะ หรือเพิ่มกะที่ 2'}
                                        >
                                          <div className="vk-tpi-worker-pill-main">
                                            <div className="vk-tpi-worker-pill-line1">
                                              <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, gap: 3 }}>
                                                <span className="vk-tpi-wp-name">
                                                  {emp.first_name} {emp.last_name}
                                                </span>
                                                {isSkilledWorker(emp.id) && <span title="พนักงานค่าแรงฝีมือ" style={{ flexShrink: 0, fontSize: 11 }}>⭐</span>}
                                              </div>
                                              {entry.is_pending && (
                                                <span
                                                  style={{
                                                    fontSize: 9,
                                                    fontWeight: 700,
                                                    padding: '1px 6px',
                                                    borderRadius: 999,
                                                    background: 'rgba(0,120,80,0.1)',
                                                    color: '#065f46',
                                                    border: '1px solid rgba(0,120,80,0.25)',
                                                    letterSpacing: '0.04em',
                                                    flexShrink: 0,
                                                  }}
                                                  title="จัดกะล่วงหน้ามา - รอยืนยันเข้างาน"
                                                >
                                                  รอยืนยัน
                                                </span>
                                              )}
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
                                                <span
                                                  className="vk-tpi-wp-ot"
                                                  title={`OT ${entry.is_ot_before_shift ? "ก่อนเข้ากะ " : "หลังเลิกกะ "}${entry.ot_hours} ชม. ${entry.ot_job_code_snapshot && entry.ot_job_code_snapshot !== entry.job_code_snapshot ? `(รหัสงาน OT: ${entry.ot_job_code_snapshot}) ` : ""}(${getShiftOtTimeRange(entry.shift_index, entry.ot_hours || 0, !!entry.is_ot_before_shift)}) 1.5 เท่า`}
                                                >
                                                  OT {entry.is_ot_before_shift ? "ก่อนกะ " : ""}{entry.ot_hours} ชม.
                                                  {entry.ot_job_code_snapshot && entry.ot_job_code_snapshot !== entry.job_code_snapshot && (
                                                    <span style={{ fontSize: 9, opacity: 0.9, marginLeft: 3, fontWeight: 700 }}>[{entry.ot_job_code_snapshot}]</span>
                                                  )}
                                                </span>
                                              )}
                                              {allSafetyAdvances.some(a => a.employee_id === emp.id && a.period_id === currentPeriod?.id) && (
                                                <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#fef2f2', color: '#b91c1c', border: '1px solid #fca5a5' }} title="มีบันทึกค่าปรับผิดระเบียบ จป. ในงวดนี้">
                                                  ปรับ จป.
                                                </span>
                                              )}
                                            </div>
                                            <div className="vk-tpi-worker-pill-line2">
                                              <span className="vk-tpi-wp-code">{emp.employee_code}</span>
                                            </div>
                                          </div>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                            {entry.is_pending && (
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  handleConfirmPending(emp.id, job.id, shiftIndex)
                                                }}
                                                title="ยืนยันเข้างาน"
                                                style={{
                                                  background: 'rgba(0,120,80,0.12)',
                                                  border: '1px solid rgba(0,120,80,0.3)',
                                                  cursor: 'pointer',
                                                  color: '#065f46',
                                                  padding: '2px 7px',
                                                  borderRadius: 4,
                                                  fontSize: 12,
                                                  fontWeight: 700,
                                                  display: 'flex',
                                                  alignItems: 'center',
                                                  justifyContent: 'center',
                                                  transition: 'all 0.15s ease',
                                                }}
                                                onMouseEnter={(e) => {
                                                  e.currentTarget.style.background = '#059669'
                                                  e.currentTarget.style.color = '#ffffff'
                                                }}
                                                onMouseLeave={(e) => {
                                                  e.currentTarget.style.background = 'rgba(0,120,80,0.12)'
                                                  e.currentTarget.style.color = '#065f46'
                                                }}
                                              >
                                                ✓
                                              </button>
                                            )}
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

        const modalOtJob = jobs.find((j) => j.id === (modalShift1OtJobId || modalShift1JobId)) || modalJob1
        const isClerkOtJob = isClerkJob(modalOtJob)
        const modalOtBaseRate = isClerkOtJob
          ? (modalTier === 'skilled' ? (modalOtJob?.skilled_rate ?? 377) : (modalOtJob?.normal_rate ?? 357))
          : (modalTier === 'skilled' && modalOtJob?.skilled_rate ? modalOtJob.skilled_rate : (modalOtJob?.normal_rate || 357))

        const modalShift1Wage = modalShift1IsHalf ? modalBaseRate1 / 2 : modalBaseRate1
        const modalShift1OtCalc = modalShift1HasOt
          ? calculateEntryOt(modalShift1OtHours, modalOtBaseRate)
          : { ot_hours: 0, ot_pay: 0 }

        const modalShift2Wage = modalShift2IsHalf ? modalBaseRate2 / 2 : modalBaseRate2

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

                  {/* OT Section for Shift 1 — identical UI for all positions */}
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
                          cursor: modalHasShift2 ? 'not-allowed' : 'pointer',
                          userSelect: 'none',
                          fontSize: 12,
                          fontWeight: 600,
                          color: modalShift1HasOt ? '#9a3412' : (modalHasShift2 ? 'var(--vk-ink-3)' : 'var(--vk-ink-2)'),
                        }}
                      >
                        <input
                          type="checkbox"
                          disabled={modalHasShift2}
                          checked={modalShift1HasOt}
                          onChange={(e) => {
                            setModalShift1HasOt(e.target.checked)
                            if (e.target.checked) {
                              setModalHasShift2(false)
                              if (modalShift1OtHours <= 0) {
                                setModalShift1OtHours(1)
                              }
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
                      {modalHasShift2 && (
                        <span style={{ fontSize: 11, color: '#9a3412', background: '#ffedd5', padding: '2px 8px', borderRadius: 4 }}>
                          ทำงานควบ 2 กะ (16 ชม.) ไม่สามารถทำ OT ได้
                        </span>
                      )}
                    </div>

                    {modalShift1HasOt && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #fed7aa', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {/* OT Job Code Selection (can differ from Shift 1) */}
                        <div style={{ background: '#fff', border: '1px solid #fed7aa', borderRadius: 6, padding: '8px 10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                            <label style={{ fontSize: 11, fontWeight: 700, color: '#9a3412' }}>
                              รหัสงานสำหรับการทำ OT:
                            </label>
                            {modalOtJob && modalOtJob.id !== modalShift1JobId && (
                              <span style={{ fontSize: 10, background: '#ea580c', color: '#ffffff', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>
                                📍 คนละตำแหน่งกับกะที่ 1
                              </span>
                            )}
                          </div>
                          <select
                            className="vk-modal-select"
                            value={modalShift1OtJobId || modalShift1JobId}
                            onChange={(e) => setModalShift1OtJobId(e.target.value)}
                            style={{ borderColor: '#fdba74', background: '#ffffff', fontSize: 12 }}
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
                          {modalOtJob && (
                            <div style={{ fontSize: 11, color: '#c2410c', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              {isClerkJob(modalOtJob) && (
                                <span className="vk-tpi-clerk-badge-prefix" style={{ fontSize: 10 }}>
                                  🏢 รหัสงานกลุ่มเสมียน
                                </span>
                              )}
                              <span>
                                เรทงานนี้: เรทปกติ ฿{modalOtJob.normal_rate ?? 357} · เรทฝีมือ {modalOtJob.skilled_rate != null ? `฿${modalOtJob.skilled_rate}` : 'ไม่มี'}
                                {' · '}คำนวณจากฐาน <strong>฿{modalOtBaseRate}</strong>/กะ (<strong>฿{(modalOtBaseRate / 8 * 1.5).toFixed(2)}/ชม.</strong>)
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Pre-shift OT Checkbox & Time Range Display */}
                        <div
                          style={{
                            padding: '8px 10px',
                            background: '#ffedd5',
                            borderRadius: 6,
                            border: '1px solid #fed7aa',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: 8,
                          }}
                        >
                          <label
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              cursor: 'pointer',
                              userSelect: 'none',
                              fontSize: 12,
                              fontWeight: 600,
                              color: '#9a3412',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={modalShift1OtBeforeShift}
                              onChange={(e) => setModalShift1OtBeforeShift(e.target.checked)}
                              style={{ accentColor: '#ea580c', width: 15, height: 15 }}
                            />
                            <span>ทำ OT ก่อนเริ่มงาน</span>
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 11, color: '#9a3412', fontWeight: 600 }}>
                              ช่วงเวลา OT ({modalShift1OtBeforeShift ? 'ก่อนเข้ากะ' : 'หลังเลิกกะ'}):
                            </span>
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 700,
                                color: '#c2410c',
                                background: '#ffffff',
                                padding: '2px 8px',
                                borderRadius: 4,
                                border: '1px solid #fdba74',
                                letterSpacing: '0.02em',
                              }}
                            >
                              🕒 {getShiftOtTimeRange(modalShift1Index, modalShift1OtHours, modalShift1OtBeforeShift)}
                            </span>
                          </div>
                        </div>

                        {/* Hours selection */}
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
                            (อัตรา (฿{modalOtBaseRate}/8 × 1.5) = ฿{(modalOtBaseRate / 8 * 1.5).toFixed(2)}/ชม.)
                          </div>
                        </div>
                      </div>
                    )}

                    {modalShift1HasOt && (
                      <div style={{ marginTop: 6, fontSize: 11, color: '#9a3412', background: 'rgba(254, 215, 170, 0.4)', padding: '4px 8px', borderRadius: 4 }}>
                        <span>
                          ค่าแรงกะ ฿{modalShift1Wage.toFixed(2)} + OT {modalShift1OtHours} ชม.
                          {modalOtJob && modalOtJob.id !== modalShift1JobId ? ` (งาน ${modalOtJob.code})` : ''} ฿{modalShift1OtCalc.ot_pay.toFixed(2)} = <strong>รวม ฿{(modalShift1Wage + modalShift1OtCalc.ot_pay).toFixed(2)}</strong>
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Shift 2 (Optional Double Shift) Configuration — hidden when Shift 1 is half-shift OR when Shift 1 has OT */}
                {!modalShift1IsHalf && !modalShift1HasOt && (
                <div className={`vk-shift-config-card ${modalHasShift2 ? 'is-active' : 'is-disabled'}`}>
                  <div className="vk-shift-card-head">
                    <label className="vk-shift2-toggle-label">
                      <input
                        type="checkbox"
                        checked={modalHasShift2}
                        onChange={(e) => {
                          setModalHasShift2(e.target.checked)
                          if (e.target.checked) {
                            setModalShift1HasOt(false)
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

                      {/* Shift 2 16h limit notice — no OT allowed for 2 shifts */}
                      <div
                        style={{
                          marginTop: 10,
                          padding: '8px 12px',
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          borderRadius: 6,
                          fontSize: 11,
                          color: '#64748b',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <span>💡</span>
                        <span>ทำงานควบ 2 กะ (รวม 16 ชม.) ครบโควตาสูงสุดแล้ว จึงไม่สามารถทำ OT ได้</span>
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
                  background: '#fef2f2',
                  border: '1.5px solid #fca5a5',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <ShieldAlert style={{ width: 18, height: 18, color: '#b91c1c' }} />
                    <span style={{ fontWeight: 700, fontSize: 13, color: '#991b1b' }}>
                      บันทึกความผิดระเบียบวินัยและค่าปรับ (จป. / HR)
                    </span>
                    {editingIncident ? (
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#92400e', background: '#fef3c7', padding: '2px 8px', borderRadius: 999, border: '1px solid #fde68a' }}>
                        ✏️ กำลังแก้ไขรายการเดิม
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#b91c1c', background: '#fee2e2', padding: '2px 8px', borderRadius: 999, border: '1px solid #fca5a5' }}>
                        หักผ่อนงวดละ 500 บ. (งวดสุดท้ายคิดตามจริง)
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {editingIncident ? (
                      <button
                        type="button"
                        onClick={() => handleStartNewIncident(modalBaseRate1)}
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: '#1e40af',
                          background: '#eff6ff',
                          border: '1px solid #bfdbfe',
                          borderRadius: 4,
                          padding: '3px 8px',
                          cursor: 'pointer',
                        }}
                      >
                        + เพิ่มรายการความผิดใหม่
                      </button>
                    ) : (
                      (() => {
                        const empAdvances = allSafetyAdvances.filter((a) => a.employee_id === modalEmp.id)
                        const empIncidents = groupSafetyAdvancesToIncidents(empAdvances, currentPeriod?.id)
                        if (empIncidents.length === 0) return null
                        return (
                          <button
                            type="button"
                            onClick={() => handleLoadIncidentForEdit(empIncidents[0])}
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: '#92400e',
                              background: '#fef3c7',
                              border: '1px solid #fde68a',
                              borderRadius: 4,
                              padding: '3px 8px',
                              cursor: 'pointer',
                            }}
                          >
                            ← กลับไปแก้ไขรายการเดิม
                          </button>
                        )
                      })()
                    )}
                  </div>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', fontSize: 13, fontWeight: 600, color: '#991b1b', marginBottom: modalSafetyFineEnabled ? 12 : 6 }}>
                  <input
                    type="checkbox"
                    checked={modalSafetyFineEnabled}
                    onChange={(e) => setModalSafetyFineEnabled(e.target.checked)}
                    style={{ accentColor: '#dc2626', width: 16, height: 16 }}
                  />
                  <span>
                    {editingIncident
                      ? `แก้ไขรายการความผิดระเบียบวินัย (${editingIncident.thDateStr ? `วันที่ ${editingIncident.thDateStr}` : 'รายการเดิม'})`
                      : 'บันทึกความผิดระเบียบวินัยในงวดนี้ (หักเงินงวดละ 500 บาท)'}
                  </span>
                </label>

                {modalSafetyFineEnabled && (
                  <div style={{ marginTop: 10, paddingTop: 12, borderTop: '1px dashed #fca5a5', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* Date & Quick Reason */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#991b1b', marginBottom: 4 }}>
                          วันที่เกิดเหตุ:
                        </label>
                        <ThaiDatePicker
                          value={modalSafetyFineDate}
                          onChange={(val) => setModalSafetyFineDate(val || '')}
                          placeholder="วว/ดด/ปปปป (พ.ศ.)"
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#991b1b', marginBottom: 4 }}>
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
                                border: `1px solid ${modalSafetyFineReason === preset ? '#dc2626' : '#fecaca'}`,
                                background: modalSafetyFineReason === preset ? '#dc2626' : '#ffffff',
                                color: modalSafetyFineReason === preset ? '#ffffff' : '#991b1b',
                                cursor: 'pointer',
                              }}
                            >
                              {preset}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Reason Text */}
                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#991b1b', marginBottom: 4 }}>
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
                          border: '1px solid #fca5a5',
                          background: '#ffffff',
                          color: '#1e1b4b',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>

                    {/* Fine Calculation Grid (จป. & HR) */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {/* Sub-section 1: จป. Fine */}
                      <div style={{ background: '#ffffff', border: '1px solid #fed7aa', borderRadius: 6, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#9a3412' }}>
                            1. ค่าปรับจาก จป. (บาท)
                          </span>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {[0, 1000, 2000].map((amt) => (
                              <button
                                key={amt}
                                type="button"
                                onClick={() => setModalSafetyFineSafetyAmount(amt)}
                                style={{
                                  fontSize: 10,
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  border: `1px solid ${modalSafetyFineSafetyAmount === amt ? '#ea580c' : '#fdba74'}`,
                                  background: modalSafetyFineSafetyAmount === amt ? '#ea580c' : '#fff7ed',
                                  color: modalSafetyFineSafetyAmount === amt ? '#ffffff' : '#9a3412',
                                  cursor: 'pointer',
                                }}
                              >
                                {amt === 0 ? '0 บ.' : `${amt.toLocaleString()} บ.`}
                              </button>
                            ))}
                          </div>
                        </div>
                        <input
                          type="number"
                          value={modalSafetyFineSafetyAmount}
                          onChange={(e) => setModalSafetyFineSafetyAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                          style={{
                            width: '100%',
                            height: 32,
                            padding: '0 8px',
                            fontSize: 13,
                            fontWeight: 700,
                            borderRadius: 4,
                            border: '1px solid #fdba74',
                            color: '#9a3412',
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>

                      {/* Sub-section 2: HR Penalty (3x Shift Rate) */}
                      <div style={{ background: modalSafetyFineIncludeHr ? '#fff1f2' : '#ffffff', border: `1px solid ${modalSafetyFineIncludeHr ? '#f43f5e' : '#fecdd3'}`, borderRadius: 6, padding: '10px 12px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none', marginBottom: 6 }}>
                          <input
                            type="checkbox"
                            checked={modalSafetyFineIncludeHr}
                            onChange={(e) => setModalSafetyFineIncludeHr(e.target.checked)}
                            style={{ accentColor: '#e11d48', width: 15, height: 15 }}
                          />
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#9f1239' }}>
                            2. ปรับเพิ่มเติมจาก HR (3 เท่า)
                          </span>
                        </label>
                        {modalSafetyFineIncludeHr ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 11, color: '#881337', whiteSpace: 'nowrap' }}>ค่าแรงกะ:</span>
                              <input
                                type="number"
                                value={modalSafetyFineShiftRate}
                                onChange={(e) => setModalSafetyFineShiftRate(Math.max(0, parseFloat(e.target.value) || 0))}
                                style={{
                                  width: 80,
                                  height: 26,
                                  padding: '0 6px',
                                  fontSize: 12,
                                  fontWeight: 700,
                                  borderRadius: 4,
                                  border: '1px solid #f43f5e',
                                  color: '#9f1239',
                                  boxSizing: 'border-box',
                                }}
                              />
                              <span style={{ fontSize: 11, color: '#881337' }}>บ.</span>
                            </div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#be123c', background: '#ffe4e6', padding: '3px 6px', borderRadius: 4, border: '1px dashed #fda4af' }}>
                              คำนวณ ฿{modalSafetyFineShiftRate} × 3 = ฿{hrFineAmount.toLocaleString()}
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: 11, color: 'var(--vk-ink-3)', marginTop: 4 }}>
                            ติ๊กเพื่อคำนวณค่าปรับ 3 เท่าจากค่าแรงกะนั้น
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Summary & Installment Plan */}
                    <div style={{ background: '#ffffff', border: '1px solid #fca5a5', borderRadius: 6, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                        <div>
                          <div style={{ fontSize: 11, color: '#991b1b', fontWeight: 600 }}>
                            สรุปยอดค่าปรับรวม:
                          </div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: '#b91c1c' }}>
                            ฿{totalFineAmount.toLocaleString()}{' '}
                            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--vk-ink-3)' }}>
                              (จป. ฿{modalSafetyFineSafetyAmount.toLocaleString()}{modalSafetyFineIncludeHr ? ` + HR ฿${hrFineAmount.toLocaleString()}` : ''})
                            </span>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#991b1b', background: '#fee2e2', padding: '3px 8px', borderRadius: 4, border: '1px solid #fca5a5' }}>
                            แบ่งผ่อน {fineInstallments.length} งวด (งวดละ 500 บ.)
                          </span>
                        </div>
                      </div>

                      {/* Visual Installment Pills */}
                      {fineInstallments.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                          {fineInstallments.map((amt, idx) => {
                            const isCurrent = idx === 0
                            const isLast = idx === fineInstallments.length - 1
                            return (
                              <div
                                key={idx}
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  padding: '4px 8px',
                                  borderRadius: 4,
                                  background: isCurrent ? '#fef2f2' : '#f8fafc',
                                  border: `1px solid ${isCurrent ? '#f87171' : '#cbd5e1'}`,
                                  minWidth: 70,
                                }}
                              >
                                <span style={{ fontSize: 10, color: isCurrent ? '#b91c1c' : '#64748b', fontWeight: 600 }}>
                                  งวด {idx + 1}/{fineInstallments.length}{isCurrent ? ' (งวดนี้)' : isLast ? ' (สุดท้าย)' : ''}
                                </span>
                                <span style={{ fontSize: 13, fontWeight: 800, color: isCurrent ? '#991b1b' : '#334155' }}>
                                  ฿{amt.toLocaleString()}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      <div style={{ fontSize: 11, color: '#991b1b', borderTop: '1px dashed #fca5a5', paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                        <div>
                          💡 <strong>แผนการหัก:</strong> งวดนี้หัก ฿{fineInstallments[0]?.toLocaleString() || 0} และระบบจะตั้งงวดถัดไปให้อัตโนมัติงวดละ ฿500 จนครบยอด
                          {fineInstallments.length > 1 && fineInstallments[fineInstallments.length - 1] < 500 && (
                            <span> (งวดสุดท้ายเหลือ ฿{fineInstallments[fineInstallments.length - 1]})</span>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={modalSafetyFineSubmitting || !modalSafetyFineReason.trim() || totalFineAmount <= 0}
                          onClick={handleSaveSafetyFine}
                          style={{
                            background: modalSafetyFineReason.trim() && totalFineAmount > 0 ? '#dc2626' : '#fca5a5',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: 4,
                            padding: '6px 14px',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: modalSafetyFineReason.trim() && totalFineAmount > 0 ? 'pointer' : 'not-allowed',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <ShieldAlert style={{ width: 14, height: 14 }} />
                          {modalSafetyFineSubmitting
                            ? 'กำลังบันทึก...'
                            : editingIncident
                            ? `บันทึกการแก้ไข (อัปเดตยอด ฿${totalFineAmount.toLocaleString()} / ${fineInstallments.length} งวด)`
                            : `บันทึกค่าปรับ ฿${totalFineAmount.toLocaleString()} ทันที (${fineInstallments.length} งวด)`}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Grouped Incidents History for this employee */}
                {(() => {
                  const empAdvances = allSafetyAdvances.filter((a) => a.employee_id === modalEmp.id)
                  const empIncidents = groupSafetyAdvancesToIncidents(empAdvances, currentPeriod?.id)
                  if (empIncidents.length === 0) return null
                  return (
                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed #fca5a5' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#991b1b' }}>
                          ประวัติรายการความผิดระเบียบวินัย / ค่าปรับ ({empIncidents.length} รายการ):
                        </div>
                        <div style={{ fontSize: 11, color: '#b91c1c' }}>
                          คลิก "แก้ไข" เพื่อเปิดปรับปรุงข้อมูล หรือ "ลบ" เพื่อยกเลิกทั้งรายการ
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {empIncidents.map((incident) => {
                          const isBeingEdited = editingIncident?.id === incident.id
                          return (
                            <div
                              key={incident.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: isBeingEdited ? '#fff7ed' : '#ffffff',
                                padding: '8px 12px',
                                borderRadius: 6,
                                border: `1px solid ${isBeingEdited ? '#ea580c' : '#fca5a5'}`,
                                fontSize: 12,
                                gap: 10,
                                boxShadow: isBeingEdited ? '0 0 0 2px rgba(234, 88, 12, 0.2)' : 'none',
                              }}
                            >
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
                                  <span style={{ fontWeight: 700, color: '#991b1b' }}>
                                    {incident.reason}
                                  </span>
                                  {isBeingEdited && (
                                    <span style={{ fontSize: 10, fontWeight: 700, background: '#ea580c', color: '#ffffff', padding: '1px 6px', borderRadius: 4 }}>
                                      กำลังแก้ไข
                                    </span>
                                  )}
                                  <span style={{ fontSize: 10, fontWeight: 600, background: '#fee2e2', color: '#b91c1c', padding: '1px 6px', borderRadius: 4, border: '1px solid #fca5a5' }}>
                                    ผ่อน {incident.installments.length} งวด
                                  </span>
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--vk-ink-2)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                  <span>วันที่เกิดเหตุ: <strong>{incident.thDateStr || '-'}</strong></span>
                                  <span>
                                    ยอดรวม: <strong style={{ color: '#dc2626' }}>฿{incident.totalAmount.toLocaleString()}</strong>{' '}
                                    <span style={{ color: 'var(--vk-ink-3)', fontSize: 10 }}>
                                      (จป. ฿{incident.safetyAmount.toLocaleString()}{incident.includeHr ? ` + HR ฿${incident.hrAmount.toLocaleString()}` : ''})
                                    </span>
                                  </span>
                                </div>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                <button
                                  type="button"
                                  className="vk-btn"
                                  onClick={() => handleLoadIncidentForEdit(incident)}
                                  style={{
                                    fontSize: 11,
                                    padding: '4px 10px',
                                    background: isBeingEdited ? '#ea580c' : '#f8fafc',
                                    color: isBeingEdited ? '#ffffff' : '#1e40af',
                                    border: `1px solid ${isBeingEdited ? '#ea580c' : '#cbd5e1'}`,
                                    borderRadius: 4,
                                    cursor: 'pointer',
                                    fontWeight: 600,
                                  }}
                                >
                                  {isBeingEdited ? '✓ กำลังแก้ไข' : '✏️ แก้ไขรายการนี้'}
                                </button>
                                <button
                                  type="button"
                                  className="vk-btn"
                                  onClick={() => setDeleteIncidentTarget(incident)}
                                  style={{
                                    fontSize: 11,
                                    padding: '4px 8px',
                                    background: '#fef2f2',
                                    color: '#b91c1c',
                                    border: '1px solid #fecaca',
                                    borderRadius: 4,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                  }}
                                  title="ลบรายการความผิดนี้ทั้งรายการ"
                                >
                                  <Trash2 style={{ width: 13, height: 13 }} />
                                  <span>ลบ</span>
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

      {/* ── Pre-assign Shifts Modal (จัดกะล่วงหน้าไปวันอื่นในงวด) ── */}
      {isPreassignModalOpen && (
        <div className="vk-modal-backdrop" onClick={() => !isPreassignSubmitting && setIsPreassignModalOpen(false)}>
          <div
            className="vk-targets-modal-container"
            style={{ maxWidth: 820 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="vk-modal-header">
              <div className="vk-modal-header-left">
                <div className="vk-modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Calendar style={{ width: 18, height: 18, color: '#059669' }} />
                  จัดกะล่วงหน้าไปวันอื่น (Pre-assign Shifts)
                </div>
                <div className="vk-modal-subtitle">
                  คัดลอกตำแหน่งงานและกะจาก <strong>{fmtDisplay(activeDateStr)}</strong> ไปยังวันอื่นๆ ในงวด (สถานะ: รอยืนยัน)
                </div>
              </div>
              <button
                type="button"
                className="vk-modal-btn-close"
                onClick={() => !isPreassignSubmitting && setIsPreassignModalOpen(false)}
                disabled={isPreassignSubmitting}
                title="ปิดหน้าต่าง"
              >
                <X style={{ width: 20, height: 20 }} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 20, maxHeight: 'calc(85vh - 130px)', overflowY: 'auto' }}>
              {/* Section 1: เลือกพนักงาน */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--vk-ink)' }}>
                      1. เลือกพนักงานที่ต้องการจัดกะล่วงหน้า
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--vk-ink-3)', marginLeft: 8 }}>
                      (เลือกแล้ว {preassignSelectedEmpIds.size} จาก {preassignUniqueEmployees.length} คน
                      {preassignEmpSearch.trim() && (
                        <span style={{ color: '#059669', fontWeight: 600, marginLeft: 6 }}>
                          • พบ {filteredPreassignEmployees.length} คน
                        </span>
                      )})
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {/* Search Input Box */}
                    <div style={{ position: 'relative', width: 220 }}>
                      <Search style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, color: 'var(--vk-ink-3)', pointerEvents: 'none' }} />
                      <input
                        type="text"
                        placeholder="ค้นหาชื่อ หรือ รหัสพนักงาน..."
                        value={preassignEmpSearch}
                        onChange={(e) => setPreassignEmpSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.stopPropagation()
                            setPreassignEmpSearch('')
                          }
                        }}
                        disabled={isPreassignSubmitting}
                        className="vk-input"
                        style={{
                          height: 28,
                          fontSize: 12,
                          paddingLeft: 26,
                          paddingRight: preassignEmpSearch ? 24 : 8,
                          width: '100%',
                          borderRadius: 6,
                          background: '#ffffff',
                          border: '1px solid #cbd5e1',
                          boxSizing: 'border-box',
                        }}
                      />
                      {preassignEmpSearch && (
                        <button
                          type="button"
                          onClick={() => setPreassignEmpSearch('')}
                          disabled={isPreassignSubmitting}
                          style={{
                            position: 'absolute',
                            right: 6,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 2,
                            color: 'var(--vk-ink-3)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                          title="ล้างคำค้นหา"
                        >
                          <X style={{ width: 12, height: 12 }} />
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      className="vk-btn vk-btn--ghost"
                      style={{ fontSize: 11, padding: '2px 8px', height: 28 }}
                      disabled={isPreassignSubmitting || filteredPreassignEmployees.length === 0}
                      onClick={() => {
                        if (preassignEmpSearch.trim()) {
                          const next = new Set(preassignSelectedEmpIds)
                          if (isAllFilteredPreassignSelected) {
                            filteredPreassignEmployees.forEach((u) => next.delete(u.empId))
                          } else {
                            filteredPreassignEmployees.forEach((u) => next.add(u.empId))
                          }
                          setPreassignSelectedEmpIds(next)
                        } else {
                          if (isAllFilteredPreassignSelected) {
                            setPreassignSelectedEmpIds(new Set())
                          } else {
                            const allIds = new Set(preassignUniqueEmployees.map((u) => u.empId))
                            setPreassignSelectedEmpIds(allIds)
                          }
                        }
                      }}
                    >
                      {preassignEmpSearch.trim()
                        ? isAllFilteredPreassignSelected
                          ? `ยกเลิกที่ค้นหา (${filteredPreassignEmployees.length})`
                          : `เลือกที่ค้นหา (${filteredPreassignEmployees.length})`
                        : isAllFilteredPreassignSelected
                        ? 'ยกเลิกทั้งหมด'
                        : 'เลือกทั้งหมด'}
                    </button>
                    <button
                      type="button"
                      className="vk-btn vk-btn--ghost"
                      style={{ fontSize: 11, padding: '2px 8px', height: 28 }}
                      disabled={isPreassignSubmitting || preassignSelectedEmpIds.size === 0}
                      onClick={() => setPreassignSelectedEmpIds(new Set())}
                    >
                      ล้างการเลือก
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8, maxHeight: 190, overflowY: 'auto', paddingRight: 4 }}>
                  {filteredPreassignEmployees.length === 0 ? (
                    <div
                      style={{
                        gridColumn: '1 / -1',
                        textAlign: 'center',
                        padding: '24px 16px',
                        color: 'var(--vk-ink-3)',
                        fontSize: 12,
                        background: '#ffffff',
                        borderRadius: 6,
                        border: '1px dashed #cbd5e1',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <span>ไม่พบพนักงานที่ตรงกับ <strong>"{preassignEmpSearch}"</strong></span>
                      <button
                        type="button"
                        className="vk-btn vk-btn--ghost"
                        style={{ fontSize: 11, padding: '2px 8px', height: 24, color: '#059669' }}
                        onClick={() => setPreassignEmpSearch('')}
                      >
                        ล้างคำค้นหา
                      </button>
                    </div>
                  ) : (
                    filteredPreassignEmployees.map(({ empId, emp, entries: empEntries }) => {
                      const isChecked = preassignSelectedEmpIds.has(empId)
                      const shiftLabels = empEntries.map((e) => `กะ ${e.shift_index + 1}`).join(', ')
                      const jobCodes = Array.from(
                        new Set(
                          empEntries.map((e) => {
                            const j = jobs.find((x) => x.id === e.job_id) || demoJobs.find((x) => x.id === e.job_id)
                            return j?.code || e.job_code_snapshot || '-'
                          })
                        )
                      ).join(', ')
                      const totalOt = empEntries.reduce((sum, e) => sum + (Number(e.ot_hours) || 0), 0)

                      return (
                        <label
                          key={empId}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '8px 12px',
                            borderRadius: 6,
                            background: isChecked ? '#f0fdf4' : '#ffffff',
                            border: `1px solid ${isChecked ? '#86efac' : '#e2e8f0'}`,
                            cursor: 'pointer',
                            userSelect: 'none',
                            fontSize: 12,
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              const next = new Set(preassignSelectedEmpIds)
                              if (e.target.checked) next.add(empId)
                              else next.delete(empId)
                              setPreassignSelectedEmpIds(next)
                            }}
                            style={{ accentColor: '#059669', width: 16, height: 16, cursor: 'pointer' }}
                          />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 700, color: 'var(--vk-ink)', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {emp ? `${emp.first_name} ${emp.last_name}` : empId}
                              </span>
                              {isSkilledWorker(empId) && (
                                <span title="พนักงานค่าแรงฝีมือ" style={{ fontSize: 11, flexShrink: 0 }}>⭐</span>
                              )}
                              {empEntries.length > 1 && (
                                <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(91,33,182,0.1)', color: '#5b21b6', flexShrink: 0 }}>
                                  2 กะ
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--vk-ink-3)', marginTop: 2, flexWrap: 'wrap' }}>
                              <span style={{ fontFamily: 'var(--vk-mono)', fontWeight: 600 }}>{emp?.employee_code}</span>
                              <span>•</span>
                              <span style={{ color: '#047857', fontWeight: 600 }}>{shiftLabels}</span>
                              <span>•</span>
                              <span style={{ maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={jobCodes}>
                                {jobCodes}
                              </span>
                              {totalOt > 0 && (
                                <>
                                  <span>•</span>
                                  <span style={{ color: '#b45309', fontWeight: 600 }}>OT {totalOt} ชม.</span>
                                </>
                              )}
                            </div>
                          </div>
                        </label>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Section 2: เลือกวันที่ในงวด */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--vk-ink)' }}>
                      2. เลือกวันที่เป้าหมายในงวดนี้
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--vk-ink-3)', marginLeft: 8 }}>
                      (เลือกแล้ว {preassignTargetDates.size} วัน)
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="vk-btn vk-btn--ghost"
                      style={{ fontSize: 11, padding: '2px 8px', height: 26 }}
                      onClick={() => {
                        const weekdays = periodDates.filter((dStr) => !isWeekend(dStr) && dStr !== activeDateStr)
                        setPreassignTargetDates(new Set(weekdays))
                      }}
                      title="เลือกวันจันทร์ถึงวันศุกร์ (ไม่รวมเสาร์-อาทิตย์ และไม่รวมวันนี้)"
                    >
                      จันทร์ - ศุกร์
                    </button>
                    <button
                      type="button"
                      className="vk-btn vk-btn--ghost"
                      style={{ fontSize: 11, padding: '2px 8px', height: 26 }}
                      onClick={() => {
                        const remaining = periodDates.filter((dStr) => dStr > activeDateStr)
                        setPreassignTargetDates(new Set(remaining))
                      }}
                      title="เลือกทุกวันที่อยู่หลังวันปัจจุบันจนถึงสิ้นงวด"
                    >
                      วันที่เหลือในงวด
                    </button>
                    <button
                      type="button"
                      className="vk-btn vk-btn--ghost"
                      style={{ fontSize: 11, padding: '2px 8px', height: 26 }}
                      onClick={() => {
                        const allOthers = periodDates.filter((dStr) => dStr !== activeDateStr)
                        setPreassignTargetDates(new Set(allOthers))
                      }}
                      title="เลือกทุกวันในงวดนี้ (ยกเว้นวันนี้)"
                    >
                      ทุกวันในงวด
                    </button>
                    <button
                      type="button"
                      className="vk-btn vk-btn--ghost"
                      style={{ fontSize: 11, padding: '2px 8px', height: 26 }}
                      onClick={() => setPreassignTargetDates(new Set())}
                    >
                      ล้างวันที่
                    </button>
                  </div>
                </div>

                {/* Calendar Date Cards Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 6, maxHeight: 220, overflowY: 'auto', paddingRight: 4 }}>
                  {periodDates.map((dStr) => {
                    const d = parseLocal(dStr)
                    const isToday = dStr === activeDateStr
                    const isSelected = preassignTargetDates.has(dStr)
                    const weekendDay = isWeekend(dStr)
                    const holidayDay = getStoredHoliday(user?.factory_id, dStr)

                    return (
                      <button
                        key={dStr}
                        type="button"
                        disabled={isToday}
                        onClick={() => {
                          const next = new Set(preassignTargetDates)
                          if (isSelected) next.delete(dStr)
                          else next.add(dStr)
                          setPreassignTargetDates(next)
                        }}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '8px 4px',
                          borderRadius: 6,
                          border: isToday
                            ? '1px dashed #cbd5e1'
                            : isSelected
                            ? '2px solid #059669'
                            : '1px solid #e2e8f0',
                          background: isToday
                            ? '#f1f5f9'
                            : isSelected
                            ? '#ecfdf5'
                            : holidayDay
                            ? 'var(--vk-marigold-tint)'
                            : weekendDay
                            ? '#faf5ff'
                            : '#ffffff',
                          cursor: isToday ? 'not-allowed' : 'pointer',
                          opacity: isToday ? 0.6 : 1,
                          transition: 'all 0.15s ease',
                          position: 'relative',
                        }}
                        title={isToday ? 'วันนี้ (ต้นทาง)' : fmtDisplay(dStr)}
                      >
                        <span style={{ fontSize: 11, fontWeight: 600, color: weekendDay ? '#7c3aed' : 'var(--vk-ink-3)' }}>
                          {DAYS[d.getDay()]}
                        </span>
                        <span style={{ fontSize: 16, fontWeight: 800, color: isSelected ? '#065f46' : 'var(--vk-ink)', margin: '2px 0' }}>
                          {d.getDate()}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--vk-ink-3)' }}>
                          {MONTHS[d.getMonth()]}
                        </span>

                        {isToday && (
                          <span style={{ fontSize: 9, fontWeight: 700, color: '#64748b', marginTop: 2 }}>
                            (ต้นทาง)
                          </span>
                        )}
                        {isSelected && (
                          <div style={{ position: 'absolute', top: 3, right: 3, width: 14, height: 14, borderRadius: '50%', background: '#059669', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>
                            ✓
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '12px 20px',
                borderTop: '1px solid #e2e8f0',
                background: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div style={{ fontSize: 13, color: 'var(--vk-ink-2)' }}>
                {preassignSelectedEmpIds.size > 0 && preassignTargetDates.size > 0 ? (
                  <span>
                    จะจัดกะพนักงาน <strong>{preassignSelectedEmpIds.size}</strong> คน ({entries.filter((e) => preassignSelectedEmpIds.has(e.employee_id)).length} กะ) ไปยัง <strong>{preassignTargetDates.size}</strong> วัน
                  </span>
                ) : (
                  <span style={{ color: 'var(--vk-ink-3)' }}>
                    กรุณาเลือกพนักงานและวันที่เป้าหมายอย่างน้อย 1 วัน
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="vk-btn vk-btn-secondary"
                  onClick={() => setIsPreassignModalOpen(false)}
                  disabled={isPreassignSubmitting}
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  className="vk-btn vk-btn--primary"
                  onClick={handleConfirmPreassign}
                  disabled={
                    preassignSelectedEmpIds.size === 0 ||
                    preassignTargetDates.size === 0 ||
                    isPreassignSubmitting
                  }
                  style={{
                    background: '#059669',
                    borderColor: '#059669',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Check style={{ width: 14, height: 14 }} />
                  {isPreassignSubmitting
                    ? 'กำลังจัดกะล่วงหน้า...'
                    : `ยืนยันจัดกะล่วงหน้า (${preassignSelectedEmpIds.size} คน)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Safety Incident Modal (Themed replacement for browser confirm) */}
      {deleteIncidentTarget && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 350,
            background: 'rgba(22, 19, 17, 0.65)',
            backdropFilter: 'blur(2px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => !isDeletingIncident && setDeleteIncidentTarget(null)}
        >
          <div
            style={{
              background: 'var(--vk-paper, #ffffff)',
              border: '1px solid var(--vk-rule, #e5e7eb)',
              width: '100%',
              maxWidth: 420,
              overflow: 'hidden',
              borderRadius: 8,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.25), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                background: '#dc2626',
                color: '#fff',
                padding: '14px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <Trash2 style={{ width: 16, height: 16, flexShrink: 0 }} />
              <div style={{ fontWeight: 700, fontSize: 15 }}>ยืนยันการลบรายการความผิดระเบียบวินัย</div>
            </div>

            <div style={{ padding: '18px 20px' }}>
              <p style={{ fontSize: 14, color: 'var(--vk-ink-2, #374151)', lineHeight: 1.6, margin: 0 }}>
                ต้องการลบรายการหักค่าปรับ {modalEmp ? <>ของ <strong>{modalEmp.first_name} {modalEmp.last_name}</strong></> : 'นี้'} ใช่หรือไม่?
              </p>

              <div
                style={{
                  marginTop: 12,
                  padding: '10px 14px',
                  background: '#f9fafb',
                  border: '1px solid var(--vk-rule, #e5e7eb)',
                  borderRadius: 6,
                  fontSize: 13,
                }}
              >
                <div style={{ color: 'var(--vk-ink-muted, #6b7280)', fontSize: 12, marginBottom: 2 }}>
                  สาเหตุความผิด:
                </div>
                <div style={{ fontWeight: 700, color: 'var(--vk-ink, #111827)', marginBottom: 6 }}>
                  {deleteIncidentTarget.reason}
                </div>
                <div style={{ fontSize: 12, color: 'var(--vk-ink-2)', marginBottom: 6 }}>
                  วันที่เกิดเหตุ: <strong>{deleteIncidentTarget.thDateStr || '-'}</strong>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingTop: 6,
                    borderTop: '1px dashed #e5e7eb',
                  }}
                >
                  <span style={{ fontSize: 12, color: 'var(--vk-ink-muted, #6b7280)' }}>
                    ยอดรวมทั้งหมด ({deleteIncidentTarget.installments.length} งวด):
                  </span>
                  <span style={{ fontFamily: 'var(--vk-mono, monospace)', fontWeight: 700, color: '#dc2626', fontSize: 14 }}>
                    ฿{deleteIncidentTarget.totalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              <div
                style={{
                  marginTop: 12,
                  padding: '8px 12px',
                  background: 'var(--vk-persimmon-tint, #fef2f2)',
                  border: '1px solid var(--vk-persimmon, #fca5a5)',
                  borderRadius: 6,
                  fontSize: 12,
                  color: 'var(--vk-persimmon-ink, #991b1b)',
                  lineHeight: 1.5,
                }}
              >
                ระบบจะลบรายการหักเงินผ่อนชำระทั้งหมด {deleteIncidentTarget.installments.length} งวดออกจากฐานข้อมูล และการดำเนินการนี้ไม่สามารถเรียกคืนได้
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                gap: 8,
                padding: '0 20px 16px',
                justifyContent: 'flex-end',
              }}
            >
              <button
                type="button"
                className="vk-btn"
                disabled={isDeletingIncident}
                onClick={() => setDeleteIncidentTarget(null)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="vk-btn"
                disabled={isDeletingIncident}
                style={{
                  background: '#dc2626',
                  color: '#ffffff',
                  borderColor: '#dc2626',
                  cursor: isDeletingIncident ? 'not-allowed' : 'pointer',
                  opacity: isDeletingIncident ? 0.7 : 1,
                }}
                onClick={handleConfirmDeleteIncident}
              >
                {isDeletingIncident ? 'กำลังลบทั้งรายการ...' : 'ยืนยันลบทั้งรายการ'}
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
