-- Deleting shift-generated attendance cancels the linked hourly wage deductions atomically.
BEGIN;
ALTER TABLE public.tpi_shift_entries ADD COLUMN IF NOT EXISTS full_rate_snapshot numeric(12,2);

-- Older hourly entries did not retain the full rate. Seed using their saved tier and job rate.
-- Legacy half-shift snapshots can be recovered exactly without consulting current rates.
UPDATE public.tpi_shift_entries e
SET full_rate_snapshot = CASE
  WHEN e.is_half_shift THEN e.rate_snapshot * 2
  WHEN coalesce(e.actual_hours,8)=8 THEN e.rate_snapshot
  ELSE CASE WHEN e.rate_tier='skilled' THEN coalesce(j.skilled_rate,j.normal_rate) ELSE j.normal_rate END END
FROM public.tpi_job_codes j, public.factories f
WHERE j.id=e.job_id AND f.id=e.factory_id
  AND f.name ~* '(ทีพีไอ|tpi)' AND f.name !~* '(ตราเพชร|diamond|drt)'
  AND e.full_rate_snapshot IS NULL;

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

CREATE OR REPLACE FUNCTION public.tpi_cancel_attendance_deduction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE restored integer;
BEGIN
  IF OLD.source <> 'shift' THEN RETURN OLD; END IF;
  IF NOT EXISTS (SELECT 1 FROM factories WHERE id=OLD.factory_id
    AND name ~* '(ทีพีไอ|tpi)' AND name !~* '(ตราเพชร|diamond|drt)') THEN RETURN OLD; END IF;
  IF NOT public.can_manage_factory(OLD.factory_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  -- Serialize with tpi_save_shift_day, preventing an old editor from reintroducing deductions.
  PERFORM 1 FROM tpi_shift_days WHERE factory_id=OLD.factory_id AND work_date=OLD.work_date FOR UPDATE;
  IF EXISTS (SELECT 1 FROM tpi_attendance_logs WHERE factory_id=OLD.factory_id
    AND employee_id=OLD.employee_id AND work_date=OLD.work_date AND source='shift' AND id<>OLD.id) THEN
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM tpi_shift_entries WHERE factory_id=OLD.factory_id
    AND employee_id=OLD.employee_id AND work_date=OLD.work_date AND actual_hours<8 AND full_rate_snapshot IS NULL) THEN
    RAISE EXCEPTION 'ไม่พบค่าแรงเต็มกะ จึงยังลบรายการไม่ได้';
  END IF;
  UPDATE tpi_shift_entries SET actual_hours=8, is_half_shift=false, rate_snapshot=full_rate_snapshot
  WHERE factory_id=OLD.factory_id AND employee_id=OLD.employee_id AND work_date=OLD.work_date
    AND actual_hours<8;
  GET DIAGNOSTICS restored = ROW_COUNT;
  IF restored>0 THEN
    UPDATE tpi_shift_days SET revision=revision+1, updated_at=clock_timestamp(), updated_by=auth.uid()
    WHERE factory_id=OLD.factory_id AND work_date=OLD.work_date;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.tpi_cancel_attendance_deduction() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tpi_cancel_deduction_on_delete ON public.tpi_attendance_logs;
CREATE TRIGGER tpi_cancel_deduction_on_delete BEFORE DELETE ON public.tpi_attendance_logs
FOR EACH ROW EXECUTE FUNCTION public.tpi_cancel_attendance_deduction();
CREATE OR REPLACE FUNCTION public.tpi_delete_attendance_log(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target record;
BEGIN
  SELECT factory_id, work_date INTO target FROM tpi_attendance_logs WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบรายการขาดลามาสาย กรุณารีเฟรช'; END IF;
  IF NOT public.can_manage_factory(target.factory_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  PERFORM 1 FROM tpi_shift_days WHERE factory_id=target.factory_id AND work_date=target.work_date FOR UPDATE;
  DELETE FROM tpi_attendance_logs WHERE id=p_id AND factory_id=target.factory_id;
END;
$$;
REVOKE ALL ON FUNCTION public.tpi_delete_attendance_log(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tpi_delete_attendance_log(uuid) TO authenticated;
COMMIT;
