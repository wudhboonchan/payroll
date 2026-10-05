-- ==============================================================================
-- อนุมัติงวด 16-31 ส.ค. 2569 และ 1-15 ก.ย. 2569 สำหรับโรงงานตราเพชร
-- และตรวจสอบสถานะงวดเพื่อให้งวด 16-30 ก.ย. 2569 เป็นงวดทำงานปัจจุบัน (draft)
-- ==============================================================================

BEGIN;

-- 1. อนุมัติงวด 16 - 31 สิงหาคม 2569 (โรงงานตราเพชร)
UPDATE public.payroll_periods
SET status = 'approved',
    approved_at = NOW()
WHERE factory_id = (SELECT id FROM public.factories WHERE name ILIKE '%ตราเพชร%' LIMIT 1)
  AND period_start = '2026-08-16'
  AND period_end = '2026-08-31';

-- 2. อนุมัติงวด 1 - 15 กันยายน 2569 (โรงงานตราเพชร)
UPDATE public.payroll_periods
SET status = 'approved',
    approved_at = NOW()
WHERE factory_id = (SELECT id FROM public.factories WHERE name ILIKE '%ตราเพชร%' LIMIT 1)
  AND period_start = '2026-09-01'
  AND period_end = '2026-09-15';

COMMIT;

-- 3. ตรวจสอบสถานะงวดทั้งหมดของโรงงานตราเพชร
SELECT 
  p.id, 
  f.name AS factory_name, 
  p.label, 
  p.period_start, 
  p.period_end, 
  p.status, 
  p.approved_at,
  p.created_at
FROM public.payroll_periods p
JOIN public.factories f ON f.id = p.factory_id
WHERE f.name ILIKE '%ตราเพชร%'
ORDER BY p.period_start DESC;
