-- ==============================================================================
-- [คำเตือนสำคัญ: ห้ามรันสคริปต์นี้เด็ดขาด!]
-- ระบบได้รับการปรับปรุงที่หน้าจอให้แสดงเฉพาะงวดปัจจุบันและซ่อนงวดอนาคตออกเรียบร้อยแล้ว
-- หากรันสคริปต์นี้ ข้อมูลรายการหักเงินค่าปรับ 5 งวดที่ผูกไว้จะถูกลบหายไป
-- ==============================================================================

BEGIN;

-- 1. ลบรายการเบิก/หักเงินล่วงหน้าที่ผูกกับงวดอนาคต (งวดที่เกิน 31 ส.ค. 2569)
DELETE FROM public.advance_payments
WHERE period_id IN (
  SELECT id FROM public.payroll_periods
  WHERE period_start > '2026-08-31'
);

-- 2. ลบข้อมูลกะจำลองหรือที่อาจถูกจัดไว้ในงวดอนาคต (ถ้ามี)
DELETE FROM public.tpi_shift_entries
WHERE work_date > '2026-08-31';

DELETE FROM public.tpi_shift_days
WHERE work_date > '2026-08-31';

-- 3. ลบงวดอนาคตทั้งหมดออกจาก payroll_periods
DELETE FROM public.payroll_periods
WHERE period_start > '2026-08-31';

COMMIT;

-- ตรวจสอบงวดที่เหลืออยู่ในระบบ (ควรเหลือแค่งวด 16 - 31 สิงหาคม 2569 เท่านั้น)
SELECT id, label, period_start, period_end, status 
FROM public.payroll_periods 
ORDER BY period_start ASC;
