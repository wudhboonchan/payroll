-- Migration Phase 8: Bind TPI skilled wage profile to a specific active job code
-- Only regular jobs qualify for skilled rate; temporary cross-job assignments revert to normal rate.

BEGIN;

-- 1. Add job_id and job_code to tpi_employee_wage_profiles
ALTER TABLE public.tpi_employee_wage_profiles
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.tpi_job_codes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS job_code text;

CREATE INDEX IF NOT EXISTS idx_tpi_wage_profiles_job 
  ON public.tpi_employee_wage_profiles (factory_id, job_id);

-- 2. Update tpi_save_shift_day RPC function
CREATE OR REPLACE FUNCTION public.tpi_save_shift_day(
  p_factory uuid,
  p_date date,
  p_revision integer,
  p_entries jsonb,
  p_is_holiday boolean DEFAULT false
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_revision integer;
  item record;
  job record;
  tier text;
  amount numeric;
  v_is_half boolean;
  v_hours numeric;
  v_ot_hours numeric;
  v_ot_pay numeric;
  v_is_holiday boolean;
  v_day_has_holiday boolean := coalesce(p_is_holiday, false);
BEGIN
  IF NOT public.can_manage_factory(p_factory) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO tpi_shift_days(factory_id, work_date, revision, is_holiday)
  VALUES(p_factory, p_date, 0, v_day_has_holiday)
  ON CONFLICT(factory_id, work_date) DO NOTHING;

  SELECT revision INTO current_revision 
  FROM tpi_shift_days 
  WHERE factory_id=p_factory AND work_date=p_date FOR UPDATE;

  IF current_revision <> p_revision THEN
    RAISE EXCEPTION 'Stale write rejected (expected revision %, found %)', p_revision, current_revision;
  END IF;

  FOR item IN SELECT * FROM jsonb_to_recordset(p_entries) AS x(
    employee_id uuid,
    shift_index integer,
    job_id uuid,
    is_half_shift boolean,
    actual_hours numeric,
    ot_hours numeric,
    ot_pay numeric,
    is_holiday_ot boolean
  ) LOOP
    IF NOT EXISTS(SELECT 1 FROM employees WHERE id=item.employee_id AND factory_id=p_factory AND status='active') THEN 
      RAISE EXCEPTION 'Employee inactive or belongs to another factory'; 
    END IF;
    
    SELECT * INTO job FROM tpi_job_codes WHERE id=item.job_id AND factory_id=p_factory FOR SHARE;
    IF NOT FOUND THEN 
      RAISE EXCEPTION 'Invalid job'; 
    END IF;
    
    v_is_half := coalesce(item.is_half_shift, false);
    v_hours := coalesce(item.actual_hours, CASE WHEN v_is_half THEN 4 ELSE 8 END);
    v_ot_hours := coalesce(item.ot_hours, 0);
    v_ot_pay := coalesce(item.ot_pay, 0);
    v_is_holiday := coalesce(item.is_holiday_ot, false) OR v_day_has_holiday;
    
    IF v_is_holiday THEN
      v_day_has_holiday := true;
    END IF;
    
    IF NOT job.active OR (job.valid_from IS NOT NULL AND p_date<job.valid_from) OR (job.expires_on IS NOT NULL AND p_date>job.expires_on) THEN 
      RAISE EXCEPTION 'รหัสงานหมดอายุ หรือยังไม่เริ่มใช้งาน'; 
    END IF;
    
    -- Check if employee has skilled wage tier AND this shift matches their regular skilled job (or clerk rotation)
    SELECT 
      CASE 
        WHEN wp.rate_tier = 'skilled' AND wp.skilled_from <= p_date 
             AND (
               job.code IN ('692021', '692032', '692041', '692050')
               OR wp.job_id = item.job_id 
               OR lower(coalesce(wp.job_code, '')) = lower(job.code)
               OR lower(coalesce(emp.job_title, '')) = lower(job.code)
             )
        THEN 'skilled' 
        ELSE 'normal' 
      END INTO tier
    FROM tpi_employee_wage_profiles wp
    LEFT JOIN employees emp ON emp.id = wp.employee_id
    WHERE wp.employee_id=item.employee_id AND wp.factory_id=p_factory;
    
    tier := coalesce(tier, 'normal');
    amount := CASE WHEN tier = 'skilled' THEN job.skilled_rate ELSE job.normal_rate END;
    
    IF amount IS NULL THEN 
      RAISE EXCEPTION 'กรุณากำหนดค่าแรงฝีมือของรหัสงานก่อนบันทึก'; 
    END IF;
    
    IF v_is_half THEN
      amount := amount / 2.0;
    END IF;
    
    INSERT INTO tpi_shift_entries(factory_id, work_date, employee_id, shift_index, job_id, rate_tier, rate_snapshot, job_code_snapshot, is_half_shift, actual_hours, ot_hours, ot_pay, is_holiday_ot)
    VALUES(p_factory, p_date, item.employee_id, item.shift_index, item.job_id, tier, amount, job.code, v_is_half, v_hours, v_ot_hours, v_ot_pay, v_is_holiday)
    ON CONFLICT(factory_id, work_date, employee_id, shift_index) 
    DO UPDATE SET 
      job_id = excluded.job_id,
      rate_tier = excluded.rate_tier,
      rate_snapshot = excluded.rate_snapshot,
      job_code_snapshot = excluded.job_code_snapshot,
      is_half_shift = excluded.is_half_shift,
      actual_hours = excluded.actual_hours,
      ot_hours = excluded.ot_hours,
      ot_pay = excluded.ot_pay,
      is_holiday_ot = excluded.is_holiday_ot;
  END LOOP;
  
  DELETE FROM tpi_shift_entries e 
  WHERE factory_id=p_factory AND work_date=p_date 
    AND NOT EXISTS(
      SELECT 1 FROM jsonb_to_recordset(p_entries) AS r(employee_id uuid, shift_index integer, job_id uuid) 
      WHERE r.employee_id=e.employee_id AND r.shift_index=e.shift_index
    );
    
  UPDATE tpi_shift_days 
  SET revision=revision+1, is_holiday=v_day_has_holiday, updated_at=clock_timestamp(), updated_by=auth.uid() 
  WHERE factory_id=p_factory AND work_date=p_date;
  
  RETURN current_revision+1;
END; 
$$;

COMMIT;
