-- Migration: Fix get_payslip_data and update_payslip_status RPCs
-- 1. Removes strict status = 'approved' requirement so slip links work without blocking on status
-- 2. Makes payroll_entries optional so employees without manual entries can still view their slip
-- 3. Trims tokens to prevent whitespace mismatches
-- 4. Ensures search_path is safe with public, pg_catalog
-- 5. Grants execute to anon and authenticated roles

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_payslip_data(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  t public.payslip_tokens%ROWTYPE;
  e public.employees%ROWTYPE;
  p public.payroll_periods%ROWTYPE;
  entry public.payroll_entries%ROWTYPE;
  shifts json;
BEGIN
  -- 1. Find token with trimmed comparison
  SELECT * INTO t FROM public.payslip_tokens
    WHERE token = btrim(p_token) AND expires_at > now();
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- 2. Find employee
  SELECT * INTO e FROM public.employees WHERE id = t.employee_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- 3. Find payroll period (matches factory)
  SELECT * INTO p FROM public.payroll_periods
    WHERE id = t.period_id AND factory_id = e.factory_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- 4. Find payroll entry if exists (DO NOT abort if not found)
  SELECT * INTO entry FROM public.payroll_entries
    WHERE period_id = t.period_id AND employee_id = t.employee_id;

  -- 5. Find shifts
  SELECT coalesce(json_agg(s), '[]'::json) INTO shifts FROM (
    SELECT is_holiday_ot, is_half_shift, ot_hours, work_date
    FROM public.shift_assignments
    WHERE period_id = t.period_id AND employee_id = t.employee_id
    ORDER BY work_date
  ) s;

  -- 6. Return payload
  RETURN json_build_object(
    'token_data', row_to_json(t),
    'employee', row_to_json(e),
    'period', row_to_json(p),
    'entry', CASE WHEN entry.id IS NOT NULL THEN row_to_json(entry) ELSE NULL END,
    'shifts', shifts,
    'factory', (SELECT row_to_json(f) FROM public.factories f WHERE f.id = e.factory_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_payslip_status(p_token text, p_status text, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('confirmed', 'disputed') THEN
    RAISE EXCEPTION 'Invalid payslip status' USING ERRCODE='22023';
  END IF;

  IF p_status = 'disputed' AND (nullif(btrim(p_reason), '') IS NULL OR length(p_reason) > 2000) THEN
    RAISE EXCEPTION 'Dispute reason required (maximum 2000 characters)' USING ERRCODE='22023';
  END IF;

  UPDATE public.payslip_tokens t
  SET
    employee_status = p_status,
    dispute_reason = CASE WHEN p_status = 'disputed' THEN btrim(p_reason) ELSE NULL END,
    confirmed_at = CASE WHEN p_status = 'confirmed' THEN now() ELSE NULL END
  WHERE t.token = btrim(p_token)
    AND t.expires_at > now()
    AND EXISTS (
      SELECT 1 FROM public.payroll_periods p
      JOIN public.employees e ON e.factory_id = p.factory_id
      WHERE p.id = t.period_id AND e.id = t.employee_id
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired payslip link' USING ERRCODE='42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_payslip_data(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_payslip_status(text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_payslip_data(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_payslip_status(text, text, text) TO anon, authenticated;

COMMIT;
