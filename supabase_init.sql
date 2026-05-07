-- 1. สร้างตาราง companies (บริษัทหลัก)
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  short_name TEXT,
  company_type TEXT NOT NULL,
  logo_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. สร้างตาราง factories (โรงงาน/สาขา)
CREATE TABLE factories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  shift_morning_start TIME,
  shift_morning_end TIME,
  shift_afternoon_start TIME,
  shift_afternoon_end TIME,
  shift_night_start TIME,
  shift_night_end TIME,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. สร้างตาราง profiles (ผู้ใช้งานระบบ เชื่อมกับ Supabase Auth)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  factory_id UUID REFERENCES factories(id) ON DELETE SET NULL,
  role TEXT CHECK (role IN ('admin', 'superUser', 'normalUser')),
  full_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. สร้างตาราง employees (ฐานข้อมูลพนักงาน)
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  employee_code TEXT NOT NULL,
  prefix TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  national_id TEXT,
  nationality TEXT DEFAULT 'Thai',
  payment_method TEXT CHECK (payment_method IN ('cash', 'bank_transfer')),
  bank_name TEXT,
  bank_account TEXT,
  rate_per_12h NUMERIC NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(factory_id, employee_code)
);

-- 5. สร้างตาราง payroll_periods (งวดการจ่ายเงิน)
CREATE TABLE payroll_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  approved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMP WITH TIME ZONE,
  social_security_rate NUMERIC DEFAULT 0.05,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. สร้างตาราง shift_assignments (การลงกะทำงานรายวัน)
CREATE TABLE shift_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_id UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  shift_type TEXT CHECK (shift_type IN ('morning', 'afternoon', 'night')),
  is_holiday_ot BOOLEAN DEFAULT FALSE,
  entered_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(employee_id, work_date)
);

-- 7. สร้างตาราง payroll_entries (ข้อมูลตัวเลขดิบก่อนคำนวณสลิป)
CREATE TABLE payroll_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_id UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  
  -- Incomes
  amount_normal NUMERIC DEFAULT 0,
  amount_shift NUMERIC DEFAULT 0,
  amount_ot NUMERIC DEFAULT 0,
  
  -- Overrides (ถ้ามีการแก้ตัวเลขด้วยมือ)
  override_normal NUMERIC,
  override_shift NUMERIC,
  override_ot NUMERIC,
  override_reason TEXT,
  
  -- Extra Incomes
  amount_wood_excess NUMERIC DEFAULT 0,
  amount_film NUMERIC DEFAULT 0,
  amount_special NUMERIC DEFAULT 0,
  amount_diligence NUMERIC DEFAULT 0,
  amount_position NUMERIC DEFAULT 0,
  
  -- Deductions
  deduct_social_security NUMERIC DEFAULT 0,
  deduct_advance NUMERIC DEFAULT 0,
  deduct_safety_equipment NUMERIC DEFAULT 0,
  deduct_uniform NUMERIC DEFAULT 0,
  
  entered_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(period_id, employee_id)
);

-- 8. สร้างตาราง advance_payments (ประวัติการเบิกเงินล่วงหน้า)
CREATE TABLE advance_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_id UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  request_date DATE DEFAULT CURRENT_DATE,
  notes TEXT,
  entered_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. สร้างตาราง payslip_tokens (ลิงก์ส่งสลิปผ่าน LINE)
CREATE TABLE payslip_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_id UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- ระบบโต้แย้ง (Dispute)
  employee_status TEXT DEFAULT 'pending' CHECK (employee_status IN ('pending', 'confirmed', 'disputed', 'auto_confirmed')),
  dispute_reason TEXT,
  confirmed_at TIMESTAMP WITH TIME ZONE,
  auto_confirm_at TIMESTAMP WITH TIME ZONE,
  
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- เพิ่มคำสั่งให้ฐานข้อมูลสามารถทำงานร่วมกับ Realtime ได้ (ไม่บังคับ แต่ดีกับ UI)
alter publication supabase_realtime add table employees;
alter publication supabase_realtime add table shift_assignments;
alter publication supabase_realtime add table payroll_entries;
