-- Allow an existing TPI assignment to be edited after its master job dates change.
-- New assignments and changes to employee, shift or job still require a valid job.
-- Patch only the TPI RPC; preserve its deployed hourly-deduction implementation.
BEGIN;
DO $patch$
DECLARE
  definition text;
  old_check text := 'IF NOT job.active OR (job.valid_from IS NOT NULL AND p_date<job.valid_from) OR (job.expires_on IS NOT NULL AND p_date>job.expires_on) THEN';
  new_check text := 'IF (NOT job.active OR (job.valid_from IS NOT NULL AND p_date<job.valid_from) OR (job.expires_on IS NOT NULL AND p_date>job.expires_on))
    AND NOT EXISTS (SELECT 1 FROM public.tpi_shift_entries existing_assignment
      WHERE existing_assignment.factory_id=p_factory AND existing_assignment.work_date=p_date
        AND existing_assignment.employee_id=item.employee_id
        AND existing_assignment.shift_index=item.shift_index AND existing_assignment.job_id=item.job_id) THEN';
BEGIN
  SELECT pg_get_functiondef('public.tpi_save_shift_day(uuid,date,integer,jsonb,boolean)'::regprocedure) INTO definition;
  IF position('existing_assignment' IN definition) > 0 THEN RETURN; END IF;
  IF position(old_check IN definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected tpi_save_shift_day definition; patch aborted without changes';
  END IF;
  EXECUTE replace(definition, old_check, new_check);
END;
$patch$;
COMMIT;
