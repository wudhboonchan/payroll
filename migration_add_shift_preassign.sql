-- Migration: Add is_pending to tpi_shift_entries and create tpi_preassign_shifts RPC
-- Date: 2026-09-13

BEGIN;

-- 1. Add is_pending column to tpi_shift_entries if not exists
ALTER TABLE public.tpi_shift_entries
ADD COLUMN IF NOT EXISTS is_pending boolean NOT NULL DEFAULT false;

-- 2. Update tpi_save_shift_day RPC to handle is_pending
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
  v_is_ot_before boolean;
  v_is_pending boolean;
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
    is_holiday_ot boolean,
    is_ot_before_shift boolean,
    ot_job_id uuid,
    ot_job_code_snapshot text,
    is_pending boolean
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
    v_is_ot_before := coalesce(item.is_ot_before_shift, false);
    v_is_pending := coalesce(item.is_pending, false);
    
    IF v_is_holiday THEN
      v_day_has_holiday := true;
    END IF;
    
    IF NOT job.active OR (job.valid_from IS NOT NULL AND p_date<job.valid_from) OR (job.expires_on IS NOT NULL AND p_date>job.expires_on) THEN 
      RAISE EXCEPTION 'รหัสงานหมดอายุ หรือยังไม่เริ่มใช้งาน'; 
    END IF;
    
    -- Check if employee has skilled wage tier
    SELECT 
      CASE 
        WHEN wp.rate_tier = 'skilled' AND (wp.skilled_from IS NULL OR wp.skilled_from <= p_date) AND (
          job.job_group = 'clerk'
          OR (
            wp.job_id = item.job_id 
            OR lower(coalesce(wp.job_code, '')) = lower(job.code)
            OR lower(coalesce(emp.job_title, '')) = lower(job.code)
            OR (wp.job_id IS NULL AND (wp.job_code IS NULL OR wp.job_code = '') AND (emp.job_title IS NULL OR emp.job_title = ''))
          )
        )
        THEN 'skilled' 
        ELSE 'normal' 
      END INTO tier
    FROM tpi_employee_wage_profiles wp
    LEFT JOIN employees emp ON emp.id = wp.employee_id
    WHERE wp.employee_id=item.employee_id AND wp.factory_id=p_factory;
    
    tier := coalesce(tier, 'normal');
    amount := CASE 
      WHEN tier = 'skilled' THEN coalesce(job.skilled_rate, job.normal_rate) 
      ELSE job.normal_rate 
    END;
    
    IF amount IS NULL THEN 
      RAISE EXCEPTION 'กรุณากำหนดอัตราค่าจ้างของรหัสงานก่อนบันทึก'; 
    END IF;
    
    IF v_is_half THEN
      amount := amount / 2.0;
    END IF;
    
    INSERT INTO tpi_shift_entries(factory_id, work_date, employee_id, shift_index, job_id, rate_tier, rate_snapshot, job_code_snapshot, is_half_shift, actual_hours, ot_hours, ot_pay, is_holiday_ot, is_ot_before_shift, ot_job_id, ot_job_code_snapshot, is_pending)
    VALUES(p_factory, p_date, item.employee_id, item.shift_index, item.job_id, tier, amount, job.code, v_is_half, v_hours, v_ot_hours, v_ot_pay, v_is_holiday, v_is_ot_before, item.ot_job_id, item.ot_job_code_snapshot, v_is_pending)
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
      is_holiday_ot = excluded.is_holiday_ot,
      is_ot_before_shift = excluded.is_ot_before_shift,
      ot_job_id = excluded.ot_job_id,
      ot_job_code_snapshot = excluded.ot_job_code_snapshot,
      is_pending = excluded.is_pending;
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

