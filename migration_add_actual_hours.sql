-- Add actual_hours column to shift_assignments
-- Used for partial shifts (< 8h) where employee worked fewer than a full 8h shift
ALTER TABLE shift_assignments
ADD COLUMN IF NOT EXISTS actual_hours numeric(4,1) DEFAULT 0;

-- Index for any future queries filtering on actual_hours
CREATE INDEX IF NOT EXISTS idx_shift_assignments_actual_hours
  ON shift_assignments (actual_hours)
  WHERE actual_hours > 0;
