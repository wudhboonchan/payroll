-- Three-level authorization model
--   superUser  = platform-wide access (owners/executives only)
--   admin      = full read/write access inside the assigned factory
--   normalUser = read-only access inside the assigned factory
--
-- Approved assignments:
--   wudh.boonchan@gmail.com   = superUser
--   noon8195@gmail.com        = superUser
--   mmsuwanna1992@gmail.com   = admin of the factory containing "ตราเพชร"

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('superUser', 'admin', 'normalUser'));

CREATE OR REPLACE FUNCTION public.is_system_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.role = 'superUser'
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
    SELECT 1 FROM public.profiles me
    WHERE me.id = (SELECT auth.uid())
      AND (
        me.role = 'superUser'
        OR (me.role IN ('admin', 'normalUser') AND me.factory_id = target_factory_id)
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
    SELECT 1 FROM public.profiles me
    WHERE me.id = (SELECT auth.uid())
      AND (
        me.role = 'superUser'
        OR (me.role = 'admin' AND me.factory_id = target_factory_id)
      )
  );
$$;

-- Resolve identities from auth.users instead of relying on names in profiles.
-- Refuse to continue if an email or the factory is missing/ambiguous.
DO $assign_roles$
DECLARE
  target_factory_id uuid;
  owner_one_id uuid;
  owner_two_id uuid;
  factory_admin_id uuid;
BEGIN
  SELECT id INTO STRICT target_factory_id
  FROM public.factories
  WHERE name ILIKE '%ตราเพชร%';

  SELECT id INTO STRICT owner_one_id
  FROM auth.users
  WHERE lower(email) = 'wudh.boonchan@gmail.com';

  SELECT id INTO STRICT owner_two_id
  FROM auth.users
  WHERE lower(email) = 'noon8195@gmail.com';

  SELECT id INTO STRICT factory_admin_id
  FROM auth.users
  WHERE lower(email) = 'mmsuwanna1992@gmail.com';

  -- There must be exactly two platform-wide accounts after this migration.
  UPDATE public.profiles
  SET role = CASE
    WHEN id IN (owner_one_id, owner_two_id) THEN 'superUser'
    ELSE 'admin'
  END
  WHERE role = 'superUser'
     OR id IN (owner_one_id, owner_two_id);

  UPDATE public.profiles
  SET role = 'admin', factory_id = target_factory_id
  WHERE id = factory_admin_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found for mmsuwanna1992@gmail.com';
  END IF;

  IF (SELECT count(*) FROM public.profiles WHERE role = 'superUser') <> 2 THEN
    RAISE EXCEPTION 'Expected exactly two SuperUsers after assignment';
  END IF;
END;
$assign_roles$;

COMMIT;

-- Verification: the first query must return exactly the two approved emails.
-- SELECT u.email, p.full_name, p.role, f.name AS factory
-- FROM public.profiles p
-- JOIN auth.users u ON u.id = p.id
-- LEFT JOIN public.factories f ON f.id = p.factory_id
-- WHERE p.role = 'superUser' OR lower(u.email) = 'mmsuwanna1992@gmail.com'
-- ORDER BY p.role DESC, u.email;
