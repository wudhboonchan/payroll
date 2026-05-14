-- Performance indexes migration
-- Run this in Supabase SQL Editor

-- employees
CREATE INDEX IF NOT EXISTS idx_employees_factory_id        ON employees(factory_id);
CREATE INDEX IF NOT EXISTS idx_employees_factory_status    ON employees(factory_id, status);
CREATE INDEX IF NOT EXISTS idx_employees_factory_complete  ON employees(factory_id, data_complete) WHERE data_complete = false;

-- payroll_periods
CREATE INDEX IF NOT EXISTS idx_periods_factory_id          ON payroll_periods(factory_id);
CREATE INDEX IF NOT EXISTS idx_periods_factory_status      ON payroll_periods(factory_id, status);
CREATE INDEX IF NOT EXISTS idx_periods_factory_start       ON payroll_periods(factory_id, period_start DESC);

-- shift_assignments
CREATE INDEX IF NOT EXISTS idx_shifts_period_id            ON shift_assignments(period_id);
CREATE INDEX IF NOT EXISTS idx_shifts_employee_id          ON shift_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_shifts_work_date            ON shift_assignments(work_date);
CREATE INDEX IF NOT EXISTS idx_shifts_period_employee      ON shift_assignments(period_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_shifts_factory_date         ON shift_assignments(period_id, work_date);

-- payroll_entries
CREATE INDEX IF NOT EXISTS idx_payroll_period_id           ON payroll_entries(period_id);
CREATE INDEX IF NOT EXISTS idx_payroll_employee_id         ON payroll_entries(employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_period_employee     ON payroll_entries(period_id, employee_id);

-- advance_payments
CREATE INDEX IF NOT EXISTS idx_advances_period_id          ON advance_payments(period_id);
CREATE INDEX IF NOT EXISTS idx_advances_employee_id        ON advance_payments(employee_id);
CREATE INDEX IF NOT EXISTS idx_advances_period_employee    ON advance_payments(period_id, employee_id);

-- payslip_tokens
CREATE INDEX IF NOT EXISTS idx_tokens_period_id            ON payslip_tokens(period_id);
CREATE INDEX IF NOT EXISTS idx_tokens_employee_id          ON payslip_tokens(employee_id);
