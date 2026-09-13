import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAppStore } from './store/useAppStore'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from './components/ui/sonner'
import { useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Employees from './pages/Employees'
import CompanyShiftEntry from './pages/CompanyShiftEntry'
import TpiShiftEntry from './pages/TpiShiftEntry'
import TpiJobManagement from './pages/TpiJobManagement'
import TpiAttendance from './pages/TpiAttendance'
import CompanyPayrollEntry from './pages/CompanyPayrollEntry'
import TpiPayrollEntry from './pages/TpiPayrollEntry'
import PayrollEntry from './pages/PayrollEntry'
import Advances from './pages/Advances'
import PaySlip from './pages/PaySlip'
import Export from './pages/Export'
import ShareLinks from './pages/ShareLinks'
import EmployeeSlipPage from './pages/EmployeeSlip'
import LiffUnavailable from './pages/LiffUnavailable'
import UserManagement from './pages/UserManagement'
import CompanyEmployeeSummary from './pages/CompanyEmployeeSummary'
import { AppLayout, RequireAuth } from './components/layout/AppLayout'
import { ErrorBoundary } from './components/ErrorBoundary'

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
  useEffect(() => useAppStore.subscribe((state, previous) => {
    if (state.user?.id !== previous.user?.id || state.user?.role !== previous.user?.role
      || state.user?.factory_id !== previous.user?.factory_id) queryClient.clear()
  }), [])
  const { loading } = useAuth()

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
          {loading ? (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F4F0E6' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 36, height: 36, border: '3px solid #EFDCD0', borderTopColor: '#B14729', borderRadius: '50%', animation: 'spin 0.75s linear infinite' }} />
                <p style={{ fontFamily: "'Plus Jakarta Sans', 'Anuphan', sans-serif", fontSize: 13, fontWeight: 600, color: '#7A6F60', letterSpacing: '0.04em' }}>กำลังโหลดระบบ...</p>
              </div>
              <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            </div>
          ) : (
            <ErrorBoundary>
              <Routes>
                {/* ── Public & Prototype routes ──────────────────── */}
                <Route path="/preview/tpi-shifts" element={<TpiShiftEntry preview />} />
                <Route path="/prototype/tpi" element={<TpiShiftEntry preview />} />
                <Route path="/login" element={<Login />} />
                <Route element={<AppLayout />}>
                  <Route element={<RequireAuth allowedRoles={['superUser', 'admin']} />}>
                    <Route path="/"           element={<Navigate to="/dashboard" replace />} />
                    <Route path="/dashboard"  element={<Dashboard />} />
                    <Route path="/employees"  element={<Employees />} />
                    <Route path="/shifts"     element={<CompanyShiftEntry />} />
                    <Route path="/tpi-shifts" element={<TpiShiftEntry />} />
                    <Route path="/attendance" element={<TpiAttendance />} />
                    <Route path="/tpi-attendance" element={<TpiAttendance />} />
                    <Route path="/tpi-jobs"   element={<TpiJobManagement />} />
                    <Route path="/jobs"       element={<TpiJobManagement />} />
                    <Route path="/payroll"    element={<CompanyPayrollEntry />} />
                    <Route path="/tpi-payroll" element={<TpiPayrollEntry />} />
                    <Route path="/advances"   element={<Advances />} />
                  </Route>
                  <Route element={<RequireAuth allowedRoles={['superUser', 'admin', 'normalUser']} />}>
                    <Route path="/payslip"    element={<PaySlip />} />
                    <Route path="/employee-summary" element={<CompanyEmployeeSummary />} />
                    <Route path="/share-links" element={<ShareLinks />} />
                    <Route path="/export"     element={<Export />} />
                  </Route>
                  <Route element={<RequireAuth allowedRoles={['superUser', 'admin']} />}>
                    <Route path="/users"      element={<UserManagement />} />
                  </Route>
                </Route>

                {/* ── Public pages ─────────────────────────────────── */}
                <Route path="/slip/:token" element={<EmployeeSlipPage />} />
                <Route path="/liff-slip"  element={<LiffUnavailable />} />

                <Route path="*" element={<Navigate to="/login" replace />} />
              </Routes>
            </ErrorBoundary>
          )}
        </div>
        <Toaster 
          position="top-center" 
          toastOptions={{
            style: {
              borderRadius: '12px',
              padding: '12px 16px',
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
            },
            classNames: {
              toast: 'font-sans !max-w-[420px] !w-auto !border',
              title: '!text-[14px] !font-bold !leading-snug',
              description: '!text-[13px] !text-[#374151] !mt-1 !leading-relaxed !font-normal',
              success: '!bg-[#F0FDF4] !border-[#86EFAC] !text-[#166534]',
              error: '!bg-[#FEF2F2] !border-[#FCA5A5] !text-[#991B1B]',
              info: '!bg-[#EFF6FF] !border-[#93C5FD] !text-[#1E40AF]',
              warning: '!bg-[#FFFBEB] !border-[#FDE68A] !text-[#92400E]',
            },
          }} 
        />
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