REVOKE ALL ON FUNCTION public.tpi_save_shift_day(uuid,date,integer,jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tpi_save_shift_day(uuid,date,integer,jsonb,boolean) TO authenticated;

-- 3. Create tpi_preassign_shifts RPC
CREATE OR REPLACE FUNCTION public.tpi_preassign_shifts(
  p_factory uuid,
  p_target_dates date[],
  p_entries jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_date date;
  item record;
  job record;
  tier text;
  amount numeric;
  v_is_half boolean;
  v_hours numeric;
  v_count integer := 0;
BEGIN
  IF NOT public.can_manage_factory(p_factory) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOREACH v_target_date IN ARRAY p_target_dates LOOP
    -- Ensure day record exists
    INSERT INTO tpi_shift_days(factory_id, work_date, revision, is_holiday)
    VALUES(p_factory, v_target_date, 0, false)
    ON CONFLICT(factory_id, work_date) DO NOTHING;

    -- Process entries
    FOR item IN SELECT * FROM jsonb_to_recordset(p_entries) AS x(
      employee_id uuid,
      shift_index integer,
      job_id uuid,
      is_half_shift boolean,
      actual_hours numeric,
      ot_hours numeric,
      ot_pay numeric,
      is_holiday_ot boolean,
      is_ot_before_shift boolean,
      ot_job_id uuid,
      ot_job_code_snapshot text
    ) LOOP
      IF EXISTS(SELECT 1 FROM employees WHERE id=item.employee_id AND factory_id=p_factory AND status='active') THEN
        SELECT * INTO job FROM tpi_job_codes WHERE id=item.job_id AND factory_id=p_factory;
        IF FOUND THEN
          v_is_half := coalesce(item.is_half_shift, false);
          v_hours := coalesce(item.actual_hours, CASE WHEN v_is_half THEN 4 ELSE 8 END);

          -- Check if employee has skilled wage tier
          SELECT 
            CASE 
              WHEN wp.rate_tier = 'skilled' AND (wp.skilled_from IS NULL OR wp.skilled_from <= v_target_date) AND (
                job.job_group = 'clerk'
                OR (
                  wp.job_id = item.job_id 
                  OR lower(coalesce(wp.job_code, '')) = lower(job.code)
                  OR lower(coalesce(emp.job_title, '')) = lower(job.code)
                  OR (wp.job_id IS NULL AND (wp.job_code IS NULL OR wp.job_code = '') AND (emp.job_title IS NULL OR emp.job_title = ''))
                )
              )
              THEN 'skilled' 
              ELSE 'normal' 
            END INTO tier
          FROM tpi_employee_wage_profiles wp
          LEFT JOIN employees emp ON emp.id = wp.employee_id
          WHERE wp.employee_id=item.employee_id AND wp.factory_id=p_factory;

          tier := coalesce(tier, 'normal');
          amount := CASE 
            WHEN tier = 'skilled' THEN coalesce(job.skilled_rate, job.normal_rate) 
            ELSE job.normal_rate 
          END;

          IF amount IS NOT NULL THEN
            IF v_is_half THEN
              amount := amount / 2.0;
            END IF;

            INSERT INTO tpi_shift_entries(
              factory_id, work_date, employee_id, shift_index, job_id,
              rate_tier, rate_snapshot, job_code_snapshot,
              is_half_shift, actual_hours, ot_hours, ot_pay,
              is_holiday_ot, is_ot_before_shift, ot_job_id, ot_job_code_snapshot,
              is_pending
            )
            VALUES(
              p_factory, v_target_date, item.employee_id, item.shift_index, item.job_id,
              tier, amount, job.code,
              v_is_half, v_hours, coalesce(item.ot_hours, 0), coalesce(item.ot_pay, 0),
              coalesce(item.is_holiday_ot, false), coalesce(item.is_ot_before_shift, false),
              item.ot_job_id, item.ot_job_code_snapshot,
              true
            )
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
              is_holiday_ot = excluded.is_holiday_ot,
              is_ot_before_shift = excluded.is_ot_before_shift,
              ot_job_id = excluded.ot_job_id,
              ot_job_code_snapshot = excluded.ot_job_code_snapshot,
              is_pending = true;

            v_count := v_count + 1;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.tpi_preassign_shifts(uuid,date[],jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tpi_preassign_shifts(uuid,date[],jsonb) TO authenticated;

COMMIT;
