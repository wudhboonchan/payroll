-- Migration Phase 5: Add Public Holiday support (is_holiday_ot) to TPI Shift Days and Entries
-- When a day is marked as a public holiday, shifts worked on that day receive 2x base wage
BEGIN;

-- 1. Add is_holiday column to tpi_shift_days
ALTER TABLE public.tpi_shift_days 
  ADD COLUMN IF NOT EXISTS is_holiday boolean NOT NULL DEFAULT false;

-- 2. Add all required columns to tpi_shift_entries
ALTER TABLE public.tpi_shift_entries 
  ADD COLUMN IF NOT EXISTS is_half_shift boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS actual_hours numeric(4,2) NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS ot_hours numeric(4,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ot_pay numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_holiday_ot boolean NOT NULL DEFAULT false;

-- 3. Update tpi_load_shift_day RPC to return is_holiday
CREATE OR REPLACE FUNCTION public.tpi_load_shift_day(p_factory uuid, p_date date) 
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object(
    'revision', coalesce((SELECT revision FROM tpi_shift_days WHERE factory_id=p_factory AND work_date=p_date), 0),
    'is_holiday', coalesce((SELECT is_holiday FROM tpi_shift_days WHERE factory_id=p_factory AND work_date=p_date), false),
    'entries', coalesce((
      SELECT jsonb_agg(to_jsonb(e)) 
      FROM tpi_shift_entries e 
      WHERE factory_id=p_factory AND work_date=p_date
    ), '[]'::jsonb)
  );
$$;

-- 4. DROP old 4-argument function to eliminate candidate function ambiguity in PostgREST
DROP FUNCTION IF EXISTS public.tpi_save_shift_day(uuid, date, integer, jsonb);

-- 5. Create the updated tpi_save_shift_day RPC with p_is_holiday
CREATE OR REPLACE FUNCTION public.tpi_save_shift_day(
  p_factory uuid, 
  p_date date, 
  p_revision integer, 
  p_entries jsonb,
  p_is_holiday boolean DEFAULT false
) 
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE 
  current_revision integer; 
  item record; 
  job tpi_job_codes%ROWTYPE; 
  tier text; 
  amount numeric;
  v_is_half boolean;
  v_hours numeric(4,2);
  v_ot_hours numeric(4,2);
  v_ot_pay numeric(12,2);
  v_is_holiday boolean;
  v_day_has_holiday boolean;
BEGIN
  IF NOT public.can_manage_factory(p_factory) THEN 
    RAISE EXCEPTION 'Not authorized for this factory'; 
  END IF;
  
  IF p_date IS NULL OR p_revision IS NULL OR p_entries IS NULL OR jsonb_typeof(p_entries)<>'array' THEN 
    RAISE EXCEPTION 'Invalid shift day'; 
  END IF;
  
  PERFORM pg_advisory_xact_lock(hashtextextended(p_factory::text||p_date::text,0));
  
  INSERT INTO tpi_shift_days(factory_id,work_date) VALUES(p_factory,p_date) ON CONFLICT DO NOTHING;
  
  SELECT revision INTO current_revision FROM tpi_shift_days WHERE factory_id=p_factory AND work_date=p_date FOR UPDATE;
  
  IF current_revision<>p_revision THEN 
    RAISE EXCEPTION 'ข้อมูลวันนี้ถูกแก้ไขแล้ว กรุณาโหลดใหม่ก่อนบันทึก'; 
  END IF;
  
  v_day_has_holiday := coalesce(p_is_holiday, false);

  IF EXISTS(
    SELECT 1 FROM jsonb_to_recordset(p_entries) AS r(employee_id uuid, shift_index integer, job_id uuid, is_half_shift boolean, actual_hours numeric, ot_hours numeric, ot_pay numeric, is_holiday_ot boolean)
    GROUP BY employee_id HAVING count(*)>2 OR count(*)<>count(DISTINCT shift_index)
  ) THEN 
    RAISE EXCEPTION 'พนักงานลงได้สูงสุด 2 กะต่อวัน และห้ามกะซ้ำ'; 
  END IF;
  
  FOR item IN SELECT * FROM jsonb_to_recordset(p_entries) AS r(employee_id uuid, shift_index integer, job_id uuid, is_half_shift boolean, actual_hours numeric, ot_hours numeric, ot_pay numeric, is_holiday_ot boolean) LOOP
    IF item.shift_index NOT BETWEEN 0 AND 2 OR item.shift_index IS NULL OR item.employee_id IS NULL OR item.job_id IS NULL THEN 
      RAISE EXCEPTION 'Invalid assignment'; 
    END IF;
    
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
    
    SELECT CASE WHEN rate_tier='skilled' AND skilled_from<=p_date THEN 'skilled' ELSE 'normal' END INTO tier
    FROM tpi_employee_wage_profiles WHERE employee_id=item.employee_id AND factory_id=p_factory FOR SHARE;
    
    tier := coalesce(tier,'normal');
    amount := CASE WHEN tier='skilled' THEN job.skilled_rate ELSE job.normal_rate END;
    
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

REVOKE ALL ON FUNCTION public.tpi_save_shift_day(uuid,date,integer,jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tpi_save_shift_day(uuid,date,integer,jsonb,boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.tpi_load_shift_day(uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tpi_load_shift_day(uuid,date) TO authenticated;

COMMIT;
