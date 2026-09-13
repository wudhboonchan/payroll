-- ==============================================================================
-- migration_tpi_reset_fake_rates.sql
-- คำสั่งคืนค่าเดิมของอัตราค่าจ้างรหัสงาน (Job Codes)
-- ลบเรท 380, 400, 450 ที่ตั้งเกินจริงออกทั้งหมด และคืนค่าเดิม
-- ==============================================================================

-- 1. คืนค่า skilled_rate ให้เป็น NULL สำหรับรหัสงานทั่วไปที่ไม่ใช่เสมียน ที่มีเรท 380, 400, 450
UPDATE tpi_job_codes
SET skilled_rate = NULL
WHERE code NOT IN ('692021', '692032', '692041', '692050')
  AND skilled_rate IN (380, 400, 450);

-- 2. รหัสงานกลุ่มเสมียน (692021, 692032, 692041, 692050) ให้คงเรทมาตรฐาน ปกติ 357 / ฝีมือ 377
UPDATE tpi_job_codes
SET normal_rate = 357, skilled_rate = 377, job_group = 'clerk'
WHERE code IN ('692021', '692032', '692041', '692050');

-- 3. หากในประวัติการทำงาน (tpi_shift_entries) มีรายการที่เผลอบันทึก rate_snapshot เป็นเรท 380, 400, 450
-- ให้คืนค่ากลับมาเป็นค่าแรงปกติ 357 (สำหรับงานทั่วไป)
UPDATE tpi_shift_entries
SET rate_snapshot = 357
WHERE rate_snapshot IN (380, 400, 450)
  AND (job_code_snapshot NOT IN ('692021', '692032', '692041', '692050') OR job_code_snapshot IS NULL);

-- 4. คืนค่าสถานะ "เปิดใช้งาน" (active = true) ใน Master Data ทั้งหมด (ไม่มีสถานะงดรับกะใน Master Data)
UPDATE tpi_job_codes
SET active = true
WHERE code IN ('P315/69VRK', 'P322/69VRK', 'P422/69', 'Q121/69', 'Q131/69')
   OR notes LIKE '%ระบุหยุด%';

