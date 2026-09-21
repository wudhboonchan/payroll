-- ==============================================================================
-- [คำเตือนสำคัญ: สคริปต์นี้ถูกแก้ไขเพื่อความปลอดภัยแล้ว]
-- หมายเหตุ: สคริปต์เวอร์ชันเดิมก่อนหน้านี้มีบั๊กที่ร้ายแรงมาก คือไม่ได้ใส่เงื่อนไข factory_id
-- และเผลอสั่ง DELETE FROM shift_assignments ทำให้ข้อมูลของ "โรงงานตราเพชร" หายไปด้วย
--
-- หากต้องการกู้คืนข้อมูลตราเพชร ให้รัน: restore_diamond_august_data.sql
-- ==============================================================================

-- สคริปต์ที่ถูกต้องสำหรับรีเซ็ตเฉพาะโรงงาน ทีพีไอ โพลีน (TPI ONLY):
BEGIN;

-- 1. ลบข้อมูลกะทดลองเฉพาะของโรงงานทีพีไอ ในเดือนสิงหาคม 2569
DELETE FROM public.tpi_shift_entries
WHERE factory_id = 'b7a53b9e-7404-43bd-8762-1f1db6dc32b6'
  AND work_date >= '2026-08-01' AND work_date <= '2026-08-31';

DELETE FROM public.tpi_shift_days
WHERE factory_id = 'b7a53b9e-7404-43bd-8762-1f1db6dc32b6'
  AND work_date >= '2026-08-01' AND work_date <= '2026-08-31';

-- [หมายเหตุ: ห้ามแตะต้อง public.shift_assignments เพราะเป็นตารางกะของตราเพชรเท่านั้น!]

-- 2. ลบรายการคำนวณเงินเดือน, สลิป และการเบิกล่วงหน้าที่ผูกกับงวดทดลอง (เฉพาะทีพีไอ)
DELETE FROM public.payroll_entries
WHERE period_id IN (
  SELECT id FROM public.payroll_periods
  WHERE factory_id = 'b7a53b9e-7404-43bd-8762-1f1db6dc32b6'
    AND period_start >= '2026-08-01' AND period_end <= '2026-08-31'
);

DELETE FROM public.payslip_tokens
WHERE period_id IN (
  SELECT id FROM public.payroll_periods
  WHERE factory_id = 'b7a53b9e-7404-43bd-8762-1f1db6dc32b6'
    AND period_start >= '2026-08-01' AND period_end <= '2026-08-31'
);

DELETE FROM public.advance_payments
WHERE period_id IN (
  SELECT id FROM public.payroll_periods
  WHERE factory_id = 'b7a53b9e-7404-43bd-8762-1f1db6dc32b6'
    AND period_start >= '2026-08-01' AND period_end <= '2026-08-31'
);

-- 3. ลบงวดทดลองของทีพีไอ (สิงหาคม 2569) ออกจากระบบ
DELETE FROM public.payroll_periods
WHERE factory_id = 'b7a53b9e-7404-43bd-8762-1f1db6dc32b6'
  AND period_start >= '2026-08-01' AND period_end <= '2026-08-31';

-- 4. เปิดงวดใหม่: 1 - 15 กันยายน 2569 (เฉพาะทีพีไอ ถ้ายังไม่มี)
INSERT INTO public.payroll_periods (
  factory_id,
  label,
  period_start,
  period_end,
  status,
  social_security_rate
)
VALUES (
  'b7a53b9e-7404-43bd-8762-1f1db6dc32b6',
  '1 - 15 กันยายน 2569',
  '2026-09-01'::date,
  '2026-09-15'::date,
  'draft',
  0.05
)
ON CONFLICT DO NOTHING;

COMMIT;
