-- Deploy alongside EmployeeSlip.tsx, which reads shifts from this token-scoped RPC.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.get_payslip_data(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t public.payslip_tokens%ROWTYPE;
  e public.employees%ROWTYPE;
  p public.payroll_periods%ROWTYPE;
  entry public.payroll_entries%ROWTYPE;
  shifts json;
BEGIN
  SELECT * INTO t FROM public.payslip_tokens
    WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO e FROM public.employees WHERE id=t.employee_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO p FROM public.payroll_periods
    WHERE id=t.period_id AND factory_id=e.factory_id AND status='approved';
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO entry FROM public.payroll_entries
    WHERE period_id=t.period_id AND employee_id=t.employee_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT coalesce(json_agg(s), '[]'::json) INTO shifts FROM (
    SELECT is_holiday_ot,is_half_shift,ot_hours,work_date
    FROM public.shift_assignments
    WHERE period_id=t.period_id AND employee_id=t.employee_id
    ORDER BY work_date
  ) s;
  RETURN json_build_object(
    'token_data', row_to_json(t), 'employee', row_to_json(e),
    'period', row_to_json(p), 'entry', row_to_json(entry), 'shifts', shifts,
    'factory', (SELECT row_to_json(f) FROM public.factories f WHERE f.id=e.factory_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_payslip_status(p_token text,p_status text,p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('confirmed','disputed') THEN
    RAISE EXCEPTION 'Invalid payslip status' USING ERRCODE='22023';
  END IF;
  IF p_status='disputed' AND (nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>2000) THEN
    RAISE EXCEPTION 'Dispute reason required (maximum 2000 characters)' USING ERRCODE='22023';
  END IF;
  UPDATE public.payslip_tokens t SET employee_status=p_status,
    dispute_reason=CASE WHEN p_status='disputed' THEN btrim(p_reason) ELSE NULL END,
    confirmed_at=CASE WHEN p_status='confirmed' THEN now() ELSE NULL END
  WHERE t.token=p_token AND t.expires_at>now()
    AND EXISTS (SELECT 1 FROM public.payroll_periods p JOIN public.employees e
      ON e.factory_id=p.factory_id JOIN public.payroll_entries pe
      ON pe.period_id=p.id AND pe.employee_id=e.id
      WHERE p.id=t.period_id AND e.id=t.employee_id AND p.status='approved');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired payslip link' USING ERRCODE='42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.get_payslip_data(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_payslip_status(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_payslip_data(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_payslip_status(text,text,text) TO anon,authenticated;
COMMIT;
