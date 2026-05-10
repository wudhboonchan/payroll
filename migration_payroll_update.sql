-- ============================================================
-- Migration Script สำหรับระบบ Payroll
-- รันใน Supabase Dashboard > SQL Editor
-- ============================================================

-- ข้อ 2: เพิ่มตำแหน่งงาน (worker = พนักงาน, clerk = เสมียน)
ALTER TABLE employees 
ADD COLUMN IF NOT EXISTS position TEXT DEFAULT 'worker';

-- ข้อ 5: เพิ่มประเภทค่าจ้าง (daily = รายวัน, monthly = รายเดือน)
ALTER TABLE employees 
ADD COLUMN IF NOT EXISTS wage_type TEXT DEFAULT 'daily';

-- ข้อ 7: เพิ่มสถานะทำงาน 8 ชม. (ไม่เต็ม 12 ชม. = ไม่ได้ค่ากะ)
ALTER TABLE shift_assignments 
ADD COLUMN IF NOT EXISTS is_half_shift BOOLEAN DEFAULT FALSE;

-- ข้อ 8: เพิ่มค่าไม้และค่าฟิล์มรายวัน (กรอกในหน้ากะได้)
ALTER TABLE shift_assignments 
ADD COLUMN IF NOT EXISTS wood_excess NUMERIC DEFAULT 0;

ALTER TABLE shift_assignments 
ADD COLUMN IF NOT EXISTS film_amount NUMERIC DEFAULT 0;

-- เสมียน: เก็บชั่วโมง OT รายวัน (เกิน 8 ชม.)
ALTER TABLE shift_assignments 
ADD COLUMN IF NOT EXISTS ot_hours NUMERIC DEFAULT 0;

-- (Optional) เพิ่ม approved_by และ approved_at ถ้ายังไม่มี
ALTER TABLE payroll_periods 
ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id);

ALTER TABLE payroll_periods 
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- ============================================================
-- ตรวจสอบผลลัพธ์
-- ============================================================
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'employees' 
  AND column_name IN ('position', 'wage_type');

SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'shift_assignments' 
  AND column_name IN ('is_half_shift', 'wood_excess', 'film_amount', 'ot_hours');
