import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAppStore } from './store/useAppStore'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from './components/ui/sonner'
import { useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Employees from './pages/Employees'
import ShiftEntry from './pages/ShiftEntry'
import PayrollEntry from './pages/PayrollEntry'
import Advances from './pages/Advances'
import PaySlip from './pages/PaySlip'
import Export from './pages/Export'
import ShareLinks from './pages/ShareLinks'
import EmployeeSlipPage from './pages/EmployeeSlip'
import LiffUnavailable from './pages/LiffUnavailable'
import UserManagement from './pages/UserManagement'
import EmployeeSummary from './pages/EmployeeSummary'
import { AppLayout, RequireAuth } from './components/layout/AppLayout'

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
            <Routes>
              {/* ── Main App ─────────────────────────────────────── */}
              <Route path="/login" element={<Login />} />
              <Route element={<AppLayout />}>
                <Route element={<RequireAuth allowedRoles={['admin']} />}>
                  <Route path="/"           element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard"  element={<Dashboard />} />
                  <Route path="/employees"  element={<Employees />} />
                  <Route path="/shifts"     element={<ShiftEntry />} />
                  <Route path="/payroll"    element={<PayrollEntry />} />
                  <Route path="/advances"   element={<Advances />} />
                </Route>
                <Route element={<RequireAuth allowedRoles={['admin', 'normalUser']} />}>
                  <Route path="/payslip"    element={<PaySlip />} />
                  <Route path="/employee-summary" element={<EmployeeSummary />} />
                  <Route path="/share-links" element={<ShareLinks />} />
                  <Route path="/export"     element={<Export />} />
                </Route>
                <Route element={<RequireAuth allowedRoles={['admin']} />}>
                  <Route path="/users"      element={<UserManagement />} />
                </Route>
              </Route>

              {/* ── Public pages ─────────────────────────────────── */}
              <Route path="/slip/:token" element={<EmployeeSlipPage />} />
              <Route path="/liff-slip"  element={<LiffUnavailable />} />

              <Route path="*" element={<Navigate to="/login" replace />} />
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
