-- ========================================
-- RLS Policies สำหรับระบบ วิราญกร Payroll
-- รัน SQL นี้ใน Supabase SQL Editor
-- ========================================

-- profiles: อ่านได้เฉพาะ row ของตัวเอง
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- companies: ผู้ใช้ที่ล็อกอินแล้วดูได้ทุกคน
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "companies_select" ON companies FOR SELECT TO authenticated USING (true);
CREATE POLICY "companies_all" ON companies FOR ALL TO authenticated USING (true);

-- factories: ผู้ใช้ที่ล็อกอินแล้วดูได้ทุกคน
ALTER TABLE factories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "factories_select" ON factories FOR SELECT TO authenticated USING (true);
CREATE POLICY "factories_all" ON factories FOR ALL TO authenticated USING (true);

-- employees: จัดการได้ทั้งหมด
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "employees_all" ON employees FOR ALL TO authenticated USING (true);

-- payroll_periods
ALTER TABLE payroll_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "periods_all" ON payroll_periods FOR ALL TO authenticated USING (true);

-- shift_assignments
ALTER TABLE shift_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shifts_all" ON shift_assignments FOR ALL TO authenticated USING (true);

-- payroll_entries
ALTER TABLE payroll_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payroll_all" ON payroll_entries FOR ALL TO authenticated USING (true);

-- advance_payments
ALTER TABLE advance_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "advances_all" ON advance_payments FOR ALL TO authenticated USING (true);

-- payslip_tokens
ALTER TABLE payslip_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tokens_all" ON payslip_tokens FOR ALL TO authenticated USING (true);
