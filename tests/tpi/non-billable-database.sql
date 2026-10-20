-- Run against the isolated TPI fixture, never production. Rolls back all test data.
BEGIN;
CREATE FUNCTION pg_temp.expect_error(command text, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE caught boolean:=false;
BEGIN
 BEGIN EXECUTE command;
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%' || expected || '%' THEN RAISE EXCEPTION 'Unexpected error: %',SQLERRM; END IF;
  caught:=true;
 END;
 IF NOT caught THEN RAISE EXCEPTION 'Expected failure: %',expected; END IF;
END; $$;
INSERT INTO tpi_job_codes(id,factory_id,code,description,job_type,quota,normal_rate,cost_owner,non_billable_reason)
VALUES('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','NB-FOREMAN','โฟร์แมน','non_billable',1,357,'หจก.วิราญกร','หจก.รับต้นทุนเอง'),
('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','690001','งานปกติ','regular',1,357,'',''),
('40000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','DRT-UNCHANGED','งานตราเพชรเดิม','regular',1,650,'','');
CREATE TEMP TABLE diamond_before AS SELECT code,description,job_type,normal_rate,billing_rate,active FROM tpi_job_codes WHERE factory_id='20000000-0000-0000-0000-000000000002';
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT tpi_save_shift_day('20000000-0000-0000-0000-000000000001','2026-10-01',0,'[{"employee_id":"30000000-0000-0000-0000-000000000001","shift_index":0,"job_id":"40000000-0000-0000-0000-000000000001"}]',false);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM tpi_shift_entries WHERE non_billable AND rate_snapshot=357 AND full_rate_snapshot=357 AND non_billable_base_rate=357 AND position_snapshot='โฟร์แมน') THEN RAISE EXCEPTION '357 snapshot failed'; END IF;
 IF (SELECT count(*) FROM tpi_non_billable_audit)<>1 THEN RAISE EXCEPTION 'Missing initial notification'; END IF;
END $$;
-- Saving unchanged data must not send duplicate notifications.
SELECT tpi_save_shift_day('20000000-0000-0000-0000-000000000001','2026-10-01',1,(tpi_load_shift_day('20000000-0000-0000-0000-000000000001','2026-10-01')->'entries'),false);
DO $$ BEGIN IF (SELECT count(*) FROM tpi_non_billable_audit)<>1 THEN RAISE EXCEPTION 'Duplicate notification'; END IF; END $$;
-- Master changes do not rewrite a saved wage or position.
UPDATE tpi_job_codes SET normal_rate=400,skilled_rate=450,description='โฟร์แมนใหม่' WHERE code='NB-FOREMAN';
INSERT INTO tpi_employee_wage_profiles(employee_id,factory_id,rate_tier,skilled_from,job_id) VALUES('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','skilled','2026-01-01','40000000-0000-0000-0000-000000000001');
SELECT tpi_save_shift_day('20000000-0000-0000-0000-000000000001','2026-10-01',2,(tpi_load_shift_day('20000000-0000-0000-0000-000000000001','2026-10-01')->'entries'),false);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM tpi_shift_entries WHERE rate_snapshot=357 AND rate_tier='normal' AND position_snapshot='โฟร์แมน' AND non_billable_base_rate=357) THEN RAISE EXCEPTION 'Historical snapshot changed'; END IF; END $$;
-- Override is local to the entry and retains the original rate.
SELECT tpi_save_shift_day('20000000-0000-0000-0000-000000000001','2026-10-01',3,'[{"employee_id":"30000000-0000-0000-0000-000000000001","shift_index":0,"job_id":"40000000-0000-0000-0000-000000000001","non_billable_rate":380,"non_billable_reason":"ปรับตามอนุมัติ"}]',false);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM tpi_shift_entries WHERE rate_snapshot=380 AND full_rate_snapshot=380 AND non_billable_base_rate=357) THEN RAISE EXCEPTION 'Override snapshot failed'; END IF;
 IF (SELECT normal_rate FROM tpi_job_codes WHERE code='NB-FOREMAN')<>400 THEN RAISE EXCEPTION 'Override changed master'; END IF;
