-- Add holiday_ot_exempt flag to shift_assignments
-- When true, employee works on holiday but receives normal (1x) pay instead of 2x
ALTER TABLE shift_assignments
ADD COLUMN IF NOT EXISTS is_holiday_ot_exempt boolean DEFAULT false;
