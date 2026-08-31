# Phase 2 role security deployment

## Production status: 2026-08-31

The role, payslip-token and legacy-LIFF migrations have ALREADY been applied
to production. Do not rerun them as part of a Git push or deployment. The
instructions below are a reference for a fresh rollout, not pending work.

- Production uses deployment `dpl_HjHVhWLg6h5oFrdytBysahMbyfha`.
- The frontend uses a publishable key; the server uses a server-only secret.
- The owner disabled legacy JWT-based API keys. A request using the old anon
  key returned 401 while the publishable key returned 200.
- The owner confirmed a fresh login and normal data after disabling legacy keys.
- Admin factory switching and normal-user route restrictions were checked.
  The owner created a TPI normal user and confirmed it cannot see the other factory.
- One temporary approved-slip link rendered successfully, was deleted, and
  was rejected on reload. No payroll amounts or confirmation states changed.
- Real confirmation/dispute writes and account deletion were not exercised.
- The LINE maintenance page is deployed. Secure LINE login is not implemented.
- This rollout does not establish whether the old key was used before revocation.

Do not run the SQL migration directly in production without a backup and the
role audit below. Applying RLS with an incorrectly assigned role can lock users
out, which is safer than leaking payroll data but still disruptive.

## Intended roles

| Role | Scope | Write access | User management |
| --- | --- | --- | --- |
| `admin` | Every company and factory | Yes | Every normal user |
| `normalUser` | Assigned factory only | No | No |

The `factory_id` on an admin profile is only the initially selected factory.
Admins can switch to any factory. The migration converts any legacy
`superUser` account to `admin`.

## 1. Back up and audit the existing users

Run this read-only query in Supabase SQL Editor:

```sql
SELECT
  p.id,
  p.full_name,
  p.role,
  p.factory_id,
  f.name AS factory_name,
  c.id AS company_id,
  c.name AS company_name
FROM public.profiles p
LEFT JOIN public.factories f ON f.id = p.factory_id
LEFT JOIN public.companies c ON c.id = f.company_id
ORDER BY c.name, f.name, p.full_name;
```

Before continuing, confirm all of the following:

- At least one trusted owner has role `admin`.
- Every `admin` and `normalUser` has the correct `factory_id`.
- Every factory has a `company_id`.
- Nobody has a misspelled or unknown role.

Export a database backup before changing policies.

## 2. Rotate the exposed service-role key

The old frontend used `VITE_SUPABASE_SERVICE_ROLE_KEY`. Any `VITE_` variable can
be included in browser JavaScript, so treat that key as compromised if that
build was ever deployed.

1. Coordinate credential replacement and revocation in Supabase with the deployment. Creating a replacement alone does not revoke an exposed legacy key. The account owner must handle credential entry and confirmation.
2. Delete `VITE_SUPABASE_SERVICE_ROLE_KEY` from local and Vercel variables.
3. Add server-only `SUPABASE_SERVICE_ROLE_KEY` in Vercel.
4. Add server-only `SUPABASE_URL` in Vercel.
5. Keep the variable name `VITE_SUPABASE_ANON_KEY` for compatibility, but put
   the new `sb_publishable_...` key in it. Keep `sb_secret_...` server-only.
   Deactivate legacy keys only after migrating all callers and testing.

Never prefix the new service-role variable with `VITE_`.

## 3. Deploy server API before enabling strict RLS

Apply `migration_secure_payslip_tokens.sql` first: it preserves response fields and adds authorized shift data needed by the new frontend. Expired links and links for unapproved periods will stop working intentionally.

Deploy `api/admin-users.ts` and the updated frontend during the same maintenance window as the role migration. Legacy `superUser` accounts are denied by the new frontend until converted. Confirm an existing
admin can create and delete a test normal user. The server validates the caller,
role and target company before using the service-role key.

## 4. Apply tenant RLS

Run `migration_phase2_tenant_roles.sql` in Supabase SQL Editor. Do this during a
short maintenance window while no one is editing payroll.

## 5. Test with separate accounts

Use at least three non-production test accounts:

1. `admin` can switch across companies and edit payroll.
2. `normalUser` can read allowed reports for their assigned factory but cannot
   insert, update or delete payroll data.
3. An admin cannot create or delete another admin from the user-management screen.
4. No normal user can read employees from another factory through a direct
   Supabase REST request.

Also retest public payslips: valid approved tokens work, expired and draft-period tokens fail, and confirmation/dispute updates require a valid token. Shift data must come from the token RPC, not anonymous table queries.

Legacy LIFF execution has been revoked in production. The new frontend displays a maintenance page. A replacement LINE identity-verification flow is not implemented and LINE must remain disabled.

Local synthetic PostgreSQL tests passed for tenant isolation, forbidden self-promotion, forbidden normal-user writes, administrator access, cross-factory reference guards, and token expiry/approval. These do not replace deployed API and real-account smoke tests.

The backup captured on 2026-08-30 contains exports of all nine public tables plus policy/function/constraint definitions. It is NOT a transaction-consistent full PostgreSQL backup and does not include Auth password data or Storage files.

## Rollback

Do not run `supabase_rls.sql` as a rollback: it reopens cross-factory access and does not remove all newly added policies. Keep access fail-closed, check the affected profile/factory assignment, and fix the narrow cause. Each migration is transactional, so a failed migration rolls back its own changes. After a successful commit, any policy restoration must be built from the captured live definitions, explicitly remove conflicting new policies, and be separately reviewed and approved. Do not roll back to a frontend containing the exposed service-role key or re-enable legacy LINE functions.
