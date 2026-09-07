-- TPI only. Requires migration_phase3_three_roles.sql.
-- No changes to Diamond employee, shift, payroll tables or calculations.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.is_tpi_factory(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS(
    SELECT 1 FROM factories f 
    LEFT JOIN companies c ON c.id = f.company_id
    WHERE f.id = target AND (
      f.name ILIKE '%ทีพีไอ%' OR f.name ILIKE '%tpi%' OR
      c.name ILIKE '%ทีพีไอ%' OR c.name ILIKE '%tpi%' OR
      c.short_name ILIKE '%tpi%'
    )
  );
$$;

CREATE TABLE public.tpi_job_codes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 factory_id uuid NOT NULL REFERENCES public.factories(id),
 code text NOT NULL CHECK (length(trim(code)) > 0),
 department text NOT NULL DEFAULT '', description text NOT NULL DEFAULT '',
 job_type text NOT NULL DEFAULT 'regular' CHECK (job_type IN ('regular','temporary')),
 valid_from date, expires_on date,
 quota integer NOT NULL CHECK (quota >= 0),
 planned_morning integer CHECK (planned_morning >= 0),
 planned_afternoon integer CHECK (planned_afternoon >= 0),
 planned_night integer CHECK (planned_night >= 0),
 normal_rate numeric(12,2) NOT NULL DEFAULT 357 CHECK (normal_rate >= 0),
 skilled_rate numeric(12,2) CHECK (skilled_rate >= 0),
 active boolean NOT NULL DEFAULT true,
 notes text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(factory_id,code), UNIQUE(id,factory_id),
 CHECK (valid_from IS NULL OR expires_on IS NULL OR expires_on >= valid_from),
 CHECK (job_type <> 'temporary' OR expires_on IS NOT NULL),
 CHECK (planned_morning IS NULL OR planned_afternoon IS NULL OR planned_night IS NULL
 OR planned_morning+planned_afternoon+planned_night = quota)
);
CREATE TABLE public.tpi_employee_wage_profiles (
 employee_id uuid PRIMARY KEY REFERENCES public.employees(id),
 factory_id uuid NOT NULL REFERENCES public.factories(id),
 rate_tier text NOT NULL DEFAULT 'normal' CHECK (rate_tier IN ('normal','skilled')),
 skilled_from date,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((rate_tier='normal' AND skilled_from IS NULL) OR (rate_tier='skilled' AND skilled_from IS NOT NULL))
);
CREATE TABLE public.tpi_shift_days (
 factory_id uuid NOT NULL REFERENCES public.factories(id), work_date date NOT NULL,
 revision integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES auth.users(id),
 PRIMARY KEY(factory_id,work_date)
);
CREATE TABLE public.tpi_shift_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), factory_id uuid NOT NULL,
 work_date date NOT NULL, employee_id uuid NOT NULL REFERENCES public.employees(id),
 shift_index integer NOT NULL CHECK (shift_index BETWEEN 0 AND 2),
 job_id uuid NOT NULL,
 rate_tier text NOT NULL CHECK(rate_tier IN ('normal','skilled')),
 rate_snapshot numeric(12,2) NOT NULL CHECK(rate_snapshot >= 0),
 job_code_snapshot text NOT NULL,
 FOREIGN KEY(factory_id,work_date) REFERENCES public.tpi_shift_days(factory_id,work_date),
 FOREIGN KEY(job_id,factory_id) REFERENCES public.tpi_job_codes(id,factory_id),
 UNIQUE(factory_id,work_date,employee_id,shift_index)
);
CREATE INDEX ON public.tpi_shift_entries(factory_id,work_date,job_id);
CREATE INDEX ON public.tpi_employee_wage_profiles(factory_id);

CREATE OR REPLACE FUNCTION public.tpi_validate_master() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'tpi_employee_wage_profiles' THEN
    IF NOT EXISTS (
      SELECT 1 FROM employees WHERE id = NEW.employee_id AND factory_id = NEW.factory_id
    ) THEN 
      RAISE EXCEPTION 'Employee belongs to another factory'; 
    END IF;
  END IF;
  NEW.updated_at = clock_timestamp(); 
  RETURN NEW;
END; 
$$;

