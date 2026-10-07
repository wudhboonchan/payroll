\set ON_ERROR_STOP on
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-0000-0000-000000000001'::uuid $$;
CREATE FUNCTION public.can_manage_factory(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.allowed',true),'true') <> 'false' $$;
CREATE TABLE factories(id uuid PRIMARY KEY,name text);
CREATE TABLE tpi_job_codes(id uuid PRIMARY KEY,factory_id uuid,normal_rate numeric,skilled_rate numeric);
CREATE TABLE tpi_shift_days(factory_id uuid,work_date date,revision integer,updated_at timestamptz,updated_by uuid,PRIMARY KEY(factory_id,work_date));
CREATE TABLE tpi_shift_entries(id integer PRIMARY KEY,factory_id uuid,employee_id uuid,work_date date,job_id uuid,shift_index integer,rate_tier text,rate_snapshot numeric,is_half_shift boolean,actual_hours numeric,ot_hours numeric,ot_pay numeric);
CREATE TABLE tpi_attendance_logs(id uuid PRIMARY KEY,factory_id uuid,employee_id uuid,work_date date,source text,workflow_status text,reason text);
INSERT INTO factories VALUES('20000000-0000-0000-0000-000000000001','ทีพีไอ โพลีน'),('20000000-0000-0000-0000-000000000002','ตราเพชร');
INSERT INTO tpi_job_codes VALUES('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',357,377);
\ir ../../migration_tpi_attendance_delete_consistency.sql
INSERT INTO tpi_shift_days VALUES('20000000-0000-0000-0000-000000000001','2026-09-16',1,null,null);
INSERT INTO tpi_shift_entries VALUES(1,'20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','2026-09-16','40000000-0000-0000-0000-000000000001',0,'normal',222,false,5,1,67,null);
INSERT INTO tpi_attendance_logs VALUES('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','2026-09-16','shift','pending',null);
-- Rate changes after the shift was saved must not change the restored wage.
UPDATE tpi_job_codes SET normal_rate=400;
SELECT public.tpi_delete_attendance_log('50000000-0000-0000-0000-000000000001');
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM tpi_shift_entries WHERE id=1 AND actual_hours=8 AND rate_snapshot=357 AND NOT is_half_shift AND ot_hours=1 AND ot_pay=67) THEN RAISE EXCEPTION 'FAIL pending delete did not restore saved full wage/retain OT'; END IF;
 IF (SELECT revision FROM tpi_shift_days)<>2 THEN RAISE EXCEPTION 'FAIL revision not incremented'; END IF;
 IF EXISTS(SELECT 1 FROM tpi_attendance_logs) THEN RAISE EXCEPTION 'FAIL pending record remains'; END IF;
END $$;
-- Completed history follows the same cancellation rules.
UPDATE tpi_shift_entries SET actual_hours=4,rate_snapshot=200,is_half_shift=true WHERE id=1;
INSERT INTO tpi_attendance_logs VALUES('50000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','2026-09-16','shift','completed','reason');
DELETE FROM tpi_attendance_logs WHERE id='50000000-0000-0000-0000-000000000002';
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM tpi_shift_entries WHERE actual_hours=8 AND rate_snapshot=400 AND NOT is_half_shift) THEN RAISE EXCEPTION 'FAIL completed/legacy half restoration'; END IF; END $$;
-- Manual history must not change shifts.
INSERT INTO tpi_attendance_logs VALUES('50000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','2026-09-16','manual','completed','reason');
DELETE FROM tpi_attendance_logs WHERE id='50000000-0000-0000-0000-000000000003';
DO $$ BEGIN IF (SELECT revision FROM tpi_shift_days)<>3 THEN RAISE EXCEPTION 'FAIL manual history modified shifts'; END IF; END $$;
-- A failed authorization must roll back deletion and leave wage untouched.
UPDATE tpi_shift_entries SET actual_hours=7,rate_snapshot=350 WHERE id=1;
INSERT INTO tpi_attendance_logs VALUES('50000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','2026-09-16','shift','pending',null);
SET test.allowed='false';
DO $$ BEGIN
 BEGIN DELETE FROM tpi_attendance_logs WHERE id='50000000-0000-0000-0000-000000000004'; RAISE EXCEPTION 'FAIL unauthorized delete accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Not authorized' THEN RAISE; END IF; END;
 IF NOT EXISTS(SELECT 1 FROM tpi_attendance_logs WHERE id='50000000-0000-0000-0000-000000000004') OR NOT EXISTS(SELECT 1 FROM tpi_shift_entries WHERE actual_hours=7 AND rate_snapshot=350) THEN RAISE EXCEPTION 'FAIL rollback'; END IF;
END $$;
SET test.allowed='true';
SELECT 'attendance deletion consistency passed' AS result;
