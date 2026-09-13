import React, { useState, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  UserX,
  Plus,
  Search,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Trash2,
  Edit2,
  History,
  AlertTriangle,
  Info,
  CheckCircle2,
  Users,
  Filter,
  FileSpreadsheet,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '../store/useAppStore'
import { supabase } from '../lib/supabase'
import { TopBar } from '../components/layout/TopBar'
import type { AttendanceLog, AttendanceType } from '../features/tpi/attendanceApi'
import {
  loadMonthlyAttendanceLogs,
  deleteAttendanceLog,
  getAttendanceTypeLabel,
  formatAttendanceSummary,
} from '../features/tpi/attendanceApi'
import { AttendanceEntryModal } from '../features/tpi/AttendanceEntryModal'
import { EmployeeAttendanceHistoryModal } from '../features/tpi/EmployeeAttendanceHistoryModal'
import { formatEmployeeFullName, formatThaiDateShort } from '../lib/formatters'
import '../styles/tokens.css'

const THAI_MONTH_NAMES = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
]

export default function TpiAttendance() {
  const outletContext = useOutletContext<{ onMenuClick?: () => void }>()
  const onMenuClick = outletContext?.onMenuClick || (() => {})
  const { user, companyContext } = useAppStore()
  const queryClient = useQueryClient()

  // ── Month Selection State (Separate Year & Month) ──
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1 // 1-12

  const [selectedYear, setSelectedYear] = useState<number>(currentYear)
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth)

  const selectedYearMonth = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`
  const isCurrentMonth = selectedYear === currentYear && selectedMonth === currentMonth

  // ── Search & Filter State ──
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | AttendanceType>('all')
  const [viewMode, setViewMode] = useState<'records' | 'employees'>('records')

  // ── Modals State ──
  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false)
  const [editingLog, setEditingLog] = useState<AttendanceLog | null>(null)

  const [historyEmployee, setHistoryEmployee] = useState<{
    id: string
    employee_code: string
    first_name: string
    last_name?: string | null
    position?: string | null
    nationality?: string | null
  } | null>(null)
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false)

  // Deletion confirmation
  const [itemToDelete, setItemToDelete] = useState<AttendanceLog | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // ── Year Options for Dropdown (เริ่มต้นที่ปีปัจจุบัน และสร้างปีอนาคต) ──
  const yearOptions = useMemo(() => {
    const years: number[] = []
    for (let y = currentYear; y <= currentYear + 4; y++) {
      years.push(y)
    }
    return years
  }, [currentYear])

  // Calculate start and end date for selected month
  const { startDate, endDate } = useMemo(() => {
    const start = `${selectedYearMonth}-01`
    const lastDay = new Date(selectedYear, selectedMonth, 0).getDate()
    const end = `${selectedYearMonth}-${String(lastDay).padStart(2, '0')}`
    return { startDate: start, endDate: end }
  }, [selectedYearMonth, selectedYear, selectedMonth])

  // Thai display label for selected month
  const selectedMonthDisplay = useMemo(() => {
    return `${THAI_MONTH_NAMES[selectedMonth - 1]} ${selectedYear + 543}`
  }, [selectedYear, selectedMonth])

  // Navigate to previous / next month (ไม่ย้อนไปก่อนปีปัจจุบัน)
  const handlePrevMonth = () => {
    if (selectedMonth === 1) {
      if (selectedYear > currentYear) {
        setSelectedMonth(12)
        setSelectedYear(prev => prev - 1)
      }
    } else {
      setSelectedMonth(prev => prev - 1)
    }
  }

  const handleNextMonth = () => {
    if (selectedMonth === 12) {
      if (selectedYear < currentYear + 4) {
        setSelectedMonth(1)
        setSelectedYear(prev => prev + 1)
      }
    } else {
      setSelectedMonth(prev => prev + 1)
    }
  }

  const handleResetCurrentMonth = () => {
    setSelectedYear(currentYear)
    setSelectedMonth(currentMonth)
  }

  // ── Fetch Employees for Dropdown / Form ──
  const { data: employees = [] } = useQuery({
    queryKey: ['tpi-employees-list', user?.factory_id],
    queryFn: async () => {
      if (!user?.factory_id) return []
      const { data, error } = await supabase
        .from('employees')
        .select('id, employee_code, first_name, last_name, position, nationality')
        .eq('factory_id', user.factory_id)
        .order('employee_code')
      if (error) throw error
      return data || []
    },
    enabled: !!user?.factory_id,
  })

  // ── Fetch Monthly Attendance Records ──
  const {
    data: monthlyLogs = [],
    isLoading: isLogsLoading,
    refetch: refetchLogs,
  } = useQuery({
    queryKey: ['tpi-monthly-attendance-page', user?.factory_id, startDate, endDate],
    queryFn: async () => {
      if (!user?.factory_id) return []
      return await loadMonthlyAttendanceLogs(user.factory_id, startDate, endDate)
    },
    enabled: !!user?.factory_id,
  })

  // ── Summary Metrics for the Selected Month ──
  const monthlyMetrics = useMemo(() => {
    let absentCount = 0
    let leaveCount = 0
    let lateCount = 0
    let totalLateMinutes = 0
    const empSet = new Set<string>()

    for (const log of monthlyLogs) {
      empSet.add(log.employee_id)
      if (log.type === 'absent') absentCount++
      else if (log.type === 'leave') leaveCount++
      else if (log.type === 'late') {
        lateCount++
        totalLateMinutes += Number(log.minutes_late || 0)
      }
    }

    return {
      totalLogs: monthlyLogs.length,
      affectedEmployeesCount: empSet.size,
      absentCount,
      leaveCount,
      lateCount,
      totalLateMinutes,
    }
  }, [monthlyLogs])

  // ── Filtered Logs for Records Table ──
  const filteredLogs = useMemo(() => {
    return monthlyLogs.filter(log => {
      // Type filter
      if (typeFilter !== 'all' && log.type !== typeFilter) return false

      // Search term
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase().trim()
        const code = log.employee?.employee_code?.toLowerCase() || ''
        const first = log.employee?.first_name?.toLowerCase() || ''
        const last = log.employee?.last_name?.toLowerCase() || ''
        const reason = log.reason?.toLowerCase() || ''
        if (!code.includes(q) && !first.includes(q) && !last.includes(q) && !reason.includes(q)) {
          return false
        }
      }

      return true
    })
  }, [monthlyLogs, typeFilter, searchTerm])

  // ── Grouped Summary by Employee ──
  const employeeSummaries = useMemo(() => {
    const map = new Map<
      string,
      {
        employee: AttendanceLog['employee']
        employee_id: string
        absentCount: number
        leaveCount: number
        lateCount: number
        lateMinutes: number
        totalCount: number
        logs: AttendanceLog[]
      }
    >()

    for (const log of monthlyLogs) {
      if (!map.has(log.employee_id)) {
        map.set(log.employee_id, {
          employee: log.employee,
          employee_id: log.employee_id,
          absentCount: 0,
          leaveCount: 0,
          lateCount: 0,
          lateMinutes: 0,
          totalCount: 0,
          logs: [],
        })
      }
      const item = map.get(log.employee_id)!
      item.totalCount++
      item.logs.push(log)
      if (log.type === 'absent') item.absentCount++
      else if (log.type === 'leave') item.leaveCount++
      else if (log.type === 'late') {
        item.lateCount++
        item.lateMinutes += Number(log.minutes_late || 0)
      }
    }

    let list = Array.from(map.values())

    // Search filter
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim()
      list = list.filter(item => {
        const code = item.employee?.employee_code?.toLowerCase() || ''
        const first = item.employee?.first_name?.toLowerCase() || ''
        const last = item.employee?.last_name?.toLowerCase() || ''
        return code.includes(q) || first.includes(q) || last.includes(q)
      })
    }

    // Type filter
    if (typeFilter === 'absent') list = list.filter(item => item.absentCount > 0)
    else if (typeFilter === 'leave') list = list.filter(item => item.leaveCount > 0)
    else if (typeFilter === 'late') list = list.filter(item => item.lateCount > 0)

    // Sort by total events DESC, then employee_code
    return list.sort((a, b) => {
      if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount
      return (a.employee?.employee_code || '').localeCompare(b.employee?.employee_code || '')
    })
  }, [monthlyLogs, searchTerm, typeFilter])

  // ── Open History Modal for an Employee ──
  const openEmployeeHistory = (emp: any) => {
    if (!emp) return
    setHistoryEmployee(emp)
    setIsHistoryModalOpen(true)
  }

  // ── Handle Delete Confirmation ──
  const handleDeleteConfirm = async () => {
    if (!itemToDelete) return
    setIsDeleting(true)
    try {
      await deleteAttendanceLog(itemToDelete.id)
      toast.success(
        `ลบรายการของ ${itemToDelete.employee ? formatEmployeeFullName(itemToDelete.employee as any, true) : 'พนักงาน'} เรียบร้อยแล้ว`
      )
      setItemToDelete(null)
      refetchLogs()
      queryClient.invalidateQueries({ queryKey: ['tpi-monthly-attendance'] })
      queryClient.invalidateQueries({ queryKey: ['tpi-daily-attendance'] })
    } catch (err: any) {
      console.error('Error deleting attendance log:', err)
      toast.error(err.message || 'ไม่สามารถลบรายการได้')
    } finally {
      setIsDeleting(false)
    }
  }

  // Format date helper (e.g. 25 ส.ค. 2569)
  const formatThaiDate = (dateStr: string) => {
    if (!dateStr) return '-'
    const parts = dateStr.split('-')
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10) + 543
      const monthNames = [
        'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
        'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
      ]
      const mIdx = parseInt(parts[1], 10) - 1
      return `${parseInt(parts[2], 10)} ${monthNames[mIdx]} ${year}`
    }
    return dateStr
  }

  return (
    <div
      className="vk-root"
      style={{
        background: 'var(--vk-paper)',
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* 1. Header Bar */}
      <TopBar title="ขาด / ลา / มาสาย" onMenuClick={onMenuClick} />

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div style={{ padding: '20px 24px 60px', maxWidth: 1400, width: '100%', margin: '0 auto' }}>
          {/* Header Row: Title & Actions */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 16,
              marginBottom: 20,
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: '#fee2e2',
                    border: '1px solid #fecaca',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <UserX style={{ width: 20, height: 20, color: '#dc2626' }} />
                </div>
                <div>
                  <h1
                    style={{
                      fontFamily: 'var(--vk-sans)',
                      fontSize: 22,
                      fontWeight: 800,
                      color: 'var(--vk-ink)',
                      margin: 0,
                      lineHeight: 1.2,
                    }}
                  >
                    บันทึกและประวัติ ขาด / ลา / มาสาย
                  </h1>
                  <p style={{ fontSize: 13, color: 'var(--vk-ink-3)', margin: '3px 0 0' }}>
                    ตรวจสอบประวัติการเข้างานย้อนหลังรายเดือน และผลกระทบต่อสิทธิ์เบี้ยขยัน (300 บ.)
                  </p>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                onClick={() => {
                  setEditingLog(null)
                  setIsEntryModalOpen(true)
                }}
                className="vk-btn vk-btn--primary"
                style={{
                  height: 38,
                  fontSize: 13,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0 16px',
                  borderRadius: 6,
                  fontWeight: 600,
                }}
              >
                <Plus style={{ width: 16, height: 16 }} />
                บันทึก ขาด / ลา / มาสาย
              </button>
            </div>
          </div>

          {/* Month Selector Bar */}
          <div
            style={{
              background: 'var(--vk-card)',
              border: '1px solid var(--vk-rule-soft)',
              borderRadius: 8,
              padding: '12px 16px',
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Calendar style={{ width: 18, height: 18, color: 'var(--vk-persimmon)' }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--vk-ink)' }}>
                เลือกดูข้อมูลประจำเดือน:
              </span>

              {/* Prev Month Button */}
              <button
                type="button"
                onClick={handlePrevMonth}
                disabled={selectedYear === currentYear && selectedMonth === 1}
                title="เดือนก่อนหน้า"
                className="vk-btn vk-btn--ghost"
                style={{
                  height: 32,
                  width: 32,
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 6,
                  opacity: selectedYear === currentYear && selectedMonth === 1 ? 0.35 : 1,
                  cursor: selectedYear === currentYear && selectedMonth === 1 ? 'not-allowed' : 'pointer',
                }}
              >
                <ChevronLeft style={{ width: 16, height: 16 }} />
              </button>

              {/* 1. Year Dropdown (ปีขึ้นก่อน) */}
              <select
                value={selectedYear}
                onChange={e => setSelectedYear(Number(e.target.value))}
                aria-label="เลือกปี"
                style={{
                  fontFamily: 'var(--vk-sans)',
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'var(--vk-ink)',
                  background: '#ffffff',
                  border: '1px solid var(--vk-rule)',
                  borderRadius: 6,
                  padding: '6px 10px',
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                {yearOptions.map(y => (
                  <option key={y} value={y}>
                    ปี {y + 543}
                  </option>
                ))}
              </select>

              {/* 2. Month Dropdown (ตามด้วยเดือน - เฉพาะชื่อเดือน) */}
              <select
                value={selectedMonth}
                onChange={e => setSelectedMonth(Number(e.target.value))}
                aria-label="เลือกเดือน"
                style={{
                  fontFamily: 'var(--vk-sans)',
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'var(--vk-ink)',
                  background: '#ffffff',
                  border: '1px solid var(--vk-rule)',
                  borderRadius: 6,
                  padding: '6px 12px',
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                {THAI_MONTH_NAMES.map((name, index) => (
                  <option key={index + 1} value={index + 1}>
                    {name}
                  </option>
                ))}
              </select>

              {/* Next Month Button */}
              <button
                type="button"
                onClick={handleNextMonth}
                disabled={selectedYear === currentYear + 4 && selectedMonth === 12}
                title="เดือนถัดไป"
                className="vk-btn vk-btn--ghost"
                style={{
                  height: 32,
                  width: 32,
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 6,
                  opacity: selectedYear === currentYear + 4 && selectedMonth === 12 ? 0.35 : 1,
                  cursor: selectedYear === currentYear + 4 && selectedMonth === 12 ? 'not-allowed' : 'pointer',
                }}
              >
                <ChevronRight style={{ width: 16, height: 16 }} />
              </button>

              {!isCurrentMonth && (
                <button
                  type="button"
                  onClick={handleResetCurrentMonth}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--vk-persimmon)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: '2px 4px',
                  }}
                >
                  กลับไปเดือนปัจจุบัน
                </button>
              )}
            </div>

            <div style={{ fontSize: 12, color: 'var(--vk-ink-3)', fontFamily: 'var(--vk-sans)' }}>
              ช่วงวันที่สแกน:{' '}
              <strong style={{ fontFamily: 'var(--vk-mono)', color: 'var(--vk-ink-2)' }}>
                {formatThaiDateShort(startDate)} ถึง {formatThaiDateShort(endDate)}
              </strong>
            </div>
          </div>

          {/* Metric Summary Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
              gap: 12,
              marginBottom: 16,
            }}
          >
            {/* 1. Affected Employees */}
            <div
              style={{
                background: 'var(--vk-card)',
                border: '1px solid var(--vk-rule-soft)',
                borderRadius: 8,
                padding: '14px 16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Users style={{ width: 15, height: 15, color: 'var(--vk-ink-3)' }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--vk-ink-3)' }}>
                  พนักงานที่ถูกบันทึก
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 24, fontWeight: 800, color: 'var(--vk-ink)' }}>
                  {monthlyMetrics.affectedEmployeesCount}
                </span>
                <span style={{ fontSize: 13, color: 'var(--vk-ink-3)' }}>คนในเดือนนี้</span>
              </div>
            </div>

            {/* 2. Absent */}
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 8,
                padding: '14px 16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#dc2626',
                    display: 'inline-block',
                  }}
                />
                <span style={{ fontSize: 12, fontWeight: 600, color: '#991b1b' }}>ขาดงาน</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 24, fontWeight: 800, color: '#dc2626' }}>
                  {monthlyMetrics.absentCount}
                </span>
                <span style={{ fontSize: 13, color: '#991b1b' }}>ครั้ง</span>
              </div>
            </div>

            {/* 3. Leave */}
            <div
              style={{
                background: '#fffbeb',
                border: '1px solid #fef3c7',
                borderRadius: 8,
                padding: '14px 16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#d97706',
                    display: 'inline-block',
                  }}
                />
                <span style={{ fontSize: 12, fontWeight: 600, color: '#92400e' }}>ลา</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 24, fontWeight: 800, color: '#d97706' }}>
                  {monthlyMetrics.leaveCount}
                </span>
                <span style={{ fontSize: 13, color: '#92400e' }}>ครั้ง</span>
              </div>
            </div>

            {/* 4. Late */}
            <div
              style={{
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: '14px 16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#4b5563',
                    display: 'inline-block',
                  }}
                />
                <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>มาสาย</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 24, fontWeight: 800, color: '#1f2937' }}>
                  {monthlyMetrics.lateCount}
                </span>
                <span style={{ fontSize: 13, color: '#4b5563' }}>ครั้ง</span>
                {monthlyMetrics.totalLateMinutes > 0 && (
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginLeft: 4 }}>
                    (รวม {monthlyMetrics.totalLateMinutes} นาที)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Diligence Information Banner */}
          <div
            style={{
              background: '#fff7ed',
              border: '1px solid #fed7aa',
              borderRadius: 8,
              padding: '10px 14px',
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 12,
              color: '#9a3412',
            }}
          >
            <Info style={{ width: 16, height: 16, color: '#c2410c', flexShrink: 0 }} />
            <div>
              <strong>หลักเกณฑ์เบี้ยขยัน (ทีพีไอ):</strong>{' '}
              ระบบคำนวณเงินเดือนจะสแกนข้อมูล ขาด / ลา / มาสาย ของพนักงาน
              <strong>ตลอดทั้งเดือนปฏิทิน (วันที่ 1 ถึงสิ้นเดือน)</strong>{' '}
              หากพนักงานคนใดมีประวัติบันทึกในเดือนนี้แม้แต่ครั้งเดียว (ทั้งในงวดแรกหรือย้อนหลัง) จะ
              <span style={{ color: '#b91c1c', fontWeight: 700 }}>
                {' '}
                ถูกตัดสิทธิ์เบี้ยขยัน (300 บาท) ในงวดสิ้นเดือน{' '}
              </span>
              โดยอัตโนมัติ
            </div>
          </div>

          {/* Controls Bar: Search, Type Filter, View Switcher */}
          <div
            style={{
              background: 'var(--vk-card)',
              border: '1px solid var(--vk-rule-soft)',
              borderRadius: 8,
              padding: '12px 16px',
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            {/* Search Input */}
            <div style={{ position: 'relative', minWidth: 240, flex: 1 }}>
              <Search
                style={{
                  width: 14,
                  height: 14,
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--vk-ink-4)',
                  pointerEvents: 'none',
                }}
              />
              <input
                type="text"
                placeholder="ค้นหาชื่อ, รหัสพนักงาน หรือ เหตุผล..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{
                  width: '100%',
                  height: 36,
                  fontSize: 13,
                  padding: '0 10px 0 32px',
                  borderRadius: 6,
                  border: '1px solid var(--vk-rule)',
                  background: '#ffffff',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Type Filter Buttons */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {[
                { id: 'all' as const, label: 'ทั้งหมด' },
                { id: 'absent' as const, label: 'ขาดงาน' },
                { id: 'leave' as const, label: 'ลา' },
                { id: 'late' as const, label: 'มาสาย' },
              ].map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setTypeFilter(f.id)}
                  style={{
                    padding: '6px 12px',
                    fontSize: 12,
                    fontWeight: typeFilter === f.id ? 700 : 500,
                    borderRadius: 6,
                    border: typeFilter === f.id ? '1px solid var(--vk-persimmon)' : '1px solid var(--vk-rule-soft)',
                    background: typeFilter === f.id ? 'var(--vk-persimmon)' : '#ffffff',
                    color: typeFilter === f.id ? '#ffffff' : 'var(--vk-ink-2)',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* View Mode Switcher (All Records vs By Employee) */}
            <div
              style={{
                display: 'flex',
                background: 'var(--vk-bone)',
                borderRadius: 6,
                padding: 2,
                border: '1px solid var(--vk-rule-soft)',
              }}
            >
              <button
                type="button"
                onClick={() => setViewMode('records')}
                style={{
                  padding: '5px 12px',
                  fontSize: 12,
                  fontWeight: viewMode === 'records' ? 700 : 500,
                  borderRadius: 4,
                  border: 'none',
                  background: viewMode === 'records' ? '#ffffff' : 'transparent',
                  color: viewMode === 'records' ? 'var(--vk-ink)' : 'var(--vk-ink-3)',
                  boxShadow: viewMode === 'records' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  cursor: 'pointer',
                }}
              >
                รายการทั้งหมด ({filteredLogs.length})
              </button>
              <button
                type="button"
                onClick={() => setViewMode('employees')}
                style={{
                  padding: '5px 12px',
                  fontSize: 12,
                  fontWeight: viewMode === 'employees' ? 700 : 500,
                  borderRadius: 4,
                  border: 'none',
                  background: viewMode === 'employees' ? '#ffffff' : 'transparent',
                  color: viewMode === 'employees' ? 'var(--vk-ink)' : 'var(--vk-ink-3)',
                  boxShadow: viewMode === 'employees' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  cursor: 'pointer',
                }}
              >
                สรุปรายคน ({employeeSummaries.length})
              </button>
            </div>
          </div>

          {/* ── Table View 1: All Records (รายการทั้งหมด) ── */}
          {viewMode === 'records' && (
            <div
              style={{
                background: '#ffffff',
                border: '1px solid var(--vk-rule-soft)',
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              {isLogsLoading ? (
                <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--vk-ink-3)', fontSize: 13 }}>
                  กำลังโหลดข้อมูล...
                </div>
              ) : filteredLogs.length === 0 ? (
                <div
                  style={{
                    padding: '48px 16px',
                    textAlign: 'center',
                    color: 'var(--vk-ink-3)',
                    fontSize: 13,
                  }}
                >
                  {monthlyLogs.length === 0 ? (
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--vk-ink-2)', marginBottom: 4 }}>
                        ไม่มีการบันทึก ขาด / ลา / มาสาย ในเดือน{selectedMonthDisplay}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--vk-ink-4)' }}>
                        พนักงานทุกคนมีสิทธิ์รับเบี้ยขยัน (300 บาท) ตามเกณฑ์ปกติ
                      </div>
                    </div>
                  ) : (
                    'ไม่พบรายการตามเงื่อนไขการค้นหา'
                  )}
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
                  <thead>
                    <tr
                      style={{
                        background: 'var(--vk-paper)',
                        borderBottom: '1px solid var(--vk-rule-soft)',
                        color: 'var(--vk-ink-2)',
                      }}
                    >
                      <th style={{ padding: '10px 16px', fontWeight: 600, width: 140, minWidth: 140, whiteSpace: 'nowrap' }}>วันที่</th>
                      <th style={{ padding: '10px 14px', fontWeight: 600, width: 90, minWidth: 90, whiteSpace: 'nowrap' }}>รหัส</th>
                      <th style={{ padding: '10px 14px', fontWeight: 600, minWidth: 180 }}>ชื่อ - สกุล (คลิกเพื่อดูประวัติ)</th>
                      <th style={{ padding: '10px 14px', fontWeight: 600, width: 100, minWidth: 100, textAlign: 'center', whiteSpace: 'nowrap' }}>ประเภท</th>
                      <th style={{ padding: '10px 16px', fontWeight: 600 }}>เหตุผล / รายละเอียด</th>
                      <th style={{ padding: '10px 14px', textAlign: 'center', width: 90, minWidth: 90, whiteSpace: 'nowrap' }}>จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLogs.map((item, idx) => {
                      const emp = item.employee
                      const typeLabel = getAttendanceTypeLabel(item.type, item.leave_type)
                      const isAbsent = item.type === 'absent'
                      const isLeave = item.type === 'leave'
                      const isLate = item.type === 'late'

                      return (
                        <tr
                          key={item.id}
                          style={{
                            borderBottom: idx === filteredLogs.length - 1 ? 'none' : '1px solid var(--vk-rule-soft)',
                            background: idx % 2 === 0 ? '#fff' : '#faf9f6',
                          }}
                        >
                          <td
                            style={{
                              padding: '10px 14px',
                              fontFamily: 'var(--vk-mono)',
                              fontWeight: 600,
                              color: 'var(--vk-ink)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {formatThaiDate(item.work_date)}
                          </td>
                          <td
                            style={{
                              padding: '10px 14px',
                              fontFamily: 'var(--vk-mono)',
                              fontWeight: 600,
                              color: 'var(--vk-ink-3)',
                            }}
                          >
                            {emp?.employee_code || '-'}
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            <button
                              type="button"
                              onClick={() => openEmployeeHistory(emp)}
                              title="คลิกเพื่อดูประวัติย้อนหลังทั้งหมดของพนักงานคนนี้"
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                cursor: 'pointer',
                                textAlign: 'left',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                color: 'var(--vk-persimmon)',
                                fontWeight: 600,
                                fontSize: 13,
                              }}
                            >
                              <span style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>
                                {emp ? formatEmployeeFullName(emp as any, true) : 'ไม่พบข้อมูล'}
                              </span>
                              <History style={{ width: 12, height: 12, opacity: 0.6 }} />
                            </button>

                            {emp?.position === 'clerk' && (
                              <span
                                style={{
                                  marginLeft: 8,
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: '1px 5px',
                                  borderRadius: 4,
                                  background: '#ffedd5',
                                  color: '#c2410c',
                                }}
                              >
                                เสมียน
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '3px 10px',
                                borderRadius: 999,
                                fontSize: 11,
                                fontWeight: 700,
                                background: isAbsent ? '#fee2e2' : isLeave ? '#fef3c7' : '#f3f4f6',
                                color: isAbsent ? '#b91c1c' : isLeave ? '#b45309' : '#374151',
                                border: `1px solid ${isAbsent ? '#fca5a5' : isLeave ? '#fcd34d' : '#d1d5db'}`,
                              }}
                            >
                              {typeLabel}
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px', color: 'var(--vk-ink-2)' }}>
                            {item.minutes_late ? (
                              <span style={{ fontWeight: 600, color: 'var(--vk-ink)', marginRight: 6 }}>
                                สาย {item.minutes_late} นาที
                              </span>
                            ) : null}
                            {item.reason ? (
                              <span>{item.reason}</span>
                            ) : item.minutes_late ? null : (
                              <span style={{ color: 'var(--vk-ink-4)' }}>-</span>
                            )}
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingLog(item)
                                  setIsEntryModalOpen(true)
                                }}
                                title="แก้ไขรายการ"
                                style={{
                                  border: 'none',
                                  background: 'transparent',
                                  color: 'var(--vk-ink-3)',
                                  cursor: 'pointer',
                                  padding: 4,
                                  borderRadius: 4,
                                }}
                              >
                                <Edit2 style={{ width: 14, height: 14 }} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setItemToDelete(item)}
                                title="ลบรายการนี้"
                                style={{
                                  border: 'none',
                                  background: 'transparent',
                                  color: '#dc2626',
                                  cursor: 'pointer',
                                  padding: 4,
                                  borderRadius: 4,
                                }}
                              >
                                <Trash2 style={{ width: 14, height: 14 }} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── Table View 2: Summary by Employee (สรุปรายบุคคล) ── */}
          {viewMode === 'employees' && (
            <div
              style={{
                background: '#ffffff',
                border: '1px solid var(--vk-rule-soft)',
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              {isLogsLoading ? (
                <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--vk-ink-3)', fontSize: 13 }}>
                  กำลังโหลดข้อมูล...
                </div>
              ) : employeeSummaries.length === 0 ? (
                <div
                  style={{
                    padding: '48px 16px',
                    textAlign: 'center',
                    color: 'var(--vk-ink-3)',
                    fontSize: 13,
                  }}
                >
                  ไม่มีพนักงานที่มีประวัติ ขาด/ลา/มาสาย ในเดือน{selectedMonthDisplay}
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
                  <thead>
                    <tr
                      style={{
                        background: 'var(--vk-paper)',
                        borderBottom: '1px solid var(--vk-rule-soft)',
                        color: 'var(--vk-ink-2)',
                      }}
                    >
                      <th style={{ padding: '10px 14px', fontWeight: 600, width: 90 }}>รหัส</th>
                      <th style={{ padding: '10px 14px', fontWeight: 600 }}>ชื่อ - สกุล (คลิกเพื่อดูประวัติ)</th>
                      <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'center', width: 90 }}>
                        ขาดงาน
                      </th>
                      <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'center', width: 80 }}>ลา</th>
                      <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'center', width: 130 }}>
                        มาสาย
                      </th>
                      <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'center', width: 90 }}>
                        รวมครั้ง
                      </th>
                      <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'center', width: 160 }}>
                        ผลกระทบเบี้ยขยัน
                      </th>
                      <th style={{ padding: '10px 14px', textAlign: 'center', width: 110 }}>ประวัติเก่า</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employeeSummaries.map((item, idx) => {
                      const emp = item.employee

                      return (
                        <tr
                          key={item.employee_id}
                          style={{
                            borderBottom: idx === employeeSummaries.length - 1 ? 'none' : '1px solid var(--vk-rule-soft)',
                            background: idx % 2 === 0 ? '#fff' : '#faf9f6',
                          }}
                        >
                          <td
                            style={{
                              padding: '12px 14px',
                              fontFamily: 'var(--vk-mono)',
                              fontWeight: 600,
                              color: 'var(--vk-ink)',
                            }}
                          >
                            {emp?.employee_code || '-'}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <button
                              type="button"
                              onClick={() => openEmployeeHistory(emp)}
                              title="คลิกเพื่อดูประวัติย้อนหลังทั้งหมดของพนักงานคนนี้"
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                cursor: 'pointer',
                                textAlign: 'left',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                color: 'var(--vk-persimmon)',
                                fontWeight: 600,
                                fontSize: 13,
                              }}
                            >
                              <span style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>
                                {emp ? formatEmployeeFullName(emp as any, true) : 'ไม่พบข้อมูล'}
                              </span>
                              <History style={{ width: 12, height: 12, opacity: 0.6 }} />
                            </button>

                            {emp?.position === 'clerk' && (
                              <span
                                style={{
                                  marginLeft: 8,
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: '1px 5px',
                                  borderRadius: 4,
                                  background: '#ffedd5',
                                  color: '#c2410c',
                                }}
                              >
                                เสมียน
                              </span>
                            )}
                          </td>
                          <td
                            style={{
                              padding: '12px 14px',
                              textAlign: 'center',
                              fontFamily: 'var(--vk-mono)',
                              fontWeight: item.absentCount > 0 ? 700 : 400,
                              color: item.absentCount > 0 ? '#dc2626' : 'var(--vk-ink-4)',
                            }}
                          >
                            {item.absentCount > 0 ? `${item.absentCount} ครั้ง` : '-'}
                          </td>
                          <td
                            style={{
                              padding: '12px 14px',
                              textAlign: 'center',
                              fontFamily: 'var(--vk-mono)',
                              fontWeight: item.leaveCount > 0 ? 700 : 400,
                              color: item.leaveCount > 0 ? '#d97706' : 'var(--vk-ink-4)',
                            }}
                          >
                            {item.leaveCount > 0 ? `${item.leaveCount} ครั้ง` : '-'}
                          </td>
                          <td
                            style={{
                              padding: '12px 14px',
                              textAlign: 'center',
                              fontFamily: 'var(--vk-mono)',
                              fontWeight: item.lateCount > 0 ? 700 : 400,
                              color: item.lateCount > 0 ? '#374151' : 'var(--vk-ink-4)',
                            }}
                          >
                            {item.lateCount > 0 ? (
                              <span>
                                {item.lateCount} ครั้ง{' '}
                                {item.lateMinutes > 0 && (
                                  <span style={{ fontSize: 11, color: '#6b7280' }}>({item.lateMinutes} น.)</span>
                                )}
                              </span>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td
                            style={{
                              padding: '12px 14px',
                              textAlign: 'center',
                              fontFamily: 'var(--vk-mono)',
                              fontWeight: 700,
                              color: 'var(--vk-ink)',
                            }}
                          >
                            {item.totalCount}
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                padding: '2px 8px',
                                borderRadius: 4,
                                fontSize: 11,
                                fontWeight: 700,
                                background: '#fef2f2',
                                color: '#b91c1c',
                                border: '1px solid #fecaca',
                              }}
                            >
                              ตัดสิทธิ์เบี้ยขยัน (300 บ.)
                            </span>
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => openEmployeeHistory(emp)}
                              className="vk-btn vk-btn--ghost"
                              style={{
                                padding: '3px 8px',
                                fontSize: 11,
                                height: 26,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <History style={{ width: 12, height: 12 }} />
                              ดูประวัติ
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal 1: Entry / Edit Modal */}
      <AttendanceEntryModal
        isOpen={isEntryModalOpen}
        onClose={() => {
          setIsEntryModalOpen(false)
          setEditingLog(null)
        }}
        factoryId={user?.factory_id || ''}
        defaultDate={`${selectedYearMonth}-01`}
        initialLog={editingLog}
        employees={employees}
        onSuccess={() => {
          refetchLogs()
          queryClient.invalidateQueries({ queryKey: ['tpi-monthly-attendance'] })
          queryClient.invalidateQueries({ queryKey: ['tpi-daily-attendance'] })
        }}
      />

      {/* Modal 2: Employee Attendance History Modal */}
      <EmployeeAttendanceHistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => {
          setIsHistoryModalOpen(false)
          setHistoryEmployee(null)
        }}
        factoryId={user?.factory_id || ''}
        employee={historyEmployee}
      />

      {/* Modal 3: Deletion Confirmation Modal */}
      {itemToDelete && (
        <div
          className="vk-modal-backdrop"
          style={{ zIndex: 10000 }}
          onClick={() => setItemToDelete(null)}
        >
          <div
            className="vk-modal-container"
            style={{ maxWidth: 440 }}
            onClick={e => e.stopPropagation()}
          >
            <div className="vk-modal-header">
              <div className="vk-modal-header-left">
                <h3 className="vk-modal-title" style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#dc2626' }}>
                  <AlertTriangle style={{ width: 18, height: 18, color: '#dc2626' }} />
                  ยืนยันการลบรายการ
                </h3>
              </div>
              <button
                type="button"
                className="vk-modal-btn-close"
                onClick={() => setItemToDelete(null)}
              >
                <X style={{ width: 18, height: 18 }} />
              </button>
            </div>

            <div className="vk-modal-body">
              <p style={{ fontSize: 13, color: 'var(--vk-ink)', margin: '0 0 12px', lineHeight: 1.5 }}>
                คุณต้องการลบรายการ{' '}
                <strong>{getAttendanceTypeLabel(itemToDelete.type, itemToDelete.leave_type)}</strong>{' '}
                ของ{' '}
                <strong>
                  {itemToDelete.employee
                    ? `${itemToDelete.employee.employee_code} - ${formatEmployeeFullName(itemToDelete.employee as any, true)}`
                    : 'พนักงาน'}
                </strong>{' '}
                ประจำวันที่ <strong>{formatThaiDate(itemToDelete.work_date)}</strong> หรือไม่?
              </p>
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 6,
                  padding: '8px 12px',
                  fontSize: 12,
                  color: '#991b1b',
                }}
              >
                เมื่อลบแล้ว สิทธิ์เบี้ยขยันของพนักงานในเดือนนี้จะถูกคำนวณใหม่โดยอัตโนมัติ
              </div>
            </div>

            <div className="vk-modal-bottom-actions">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setItemToDelete(null)}
                className="vk-btn vk-btn-secondary"
                style={{ fontSize: 13, padding: '6px 16px' }}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleDeleteConfirm}
                className="vk-btn"
                style={{
                  background: '#dc2626',
                  color: '#ffffff',
                  fontSize: 13,
                  padding: '6px 16px',
                  border: 'none',
                  borderRadius: 6,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {isDeleting ? 'กำลังลบ...' : 'ยืนยันลบรายการ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
