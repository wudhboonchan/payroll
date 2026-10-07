-- TPI only: apply before deploying the hourly deduction UI.
BEGIN;
ALTER TABLE public.tpi_attendance_logs
  ADD COLUMN IF NOT EXISTS workflow_status text NOT NULL DEFAULT 'completed' CHECK (workflow_status IN ('pending','completed')),
  ADD COLUMN IF NOT EXISTS deducted_hours integer,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

CREATE OR REPLACE FUNCTION public.tpi_require_attendance_reason() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.source='shift' AND (NEW.work_date<>OLD.work_date OR NEW.employee_id<>OLD.employee_id OR NEW.factory_id<>OLD.factory_id) THEN
    RAISE EXCEPTION 'รายการจากกะต้องใช้วันที่และพนักงานเดิม';
  END IF;
  IF NEW.source='shift' AND NEW.workflow_status='completed' AND nullif(trim(NEW.reason), '') IS NULL THEN
    RAISE EXCEPTION 'กรุณากรอกเหตุผลก่อนดำเนินรายการให้เสร็จ';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tpi_attendance_reason ON public.tpi_attendance_logs;
CREATE TRIGGER tpi_attendance_reason BEFORE INSERT OR UPDATE ON public.tpi_attendance_logs
FOR EACH ROW EXECUTE FUNCTION public.tpi_require_attendance_reason();

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

  IF NOT EXISTS (SELECT 1 FROM factories WHERE id=p_factory AND name ~* '(ทีพีไอ|tpi)' AND name !~* '(ตราเพชร|diamond|drt)') THEN
    RAISE EXCEPTION 'Hourly deductions are available for TPI only';
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
    
    IF (NOT job.active OR (job.valid_from IS NOT NULL AND p_date<job.valid_from) OR (job.expires_on IS NOT NULL AND p_date>job.expires_on))
      AND NOT EXISTS (SELECT 1 FROM public.tpi_shift_entries existing_assignment
        WHERE existing_assignment.factory_id=p_factory AND existing_assignment.work_date=p_date
          AND existing_assignment.employee_id=item.employee_id
          AND existing_assignment.shift_index=item.shift_index AND existing_assignment.job_id=item.job_id) THEN 
      RAISE EXCEPTION 'รหัสงาน % ใช้ไม่ได้ในวันที่ % (เปิดใช้งาน: %, เริ่มใช้: %, หมดอายุ: %)', job.code, p_date, job.active, job.valid_from, job.expires_on; 
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
    
    IF v_hours < 1 OR v_hours > 8 OR v_hours <> trunc(v_hours) THEN
      RAISE EXCEPTION 'Working hours must be an integer from 1 to 8';
    END IF;
    -- Legacy half shifts retain their historical formula; new hourly entries use whole-baht deduction.
    IF v_is_half THEN
      amount := amount / 2.0;
    ELSE
      amount := amount - ceil(amount / 8.0) * (8 - v_hours);
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
  
  UPDATE tpi_attendance_logs a SET deducted_hours=(SELECT sum(8-e.actual_hours) FROM tpi_shift_entries e
    WHERE e.factory_id=p_factory AND e.work_date=p_date AND e.employee_id=a.employee_id AND NOT e.is_pending)
  WHERE a.factory_id=p_factory AND a.work_date=p_date AND a.source='shift';

  -- Synchronize within the same transaction. Preserve completed reasons across resaves.
  INSERT INTO tpi_attendance_logs(factory_id, employee_id, work_date, type, workflow_status, deducted_hours, source)
  SELECT p_factory, employee_id, p_date, 'leave', 'pending', sum(8 - actual_hours), 'shift'
  FROM tpi_shift_entries
  WHERE factory_id=p_factory AND work_date=p_date AND actual_hours < 8 AND NOT is_pending
    AND NOT EXISTS (SELECT 1 FROM tpi_attendance_logs a WHERE a.factory_id=p_factory AND a.work_date=p_date
      AND a.employee_id=tpi_shift_entries.employee_id AND a.source='shift' AND a.type <> 'leave')
  GROUP BY employee_id
  ON CONFLICT (factory_id, employee_id, work_date, type) DO UPDATE
  SET deducted_hours=excluded.deducted_hours,
      workflow_status=CASE WHEN nullif(trim(tpi_attendance_logs.reason), '') IS NULL THEN 'pending' ELSE tpi_attendance_logs.workflow_status END,
      source='shift', updated_at=now();

  DELETE FROM tpi_attendance_logs a
  WHERE a.factory_id=p_factory AND a.work_date=p_date AND a.source='shift'
    AND a.workflow_status='pending'
    AND NOT EXISTS (SELECT 1 FROM tpi_shift_entries e WHERE e.factory_id=p_factory
      AND e.work_date=p_date AND e.employee_id=a.employee_id AND e.actual_hours < 8 AND NOT e.is_pending);

  RETURN current_revision+1;
END; 
$$;

REVOKE ALL ON FUNCTION public.tpi_save_shift_day(uuid,date,integer,jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tpi_save_shift_day(uuid,date,integer,jsonb,boolean) TO authenticated;


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
            IF v_hours < 1 OR v_hours > 8 OR v_hours <> trunc(v_hours) THEN
              RAISE EXCEPTION 'Working hours must be an integer from 1 to 8';
            END IF;
            IF v_is_half THEN
              amount := amount / 2.0;
            ELSE
              amount := amount - ceil(amount / 8.0) * (8 - v_hours);
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
