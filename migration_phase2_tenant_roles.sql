-- Phase 2 tenant authorization
-- Role model:
--   admin      = system administrator, can access every company and factory
--   normalUser = read-only user for their assigned factory
--
-- Run this migration only after reviewing the verification queries at the end.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- Merge the obsolete superUser role into admin before tightening the constraint.
UPDATE public.profiles
SET role = 'admin'
WHERE role = 'superUser';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'normalUser'));

ALTER TABLE public.profiles
  ALTER COLUMN role SET DEFAULT 'normalUser',
  ALTER COLUMN role SET NOT NULL;

-- These functions are SECURITY DEFINER so policy evaluation can inspect profiles
-- without causing recursive RLS checks. The fixed search_path prevents object
-- shadowing attacks.
CREATE OR REPLACE FUNCTION public.is_system_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_factory(target_factory_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles me
    WHERE me.id = (SELECT auth.uid())
      AND (
        me.role = 'admin'
        OR (me.role = 'normalUser' AND me.factory_id = target_factory_id)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_factory(target_factory_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles me
    WHERE me.id = (SELECT auth.uid())
      AND me.role = 'admin'
  );
$$;

DROP FUNCTION IF EXISTS public.is_platform_super_user();
REVOKE ALL ON FUNCTION public.is_system_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_factory(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_factory(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_system_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_factory(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_factory(uuid) TO authenticated;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.factories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advance_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payslip_tokens ENABLE ROW LEVEL SECURITY;

-- Remove the permissive Phase 1 policies.
DROP POLICY IF EXISTS profiles_select ON public.profiles;
DROP POLICY IF EXISTS profiles_update ON public.profiles;
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
DROP POLICY IF EXISTS companies_select ON public.companies;
DROP POLICY IF EXISTS companies_all ON public.companies;
DROP POLICY IF EXISTS factories_select ON public.factories;
DROP POLICY IF EXISTS factories_all ON public.factories;
DROP POLICY IF EXISTS employees_all ON public.employees;
DROP POLICY IF EXISTS periods_all ON public.payroll_periods;
DROP POLICY IF EXISTS shifts_all ON public.shift_assignments;
DROP POLICY IF EXISTS payroll_all ON public.payroll_entries;
DROP POLICY IF EXISTS advances_all ON public.advance_payments;
DROP POLICY IF EXISTS tokens_all ON public.payslip_tokens;

-- Profiles are administered through the server API. The browser receives SELECT only.
CREATE POLICY profiles_select_authorized
ON public.profiles FOR SELECT TO authenticated
USING (
  id = (SELECT auth.uid())
  OR public.is_system_admin()
  OR public.can_manage_factory(factory_id)
);

CREATE POLICY companies_select_authorized
ON public.companies FOR SELECT TO authenticated
USING (
  public.is_system_admin()
  OR EXISTS (
    SELECT 1 FROM public.factories f
    WHERE f.company_id = companies.id
      AND public.can_access_factory(f.id)
  )
);

CREATE POLICY companies_manage_admin
ON public.companies FOR ALL TO authenticated
USING (public.is_system_admin())
WITH CHECK (public.is_system_admin());

CREATE POLICY factories_select_authorized
ON public.factories FOR SELECT TO authenticated
USING (public.can_access_factory(id));

CREATE POLICY factories_manage_admin
ON public.factories FOR ALL TO authenticated
USING (public.is_system_admin())
WITH CHECK (public.is_system_admin());

CREATE POLICY employees_select_authorized
ON public.employees FOR SELECT TO authenticated
USING (public.can_access_factory(factory_id));
CREATE POLICY employees_manage_authorized
ON public.employees FOR ALL TO authenticated
USING (public.can_manage_factory(factory_id))
WITH CHECK (public.can_manage_factory(factory_id));

CREATE POLICY periods_select_authorized
ON public.payroll_periods FOR SELECT TO authenticated
USING (public.can_access_factory(factory_id));
CREATE POLICY periods_manage_authorized
ON public.payroll_periods FOR ALL TO authenticated
USING (public.can_manage_factory(factory_id))
WITH CHECK (public.can_manage_factory(factory_id));

CREATE POLICY shifts_select_authorized
ON public.shift_assignments FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.payroll_periods pp
    WHERE pp.id = shift_assignments.period_id
      AND public.can_access_factory(pp.factory_id)
  )
);
CREATE POLICY shifts_manage_authorized
ON public.shift_assignments FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.payroll_periods pp
    WHERE pp.id = shift_assignments.period_id
      AND public.can_manage_factory(pp.factory_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.payroll_periods pp
    WHERE pp.id = shift_assignments.period_id
      AND public.can_manage_factory(pp.factory_id)
  )
);

CREATE POLICY payroll_select_authorized
ON public.payroll_entries FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.payroll_periods pp
    WHERE pp.id = payroll_entries.period_id
      AND public.can_access_factory(pp.factory_id)
  )
);
CREATE POLICY payroll_manage_authorized
ON public.payroll_entries FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.payroll_periods pp
    WHERE pp.id = payroll_entries.period_id
      AND public.can_manage_factory(pp.factory_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.payroll_periods pp
    WHERE pp.id = payroll_entries.period_id
      AND public.can_manage_factory(pp.factory_id)
  )
);

