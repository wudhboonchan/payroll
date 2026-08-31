# LINE/LIFF containment

The user confirmed that LINE has no real users yet on 2026-08-30.
This change disables legacy LIFF. It does NOT implement secure LINE login.
The normal /slip/:token flow is separate and is not changed by this patch.

## Production result on 2026-08-30

Applied migration_disable_legacy_liff.sql revocations to project
nlyumhbzlruhpcorwswk via Supabase SQL Editor. The transaction returned success.
Subsequent has_function_privilege checks returned false for anon,
authenticated and service_role on each of the three functions (9 checks).
Only privileges changed; function bodies and payroll records were not modified.
The maintenance page is deployed to Vercel as of 2026-08-31.

## Original ACL observed in production

Owner: postgres. For each of the following functions, EXECUTE was granted to
PUBLIC, postgres, anon, authenticated and service_role:

- public.liff_get_entry_data(uuid,uuid)
- public.liff_get_slip_info(text)
- public.liff_link_employee(text,text,text)

The functions are SECURITY DEFINER. The entry function accepts arbitrary
employee/period IDs without checking ownership. Restoring its original grants
would reopen the vulnerability and must not be used as a routine rollback.
Function bodies and payroll data are retained by the containment migration.

## Requirements before enabling LINE

- Verify LINE tokens on the server with the correct LINE Login channel audience.
- Derive the LINE subject from that verification, never a client-supplied user ID.
- Bind accounts using a single-use, expiring high-entropy invitation scoped to an
  employee and factory; do not rely on national ID last-four digits.
- Derive employee access on the server and only release authorized approved slips.
- Add rate limiting, replay protection and tests for forged/expired tokens,
  wrong-channel tokens and cross-employee access.
- Keep legacy functions revoked even after a replacement is launched.

Role rollout, key migration and deployment are complete as of 2026-08-31.
The owner disabled legacy API keys and confirmed fresh login with normal data.
The backup is a public-table export, not a full database backup; see
SECURITY_PHASE2_DEPLOY.md for scope and test limitations.
