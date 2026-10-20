import { useState } from 'react'
// Isolated manual browser fixture. All data requests are mocked; never uses production records.
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Outlet, Link } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAppStore } from '../../src/store/useAppStore'
import TpiJobManagement from '../../src/pages/TpiJobManagement'
import CompanyPayrollEntry from '../../src/pages/CompanyPayrollEntry'
import '../../src/index.css'

const job = {
  id: '40000000-0000-0000-0000-000000000001', factory_id: 'tpi-fixture', code: 'NB-FOREMAN', department: 'งานไม่ตั้งเบิก',
  description: 'โฟร์แมน', job_type: 'non_billable', morning_only: true, job_group: 'general', quota: 1,
  planned_morning: 1, planned_afternoon: 0, planned_night: 0, normal_rate: 357, skilled_rate: null,
  billing_normal_rate: 0, billing_skilled_rate: 0, billing_rate: 0, active: true, notes: '', valid_from: null, expires_on: null,
  cost_owner: 'หจก.วิราญกร', non_billable_reason: 'บริษัทรับต้นทุนเอง',
}
window.fetch = async (input) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href)
  const isDiamond = url.searchParams.get('id')?.includes('diamond') || url.searchParams.get('factory_id')?.includes('diamond')
  let body: unknown = []
  if (url.pathname.endsWith('/factories')) body = { name: isDiamond ? 'โรงงานตราเพชร' : 'โรงงานทีพีไอ' }
  if (url.pathname.endsWith('/tpi_job_codes')) body = isDiamond ? [] : [{ ...job, id: '40000000-0000-0000-0000-000000000002', code: '690003', department: 'Research & Development', description: 'งานทดลองผลิตภัณฑ์ RD และเป็นผู้ช่วยงานเทคนิคทดลองวัตถุดิบ Line 1–4', job_type: 'regular', normal_rate: 357, skilled_rate: 377, billing_normal_rate: 457, billing_skilled_rate: 492 }, job]
  if (url.pathname.endsWith('/employees')) body = [{ id: 'fixture-worker', employee_code: 'DRT001', first_name: 'คนงานจำลอง', last_name: 'ตราเพชร', position: 'worker', nationality: 'ไทย', status: 'active', wage_type: 'daily', rate_per_12h: 650 }]
  if (url.pathname.endsWith('/shift_assignments')) body = [{ employee_id: 'fixture-worker', work_date: '2026-10-01', shift_type: 'normal', is_holiday_ot: false, ot_hours: 0 }]
  if (url.pathname.endsWith('/payroll_periods')) body = [{ id: 'fixture-period', factory_id: 'diamond-fixture', label: '1-15 ตุลาคม 2569', period_start: '2026-10-01', period_end: '2026-10-15', status: 'draft', social_security_rate: 0.05 }]
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/1' } })
}
function setFactory(diamond: boolean) {
  useAppStore.getState().setUser({ id: 'fixture-admin', role: 'admin', factory_id: diamond ? 'diamond-fixture' : 'tpi-fixture', full_name: 'แอดมินทดสอบ' })
  useAppStore.getState().setCompanyContext({ id: 'fixture-company', name: diamond ? 'ตราเพชร' : 'ทีพีไอ', factoryName: diamond ? 'โรงงานตราเพชร' : 'โรงงานทีพีไอ', type: diamond ? 'drt' : 'tpi' })
}
setFactory(false)
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
function Layout() {
  const [narrow, setNarrow] = useState(false)
  return <><nav style={{ flexWrap: 'wrap', display: 'flex', gap: 20, padding: 16 }}><Link to="/tests/tpi/non-billable-browser.html" onClick={() => setFactory(false)}>รหัสงาน</Link><Link to="/tests/tpi/non-billable-browser.html" onClick={() => setFactory(true)}>ทดสอบการแยกโรงงาน</Link><Link to="/tests/tpi/diamond-payroll" onClick={() => setFactory(true)}>ค่าจ้างอีกโรงงาน</Link><button onClick={() => setNarrow(value => !value)}>{narrow ? 'จำลองเต็มหน้า' : 'จำลองพื้นที่ 720px'}</button></nav><main style={{ width: narrow ? 720 : '100%', maxWidth: '100%' }}><Outlet context={{ onMenuClick: () => {} }} /></main></>
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><BrowserRouter><Routes><Route element={<Layout />}><Route path="/tests/tpi/non-billable-browser.html" element={<TpiJobManagement />} /><Route path="/tests/tpi/diamond-payroll" element={<CompanyPayrollEntry />} /></Route></Routes></BrowserRouter></QueryClientProvider>)
