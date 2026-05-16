import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from './components/ui/sonner'
import { useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Employees from './pages/Employees'
import ShiftEntry from './pages/ShiftEntry'
import PayrollEntry from './pages/PayrollEntry'
import AdvancePaymentsList from './pages/AdvancePayments'
import PaySlipPage from './pages/PaySlip'
import ExportPage from './pages/Export'
import ShareLinksPage from './pages/ShareLinks'
import EmployeeSlipPage from './pages/EmployeeSlip'
import SettingsPage from './pages/Settings'
import AttendanceOverview from './pages/AttendanceOverview'
import UserManagement from './pages/UserManagement'
import { AppLayout, RequireAuth } from './components/layout/AppLayout'
import { AppLayoutV2, RequireAuthV2 } from './components/v2/layout/AppLayoutV2'
import LoginV2 from './pages/v2/LoginV2'
import DashboardV2 from './pages/v2/DashboardV2'
import EmployeesV2 from './pages/v2/EmployeesV2'
import ShiftEntryV2 from './pages/v2/ShiftEntryV2'
import PayrollEntryV2 from './pages/v2/PayrollEntryV2'
import AdvancesV2 from './pages/v2/AdvancesV2'
import PaySlipV2 from './pages/v2/PaySlipV2'
import ShareLinksV2 from './pages/v2/ShareLinksV2'
import ExportV2 from './pages/v2/ExportV2'
import UserManagementV2 from './pages/v2/UserManagementV2'

// Created once outside component to prevent re-instantiation on re-render
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,   // 5 min — ข้อมูลใน cache ถือว่า fresh
      gcTime: 1000 * 60 * 10,      // 10 min — เก็บ cache ไว้ก่อน garbage collect
      retry: 1,
      refetchOnWindowFocus: false, // ไม่ยิง query ซ้ำทุกครั้งที่ user กลับมาที่ tab
    }
  }
})

function App() {
  const { loading } = useAuth()

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
          {loading ? (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
              <div className="flex flex-col items-center gap-4">
                <div className="w-10 h-10 border-4 border-[#1D9E75] border-t-transparent rounded-full animate-spin" />
                <p className="text-slate-500 font-medium">กำลังโหลดระบบ...</p>
              </div>
            </div>
          ) : (
            <Routes>
              {/* ── V2 Main App ─────────────────────────────────────── */}
              <Route path="/" element={<Navigate to="/v2/dashboard" replace />} />
              <Route path="/login" element={<Navigate to="/v2/login" replace />} />
              <Route path="/v2/login" element={<LoginV2 />} />
              <Route element={<AppLayoutV2 />}>
                <Route element={<RequireAuthV2 allowedRoles={['admin', 'superUser']} />}>
                  <Route path="/v2/dashboard"  element={<DashboardV2 />} />
                  <Route path="/v2/employees"  element={<EmployeesV2 />} />
                  <Route path="/v2/shifts"     element={<ShiftEntryV2 />} />
                  <Route path="/v2/payroll"    element={<PayrollEntryV2 />} />
                  <Route path="/v2/advances"   element={<AdvancesV2 />} />
                  <Route path="/v2/export"     element={<ExportV2 />} />
                  <Route path="/v2"            element={<Navigate to="/v2/dashboard" replace />} />
                </Route>
                <Route element={<RequireAuthV2 allowedRoles={['admin', 'superUser', 'normalUser']} />}>
                  <Route path="/v2/payslip"    element={<PaySlipV2 />} />
                  <Route path="/v2/share-links" element={<ShareLinksV2 />} />
                </Route>
                <Route element={<RequireAuthV2 allowedRoles={['admin']} />}>
                  <Route path="/v2/users"      element={<UserManagementV2 />} />
                </Route>
              </Route>

              {/* ── V1 Archive (reference only) ──────────────────────── */}
              <Route path="/v1/login" element={<Login />} />
              <Route path="/slip/:token" element={<EmployeeSlipPage />} />
              <Route element={<AppLayout />}>
                <Route element={<RequireAuth allowedRoles={['admin', 'superUser']} />}>
                  <Route path="/v1/dashboard"  element={<Dashboard />} />
                  <Route path="/v1/employees"  element={<Employees />} />
                  <Route path="/v1/shifts"     element={<ShiftEntry />} />
                  <Route path="/v1/attendance" element={<AttendanceOverview />} />
                  <Route path="/v1/payroll"    element={<PayrollEntry />} />
                  <Route path="/v1/advances"   element={<AdvancePaymentsList />} />
                  <Route path="/v1/settings"   element={<SettingsPage />} />
                  <Route path="/v1"            element={<Navigate to="/v1/dashboard" replace />} />
                </Route>
                <Route element={<RequireAuth allowedRoles={['admin', 'superUser', 'normalUser']} />}>
                  <Route path="/v1/payslip"    element={<PaySlipPage />} />
                  <Route path="/v1/share-links" element={<ShareLinksPage />} />
                </Route>
                <Route element={<RequireAuth allowedRoles={['admin', 'superUser']} />}>
                  <Route path="/v1/export"     element={<ExportPage />} />
                </Route>
                <Route element={<RequireAuth allowedRoles={['admin']} />}>
                  <Route path="/v1/users"      element={<UserManagement />} />
                </Route>
              </Route>

              <Route path="*" element={<Navigate to="/v2/login" replace />} />
            </Routes>
          )}
        </div>
        <Toaster position="top-center" toastOptions={{
          classNames: {
            toast: 'font-sans',
            success: '!bg-[#F4F0E6] !border-[#B14729] !text-[#B14729]',
            error: '!bg-[#F4F0E6] !border-[#C0392B] !text-[#C0392B]',
          },
        }} />
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
