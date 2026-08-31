-- Containment only: no payroll records, accounts or function bodies are changed.
-- LINE/LIFF is not in production use. Keep these legacy functions inaccessible
-- until a server-verified LINE identity flow has been implemented and tested.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.liff_get_entry_data(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.liff_get_slip_info(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.liff_link_employee(text, text, text) FROM PUBLIC, anon, authenticated, service_role;
COMMIT;

-- Verification must return false for all three client roles on all functions.
SELECT p.proname,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_call,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS user_can_call,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_can_call
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname LIKE 'liff_%'
ORDER BY p.proname;
