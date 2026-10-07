import type { QueryClient } from '@tanstack/react-query'

/** Attendance cancellation changes both the history and the linked shift wage. */
export function invalidateTpiAttendanceAndShifts(queryClient: QueryClient) {
  return Promise.all([
    'tpi-pending-attendance', 'tpi-monthly-attendance-page',
    'tpi-monthly-attendance', 'tpi-daily-attendance', 'tpi-shift-day',
    'all-tpi-period-shifts', 'all-tpi-period-shifts-summary',
    'tpi-shift-days-period', 'summary-all-shifts',
    'payslip-all-tpi-shifts', 'payslip-all-shifts',
  ].map(key => queryClient.invalidateQueries({ queryKey: [key] })))
}
