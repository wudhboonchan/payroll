# TPI phase 2: shift entry preview

Open `/preview/tpi-shifts` on the Vite development server for an interactive example with fictional employees. This route is absent from production builds. The existing `/shifts` route selects the new page only when the active company name matches TPI or ทีพีไอ โพลีน. Other companies retain ShiftEntry.tsx unchanged.

The TPI page is a UI prototype. It reads active employees within the selected factory but never writes shift assignments. Drafts live in component memory, are separated by date, and reset on factory change or leaving/reloading the page. Payroll calculations and database schema are unchanged.

Supported: three shift columns; selection of multiple employees; drag a person/card into a shift header or empty slot to add a shift; at most two distinct shifts per employee per date; remove individual shifts; connected bars for adjacent shifts; separated cards on one row for morning plus night. Dates refer to shift start dates. Night ends the next day.

Validation: production build and focused ESLint passed. Browser checks covered third-shift rejection, removal, nonadjacent shifts, bulk assignment, mobile overflow, and no captured console errors. Full repository TypeScript checking fails in existing modules; see existing typing debt before treating a build as a typecheck. Live authenticated employee loading and payroll persistence were not tested. Persistence is intentionally outside this screen preview.

Before real payroll use: define TPI rates, breaks and the 20-minute overlap between consecutive shift schedules; confirm whether morning plus night is allowed; define how night-to-next-morning work counts toward the daily limit; implement separate tenant-scoped persistence and server validation without changing Diamond's one-row-per-day contract.
