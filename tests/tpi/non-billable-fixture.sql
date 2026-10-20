-- Disposable local database only. Contains synthetic TPI and Diamond fixtures.
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
CREATE TABLE companies(id uuid PRIMARY KEY,name text NOT NULL);
CREATE TABLE factories(id uuid PRIMARY KEY,company_id uuid REFERENCES companies(id));
CREATE TABLE employees(id uuid PRIMARY KEY,factory_id uuid REFERENCES factories(id),status text);
CREATE TABLE profiles(id uuid PRIMARY KEY,role text,factory_id uuid);
CREATE FUNCTION can_access_factory(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND (role='superUser' OR factory_id=target)) $$;
CREATE FUNCTION can_manage_factory(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND (role='superUser' OR (role='admin' AND factory_id=target))) $$;
GRANT SELECT ON employees TO authenticated;
INSERT INTO auth.users VALUES('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003');
INSERT INTO companies VALUES('10000000-0000-0000-0000-000000000001','ทีพีไอ โพลีน'),('10000000-0000-0000-0000-000000000002','ผลิตภัณฑ์ตราเพชร');
INSERT INTO factories VALUES('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
INSERT INTO employees VALUES('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','active'),('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','active'),('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','active');
INSERT INTO profiles VALUES('00000000-0000-0000-0000-000000000001','admin','20000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002','admin','20000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003','normalUser','20000000-0000-0000-0000-000000000001');

ALTER TABLE factories ADD COLUMN name text;
UPDATE factories SET name=CASE WHEN id='20000000-0000-0000-0000-000000000001' THEN 'ทีพีไอ โพลีน' ELSE 'ตราเพชร' END;
ALTER TABLE companies ADD COLUMN short_name text;
ALTER TABLE employees ADD COLUMN job_title text;

\ir ../../migration_tpi_phase2.sql
ALTER TABLE tpi_job_codes ADD COLUMN job_group text DEFAULT 'general', ADD COLUMN billing_rate numeric, ADD COLUMN billing_normal_rate numeric, ADD COLUMN billing_skilled_rate numeric;
ALTER TABLE tpi_employee_wage_profiles ADD COLUMN job_id uuid, ADD COLUMN job_code text;
ALTER TABLE tpi_shift_days ADD COLUMN is_holiday boolean DEFAULT false;
ALTER TABLE tpi_shift_entries ADD COLUMN is_half_shift boolean DEFAULT false, ADD COLUMN actual_hours numeric DEFAULT 8, ADD COLUMN ot_hours numeric DEFAULT 0, ADD COLUMN ot_pay numeric DEFAULT 0, ADD COLUMN is_holiday_ot boolean DEFAULT false, ADD COLUMN is_ot_before_shift boolean DEFAULT false, ADD COLUMN ot_job_id uuid, ADD COLUMN ot_job_code_snapshot text, ADD COLUMN is_pending boolean DEFAULT false, ADD COLUMN full_rate_snapshot numeric;
CREATE TABLE tpi_attendance_logs(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,factory_id uuid,employee_id uuid,work_date date,type text,workflow_status text DEFAULT 'pending',deducted_hours integer,source text DEFAULT 'manual',reason text,updated_at timestamptz DEFAULT now(),UNIQUE(factory_id,employee_id,work_date,type));
CREATE OR REPLACE FUNCTION public.tpi_load_shift_day(p_factory uuid,p_date date) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('revision',coalesce((SELECT revision FROM tpi_shift_days WHERE factory_id=p_factory AND work_date=p_date),0),'is_holiday',coalesce((SELECT is_holiday FROM tpi_shift_days WHERE factory_id=p_factory AND work_date=p_date),false),'entries',coalesce((SELECT jsonb_agg(to_jsonb(e)) FROM tpi_shift_entries e WHERE factory_id=p_factory AND work_date=p_date),'[]'::jsonb)); $$;

CREATE TABLE payroll_periods(id uuid DEFAULT gen_random_uuid(),factory_id uuid,period_start date,period_end date,status text);
CREATE OR REPLACE FUNCTION public.tpi_capture_full_shift_rate() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE base numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM factories WHERE id=NEW.factory_id
    AND name ~* '(ทีพีไอ|tpi)' AND name !~* '(ตราเพชร|diamond|drt)') THEN RETURN NEW; END IF;
  IF coalesce(NEW.actual_hours,8)=8 AND NOT coalesce(NEW.is_half_shift,false) THEN
    NEW.full_rate_snapshot := NEW.rate_snapshot;
  ELSIF TG_OP='UPDATE' AND NEW.job_id=OLD.job_id AND NEW.rate_tier=OLD.rate_tier
    AND NEW.rate_snapshot=OLD.rate_snapshot AND NEW.actual_hours=OLD.actual_hours THEN
    NEW.full_rate_snapshot := OLD.full_rate_snapshot;
  ELSIF NEW.is_half_shift THEN
    NEW.full_rate_snapshot := NEW.rate_snapshot * 2;
  ELSE
    SELECT CASE WHEN NEW.rate_tier='skilled' THEN coalesce(skilled_rate,normal_rate) ELSE normal_rate END
    INTO base FROM tpi_job_codes WHERE id=NEW.job_id AND factory_id=NEW.factory_id;
    NEW.full_rate_snapshot := base;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tpi_capture_full_rate ON public.tpi_shift_entries;
CREATE TRIGGER tpi_capture_full_rate BEFORE INSERT OR UPDATE ON public.tpi_shift_entries
FOR EACH ROW EXECUTE FUNCTION public.tpi_capture_full_shift_rate();


\ir ../../supabase/migrations/20261020054636_tpi_non_billable_work.sql
\ir non-billable-database.sql
