import React, { useState, useEffect, useMemo } from 'react'
import {
  X,
  AlertCircle,
  Clock,
  Calendar,
  Trash2,
  UserX,
  Plus,
  CheckCircle2,
  Search,
  AlertTriangle
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  AttendanceLog,
  AttendanceType,
} from './attendanceApi'
import {
  loadDailyAttendance,
  saveAttendanceLog,
  deleteAttendanceLog,
  getAttendanceTypeLabel,
} from './attendanceApi'
import { formatEmployeeFullName } from '../../lib/formatters'

interface Props {
  isOpen: boolean
  onClose: () => void
  factoryId: string
  workDate: string
  employees: Array<{
    id: string
    employee_code: string
    first_name: string
    last_name: string
    position?: string | null
    nationality?: string | null
  }>
  onChanged?: () => void
}

export const AttendanceModal: React.FC<Props> = ({
  isOpen,
  onClose,
  factoryId,
  workDate,
  employees,
  onChanged
}) => {
  const [logs, setLogs] = useState<AttendanceLog[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Form State
  const [selectedEmpId, setSelectedEmpId] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [type, setType] = useState<AttendanceType>('absent')
  const [minutesLate, setMinutesLate] = useState<number | ''>('')
  const [reason, setReason] = useState<string>('')

  // Load attendance data whenever modal opens or date changes
  const refreshLogs = async () => {
    if (!factoryId || !workDate) return
    setLoading(true)
    setError(null)
    try {
      const data = await loadDailyAttendance(factoryId, workDate)
      setLogs(data)
    } catch (err: any) {
      console.error('Error loading attendance logs:', err)
      setError(err.message || 'ไม่สามารถโหลดข้อมูล ขาด/ลา/มาสาย ได้')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      refreshLogs()
      setSelectedEmpId('')
      setSearchTerm('')
      setType('absent')
      setMinutesLate('')
      setReason('')
      setError(null)
      setSuccessMsg(null)
    }
  }, [isOpen, factoryId, workDate])

  // Filtered employees for dropdown
  const filteredEmployees = useMemo(() => {
    if (!searchTerm.trim()) return employees
    const lower = searchTerm.toLowerCase().trim()
    return employees.filter(emp =>
      emp.employee_code.toLowerCase().includes(lower) ||
      emp.first_name.toLowerCase().includes(lower) ||
      emp.last_name.toLowerCase().includes(lower)
    )
  }, [employees, searchTerm])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedEmpId) {
      setError('กรุณาเลือกพนักงาน')
      return
    }

    setSubmitting(true)
    setError(null)
    setSuccessMsg(null)

    try {
      await saveAttendanceLog({
        factory_id: factoryId,
        employee_id: selectedEmpId,
        work_date: workDate,
        type,
        leave_type: null,
        minutes_late: type === 'late' ? (Number(minutesLate) || null) : null,
        reason: reason.trim() || null
      })

      setSuccessMsg('บันทึกรายการเรียบร้อยแล้ว')
      setTimeout(() => setSuccessMsg(null), 3000)

      // Reset form
      setSelectedEmpId('')
      setSearchTerm('')
      setReason('')
      setMinutesLate('')

      // Refresh list
      await refreshLogs()
      if (onChanged) onChanged()
    } catch (err: any) {
      console.error('Error saving attendance log:', err)
      setError(err.message || 'ไม่สามารถบันทึกรายการได้')
    } finally {
      setSubmitting(false)
    }
  }

  // Themed Deletion Confirmation State
  const [itemToDelete, setItemToDelete] = useState<AttendanceLog | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const confirmDelete = async () => {
    if (!itemToDelete) return
    setIsDeleting(true)
    try {
      await deleteAttendanceLog(itemToDelete.id)
      toast.success(
        `ลบรายการของ ${itemToDelete.employee ? formatEmployeeFullName(itemToDelete.employee as any, true) : 'พนักงาน'} เรียบร้อยแล้ว`
      )
      setItemToDelete(null)
      await refreshLogs()
      if (onChanged) onChanged()
    } catch (err: any) {
      console.error('Error deleting attendance log:', err)
      toast.error(err.message || 'ไม่สามารถลบรายการได้')
    } finally {
      setIsDeleting(false)
    }
  }

  if (!isOpen) return null

  // Format date display (Thai)
  const formattedDate = (() => {
    if (!workDate) return ''
    try {
      const parts = workDate.split('-')
      if (parts.length === 3) {
        const year = parseInt(parts[0], 10) + 543
        const monthNames = [
          'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
          'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
        ]
        const mIdx = parseInt(parts[1], 10) - 1
        return `${parseInt(parts[2], 10)} ${monthNames[mIdx]} ${year}`
      }
    } catch (e) {}
    return workDate
  })()

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
        style={{ maxWidth: 720 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="vk-modal-header">
          <div className="vk-modal-header-left">
            <h3 className="vk-modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <UserX style={{ width: 18, height: 18, color: 'var(--vk-persimmon)' }} />
              บันทึก ขาด / ลา / มาสาย
            </h3>
            <div className="vk-modal-subtitle">
              ประจำวันที่ <strong style={{ color: 'var(--vk-ink)' }}>{formattedDate}</strong>
            </div>
          </div>
          <button
            type="button"
            className="vk-modal-btn-close"
            onClick={onClose}
          >
            <X style={{ width: 18, height: 18 }} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="vk-modal-body">
          {error && (
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #f87171',
                borderRadius: 8,
                padding: '10px 14px',
                marginBottom: 16,
                color: '#991b1b',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}
            >
              <AlertCircle style={{ width: 16, height: 16, flexShrink: 0 }} />
              <div>{error}</div>
            </div>
          )}

          {successMsg && (
            <div
              style={{
                background: '#ecfdf5',
                border: '1px solid #34d399',
                borderRadius: 8,
                padding: '10px 14px',
                marginBottom: 16,
                color: '#065f46',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}
            >
              <CheckCircle2 style={{ width: 16, height: 16, flexShrink: 0 }} />
              <div>{successMsg}</div>
            </div>
          )}

          {/* New Entry Form Box */}
          <form
            onSubmit={handleAdd}
            style={{
              background: '#fcfbf9',
              border: '1px solid var(--vk-rule-soft)',
              borderRadius: 8,
              padding: 16,
              marginBottom: 20
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--vk-ink)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Plus style={{ width: 15, height: 15, color: 'var(--vk-persimmon)' }} />
              เพิ่มรายการใหม่สำหรับวันนี้
            </div>

            {/* Row 1: Employee Selector */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--vk-ink-2)', marginBottom: 6 }}>
                เลือกพนักงาน <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <div style={{ display: 'flex', gap: 10, height: 38, width: '100%' }}>
                <div style={{ position: 'relative', width: 200, flexShrink: 0, height: 38 }}>
                  <Search style={{ width: 14, height: 14, position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--vk-ink-4)', pointerEvents: 'none' }} />
                  <input
                    type="text"
                    placeholder="ค้นหาชื่อ หรือ รหัส..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    style={{
                      width: '100%',
                      height: 38,
                      fontSize: 13,
                      padding: '0 10px 0 30px',
                      borderRadius: 6,
                      border: '1px solid var(--vk-rule)',
                      boxSizing: 'border-box',
                      background: '#fff'
                    }}
                  />
                </div>
                <select
                  value={selectedEmpId}
                  onChange={e => setSelectedEmpId(e.target.value)}
                  required
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 38,
                    fontSize: 13,
                    padding: '0 12px',
                    borderRadius: 6,
                    border: '1px solid var(--vk-rule)',
                    background: '#fff',
                    boxSizing: 'border-box'
                  }}
                >
                  <option value="">-- กรุณาเลือกพนักงาน ({filteredEmployees.length} คน) --</option>
                  {filteredEmployees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.employee_code} · {formatEmployeeFullName(emp as any, true)} {emp.position === 'clerk' ? '[เสมียน]' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Row 2: Attendance Type */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--vk-ink-2)', marginBottom: 6 }}>
                ประเภทการลงบันทึก <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <div style={{ display: 'flex', gap: 10, height: 38, alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 8, flex: 1, height: 38 }}>
                  {[
                    { id: 'absent' as AttendanceType, label: 'ขาดงาน', color: '#dc2626', bg: '#fee2e2' },
                    { id: 'leave' as AttendanceType, label: 'ลา', color: '#d97706', bg: '#fef3c7' },
                    { id: 'late' as AttendanceType, label: 'มาสาย', color: '#4b5563', bg: '#f3f4f6' }
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
                        transition: 'all 0.15s'
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
                        background: '#fff'
                      }}
                    />
                    <span style={{ fontSize: 13, color: 'var(--vk-ink-3)', whiteSpace: 'nowrap' }}>นาที</span>
                  </div>
                )}
              </div>
            </div>

            {/* Row 3: Reason / Note input */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--vk-ink-2)', marginBottom: 6 }}>
                เหตุผล / หมายเหตุ (ถ้ามี)
              </label>
              <input
                type="text"
                placeholder="เช่น ลาโดยไม่มีคนแทน, ติดต่อไม่ได้, ลากิจธุระด่วน, รถเสีย..."
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
                  background: '#fff'
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                disabled={submitting}
                className="vk-btn vk-btn--primary"
                style={{ height: 38, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 20px', borderRadius: 6 }}
              >
                <Plus style={{ width: 15, height: 15 }} />
                {submitting ? 'กำลังบันทึก...' : 'บันทึกรายการ'}
              </button>
            </div>
          </form>

          {/* Current Day Attendance Table */}
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--vk-ink)' }}>
                รายการ ขาด / ลา / มาสาย ในวันนี้ ({logs.length} คน)
              </div>
              {loading && <span style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>กำลังโหลด...</span>}
            </div>

            {logs.length === 0 ? (
              <div
                style={{
                  padding: '24px 16px',
                  textAlign: 'center',
                  background: 'var(--vk-paper)',
                  borderRadius: 8,
                  border: '1px dashed var(--vk-rule)',
                  color: 'var(--vk-ink-3)',
                  fontSize: 13
                }}
              >
                ยังไม่มีการบันทึก ขาด / ลา / มาสาย สำหรับวันนี้
              </div>
            ) : (
              <div style={{ border: '1px solid var(--vk-rule-soft)', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: 'var(--vk-paper)', borderBottom: '1px solid var(--vk-rule-soft)', color: 'var(--vk-ink-2)' }}>
                      <th style={{ padding: '8px 12px', fontWeight: 600 }}>รหัส</th>
                      <th style={{ padding: '8px 12px', fontWeight: 600 }}>ชื่อ - สกุล</th>
                      <th style={{ padding: '8px 12px', fontWeight: 600 }}>ประเภท</th>
                      <th style={{ padding: '8px 12px', fontWeight: 600 }}>เหตุผล / รายละเอียด</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center', width: 50 }}>จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((item, idx) => {
                      const emp = item.employee
                      const typeLabel = getAttendanceTypeLabel(item.type, item.leave_type)
                      const isAbsent = item.type === 'absent'
                      const isLeave = item.type === 'leave'
                      const isLate = item.type === 'late'

                      return (
                        <tr
                          key={item.id}
                          style={{
                            borderBottom: idx === logs.length - 1 ? 'none' : '1px solid var(--vk-rule-soft)',
                            background: idx % 2 === 0 ? '#fff' : '#faf9f6'
                          }}
                        >
                          <td style={{ padding: '8px 12px', fontFamily: 'var(--vk-mono)', fontWeight: 600, color: 'var(--vk-ink)' }}>
                            {emp?.employee_code || '-'}
                          </td>
                          <td style={{ padding: '8px 12px', fontWeight: 500 }}>
                            {emp ? formatEmployeeFullName(emp as any, true) : 'ไม่พบข้อมูล'}
                            {emp?.position === 'clerk' && (
                              <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#ffedd5', color: '#c2410c' }}>
                                เสมียน
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '2px 8px',
                                borderRadius: 999,
                                fontSize: 11,
                                fontWeight: 700,
                                background: isAbsent ? '#fee2e2' : isLeave ? '#fef3c7' : '#f3f4f6',
                                color: isAbsent ? '#b91c1c' : isLeave ? '#b45309' : '#374151'
                              }}
                            >
                              {typeLabel}
                            </span>
                          </td>
                          <td style={{ padding: '8px 12px', color: 'var(--vk-ink-2)' }}>
                            {item.minutes_late ? `สาย ${item.minutes_late} นาที ` : ''}
                            {item.reason ? `(${item.reason})` : (item.minutes_late ? '' : '-')}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => setItemToDelete(item)}
                              title="ลบรายการนี้"
                              style={{
                                border: 'none',
                                background: 'transparent',
                                color: '#991b1b',
                                cursor: 'pointer',
                                padding: 4,
                                borderRadius: 4
                              }}
                            >
                              <Trash2 style={{ width: 15, height: 15 }} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="vk-modal-bottom-actions">
          <button
            type="button"
            onClick={onClose}
            className="vk-btn vk-btn-secondary"
            style={{ fontSize: 13, padding: '6px 18px' }}
          >
            ปิดหน้าต่าง
          </button>
        </div>
      </div>

      {/* Themed Confirmation Modal for Deletion */}
      {itemToDelete && (
        <div
          className="vk-modal-backdrop"
          style={{ zIndex: 10001 }}
          onClick={() => setItemToDelete(null)}
        >
          <div
            className="vk-modal-container"
            style={{ maxWidth: 440 }}
            onClick={e => e.stopPropagation()}
          >
            <div className="vk-modal-header">
              <div className="vk-modal-header-left">
                <h3 className="vk-modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#b91c1c' }}>
                  <AlertTriangle style={{ width: 18, height: 18 }} />
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

            <div className="vk-modal-body" style={{ padding: '20px 24px', fontSize: 13, color: 'var(--vk-ink-2)', lineHeight: 1.6 }}>
              คุณต้องการลบประวัติ <strong>{getAttendanceTypeLabel(itemToDelete.type, itemToDelete.leave_type)}</strong> ของ{' '}
              <strong style={{ color: 'var(--vk-ink)' }}>
                {itemToDelete.employee ? formatEmployeeFullName(itemToDelete.employee as any, true) : itemToDelete.employee_id}
              </strong>{' '}
              ประจำวันที่ <strong>{formattedDate}</strong> ใช่หรือไม่?
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--vk-ink-3)' }}>
                * เมื่อลบแล้ว ข้อมูล ขาด/ลา/มาสาย ในวันนี้ของพนักงานจะถูกยกเลิกทันที
              </div>
            </div>

            <div className="vk-modal-bottom-actions">
              <button
                type="button"
                className="vk-btn vk-btn-secondary"
                style={{ fontSize: 13, padding: '6px 16px' }}
                onClick={() => setItemToDelete(null)}
                disabled={isDeleting}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="vk-btn"
                style={{
                  fontSize: 13,
                  padding: '6px 18px',
                  background: '#dc2626',
                  color: '#ffffff',
                  border: '1px solid #b91c1c',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer'
                }}
                onClick={confirmDelete}
                disabled={isDeleting}
              >
                <Trash2 style={{ width: 14, height: 14 }} />
                {isDeleting ? 'กำลังลบ...' : 'ยืนยันลบ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
