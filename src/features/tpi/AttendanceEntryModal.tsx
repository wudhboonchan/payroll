import React, { useState, useEffect, useMemo } from 'react'
import {
  X,
  AlertCircle,
  Clock,
  Calendar,
  UserX,
  Plus,
  CheckCircle2,
  Search,
  Save,
  Edit2
} from 'lucide-react'
import { toast } from 'sonner'
import type { AttendanceLog, AttendanceType } from './attendanceApi'
import { saveAttendanceLog, updateAttendanceLog } from './attendanceApi'
import { formatEmployeeFullName } from '../../lib/formatters'
import { ThaiDatePicker } from '../../components/common/ThaiDatePicker'

interface Props {
  isOpen: boolean
  onClose: () => void
  factoryId: string
  defaultDate?: string
  initialLog?: AttendanceLog | null
  employees: Array<{
    id: string
    employee_code: string
    first_name: string
    last_name?: string | null
    position?: string | null
    nationality?: string | null
  }>
  onSuccess?: () => void
}

export const AttendanceEntryModal: React.FC<Props> = ({
  isOpen,
  onClose,
  factoryId,
  defaultDate,
  initialLog,
  employees,
  onSuccess,
}) => {
  const [selectedEmpId, setSelectedEmpId] = useState<string>('')
  const [workDate, setWorkDate] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [type, setType] = useState<AttendanceType>('absent')
  const [minutesLate, setMinutesLate] = useState<number | ''>('')
  const [reason, setReason] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEditMode = Boolean(initialLog)

  useEffect(() => {
    if (isOpen) {
      if (initialLog) {
        setSelectedEmpId(initialLog.employee_id)
        setWorkDate(initialLog.work_date)
        setType(initialLog.type)
        setMinutesLate(initialLog.minutes_late ?? '')
        setReason(initialLog.reason ?? '')
      } else {
        const todayStr = new Date().toISOString().slice(0, 10)
        setSelectedEmpId('')
        setWorkDate(defaultDate || todayStr)
        setType('absent')
        setMinutesLate('')
        setReason('')
      }
      setSearchTerm('')
      setError(null)
    }
  }, [isOpen, initialLog, defaultDate])

  const filteredEmployees = useMemo(() => {
    if (!searchTerm.trim()) return employees
    const lower = searchTerm.toLowerCase().trim()
    return employees.filter(
      emp =>
        emp.employee_code.toLowerCase().includes(lower) ||
        emp.first_name.toLowerCase().includes(lower) ||
        (emp.last_name && emp.last_name.toLowerCase().includes(lower))
    )
  }, [employees, searchTerm])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedEmpId) {
      setError('กรุณาเลือกพนักงาน')
      return
    }
    if (!workDate) {
      setError('กรุณาระบุวันที่')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      if (isEditMode && initialLog) {
        await updateAttendanceLog(initialLog.id, {
          work_date: workDate,
          type,
          leave_type: null,
          minutes_late: type === 'late' ? Number(minutesLate) || null : null,
          reason: reason.trim() || null,
        })
        toast.success('แก้ไขข้อมูล ขาด/ลา/มาสาย เรียบร้อยแล้ว')
      } else {
        await saveAttendanceLog({
          factory_id: factoryId,
          employee_id: selectedEmpId,
          work_date: workDate,
          type,
          leave_type: null,
          minutes_late: type === 'late' ? Number(minutesLate) || null : null,
          reason: reason.trim() || null,
        })
        toast.success('บันทึกข้อมูล ขาด/ลา/มาสาย เรียบร้อยแล้ว')
      }

      if (onSuccess) onSuccess()
      onClose()
    } catch (err: any) {
      console.error('Error saving attendance log:', err)
      setError(err.message || 'ไม่สามารถบันทึกข้อมูลได้')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="vk-modal-backdrop"
      style={{ zIndex: 9999 }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="vk-modal-container"
        style={{ maxWidth: 600 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="vk-modal-header">
          <div className="vk-modal-header-left">
            <h3 className="vk-modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <UserX style={{ width: 18, height: 18, color: 'var(--vk-persimmon)' }} />
              {isEditMode ? 'แก้ไขรายการ ขาด / ลา / มาสาย' : 'บันทึก ขาด / ลา / มาสาย'}
            </h3>
            <div className="vk-modal-subtitle">
              {isEditMode
                ? 'แก้ไขรายละเอียดรายการที่มีอยู่'
                : 'บันทึกประวัติเพื่อใช้ในการคำนวณเบี้ยขยันและติดตามการเข้างาน'}
            </div>
          </div>
          <button type="button" className="vk-modal-btn-close" onClick={onClose} title="ปิด">
            <X style={{ width: 18, height: 18 }} />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit}>
          <div className="vk-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {error && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #f87171',
                  borderRadius: 8,
                  padding: '10px 14px',
                  color: '#991b1b',
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <AlertCircle style={{ width: 16, height: 16, flexShrink: 0 }} />
                <div>{error}</div>
              </div>
            )}

            {/* Row 1: Date Picker */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--vk-ink-2)',
                  marginBottom: 6,
                }}
              >
                วันที่เกิดรายการ <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <div>
                <ThaiDatePicker
                  value={workDate}
                  onChange={val => setWorkDate(val || '')}
                  required
                  placeholder="วว/ดด/ปปปป (พ.ศ.)"
                />
              </div>
            </div>

            {/* Row 2: Employee Selector */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--vk-ink-2)',
                  marginBottom: 6,
                }}
              >
                พนักงาน <span style={{ color: '#dc2626' }}>*</span>
              </label>

              {isEditMode ? (
                <div
                  style={{
                    padding: '10px 14px',
                    background: 'var(--vk-bone)',
                    border: '1px solid var(--vk-rule-soft)',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--vk-ink)',
                  }}
                >
                  {initialLog?.employee ? (
                    <>
                      {initialLog.employee.employee_code} · {formatEmployeeFullName(initialLog.employee as any, true)}
                      {initialLog.employee.position === 'clerk' && (
                        <span
                          style={{
                            marginLeft: 6,
                            fontSize: 9,
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
                    </>
                  ) : (
                    'พนักงาน'
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
                  <div style={{ position: 'relative' }}>
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
                      placeholder="ค้นหาชื่อ หรือ รหัสพนักงาน..."
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      style={{
                        width: '100%',
                        height: 36,
                        fontSize: 13,
                        padding: '0 10px 0 32px',
                        borderRadius: 6,
                        border: '1px solid var(--vk-rule)',
                        boxSizing: 'border-box',
                        background: '#fff',
                      }}
                    />
                  </div>

                  <select
                    value={selectedEmpId}
                    onChange={e => setSelectedEmpId(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      height: 38,
                      fontSize: 13,
                      padding: '0 12px',
                      borderRadius: 6,
                      border: '1px solid var(--vk-rule)',
                      background: '#fff',
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="">-- กรุณาเลือกพนักงาน ({filteredEmployees.length} คน) --</option>
                    {filteredEmployees.map(emp => (
                      <option key={emp.id} value={emp.id}>
                        {emp.employee_code} · {formatEmployeeFullName(emp as any, true)}{' '}
                        {emp.position === 'clerk' ? '[เสมียน]' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Row 3: Attendance Type Buttons */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--vk-ink-2)',
                  marginBottom: 6,
                }}
              >
                ประเภทการลงบันทึก <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 8, flex: 1, height: 38 }}>
                  {[
                    { id: 'absent' as AttendanceType, label: 'ขาดงาน', color: '#dc2626', bg: '#fee2e2' },
                    { id: 'leave' as AttendanceType, label: 'ลา', color: '#d97706', bg: '#fef3c7' },
                    { id: 'late' as AttendanceType, label: 'มาสาย', color: '#4b5563', bg: '#f3f4f6' },
                  ].map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setType(t.id)}
                      style={{
                        flex: 1,
                        height: 38,
                        padding: '0 12px',
                        fontSize: 13,
                        fontWeight: type === t.id ? 700 : 500,
                        borderRadius: 6,
                        border: type === t.id ? `2px solid ${t.color}` : '1px solid var(--vk-rule-soft)',
                        background: type === t.id ? t.bg : '#fff',
                        color: type === t.id ? t.color : 'var(--vk-ink-2)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxSizing: 'border-box',
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {type === 'late' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38, flexShrink: 0 }}>
                    <input
                      type="number"
                      placeholder="กี่นาที"
                      min="1"
                      required
                      value={minutesLate}
                      onChange={e => setMinutesLate(e.target.value === '' ? '' : Number(e.target.value))}
                      style={{
                        width: 85,
                        height: 38,
                        fontSize: 13,
                        padding: '0 8px',
                        borderRadius: 6,
                        border: '1px solid var(--vk-rule)',
                        textAlign: 'right',
                        boxSizing: 'border-box',
                        background: '#fff',
                      }}
                    />
                    <span style={{ fontSize: 13, color: 'var(--vk-ink-3)', whiteSpace: 'nowrap' }}>นาที</span>
                  </div>
                )}
              </div>
            </div>

            {/* Row 4: Reason / Note */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--vk-ink-2)',
                  marginBottom: 6,
                }}
              >
                เหตุผล / หมายเหตุ
              </label>
              <input
                type="text"
                placeholder="เช่น ลาป่วยมีใบรับรอง, ลากิจฉุกเฉิน, รถเสีย, ขาดงานติดต่อไม่ได้..."
                value={reason}
                onChange={e => setReason(e.target.value)}
                style={{
                  width: '100%',
                  height: 38,
                  fontSize: 13,
                  padding: '0 12px',
                  borderRadius: 6,
                  border: '1px solid var(--vk-rule)',
                  boxSizing: 'border-box',
                  background: '#fff',
                }}
              />
            </div>
          </div>

          {/* Modal Footer */}
          <div className="vk-modal-bottom-actions">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="vk-btn vk-btn-secondary"
              style={{ fontSize: 13, padding: '6px 18px' }}
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="vk-btn vk-btn--primary"
              style={{
                fontSize: 13,
                padding: '6px 20px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Save style={{ width: 15, height: 15 }} />
              {submitting ? 'กำลังบันทึก...' : isEditMode ? 'บันทึกการแก้ไข' : 'บันทึกรายการ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
