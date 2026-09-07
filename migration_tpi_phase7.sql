-- Migration Phase 7: Create tpi_attendance_logs table for tracking absent, leave, and late records
BEGIN;

CREATE TABLE IF NOT EXISTS public.tpi_attendance_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  type text NOT NULL CHECK (type IN ('absent', 'leave', 'late')),
  leave_type text CHECK (leave_type IN ('sick', 'business', 'vacation', 'other')),
  minutes_late integer DEFAULT NULL,
  reason text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(factory_id, employee_id, work_date, type)
);

CREATE INDEX IF NOT EXISTS idx_tpi_attendance_lookup 
  ON public.tpi_attendance_logs (factory_id, work_date);

CREATE INDEX IF NOT EXISTS idx_tpi_attendance_emp_month 
  ON public.tpi_attendance_logs (factory_id, employee_id, work_date);

ALTER TABLE public.tpi_attendance_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tpi_attendance_read ON public.tpi_attendance_logs;
CREATE POLICY tpi_attendance_read ON public.tpi_attendance_logs 
  FOR SELECT TO authenticated USING (public.can_access_factory(factory_id));

DROP POLICY IF EXISTS tpi_attendance_insert ON public.tpi_attendance_logs;
CREATE POLICY tpi_attendance_insert ON public.tpi_attendance_logs 
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_factory(factory_id));

DROP POLICY IF EXISTS tpi_attendance_update ON public.tpi_attendance_logs;
CREATE POLICY tpi_attendance_update ON public.tpi_attendance_logs 
  FOR UPDATE TO authenticated USING (public.can_manage_factory(factory_id)) WITH CHECK (public.can_manage_factory(factory_id));

DROP POLICY IF EXISTS tpi_attendance_delete ON public.tpi_attendance_logs;
CREATE POLICY tpi_attendance_delete ON public.tpi_attendance_logs 
  FOR DELETE TO authenticated USING (public.can_manage_factory(factory_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tpi_attendance_logs TO authenticated;

COMMIT;