DROP TRIGGER IF EXISTS tpi_job_validate ON public.tpi_job_codes;
CREATE TRIGGER tpi_job_validate BEFORE INSERT OR UPDATE ON public.tpi_job_codes
  FOR EACH ROW EXECUTE FUNCTION public.tpi_validate_master();

DROP TRIGGER IF EXISTS tpi_wage_validate ON public.tpi_employee_wage_profiles;
CREATE TRIGGER tpi_wage_validate BEFORE INSERT OR UPDATE ON public.tpi_employee_wage_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tpi_validate_master();

ALTER TABLE public.tpi_job_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tpi_employee_wage_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tpi_shift_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tpi_shift_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tpi_jobs_read ON public.tpi_job_codes;
CREATE POLICY tpi_jobs_read ON public.tpi_job_codes FOR SELECT TO authenticated USING(public.can_access_factory(factory_id));

DROP POLICY IF EXISTS tpi_jobs_insert ON public.tpi_job_codes;
CREATE POLICY tpi_jobs_insert ON public.tpi_job_codes FOR INSERT TO authenticated WITH CHECK(public.can_manage_factory(factory_id));

DROP POLICY IF EXISTS tpi_jobs_update ON public.tpi_job_codes;
CREATE POLICY tpi_jobs_update ON public.tpi_job_codes FOR UPDATE TO authenticated USING(public.can_manage_factory(factory_id)) WITH CHECK(public.can_manage_factory(factory_id));

DROP POLICY IF EXISTS tpi_wages_read ON public.tpi_employee_wage_profiles;
CREATE POLICY tpi_wages_read ON public.tpi_employee_wage_profiles FOR SELECT TO authenticated USING(public.can_access_factory(factory_id));

DROP POLICY IF EXISTS tpi_wages_insert ON public.tpi_employee_wage_profiles;
CREATE POLICY tpi_wages_insert ON public.tpi_employee_wage_profiles FOR INSERT TO authenticated WITH CHECK(public.can_manage_factory(factory_id));

DROP POLICY IF EXISTS tpi_wages_update ON public.tpi_employee_wage_profiles;
CREATE POLICY tpi_wages_update ON public.tpi_employee_wage_profiles FOR UPDATE TO authenticated USING(public.can_manage_factory(factory_id)) WITH CHECK(public.can_manage_factory(factory_id));
CREATE POLICY tpi_days_read ON public.tpi_shift_days FOR SELECT TO authenticated USING(public.can_access_factory(factory_id));
CREATE POLICY tpi_entries_read ON public.tpi_shift_entries FOR SELECT TO authenticated USING(public.can_access_factory(factory_id));
REVOKE ALL ON public.tpi_job_codes,public.tpi_employee_wage_profiles,public.tpi_shift_days,public.tpi_shift_entries FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.tpi_job_codes,public.tpi_employee_wage_profiles TO authenticated;
GRANT SELECT ON public.tpi_shift_days,public.tpi_shift_entries TO authenticated;

