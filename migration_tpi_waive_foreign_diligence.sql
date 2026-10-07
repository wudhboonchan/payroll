-- Migration: Add waive_foreign_diligence to payroll_periods for TPI factory
-- ฟังก์ชั่นงดจ่ายค่าเบี้ยขยันสำหรับพนักงานต่างชาติทุกคนเป็นกรณีพิเศษในงวดสิ้นเดือน (เฉพาะโรงงานทีพีไอ)

ALTER TABLE public.payroll_periods
  ADD COLUMN IF NOT EXISTS waive_foreign_diligence BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN public.payroll_periods.waive_foreign_diligence IS 'กรณีพิเศษ (เฉพาะทีพีไอ): งดจ่ายเบี้ยขยันสำหรับพนักงานชาวต่างชาติทุกคนในงวดสิ้นเดือน';
