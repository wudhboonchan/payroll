\set ON_ERROR_STOP on
BEGIN;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
INSERT INTO tpi_job_codes(id,factory_id,code,quota,planned_morning,planned_afternoon,planned_night,skilled_rate,expires_on) VALUES
('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','JOB1',4,2,2,0,450,'2026-09-30'),
('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','JOB2',1,1,0,0,NULL,'2026-09-30');
INSERT INTO tpi_employee_wage_profiles(employee_id,factory_id,rate_tier,skilled_from) VALUES('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','skilled','2026-09-05');
DO $$ DECLARE f uuid='20000000-0000-0000-0000-000000000001'; e uuid='30000000-0000-0000-0000-000000000001'; j uuid='40000000-0000-0000-0000-000000000001'; rows jsonb; rev integer; amount numeric; BEGIN
 rows=jsonb_build_array(jsonb_build_object('employee_id',e,'job_id',j,'shift_index',0),jsonb_build_object('employee_id',e,'job_id',j,'shift_index',1));
 rev=tpi_save_shift_day(f,'2026-09-05',0,rows);
 SELECT sum(rate_snapshot) INTO amount FROM tpi_shift_entries WHERE work_date='2026-09-05';
 IF amount<>714 OR rev<>1 THEN RAISE EXCEPTION 'FAIL 357 + 357'; END IF;
 UPDATE tpi_job_codes SET normal_rate=400 WHERE id=j;
 PERFORM tpi_save_shift_day(f,'2026-09-05',1,rows);
 SELECT sum(rate_snapshot) INTO amount FROM tpi_shift_entries WHERE work_date='2026-09-05';
 IF amount<>714 THEN RAISE EXCEPTION 'FAIL immutable snapshot'; END IF;
 BEGIN PERFORM tpi_save_shift_day(f,'2026-09-05',1,rows); RAISE EXCEPTION 'FAIL stale write accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
 BEGIN PERFORM tpi_save_shift_day(f,'2026-09-05',2,rows||jsonb_build_array(jsonb_build_object('employee_id',e,'job_id','40000000-0000-0000-0000-000000000002','shift_index',2))); RAISE EXCEPTION 'FAIL third shift accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
 BEGIN PERFORM tpi_save_shift_day(f,'2026-09-06',0,jsonb_build_array(rows->0,rows->0)); RAISE EXCEPTION 'FAIL duplicate shift'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
 BEGIN PERFORM tpi_save_shift_day(f,'2026-10-01',0,rows); RAISE EXCEPTION 'FAIL expired job accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
 PERFORM tpi_save_shift_day(f,'2026-09-30',0,rows); -- inclusive expiry
 BEGIN PERFORM tpi_save_shift_day(f,'2026-09-06',0,jsonb_build_array(jsonb_build_object('employee_id','30000000-0000-0000-0000-000000000003','job_id',j,'shift_index',0))); RAISE EXCEPTION 'FAIL foreign employee'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
 BEGIN INSERT INTO tpi_employee_wage_profiles(employee_id,factory_id) VALUES('30000000-0000-0000-0000-000000000003',f); RAISE EXCEPTION 'FAIL foreign wage profile'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
 PERFORM tpi_save_shift_day(f,'2026-09-04',0,jsonb_build_array(jsonb_build_object('employee_id','30000000-0000-0000-0000-000000000002','job_id',j,'shift_index',0)));
 IF (SELECT rate_tier FROM tpi_shift_entries WHERE work_date='2026-09-04')<>'normal' THEN RAISE EXCEPTION 'FAIL promotion effective date'; END IF;
 PERFORM tpi_save_shift_day(f,'2026-09-06',0,jsonb_build_array(jsonb_build_object('employee_id','30000000-0000-0000-0000-000000000002','job_id',j,'shift_index',0)));
 IF (SELECT rate_snapshot FROM tpi_shift_entries WHERE work_date='2026-09-06')<>450 THEN RAISE EXCEPTION 'FAIL skilled rate'; END IF;
 BEGIN PERFORM tpi_save_shift_day(f,'2026-09-07',0,jsonb_build_array(jsonb_build_object('employee_id',e,'job_id',j,'shift_index',0),jsonb_build_object('employee_id','30000000-0000-0000-0000-000000000002','job_id','40000000-0000-0000-0000-000000000002','shift_index',1))); RAISE EXCEPTION 'FAIL missing skilled rate accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM tpi_shift_entries WHERE work_date='2026-09-07') THEN RAISE EXCEPTION 'FAIL rollback'; END IF;
 PERFORM tpi_save_shift_day(f,'2026-09-05',2,'[]');
 IF EXISTS(SELECT 1 FROM tpi_shift_entries WHERE work_date='2026-09-05') THEN RAISE EXCEPTION 'FAIL delete'; END IF;
 BEGIN INSERT INTO tpi_shift_entries(factory_id,work_date,employee_id,job_id,shift_index,rate_tier,rate_snapshot,job_code_snapshot) VALUES(f,'2026-09-05',e,j,0,'normal',1,'JOB1'); RAISE EXCEPTION 'FAIL direct write allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS rates, snapshots, effective date, expiry, max two, duplicate, tenant employee, atomic rollback, revisions, delete, direct write protection';
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM tpi_job_codes) OR EXISTS(SELECT 1 FROM tpi_shift_entries) THEN RAISE EXCEPTION 'FAIL cross-tenant read'; END IF;
 BEGIN PERFORM tpi_save_shift_day('20000000-0000-0000-0000-000000000001','2026-09-05',0,'[]'); RAISE EXCEPTION 'FAIL foreign tenant save'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
 BEGIN INSERT INTO tpi_job_codes(factory_id,code,quota) VALUES('20000000-0000-0000-0000-000000000002','DIAMOND',1); RAISE EXCEPTION 'FAIL Diamond job accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
 RAISE NOTICE 'PASS tenant isolation and Diamond rejection';
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM tpi_job_codes) THEN RAISE EXCEPTION 'FAIL reader cannot read'; END IF;
 BEGIN PERFORM tpi_save_shift_day('20000000-0000-0000-0000-000000000001','2026-09-05',3,'[]'); RAISE EXCEPTION 'FAIL read-only save accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
 RAISE NOTICE 'PASS read-only role';
END $$;
RESET ROLE;

ROLLBACK;