-- Read revision and rows in one statement so a concurrent save cannot create a torn read.
CREATE FUNCTION public.tpi_load_shift_day(p_factory uuid,p_date date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('revision',coalesce((SELECT revision FROM tpi_shift_days WHERE factory_id=p_factory AND work_date=p_date),0),
 'entries',coalesce((SELECT jsonb_agg(to_jsonb(e)) FROM tpi_shift_entries e WHERE factory_id=p_factory AND work_date=p_date),'[]'::jsonb));
$$;

-- Only this RPC may write assignments. Atomic replacement, scoped lock and optimistic revision.
CREATE OR REPLACE FUNCTION public.tpi_save_shift_day(p_factory uuid,p_date date,p_revision integer,p_entries jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE current_revision integer; item record; job tpi_job_codes%ROWTYPE; tier text; amount numeric;
BEGIN
 IF NOT public.can_manage_factory(p_factory) THEN RAISE EXCEPTION 'Not authorized for this factory'; END IF;
 IF p_date IS NULL OR p_revision IS NULL OR p_entries IS NULL OR jsonb_typeof(p_entries)<>'array' THEN RAISE EXCEPTION 'Invalid shift day'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_factory::text||p_date::text,0));
 INSERT INTO tpi_shift_days(factory_id,work_date) VALUES(p_factory,p_date) ON CONFLICT DO NOTHING;
 SELECT revision INTO current_revision FROM tpi_shift_days WHERE factory_id=p_factory AND work_date=p_date FOR UPDATE;
 IF current_revision<>p_revision THEN RAISE EXCEPTION 'ข้อมูลวันนี้ถูกแก้ไขแล้ว กรุณาโหลดใหม่ก่อนบันทึก'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_entries) AS r(employee_id uuid,shift_index integer,job_id uuid)
 GROUP BY employee_id HAVING count(*)>2 OR count(*)<>count(DISTINCT shift_index)) THEN RAISE EXCEPTION 'พนักงานลงได้สูงสุด 2 กะต่อวัน และห้ามกะซ้ำ'; END IF;
 FOR item IN SELECT * FROM jsonb_to_recordset(p_entries) AS r(employee_id uuid,shift_index integer,job_id uuid) LOOP
  IF item.shift_index NOT BETWEEN 0 AND 2 OR item.shift_index IS NULL OR item.employee_id IS NULL OR item.job_id IS NULL THEN RAISE EXCEPTION 'Invalid assignment'; END IF;
  IF NOT EXISTS(SELECT 1 FROM employees WHERE id=item.employee_id AND factory_id=p_factory AND status='active') THEN RAISE EXCEPTION 'Employee inactive or belongs to another factory'; END IF;
  SELECT * INTO job FROM tpi_job_codes WHERE id=item.job_id AND factory_id=p_factory FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid job'; END IF;
  -- Unchanged assignments retain their original rate and job-code snapshots, including expired historical jobs.
  IF EXISTS(SELECT 1 FROM tpi_shift_entries WHERE factory_id=p_factory AND work_date=p_date AND employee_id=item.employee_id AND shift_index=item.shift_index AND job_id=item.job_id) THEN CONTINUE; END IF;
  IF NOT job.active OR (job.valid_from IS NOT NULL AND p_date<job.valid_from) OR (job.expires_on IS NOT NULL AND p_date>job.expires_on) THEN RAISE EXCEPTION 'รหัสงานหมดอายุ หรือยังไม่เริ่มใช้งาน'; END IF;
  SELECT CASE WHEN rate_tier='skilled' AND skilled_from<=p_date THEN 'skilled' ELSE 'normal' END INTO tier
   FROM tpi_employee_wage_profiles WHERE employee_id=item.employee_id AND factory_id=p_factory FOR SHARE;
  tier=coalesce(tier,'normal');
  amount=CASE WHEN tier='skilled' THEN job.skilled_rate ELSE job.normal_rate END;
  IF amount IS NULL THEN RAISE EXCEPTION 'กรุณากำหนดค่าแรงฝีมือของรหัสงานก่อนบันทึก'; END IF;
  INSERT INTO tpi_shift_entries(factory_id,work_date,employee_id,shift_index,job_id,rate_tier,rate_snapshot,job_code_snapshot)
  VALUES(p_factory,p_date,item.employee_id,item.shift_index,item.job_id,tier,amount,job.code)
  ON CONFLICT(factory_id,work_date,employee_id,shift_index) DO UPDATE SET job_id=excluded.job_id,rate_tier=excluded.rate_tier,rate_snapshot=excluded.rate_snapshot,job_code_snapshot=excluded.job_code_snapshot;
 END LOOP;
 DELETE FROM tpi_shift_entries e WHERE factory_id=p_factory AND work_date=p_date AND NOT EXISTS(
 SELECT 1 FROM jsonb_to_recordset(p_entries) AS r(employee_id uuid,shift_index integer,job_id uuid) WHERE r.employee_id=e.employee_id AND r.shift_index=e.shift_index);
 UPDATE tpi_shift_days SET revision=revision+1,updated_at=clock_timestamp(),updated_by=auth.uid() WHERE factory_id=p_factory AND work_date=p_date;
 RETURN current_revision+1;
END; $$;
REVOKE ALL ON FUNCTION public.tpi_save_shift_day(uuid,date,integer,jsonb), public.tpi_load_shift_day(uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tpi_save_shift_day(uuid,date,integer,jsonb), public.tpi_load_shift_day(uuid,date) TO authenticated;
COMMIT;
