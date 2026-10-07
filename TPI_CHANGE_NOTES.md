# TPI hourly deductions and attendance workflow

This change adds integer hourly deductions (1–7 hours), pending attendance reasons,
attendance deletion that restores linked shift wages, and diligence override reasons.
The TPI attendance page defaults to the month of the latest payroll period.

## Database migrations

Apply in this order when setting up another environment:

1. `migration_tpi_hourly_deductions.sql`
2. `migration_tpi_fix_existing_job_validity.sql`
3. `migration_tpi_attendance_delete_consistency.sql`

The production database used during this session already received these changes.

## Known unresolved issue: existing shift wage snapshots

`tpi_save_shift_day` currently recalculates wages for all submitted entries using
current job rates. Saving one employee's shift can therefore replace another
employee's historical wage snapshot in the same day.

Observed on employee 15226 in the 16–30 September 2026 period: the first shift on
16 September, job P133/69, currently has a 357-baht snapshot. The other twelve
first shifts are 367 baht. Current normal wages total 4,761 baht, while the saved
payroll totals 4,771 baht. Social security correspondingly differs: 238 vs 239 baht.
The intended historical rate has not been confirmed. No wage correction was made
for this employee. Preserve historical snapshots before using a save to resolve
this discrepancy; do not infer the intended rate solely from the old total.

## Validation

Production build and 49 Node tests pass. PostgreSQL integration tests cover
attendance cancellation, restoration of the saved full wage without changing OT,
legacy half shifts, manual attendance isolation, revision changes, and rejection
of unauthorized deletions. Repository-wide TypeScript checking remains unverified
as passing; it reported numerous errors during implementation.
