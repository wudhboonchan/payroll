-- ============================================================
-- Migration Phase 6: TPI Payroll Fields for Employees
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. เจ้าหน้าที่ความปลอดภัย (จป.) +500/เดือน (งวดสิ้นเดือน)
ALTER TABLE public.employees
ADD COLUMN IF NOT EXISTS is_safety_officer BOOLEAN DEFAULT FALSE;

-- 2. ค่าตำแหน่ง 1,000 บาท/เดือน (งวดสิ้นเดือน)
ALTER TABLE public.employees
ADD COLUMN IF NOT EXISTS has_position_allowance BOOLEAN DEFAULT FALSE;

-- 3. เลขประจำตัวประกันสังคม (ปกส)
ALTER TABLE public.employees
ADD COLUMN IF NOT EXISTS social_security_number TEXT DEFAULT NULL;

COMMENT ON COLUMN public.employees.is_safety_officer IS 'พนักงานเป็นเจ้าหน้าที่ความปลอดภัย (จป.) รับค่า จป. 500 บาท/เดือน งวดสิ้นเดือน';
COMMENT ON COLUMN public.employees.has_position_allowance IS 'พนักงานมีค่าตำแหน่ง รับค่าตำแหน่ง 1,000 บาท/เดือน งวดสิ้นเดือน';
COMMENT ON COLUMN public.employees.social_security_number IS 'เลขประจำตัวประกันสังคม (13 หลัก)';
