-- Migration: Add billing_normal_rate and billing_skilled_rate to tpi_job_codes
-- อัตราค่าบริการ/ค่าแรงที่ตั้งเบิกจาก บมจ. ทีพีไอ โพลีน แยกตามเรทปกติ และ เรทฝีมือ เพื่อคำนวณส่วนต่างกำไรของทั้ง 2 อัตรา respectively

ALTER TABLE public.tpi_job_codes
  ADD COLUMN IF NOT EXISTS billing_normal_rate numeric(12,2) CHECK (billing_normal_rate >= 0),
  ADD COLUMN IF NOT EXISTS billing_skilled_rate numeric(12,2) CHECK (billing_skilled_rate >= 0),
  ADD COLUMN IF NOT EXISTS billing_rate numeric(12,2) CHECK (billing_rate >= 0);

COMMENT ON COLUMN public.tpi_job_codes.billing_normal_rate IS 'ค่าแรงตั้งเบิก TPI เรทปกติ (บาท/กะ) สำหรับคำนวณกำไรส่วนต่างเทียบค่าแรงปกติ';
COMMENT ON COLUMN public.tpi_job_codes.billing_skilled_rate IS 'ค่าแรงตั้งเบิก TPI เรทฝีมือ (บาท/กะ) สำหรับคำนวณกำไรส่วนต่างเทียบค่าแรงฝีมือ';
