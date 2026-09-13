import React, { useState, useEffect, useMemo } from 'react'
import { X, User, Calendar, Clock, AlertTriangle, Filter, History, UserX } from 'lucide-react'
import type { AttendanceLog, AttendanceType } from './attendanceApi'
import { loadEmployeeAttendanceHistory, getAttendanceTypeLabel } from './attendanceApi'
import { formatEmployeeFullName } from '../../lib/formatters'

interface Props {
  isOpen: boolean
  onClose: () => void
  factoryId: string
  employee: {
    id: string
    employee_code: string
    first_name: string
    last_name?: string | null
    position?: string | null
    nationality?: string | null
  } | null
}

export const EmployeeAttendanceHistoryModal: React.FC<Props> = ({
  isOpen,
  onClose,
  factoryId,
  employee,
}) => {
  const [logs, setLogs] = useState<AttendanceLog[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<'all' | AttendanceType>('all')

  useEffect(() => {
    if (isOpen && employee && factoryId) {
      setLoading(true)
      setError(null)
      loadEmployeeAttendanceHistory(factoryId, employee.id)
        .then(data => setLogs(data))
        .catch(err => {
          console.error('Error loading employee attendance history:', err)
          setError(err.message || 'ไม่สามารถโหลดประวัติได้')
        })
        .finally(() => setLoading(false))
    } else {
      setLogs([])
      setTypeFilter('all')
    }
  }, [isOpen, employee, factoryId])

  // Summary statistics for this employee
  const stats = useMemo(() => {
    let absentCount = 0
    let leaveCount = 0
    let lateCount = 0
    let totalLateMinutes = 0

    for (const log of logs) {
      if (log.type === 'absent') absentCount++
      else if (log.type === 'leave') leaveCount++
      else if (log.type === 'late') {
        lateCount++
        totalLateMinutes += Number(log.minutes_late || 0)
      }
    }

    return {
      total: logs.length,
      absentCount,
      leaveCount,
      lateCount,
      totalLateMinutes,
    }
  }, [logs])

  // Filtered logs
  const filteredLogs = useMemo(() => {
    if (typeFilter === 'all') return logs
    return logs.filter(l => l.type === typeFilter)
  }, [logs, typeFilter])

  if (!isOpen || !employee) return null

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
      className="vk-modal-backdrop"
      style={{ zIndex: 9999 }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="vk-modal-container"
        style={{ maxWidth: 760 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="vk-modal-header">
          <div className="vk-modal-header-left">
            <h3 className="vk-modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <History style={{ width: 18, height: 18, color: 'var(--vk-persimmon)' }} />
              ประวัติ ขาด / ลา / มาสาย (ทั้งหมด)
            </h3>
            <div className="vk-modal-subtitle">
              พนักงาน:{' '}
              <strong style={{ color: 'var(--vk-ink)' }}>
                {employee.employee_code} · {formatEmployeeFullName(employee as any, true)}
              </strong>
              {employee.position === 'clerk' && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: '#ffedd5',
                    color: '#c2410c',
                  }}
                >
                  พนักงานกลุ่มเสมียน
                </span>
              )}
            </div>
          </div>
          <button type="button" className="vk-modal-btn-close" onClick={onClose} title="ปิด">
            <X style={{ width: 18, height: 18 }} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="vk-modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
          {error && (
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fca5a5',
                borderRadius: 8,
                padding: '10px 14px',
                marginBottom: 16,
                color: '#991b1b',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <AlertTriangle style={{ width: 16, height: 16, flexShrink: 0 }} />
              <div>{error}</div>
            </div>
          )}

          {/* Stats Summary Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: 10,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                background: 'var(--vk-card)',
                border: '1px solid var(--vk-rule-soft)',
                borderRadius: 8,
                padding: '10px 14px',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--vk-ink-3)', marginBottom: 2 }}>
                บันทึกทั้งหมด
              </div>
              <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 18, fontWeight: 700, color: 'var(--vk-ink)' }}>
                {stats.total}{' '}
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--vk-ink-3)' }}>ครั้ง</span>
              </div>
            </div>

            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 8,
                padding: '10px 14px',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: '#991b1b', marginBottom: 2 }}>
                ขาดงาน
              </div>
              <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 18, fontWeight: 700, color: '#dc2626' }}>
                {stats.absentCount}{' '}
                <span style={{ fontSize: 12, fontWeight: 500, color: '#991b1b' }}>ครั้ง</span>
              </div>
            </div>

            <div
              style={{
                background: '#fffbeb',
                border: '1px solid #fef3c7',
                borderRadius: 8,
                padding: '10px 14px',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: '#92400e', marginBottom: 2 }}>
                ลา
              </div>
              <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 18, fontWeight: 700, color: '#d97706' }}>
                {stats.leaveCount}{' '}
                <span style={{ fontSize: 12, fontWeight: 500, color: '#92400e' }}>ครั้ง</span>
              </div>
            </div>

            <div
              style={{
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: '10px 14px',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 2 }}>
                มาสาย
              </div>
              <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 18, fontWeight: 700, color: '#1f2937' }}>
                {stats.lateCount}{' '}
                <span style={{ fontSize: 12, fontWeight: 500, color: '#4b5563' }}>ครั้ง</span>
                {stats.totalLateMinutes > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginLeft: 4 }}>
                    ({stats.totalLateMinutes} น.)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Filter Pills */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', gap: 6 }}>
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
                    padding: '4px 10px',
                    fontSize: 12,
                    fontWeight: typeFilter === f.id ? 700 : 500,
                    borderRadius: 6,
                    border: typeFilter === f.id ? '1px solid var(--vk-persimmon)' : '1px solid var(--vk-rule-soft)',
                    background: typeFilter === f.id ? 'var(--vk-persimmon)' : '#ffffff',
                    color: typeFilter === f.id ? '#ffffff' : 'var(--vk-ink-2)',
                    cursor: 'pointer',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>
              {loading ? 'กำลังโหลด...' : `แสดง ${filteredLogs.length} รายการ`}
            </div>
          </div>

          {/* Records Table */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--vk-ink-3)', fontSize: 13 }}>
              กำลังโหลดประวัติ...
            </div>
          ) : filteredLogs.length === 0 ? (
            <div
              style={{
                padding: '36px 16px',
                textAlign: 'center',
                background: 'var(--vk-paper)',
                borderRadius: 8,
                border: '1px dashed var(--vk-rule)',
                color: 'var(--vk-ink-3)',
                fontSize: 13,
              }}
            >
              {logs.length === 0
                ? 'ไม่พบประวัติ ขาด / ลา / มาสาย ของพนักงานคนนี้ในระบบ'
                : 'ไม่พบรายการตามประเภทที่เลือก'}
            </div>
          ) : (
            <div style={{ border: '1px solid var(--vk-rule-soft)', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
                <thead>
                  <tr
                    style={{
                      background: 'var(--vk-paper)',
                      borderBottom: '1px solid var(--vk-rule-soft)',
                      color: 'var(--vk-ink-2)',
                    }}
                  >
                    <th style={{ padding: '10px 16px', fontWeight: 600, width: 140, minWidth: 140, whiteSpace: 'nowrap' }}>
                      วันที่เกิดรายการ
                    </th>
                    <th style={{ padding: '10px 14px', fontWeight: 600, width: 100, minWidth: 100, textAlign: 'center', whiteSpace: 'nowrap' }}>
                      ประเภท
                    </th>
                    <th style={{ padding: '10px 16px', fontWeight: 600 }}>
                      รายละเอียด / เหตุผล
                    </th>
                    <th style={{ padding: '10px 16px', fontWeight: 600, width: 130, minWidth: 130, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      บันทึกเมื่อ
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((item, idx) => {
                    const isAbsent = item.type === 'absent'
                    const isLeave = item.type === 'leave'
                    const isLate = item.type === 'late'
                    const typeLabel = getAttendanceTypeLabel(item.type, item.leave_type)

                    const createdDateStr = item.created_at
                      ? new Date(item.created_at).toLocaleDateString('th-TH', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })
                      : '-'

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
                            padding: '11px 16px',
                            fontFamily: 'var(--vk-mono)',
                            fontWeight: 600,
                            fontSize: 13,
                            color: 'var(--vk-ink)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatThaiDate(item.work_date)}
                        </td>
                        <td style={{ padding: '11px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
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
                        <td style={{ padding: '11px 16px', color: 'var(--vk-ink-2)', fontSize: 13 }}>
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
                        <td
                          style={{
                            padding: '11px 16px',
                            textAlign: 'right',
                            fontFamily: 'var(--vk-mono)',
                            fontSize: 12,
                            color: 'var(--vk-ink-3)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {createdDateStr}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
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
    </div>
  )
}
