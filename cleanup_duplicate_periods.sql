-- ==============================================================================
-- CLEANUP & PREVENT DUPLICATE PAYROLL PERIODS
-- ห้างหุ้นส่วนจำกัด วิราญกร
-- 1. รวมงวดที่ซ้ำกัน (Duplicate Ranges) เข้าด้วยกัน
-- 2. อัปเดต foreign keys ทั้งหมดให้ชี้ไปที่ ID ตัวหลัก
-- 3. ลบงวดที่ซ้ำซ้อนออก
-- 4. อัปเดต label ให้เป็นมาตรฐานเดียวกัน
-- 5. เพิ่ม UNIQUE Constraint ป้องกันการสร้างงวดซ้ำตลอดไป
-- ==============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

-- สร้างตารางชั่วคราวเพื่อจับคู่ (id ตัวซ้ำ -> id ตัวหลักที่จะเก็บไว้)
CREATE TEMP TABLE period_merge_map AS
WITH ranked_periods AS (
  SELECT 
    id,
    factory_id,
    period_start,
    period_end,
    status,
    ROW_NUMBER() OVER (
      PARTITION BY factory_id, period_start, period_end 
      ORDER BY 
        (CASE WHEN status = 'approved' THEN 0 ELSE 1 END),
        created_at ASC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY factory_id, period_start, period_end 
      ORDER BY 
        (CASE WHEN status = 'approved' THEN 0 ELSE 1 END),
        created_at ASC
    ) AS canonical_id
  FROM public.payroll_periods
)
SELECT id AS duplicate_id, canonical_id
FROM ranked_periods
WHERE id <> canonical_id;

-- 1. ย้าย reference ใน shift_assignments (ถ้ามี)
-- หากมีแถวซ้ำซ้อนกันใน (period_id, employee_id, work_date) ให้ลบตัวซ้ำก่อน
DELETE FROM public.shift_assignments sa
USING period_merge_map m
WHERE sa.period_id = m.duplicate_id
  AND EXISTS (
    SELECT 1 FROM public.shift_assignments canonical_sa
    WHERE canonical_sa.period_id = m.canonical_id
      AND canonical_sa.employee_id = sa.employee_id
      AND canonical_sa.work_date = sa.work_date
  );

UPDATE public.shift_assignments sa
SET period_id = m.canonical_id
FROM period_merge_map m
WHERE sa.period_id = m.duplicate_id;

-- 2. ย้าย reference ใน payroll_entries
DELETE FROM public.payroll_entries pe
USING period_merge_map m
WHERE pe.period_id = m.duplicate_id
  AND EXISTS (
    SELECT 1 FROM public.payroll_entries canonical_pe
    WHERE canonical_pe.period_id = m.canonical_id
      AND canonical_pe.employee_id = pe.employee_id
  );

UPDATE public.payroll_entries pe
SET period_id = m.canonical_id
FROM period_merge_map m
WHERE pe.period_id = m.duplicate_id;

-- 3. ย้าย reference ใน advance_payments
UPDATE public.advance_payments ap
SET period_id = m.canonical_id
FROM period_merge_map m
WHERE ap.period_id = m.duplicate_id;

-- 4. ย้าย reference ใน payslip_tokens
DELETE FROM public.payslip_tokens pt
USING period_merge_map m
WHERE pt.period_id = m.duplicate_id
  AND EXISTS (
    SELECT 1 FROM public.payslip_tokens canonical_pt
    WHERE canonical_pt.period_id = m.canonical_id
      AND canonical_pt.employee_id = pt.employee_id
  );

UPDATE public.payslip_tokens pt
SET period_id = m.canonical_id
FROM period_merge_map m
WHERE pt.period_id = m.duplicate_id;

-- 5. ลบแถว payroll_periods ที่ซ้ำซ้อนออก
DELETE FROM public.payroll_periods p
USING period_merge_map m
WHERE p.id = m.duplicate_id;

-- 6. ปรับปรุง Label ของงวดทั้งหมดให้เป็นชื่อมาตรฐานทางการภาษาไทย
-- แปลงเดือนเป็นชื่อเต็มภาษาไทยและปี พ.ศ.
UPDATE public.payroll_periods
SET label = 
  EXTRACT(DAY FROM period_start)::text || ' - ' ||
  EXTRACT(DAY FROM period_end)::text || ' ' ||
  CASE EXTRACT(MONTH FROM period_end)
    WHEN 1 THEN 'มกราคม'
    WHEN 2 THEN 'กุมภาพันธ์'
    WHEN 3 THEN 'มีนาคม'
    WHEN 4 THEN 'เมษายน'
    WHEN 5 THEN 'พฤษภาคม'
    WHEN 6 THEN 'มิถุนายน'
    WHEN 7 THEN 'กรกฎาคม'
    WHEN 8 THEN 'สิงหาคม'
    WHEN 9 THEN 'กันยายน'
    WHEN 10 THEN 'ตุลาคม'
    WHEN 11 THEN 'พฤศจิกายน'
    WHEN 12 THEN 'ธันวาคม'
  END || ' ' ||
  (EXTRACT(YEAR FROM period_end) + 543)::text;

-- 7. เพิ่ม UNIQUE Constraint ป้องกันการสร้างงวดซ้ำซ้อนในอนาคต
ALTER TABLE public.payroll_periods
  DROP CONSTRAINT IF EXISTS payroll_periods_unique_range;

ALTER TABLE public.payroll_periods
  ADD CONSTRAINT payroll_periods_unique_range 
  UNIQUE (factory_id, period_start, period_end);

COMMIT;

-- ตรวจสอบผลลัพธ์: งวดที่เหลืออยู่หลังทำความสะอาด
SELECT 
  p.id, 
  f.name AS factory_name, 
  p.label, 
  p.period_start, 
  p.period_end, 
  p.status, 
  p.created_at
FROM public.payroll_periods p
JOIN public.factories f ON f.id = p.factory_id
ORDER BY f.name, p.period_start DESC;