CREATE POLICY advances_select_authorized
ON public.advance_payments FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.payroll_periods pp
    WHERE pp.id = advance_payments.period_id
      AND public.can_access_factory(pp.factory_id)
  )
);
CREATE POLICY advances_manage_authorized
ON public.advance_payments FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.payroll_periods pp
    WHERE pp.id = advance_payments.period_id
      AND public.can_manage_factory(pp.factory_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.payroll_periods pp
    WHERE pp.id = advance_payments.period_id
      AND public.can_manage_factory(pp.factory_id)
  )
);

CREATE POLICY tokens_select_authorized
ON public.payslip_tokens FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.payroll_periods pp
    WHERE pp.id = payslip_tokens.period_id
      AND public.can_access_factory(pp.factory_id)
  )
);
CREATE POLICY tokens_manage_authorized
ON public.payslip_tokens FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.payroll_periods pp
    WHERE pp.id = payslip_tokens.period_id
      AND public.can_manage_factory(pp.factory_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.payroll_periods pp
    WHERE pp.id = payslip_tokens.period_id
      AND public.can_manage_factory(pp.factory_id)
  )
);

-- Both references must belong to the same factory. Checking only the period
-- would allow malformed records to expose a different factory's employee.
DO $guard$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shift_assignments','payroll_entries','advance_payments','payslip_tokens'] LOOP
    EXECUTE format(
      'CREATE POLICY tenant_reference_guard ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
       USING (EXISTS (SELECT 1 FROM public.employees e JOIN public.payroll_periods p ON p.factory_id=e.factory_id
         WHERE e.id=%I.employee_id AND p.id=%I.period_id AND public.can_access_factory(p.factory_id)))
       WITH CHECK (EXISTS (SELECT 1 FROM public.employees e JOIN public.payroll_periods p ON p.factory_id=e.factory_id
         WHERE e.id=%I.employee_id AND p.id=%I.period_id AND public.can_manage_factory(p.factory_id)))',
      t,t,t,t,t);
  END LOOP;
END;
$guard$;

COMMIT;

-- Review after migration:
-- SELECT role, count(*) FROM public.profiles GROUP BY role ORDER BY role;
-- SELECT p.id, p.full_name, p.role, f.name AS factory, c.name AS company
-- FROM public.profiles p
-- LEFT JOIN public.factories f ON f.id = p.factory_id
-- LEFT JOIN public.companies c ON c.id = f.company_id
-- ORDER BY c.name, f.name, p.full_name;
