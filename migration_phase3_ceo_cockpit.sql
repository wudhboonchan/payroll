-- ==============================================================================
-- MIGRATION: PHASE 3 — CEO COCKPIT & OUTSOURCE FINANCIAL HUB
-- ห้างหุ้นส่วนจำกัด วิราญกร
-- Only accessible to role: 'superUser'
-- Zero impact to existing Tra Phet / TPI tables, calculations, or triggers.
-- ==============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. ตารางข้อมูลพนักงานแอดมินและทีมบริหารหลังบ้าน (อยู่นอกระบบกะแรงงาน)
CREATE TABLE IF NOT EXISTS public.admin_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code text NOT NULL,
  prefix text,
  first_name text NOT NULL,
  last_name text NOT NULL,
  nickname text,
  national_id text,
  phone text,
  email text,
  role_title text NOT NULL DEFAULT 'Admin ประจำไซต์',
  factory_id uuid REFERENCES public.factories(id) ON DELETE SET NULL, -- โรงงานที่รับผิดชอบ (ถ้ามี)
  bank_name text DEFAULT 'ธนาคารกสิกรไทย',
  bank_account text,
  base_salary numeric(12,2) NOT NULL DEFAULT 0 CHECK (base_salary >= 0),
  daily_allowance numeric(10,2) DEFAULT 0,
  has_social_security boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_code)
);

-- 2. ตารางบันทึกการจ่ายเงินเดือนแอดมินรายงวด (Admin Payroll Entries)
CREATE TABLE IF NOT EXISTS public.admin_payroll_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_label text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  admin_employee_id uuid NOT NULL REFERENCES public.admin_employees(id) ON DELETE CASCADE,
  base_salary numeric(12,2) NOT NULL DEFAULT 0,
  allowance_travel numeric(12,2) DEFAULT 0,
  allowance_site numeric(12,2) DEFAULT 0,
  bonus_incentive numeric(12,2) DEFAULT 0,
  ot_pay numeric(12,2) DEFAULT 0,
  other_income numeric(12,2) DEFAULT 0,
  deduct_social_security numeric(12,2) DEFAULT 0,
  deduct_tax numeric(12,2) DEFAULT 0,
  deduct_advance numeric(12,2) DEFAULT 0,
  other_deductions numeric(12,2) DEFAULT 0,
  net_pay numeric(12,2) NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'approved', 'paid')),
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(period_label, admin_employee_id)
);

-- 3. ตารางบันทึกยอดวางบิลเรียกเก็บจากโรงงานคู่สัญญา (Factory Billings - ฝั่ง Credit)
CREATE TABLE IF NOT EXISTS public.factory_billings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  period_label text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  invoice_number text,
  total_shifts integer DEFAULT 0,
  total_hours numeric(10,2) DEFAULT 0,
  billing_amount numeric(14,2) NOT NULL DEFAULT 0, -- ยอดเรียกเก็บก่อนภาษี
  vat_amount numeric(12,2) DEFAULT 0,
  withholding_tax_amount numeric(12,2) DEFAULT 0,
  net_receivable numeric(14,2) NOT NULL DEFAULT 0, -- ยอดสุทธิที่ต้องได้รับโอน
  billing_status text NOT NULL DEFAULT 'draft' CHECK (billing_status IN ('draft', 'invoiced', 'received')),
  received_at timestamptz,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(factory_id, period_label)
);

-- 4. ตารางบันทึกบัญชีแยกประเภท Credit / Debit และค่าใช้จ่ายดำเนินงาน (Company Ledger)
CREATE TABLE IF NOT EXISTS public.company_ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_date date NOT NULL DEFAULT CURRENT_DATE,
  transaction_type text NOT NULL CHECK (transaction_type IN ('credit', 'debit')),
  category text NOT NULL, -- เช่น 'billing_income', 'worker_wages', 'admin_salary', 'employer_social_security', 'operating_expense', 'safety_equipment', 'bank_fee'
  factory_id uuid REFERENCES public.factories(id) ON DELETE SET NULL,
  period_label text,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  description text NOT NULL,
  bank_account_name text DEFAULT 'บัญชีหลัก หจก.วิราญกร',
  reference_no text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5. ตารางบัญชีธนาคารของบริษัท สำหรับติดตามกระแสเงินสดคงเหลือ
CREATE TABLE IF NOT EXISTS public.company_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name text NOT NULL,
  account_name text NOT NULL DEFAULT 'ห้างหุ้นส่วนจำกัด วิราญกร',
  account_number text NOT NULL,
  current_balance numeric(14,2) NOT NULL DEFAULT 0,
  is_primary boolean NOT NULL DEFAULT true,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on all Phase 3 CEO tables
ALTER TABLE public.admin_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_payroll_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.factory_billings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_bank_accounts ENABLE ROW LEVEL SECURITY;

-- Restrict all access exclusively to superUser (CEO/Executive)
DROP POLICY IF EXISTS ceo_admin_employees_all ON public.admin_employees;
CREATE POLICY ceo_admin_employees_all ON public.admin_employees
  FOR ALL TO authenticated
  USING (public.is_system_admin())
  WITH CHECK (public.is_system_admin());

DROP POLICY IF EXISTS ceo_admin_payroll_entries_all ON public.admin_payroll_entries;
CREATE POLICY ceo_admin_payroll_entries_all ON public.admin_payroll_entries
  FOR ALL TO authenticated
  USING (public.is_system_admin())
  WITH CHECK (public.is_system_admin());

DROP POLICY IF EXISTS ceo_factory_billings_all ON public.factory_billings;
CREATE POLICY ceo_factory_billings_all ON public.factory_billings
  FOR ALL TO authenticated
  USING (public.is_system_admin())
  WITH CHECK (public.is_system_admin());

DROP POLICY IF EXISTS ceo_company_ledger_all ON public.company_ledger_transactions;
CREATE POLICY ceo_company_ledger_all ON public.company_ledger_transactions
  FOR ALL TO authenticated
  USING (public.is_system_admin())
  WITH CHECK (public.is_system_admin());

DROP POLICY IF EXISTS ceo_company_bank_accounts_all ON public.company_bank_accounts;
CREATE POLICY ceo_company_bank_accounts_all ON public.company_bank_accounts
  FOR ALL TO authenticated
  USING (public.is_system_admin())
  WITH CHECK (public.is_system_admin());

COMMIT;
