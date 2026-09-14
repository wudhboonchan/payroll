import React from 'react'
import type {
  TimesheetBillingReport,
  EmployeeTimesheetRow,
} from './tpiTimesheetCalc'
import { Briefcase, Loader2 } from 'lucide-react'

interface Props {
  report: TimesheetBillingReport
  filteredThaiWorkers: EmployeeTimesheetRow[]
  filteredForeignWorkers: EmployeeTimesheetRow[]
  effectiveRangeLabel: string
  isLoading?: boolean
}

export const EmployeeTimesheetTable: React.FC<Props> = ({
  report,
  filteredThaiWorkers,
  filteredForeignWorkers,
  effectiveRangeLabel,
  isLoading = false,
}) => {
  const mono = (n: number) =>
    (n || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })

  const monoHour = (n: number) => {
    if (!n || n === 0) return '-'
    return Number.isInteger(n) ? String(n) : n.toFixed(1)
  }

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 10,
        }}
      >
        <Loader2
          className="animate-spin"
          style={{ width: 22, height: 22, color: '#0f766e' }}
        />
        <span style={{ fontSize: 13, color: 'var(--vk-ink-3)' }}>
          กำลังคำนวณข้อมูลใบวางบิลรายบุคคล...
        </span>
      </div>
    )
  }

  const days = report?.days || report?.dateRange?.days || []
  const totalDays = days.length

  const thaiSummary = report?.thaiSummary || {
    rowCount: 0,
    totalDailyHours: [],
    normalHours: 0,
    ot15Hours: 0,
    ot20Hours: 0,
    ot30Hours: 0,
    totalHours: 0,
    normalWage: 0,
    ot15Wage: 0,
    ot20Wage: 0,
    ot30Wage: 0,
    totalWage: 0,
    baseWageForFee: 0,
    serviceFee: 0,
    totalBillingAmount: 0,
  }

  const foreignSummary = report?.foreignSummary || {
    rowCount: 0,
    totalDailyHours: [],
    normalHours: 0,
    ot15Hours: 0,
    ot20Hours: 0,
    ot30Hours: 0,
    totalHours: 0,
    normalWage: 0,
    ot15Wage: 0,
    ot20Wage: 0,
    ot30Wage: 0,
    totalWage: 0,
    baseWageForFee: 0,
    serviceFee: 0,
    totalBillingAmount: 0,
  }

  const grandTotal = report?.grandTotal || {
    totalDailyHours: [],
    normalHours: 0,
    ot15Hours: 0,
    ot20Hours: 0,
    ot30Hours: 0,
    totalHours: 0,
    normalWage: 0,
    ot15Wage: 0,
    ot20Wage: 0,
    ot30Wage: 0,
    totalWage: 0,
    baseWageForFee: 0,
    serviceFee: 0,
    totalBillingAmount: 0,
    bahtText: '',
  }

  const totalWorkers = (filteredThaiWorkers?.length || 0) + (filteredForeignWorkers?.length || 0)

  if (totalWorkers === 0 || totalDays === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 8,
        }}
      >
        <Briefcase style={{ width: 36, height: 36, color: 'var(--vk-ink-4)' }} />
        <div
          style={{ fontSize: 14, fontWeight: 600, color: 'var(--vk-ink-3)' }}
        >
          ไม่พบข้อมูลคนงานหรือกะปฏิบัติงานในช่วงเวลา ({effectiveRangeLabel})
        </div>
      </div>
    )
  }

  // Render a single worker row
  const renderWorkerRow = (row: EmployeeTimesheetRow, index: number) => {
    return (
      <tr
        key={row.employeeId || row.employeeCode || index}
        style={{
          borderBottom: '1px solid #f1f5f9',
          background: index % 2 === 0 ? '#ffffff' : '#fafafa',
        }}
        className="hover:bg-teal-50/40 transition-colors"
      >
        {/* Sticky Col 1: Employee Code */}
        <td
          style={{
            position: 'sticky',
            left: 0,
            zIndex: 10,
            background: index % 2 === 0 ? '#ffffff' : '#fafafa',
            padding: '6px 8px',
            fontFamily: 'var(--vk-mono)',
            fontSize: 11,
            color: 'var(--vk-ink-2)',
            borderRight: '1px solid #e2e8f0',
            borderBottom: '1px solid #f1f5f9',
          }}
        >
          {row.employeeCode || '-'}
        </td>

        {/* Sticky Col 2: Name */}
        <td
          style={{
            position: 'sticky',
            left: 80,
            zIndex: 10,
            background: index % 2 === 0 ? '#ffffff' : '#fafafa',
            padding: '6px 10px',
            fontWeight: 600,
            color: 'var(--vk-ink)',
            borderRight: '2px solid #94a3b8',
            borderBottom: '1px solid #f1f5f9',
            boxShadow: '2px 0 4px rgba(0,0,0,0.04)',
            maxWidth: 160,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={row.fullName}
        >
          {row.fullName}
        </td>

        {/* 7 Days Hours */}
        {row.dailyHours.map((h, dIdx) => (
          <td
            key={dIdx}
            style={{
              padding: '6px 4px',
              textAlign: 'center',
              fontFamily: 'var(--vk-mono)',
              fontSize: 11,
              color: h > 0 ? 'var(--vk-ink)' : '#cbd5e1',
              fontWeight: h > 0 ? 600 : 400,
              background: h > 0 ? '#f8fafc' : 'inherit',
              borderRight: '1px solid #f1f5f9',
            }}
          >
            {monoHour(h)}
          </td>
        ))}

        {/* Wage Rate */}
        <td
          style={{
            padding: '6px 8px',
            textAlign: 'right',
            fontFamily: 'var(--vk-mono)',
            fontSize: 11,
            color: 'var(--vk-ink-2)',
            borderRight: '1px solid #cbd5e1',
            background: '#fcfcfc',
          }}
        >
          {mono(row.dailyRate)}
        </td>

        {/* Hours breakdown: Normal, 1.5, 2, 3, Total */}
        <td
          style={{
            padding: '6px 6px',
            textAlign: 'right',
            fontFamily: 'var(--vk-mono)',
            fontSize: 11,
            color: row.normalHours > 0 ? 'var(--vk-ink)' : '#cbd5e1',
            borderRight: '1px solid #f1f5f9',
          }}
        >
          {monoHour(row.normalHours)}
        </td>
        <td
          style={{
            padding: '6px 6px',
            textAlign: 'right',
            fontFamily: 'var(--vk-mono)',
            fontSize: 11,
            color: row.ot15Hours > 0 ? '#c2410c' : '#cbd5e1',
            fontWeight: row.ot15Hours > 0 ? 600 : 400,
            borderRight: '1px solid #f1f5f9',
            background: row.ot15Hours > 0 ? '#fff7ed' : 'inherit',
          }}
        >
          {monoHour(row.ot15Hours)}
        </td>
        <td
          style={{
            padding: '6px 6px',
            textAlign: 'right',
            fontFamily: 'var(--vk-mono)',
            fontSize: 11,
            color: row.ot20Hours > 0 ? '#b91c1c' : '#cbd5e1',
            fontWeight: row.ot20Hours > 0 ? 600 : 400,
            borderRight: '1px solid #f1f5f9',
            background: row.ot20Hours > 0 ? '#fef2f2' : 'inherit',
          }}
        >
          {monoHour(row.ot20Hours)}
        </td>
        <td
          style={{
            padding: '6px 6px',
            textAlign: 'right',
            fontFamily: 'var(--vk-mono)',
            fontSize: 11,
            color: row.ot30Hours > 0 ? '#7c2d12' : '#cbd5e1',
            fontWeight: row.ot30Hours > 0 ? 600 : 400,
            borderRight: '1px solid #f1f5f9',
          }}
        >
          {monoHour(row.ot30Hours)}
        </td>
        <td
          style={{
            padding: '6px 6px',
            textAlign: 'right',
            fontFamily: 'var(--vk-mono)',
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--vk-ink)',
            borderRight: '1px solid #cbd5e1',
            background: '#f8fafc',
          }}
        >
          {monoHour(row.totalHours)}
        </td>

        {/* Wages breakdown: Normal, 1.5, 2, 3, Total */}
        <td
          style={{
            padding: '6px 8px',
            textAlign: 'right',
            fontFamily: 'var(--vk-mono)',
            fontSize: 11,
            borderRight: '1px solid #f1f5f9',
          }}
        >
          {mono(row.normalWage)}
        </td>
        <td
          style={{
            padding: '6px 8px',
            textAlign: 'right',
            fontFamily: 'var(--vk-mono)',
            fontSize: 11,
            color: row.ot15Wage > 0 ? '#c2410c' : 'inherit',
            fontWeight: row.ot15Wage > 0 ? 600 : 400,
            borderRight: '1px solid #f1f5f9',
            background: row.ot15Wage > 0 ? '#fff7ed' : 'inherit',
          }}
        >
          {mono(row.ot15Wage)}
        </td>
        <td
          style={{
            padding: '6px 8px',
            textAlign: 'right',
            fontFamily: 'var(--vk-mono)',
            fontSize: 11,
            color: row.ot20Wage > 0 ? '#b91c1c' : 'inherit',
            fontWeight: row.ot20Wage > 0 ? 600 : 400,
            borderRight: '1px solid #f1f5f9',
            background: row.ot20Wage > 0 ? '#fef2f2' : 'inherit',
          }}
        >
          {mono(row.ot20Wage)}
        </td>
        <td
          style={{
            padding: '6px 8px',
            textAlign: 'right',
            fontFamily: 'var(--vk-mono)',
            fontSize: 11,
            borderRight: '1px solid #f1f5f9',
          }}
        >
          {mono(row.ot30Wage)}
        </td>
        <td
          style={{
            padding: '6px 8px',
            textAlign: 'right',
            fontFamily: 'var(--vk-mono)',
            fontSize: 11,
            fontWeight: 700,
            color: '#0f766e',
            borderRight: '1px solid #cbd5e1',
            background: '#f0fdfa',
          }}
        >
          {mono(row.totalWage)}
        </td>

        {/* Service Fee: Base Wage, 28% Fee */}
        <td
          style={{
            padding: '6px 8px',
            textAlign: 'right',
            fontFamily: 'var(--vk-mono)',
            fontSize: 11,
            color: 'var(--vk-ink-2)',
            borderRight: '1px solid #f1f5f9',
          }}
        >
          {mono(row.baseWageForFee)}
        </td>
        <td
          style={{
            padding: '6px 8px',
            textAlign: 'right',
            fontFamily: 'var(--vk-mono)',
            fontSize: 11,
            fontWeight: 600,
            color: '#b45309',
            borderRight: '1px solid #cbd5e1',
            background: '#fffbeb',
          }}
        >
          {mono(row.serviceFee)}
        </td>

        {/* Total Billing */}
        <td
          style={{
            padding: '6px 10px',
            textAlign: 'right',
            fontFamily: 'var(--vk-mono)',
            fontSize: 12,
            fontWeight: 800,
            color: '#0f766e',
            background: '#ecfdf5',
          }}
        >
          {mono(row.totalBillingAmount)}
        </td>
      </tr>
    )
  }

  // Render Subtotal Row for Thai or Foreign section
  const renderSubtotalRow = (
    label: string,
    summary: typeof thaiSummary,
    bgColor: string,
    textColor: string
  ) => {
    return (
      <tr
        style={{
          background: bgColor,
          fontWeight: 700,
          borderTop: '2px solid #cbd5e1',
          borderBottom: '2px solid #cbd5e1',
        }}
      >
        <td
          colSpan={2}
          style={{
            position: 'sticky',
            left: 0,
            zIndex: 10,
            background: bgColor,
            padding: '8px 10px',
            fontWeight: 700,
            color: textColor,
            borderRight: '2px solid #94a3b8',
            boxShadow: '2px 0 4px rgba(0,0,0,0.04)',
          }}
        >
          {label} ({summary.rowCount} คน)
        </td>

        {/* Daily hours */}
        {(summary?.totalDailyHours || []).map((h, dIdx) => (
          <td
            key={dIdx}
            style={{
              padding: '8px 4px',
              textAlign: 'center',
              fontFamily: 'var(--vk-mono)',
              fontSize: 11,
              color: textColor,
              borderRight: '1px solid #e2e8f0',
            }}
          >
            {monoHour(h)}
          </td>
        ))}

        {/* Empty rate cell */}
        <td style={{ borderRight: '1px solid #cbd5e1' }} />

        {/* Hours totals */}
        <td style={{ padding: '8px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 11 }}>
          {monoHour(summary.normalHours)}
        </td>
        <td style={{ padding: '8px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 11, color: '#c2410c' }}>
          {monoHour(summary.ot15Hours)}
        </td>
        <td style={{ padding: '8px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 11, color: '#b91c1c' }}>
          {monoHour(summary.ot20Hours)}
        </td>
        <td style={{ padding: '8px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 11 }}>
          {monoHour(summary.ot30Hours)}
        </td>
        <td style={{ padding: '8px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 11, fontWeight: 800, borderRight: '1px solid #cbd5e1' }}>
          {monoHour(summary.totalHours)}
        </td>

        {/* Wage totals */}
        <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 11 }}>
          {mono(summary.normalWage)}
        </td>
        <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 11, color: '#c2410c' }}>
          {mono(summary.ot15Wage)}
        </td>
        <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 11, color: '#b91c1c' }}>
          {mono(summary.ot20Wage)}
        </td>
        <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 11 }}>
          {mono(summary.ot30Wage)}
        </td>
        <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 11, fontWeight: 800, color: '#0f766e', borderRight: '1px solid #cbd5e1' }}>
          {mono(summary.totalWage)}
        </td>

        {/* Service Fee totals */}
        <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 11 }}>
          {mono(summary.baseWageForFee)}
        </td>
        <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 11, fontWeight: 800, color: '#b45309', borderRight: '1px solid #cbd5e1' }}>
          {mono(summary.serviceFee)}
        </td>

        {/* Total Billing */}
        <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 12, fontWeight: 800, color: '#065f46' }}>
          {mono(summary.totalBillingAmount)}
        </td>
      </tr>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'auto', background: '#fff' }}>
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
            {/* Header Row 1 (Top: 0) */}
            <tr style={{ background: '#f1f5f9' }}>
              {/* Sticky Col 1: Worker ID */}
              <th
                rowSpan={2}
                style={{
                  position: 'sticky',
                  left: 0,
                  top: 0,
                  zIndex: 40,
                  padding: '8px 8px',
                  textAlign: 'left',
                  fontWeight: 700,
                  background: '#f1f5f9',
                  borderBottom: '2px solid #94a3b8',
                  borderRight: '1px solid #cbd5e1',
                  minWidth: 80,
                }}
              >
                รหัสแรงงาน
              </th>

              {/* Sticky Col 2: Name */}
              <th
                rowSpan={2}
                style={{
                  position: 'sticky',
                  left: 80,
                  top: 0,
                  zIndex: 40,
                  padding: '8px 10px',
                  textAlign: 'left',
                  fontWeight: 700,
                  background: '#f1f5f9',
                  borderBottom: '2px solid #94a3b8',
                  borderRight: '2px solid #94a3b8',
                  boxShadow: '2px 0 4px rgba(0,0,0,0.06)',
                  minWidth: 160,
                }}
              >
                ชื่อ - นามสกุล
              </th>

              {/* Days Group Header */}
              <th
                colSpan={totalDays}
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 30,
                  padding: '6px 4px',
                  textAlign: 'center',
                  fontWeight: 700,
                  background: '#e0f2fe',
                  color: '#0369a1',
                  borderBottom: '1px solid #bae6fd',
                  borderRight: '1px solid #cbd5e1',
                }}
              >
                วันที่
              </th>

              {/* Daily Wage Rate */}
              <th
                rowSpan={2}
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 30,
                  padding: '8px 8px',
                  textAlign: 'right',
                  fontWeight: 700,
                  background: '#f1f5f9',
                  borderBottom: '2px solid #94a3b8',
                  borderRight: '1px solid #cbd5e1',
                  minWidth: 70,
                }}
              >
                ค่าจ้าง
              </th>

              {/* Hours Group Header */}
              <th
                colSpan={5}
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 30,
                  padding: '6px 4px',
                  textAlign: 'center',
                  fontWeight: 700,
                  background: '#f8fafc',
                  color: 'var(--vk-ink-2)',
                  borderBottom: '1px solid #cbd5e1',
                  borderRight: '1px solid #cbd5e1',
                }}
              >
                จำนวนชั่วโมงการทำงาน
              </th>

              {/* Wages Group Header */}
              <th
                colSpan={5}
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 30,
                  padding: '6px 4px',
                  textAlign: 'center',
                  fontWeight: 700,
                  background: '#f1f5f9',
                  color: 'var(--vk-ink-2)',
                  borderBottom: '1px solid #cbd5e1',
                  borderRight: '1px solid #cbd5e1',
                }}
              >
                จำนวนเงิน (บาท)
              </th>

              {/* Service Fee Group Header */}
              <th
                colSpan={2}
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 30,
                  padding: '6px 4px',
                  textAlign: 'center',
                  fontWeight: 700,
                  background: '#fef3c7',
                  color: '#92400e',
                  borderBottom: '1px solid #fde68a',
                  borderRight: '1px solid #cbd5e1',
                }}
              >
                ค่าบริการ (28%)
              </th>

              {/* Total Billing */}
              <th
                rowSpan={2}
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 30,
                  padding: '8px 10px',
                  textAlign: 'right',
                  fontWeight: 800,
                  background: '#dcfce7',
                  color: '#166534',
                  borderBottom: '2px solid #94a3b8',
                  minWidth: 95,
                }}
              >
                รวมเงิน
              </th>
            </tr>

            {/* Header Row 2 (Top: 31px) */}
            <tr style={{ background: '#f8fafc' }}>
              {/* 7 Days sub-headers */}
              {days.map(d => (
                <th
                  key={d.dateStr}
                  style={{
                    position: 'sticky',
                    top: 29,
                    zIndex: 30,
                    padding: '4px 2px',
                    textAlign: 'center',
                    fontWeight: 600,
                    fontSize: 10.5,
                    background: '#e0f2fe',
                    color: '#0369a1',
                    borderBottom: '2px solid #94a3b8',
                    borderRight: '1px solid #bae6fd',
                    minWidth: 36,
                  }}
                >
                  <div>{d.dayName}</div>
                  <div style={{ fontSize: 9.5, opacity: 0.85 }}>{d.dayNum}</div>
                </th>
              ))}

              {/* Hours Sub-headers */}
              <th style={{ position: 'sticky', top: 29, zIndex: 30, padding: '4px 6px', textAlign: 'right', fontSize: 10.5, background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', minWidth: 42 }}>
                ปกติ
              </th>
              <th style={{ position: 'sticky', top: 29, zIndex: 30, padding: '4px 6px', textAlign: 'right', fontSize: 10.5, background: '#fff7ed', color: '#c2410c', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #fed7aa', minWidth: 48 }}>
                OT 1.5
              </th>
              <th style={{ position: 'sticky', top: 29, zIndex: 30, padding: '4px 6px', textAlign: 'right', fontSize: 10.5, background: '#fef2f2', color: '#b91c1c', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #fecaca', minWidth: 42 }}>
                OT 2
              </th>
              <th style={{ position: 'sticky', top: 29, zIndex: 30, padding: '4px 6px', textAlign: 'right', fontSize: 10.5, background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', minWidth: 42 }}>
                OT 3
              </th>
              <th style={{ position: 'sticky', top: 29, zIndex: 30, padding: '4px 6px', textAlign: 'right', fontSize: 10.5, background: '#f1f5f9', fontWeight: 700, borderBottom: '2px solid #94a3b8', borderRight: '1px solid #cbd5e1', minWidth: 48 }}>
                รวม
              </th>

              {/* Wage Sub-headers */}
              <th style={{ position: 'sticky', top: 29, zIndex: 30, padding: '4px 6px', textAlign: 'right', fontSize: 10.5, background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', minWidth: 62 }}>
                ปกติ
              </th>
              <th style={{ position: 'sticky', top: 29, zIndex: 30, padding: '4px 6px', textAlign: 'right', fontSize: 10.5, background: '#fff7ed', color: '#c2410c', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #fed7aa', minWidth: 62 }}>
                OT 1.5
              </th>
              <th style={{ position: 'sticky', top: 29, zIndex: 30, padding: '4px 6px', textAlign: 'right', fontSize: 10.5, background: '#fef2f2', color: '#b91c1c', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #fecaca', minWidth: 62 }}>
                OT 2
              </th>
              <th style={{ position: 'sticky', top: 29, zIndex: 30, padding: '4px 6px', textAlign: 'right', fontSize: 10.5, background: '#f8fafc', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0', minWidth: 55 }}>
                OT 3
              </th>
              <th style={{ position: 'sticky', top: 29, zIndex: 30, padding: '4px 6px', textAlign: 'right', fontSize: 10.5, background: '#f0fdfa', fontWeight: 700, color: '#0f766e', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #cbd5e1', minWidth: 68 }}>
                รวม
              </th>

              {/* Service Fee Sub-headers */}
              <th style={{ position: 'sticky', top: 29, zIndex: 30, padding: '4px 6px', textAlign: 'right', fontSize: 10.5, background: '#fffbeb', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #fef3c7', minWidth: 72 }}>
                ค่าจ้างพื้นฐาน
              </th>
              <th style={{ position: 'sticky', top: 29, zIndex: 30, padding: '4px 6px', textAlign: 'right', fontSize: 10.5, background: '#fef3c7', fontWeight: 700, color: '#b45309', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #cbd5e1', minWidth: 70 }}>
                ค่าบริการ
              </th>
            </tr>
          </thead>

          <tbody>
            {/* 1. Section: Thai Workers */}
            {filteredThaiWorkers.length > 0 && (
              <>
                <tr style={{ background: '#dbeafe' }}>
                  <td
                    colSpan={2 + totalDays + 1 + 5 + 5 + 2 + 1}
                    style={{
                      padding: '8px 12px',
                      fontWeight: 800,
                      fontSize: 12,
                      color: '#1e40af',
                      borderBottom: '1px solid #bfdbfe',
                      letterSpacing: '0.02em',
                    }}
                  >
                    🇹🇭 คนงานสัญชาติไทย ({filteredThaiWorkers.length} คน)
                  </td>
                </tr>
                {filteredThaiWorkers.map((row, idx) => renderWorkerRow(row, idx))}
                {renderSubtotalRow('รวม คนงานสัญชาติไทย', thaiSummary, '#eff6ff', '#1e40af')}
              </>
            )}

            {/* 2. Section: Foreign Workers */}
            {filteredForeignWorkers.length > 0 && (
              <>
                <tr style={{ background: '#fef3c7' }}>
                  <td
                    colSpan={2 + totalDays + 1 + 5 + 5 + 2 + 1}
                    style={{
                      padding: '8px 12px',
                      fontWeight: 800,
                      fontSize: 12,
                      color: '#92400e',
                      borderTop: filteredThaiWorkers.length > 0 ? '4px solid #cbd5e1' : undefined,
                      borderBottom: '1px solid #fde68a',
                      letterSpacing: '0.02em',
                    }}
                  >
                    🌐 คนงานต่างด้าว ({filteredForeignWorkers.length} คน)
                  </td>
                </tr>
                {filteredForeignWorkers.map((row, idx) => renderWorkerRow(row, idx))}
                {renderSubtotalRow('รวม คนงานต่างด้าว', foreignSummary, '#fffbeb', '#92400e')}
              </>
            )}

            {/* 3. Grand Total Sticky Bottom Row */}
            <tr
              style={{
                position: 'sticky',
                bottom: 0,
                zIndex: 35,
                background: '#f0fdf4',
                borderTop: '2px solid #0f766e',
                boxShadow: '0 -3px 6px rgba(0,0,0,0.06)',
                fontWeight: 800,
              }}
            >
              <td
                colSpan={2}
                style={{
                  position: 'sticky',
                  left: 0,
                  zIndex: 36,
                  background: '#f0fdf4',
                  padding: '10px 10px',
                  fontWeight: 800,
                  fontSize: 12,
                  color: '#065f46',
                  borderTop: '2px solid #0f766e',
                  borderRight: '2px solid #0f766e',
                  boxShadow: '2px 0 4px rgba(0,0,0,0.06)',
                }}
              >
                ยอดรวมทั้งสองสัญชาติ ({totalWorkers} คน)
              </td>

              {/* Grand Total Daily Hours */}
              {(grandTotal.totalDailyHours || []).map((h, dIdx) => (
                <td
                  key={dIdx}
                  style={{
                    padding: '10px 4px',
                    textAlign: 'center',
                    fontFamily: 'var(--vk-mono)',
                    fontSize: 11.5,
                    color: '#065f46',
                    borderTop: '2px solid #0f766e',
                    borderRight: '1px solid #bbf7d0',
                  }}
                >
                  {monoHour(h)}
                </td>
              ))}

              {/* Blank for rate */}
              <td style={{ borderTop: '2px solid #0f766e', borderRight: '1px solid #cbd5e1' }} />

              {/* Grand Total Hours */}
              <td style={{ padding: '10px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 11.5, color: '#065f46', borderTop: '2px solid #0f766e' }}>
                {monoHour(grandTotal.normalHours)}
              </td>
              <td style={{ padding: '10px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 11.5, color: '#c2410c', borderTop: '2px solid #0f766e' }}>
                {monoHour(grandTotal.ot15Hours)}
              </td>
              <td style={{ padding: '10px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 11.5, color: '#b91c1c', borderTop: '2px solid #0f766e' }}>
                {monoHour(grandTotal.ot20Hours)}
              </td>
              <td style={{ padding: '10px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 11.5, color: '#7c2d12', borderTop: '2px solid #0f766e' }}>
                {monoHour(grandTotal.ot30Hours)}
              </td>
              <td style={{ padding: '10px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 11.5, fontWeight: 800, color: '#065f46', borderTop: '2px solid #0f766e', borderRight: '1px solid #cbd5e1' }}>
                {monoHour(grandTotal.totalHours)}
              </td>

              {/* Grand Total Wages */}
              <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 11.5, color: '#065f46', borderTop: '2px solid #0f766e' }}>
                {mono(grandTotal.normalWage)}
              </td>
              <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 11.5, color: '#c2410c', borderTop: '2px solid #0f766e' }}>
                {mono(grandTotal.ot15Wage)}
              </td>
              <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 11.5, color: '#b91c1c', borderTop: '2px solid #0f766e' }}>
                {mono(grandTotal.ot20Wage)}
              </td>
              <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 11.5, color: '#7c2d12', borderTop: '2px solid #0f766e' }}>
                {mono(grandTotal.ot30Wage)}
              </td>
              <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 11.5, fontWeight: 800, color: '#0f766e', borderTop: '2px solid #0f766e', borderRight: '1px solid #cbd5e1' }}>
                {mono(grandTotal.totalWage)}
              </td>

              {/* Grand Total Service Fee */}
              <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 11.5, color: '#065f46', borderTop: '2px solid #0f766e' }}>
                {mono(grandTotal.baseWageForFee)}
              </td>
              <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 11.5, fontWeight: 800, color: '#b45309', borderTop: '2px solid #0f766e', borderRight: '1px solid #cbd5e1' }}>
                {mono(grandTotal.serviceFee)}
              </td>

              {/* Grand Total Billing */}
              <td
                style={{
                  padding: '10px 10px',
                  textAlign: 'right',
                  fontFamily: 'var(--vk-mono)',
                  fontSize: 13,
                  fontWeight: 900,
                  color: '#065f46',
                  background: '#bbf7d0',
                  borderTop: '2px solid #0f766e',
                }}
              >
                {mono(grandTotal.totalBillingAmount)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Thai Baht text bottom banner matching user's sheet */}
      <div
        style={{
          background: '#ecfdf5',
          borderTop: '1px solid #a7f3d0',
          padding: '10px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-2)' }}>
            ตัวอักษร:
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: '#065f46',
              background: '#fff',
              padding: '3px 10px',
              borderRadius: 4,
              border: '1px solid #a7f3d0',
            }}
          >
            {grandTotal.bahtText}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--vk-ink-3)' }}>
            ยอดรวมวางบิลสุทธิ (ทั้งสองสัญชาติ):
          </span>
          <span
            style={{
              fontFamily: 'var(--vk-mono)',
              fontSize: 16,
              fontWeight: 900,
              color: '#0f766e',
            }}
          >
            ฿{mono(grandTotal.totalBillingAmount)}
          </span>
        </div>
      </div>
    </div>
  )
}
