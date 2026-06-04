-- Fix: shift_assignments unique constraint must include period_id
-- The old constraint UNIQUE(employee_id, work_date) allows only one shift per
-- employee per calendar date across ALL periods, causing upserts for a new period
-- to silently overwrite shift rows from older periods (changing their period_id).

-- Step 1: Drop the old constraint (name may differ — check with \d shift_assignments)
ALTER TABLE shift_assignments
  DROP CONSTRAINT IF EXISTS shift_assignments_employee_id_work_date_key;

-- Step 2: Add the correct constraint that scopes uniqueness per period
ALTER TABLE shift_assignments
  ADD CONSTRAINT shift_assignments_period_employee_date_key
  UNIQUE (period_id, employee_id, work_date);