END $$;
-- Hourly deduction uses the override base once.
SELECT tpi_save_shift_day('20000000-0000-0000-0000-000000000001','2026-10-01',4,'[{"employee_id":"30000000-0000-0000-0000-000000000001","shift_index":0,"job_id":"40000000-0000-0000-0000-000000000001","non_billable_rate":380,"non_billable_reason":"ปรับตามอนุมัติ","actual_hours":7}]',false);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM tpi_shift_entries WHERE rate_snapshot=332 AND full_rate_snapshot=380) THEN RAISE EXCEPTION 'Hourly override failed'; END IF; END $$;
-- Reject cross-factory codes, classification changes, and mixed-billing OT.
SELECT pg_temp.expect_error($q$UPDATE tpi_job_codes SET job_type='regular' WHERE code='NB-FOREMAN'$q$,'ประวัติ');
SELECT pg_temp.expect_error($q$UPDATE tpi_job_codes SET reference_job_id='40000000-0000-0000-0000-000000000003' WHERE code='NB-FOREMAN'$q$,'โรงงานเดียวกัน');
SELECT pg_temp.expect_error($q$SELECT tpi_save_shift_day('20000000-0000-0000-0000-000000000001','2026-10-02',0,'[{"employee_id":"30000000-0000-0000-0000-000000000001","shift_index":0,"job_id":"40000000-0000-0000-0000-000000000001","ot_hours":1,"ot_job_id":"40000000-0000-0000-0000-000000000002"}]',false)$q$,'สถานะตั้งเบิก');
SELECT pg_temp.expect_error($q$INSERT INTO tpi_job_codes(factory_id,code,description,job_type,quota,normal_rate,cost_owner,non_billable_reason) VALUES('20000000-0000-0000-0000-000000000002','FORBIDDEN','โฟร์แมน','non_billable',1,357,'หจก.','ไม่ตั้งเบิก')$q$,'เฉพาะ TPI');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.expect_error($q$SELECT tpi_save_shift_day('20000000-0000-0000-0000-000000000002','2026-10-02',0,'[]',false)$q$,'TPI only');
SELECT pg_temp.expect_error($q$SELECT tpi_save_shift_day('20000000-0000-0000-0000-000000000001','2026-10-02',0,'[]',false)$q$,'Access denied');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
UPDATE tpi_job_codes SET morning_only=true WHERE code='NB-FOREMAN';
SELECT pg_temp.expect_error($q$SELECT tpi_save_shift_day('20000000-0000-0000-0000-000000000001','2026-10-02',0,'[{"employee_id":"30000000-0000-0000-0000-000000000001","shift_index":1,"job_id":"40000000-0000-0000-0000-000000000001"}]',false)$q$,'กะเช้า');
SELECT pg_temp.expect_error($q$SELECT tpi_save_shift_day('20000000-0000-0000-0000-000000000001','2026-10-02',0,'[{"employee_id":"30000000-0000-0000-0000-000000000001","shift_index":0,"job_id":"40000000-0000-0000-0000-000000000001"},{"employee_id":"30000000-0000-0000-0000-000000000001","shift_index":1,"job_id":"40000000-0000-0000-0000-000000000002"}]',false)$q$,'กะเช้า');
SELECT tpi_preassign_shifts('20000000-0000-0000-0000-000000000001',ARRAY['2026-10-03'::date],'[{"employee_id":"30000000-0000-0000-0000-000000000001","shift_index":0,"job_id":"40000000-0000-0000-0000-000000000001","non_billable_rate":375,"non_billable_reason":"จัดล่วงหน้า"}]');
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM tpi_shift_entries WHERE work_date='2026-10-03' AND non_billable AND is_pending AND rate_snapshot=375) THEN RAISE EXCEPTION 'Preassign metadata lost'; END IF; END $$;
INSERT INTO payroll_periods(factory_id,period_start,period_end,status) VALUES('20000000-0000-0000-0000-000000000001','2026-10-04','2026-10-04','approved');
SELECT pg_temp.expect_error($q$SELECT tpi_save_shift_day('20000000-0000-0000-0000-000000000001','2026-10-04',0,'[{"employee_id":"30000000-0000-0000-0000-000000000001","shift_index":0,"job_id":"40000000-0000-0000-0000-000000000001"}]',false)$q$,'งวดอนุมัติแล้ว');
-- Deletions preserve their audit trail; no work records are written for Diamond.
SELECT tpi_save_shift_day('20000000-0000-0000-0000-000000000001','2026-10-01',5,'[]',false);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM tpi_non_billable_audit WHERE action='DELETE' AND before_data->>'position_snapshot'='โฟร์แมน') THEN RAISE EXCEPTION 'Missing deletion audit'; END IF;
 IF EXISTS((SELECT * FROM diamond_before) EXCEPT (SELECT code,description,job_type,normal_rate,billing_rate,active FROM tpi_job_codes WHERE factory_id='20000000-0000-0000-0000-000000000002')) THEN RAISE EXCEPTION 'Diamond data changed'; END IF;
 IF EXISTS(SELECT 1 FROM tpi_shift_entries WHERE factory_id='20000000-0000-0000-0000-000000000002') THEN RAISE EXCEPTION 'Diamond shifts changed'; END IF;
END $$;
GRANT SELECT ON profiles TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM tpi_non_billable_audit) THEN RAISE EXCEPTION 'Admin can read SuperUser audit'; END IF; END $$;
RESET ROLE;
INSERT INTO auth.users VALUES('00000000-0000-0000-0000-000000000004');
INSERT INTO profiles VALUES('00000000-0000-0000-0000-000000000004','superUser',NULL);
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM tpi_non_billable_audit) THEN RAISE EXCEPTION 'SuperUser cannot see notification'; END IF; END $$;
RESET ROLE;
ROLLBACK;
