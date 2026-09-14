-- ==============================================================================
-- สคริปต์: ล้างข้อมูลทดลองงวดสิงหาคม 2569 และเปิดงวดใหม่ 1 - 15 กันยายน 2569
-- รันสคริปต์นี้ใน: Supabase Dashboard -> SQL Editor -> Run
-- ==============================================================================

BEGIN;

-- 1. ลบข้อมูลกะการทำงานทดลองทั้งหมดในเดือนสิงหาคม 2569 (tpi_shift_entries & tpi_shift_days)
DELETE FROM public.tpi_shift_entries
WHERE work_date >= '2026-08-01' AND work_date <= '2026-08-31';

DELETE FROM public.tpi_shift_days
WHERE work_date >= '2026-08-01' AND work_date <= '2026-08-31';

DELETE FROM public.shift_assignments
WHERE work_date >= '2026-08-01' AND work_date <= '2026-08-31';

-- 2. ลบรายการคำนวณเงินเดือน, สลิป และการเบิกล่วงหน้าที่ผูกกับงวดทดลอง (สิงหาคม 2569)
DELETE FROM public.payroll_entries
WHERE period_id IN (
  SELECT id FROM public.payroll_periods
  WHERE period_start >= '2026-08-01' AND period_end <= '2026-08-31'
);

DELETE FROM public.payslip_tokens
WHERE period_id IN (
  SELECT id FROM public.payroll_periods
  WHERE period_start >= '2026-08-01' AND period_end <= '2026-08-31'
);

DELETE FROM public.advance_payments
WHERE period_id IN (
  SELECT id FROM public.payroll_periods
  WHERE period_start >= '2026-08-01' AND period_end <= '2026-08-31'
);

-- 3. ลบงวดทดลองเดิม (16 - 31 สิงหาคม 2569) ออกจากระบบ
DELETE FROM public.payroll_periods
WHERE period_start >= '2026-08-01' AND period_end <= '2026-08-31';

-- 4. เปิดงวดใหม่: 1 - 15 กันยายน 2569 (สำหรับทุกโรงงาน)
INSERT INTO public.payroll_periods (
  factory_id,
  label,
  period_start,
  period_end,
  status,
  social_security_rate
)
SELECT 
  f.id AS factory_id,
  '1 - 15 กันยายน 2569' AS label,
  '2026-09-01'::date AS period_start,
  '2026-09-15'::date AS period_end,
  'draft' AS status,
  0.05 AS social_security_rate
FROM public.factories f
ON CONFLICT DO NOTHING;

COMMIT;

-- 5. ตรวจสอบผลลัพธ์
-- รายการงวดทั้งหมดในระบบ (ควรงวด 1 - 15 กันยายน 2569 เป็น draft)
SELECT id, factory_id, label, period_start, period_end, status 
FROM public.payroll_periods 
ORDER BY period_start ASC;

-- ตรวจสอบจำนวนกะคงค้างในเดือนสิงหาคม (ควรได้ 0)
SELECT count(*) AS remaining_august_shifts 
FROM public.tpi_shift_entries 
WHERE work_date >= '2026-08-01' AND work_date <= '2026-08-31';
