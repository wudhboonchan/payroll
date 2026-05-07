# PAYROLL MANAGEMENT SYSTEM — FULL BUILD PROMPT
## ระบบจัดการค่าแรง ห้างหุ้นส่วนจำกัด วิราญกร

---

## OBJECTIVE

Build a full-stack payroll management web application as a React SPA with Supabase as the backend.

**Business context (critical for architecture):**
- **ห้างหุ้นส่วนจำกัด วิราญกร** is the system owner and payroll processor. This name appears on ALL pay slips and as the app brand — it never changes.
- **ตราเพชร** and **TPI** are วิราญกร's client companies. They are managed as separate company groups within the app, each with their own employees, factories, and payroll logic.
- The `companies` table represents these client companies (ตราเพชร, TPI), NOT วิราญกร itself.
- Phase 1 builds for ตราเพชร. Phase 2 adds TPI with different payroll calculation logic (use `company_type` field to switch calculation strategy).

The system manages bi-monthly payroll (every 15 days) for ~90 employees per client company. It supports shift-based attendance entry, automatic payroll calculation, pay slip generation with LINE sharing, and a role-based approval workflow.

---

## TECH STACK

- **Frontend**: React (Vite), React Router v6, TanStack Query (React Query) for data fetching
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui
- **Backend/DB**: Supabase (PostgreSQL, Auth, Row Level Security, Realtime)
- **PDF Generation**: react-pdf or jsPDF for pay slip export
- **Icons**: Lucide React
- **State**: Zustand for global state
- **Forms**: React Hook Form + Zod validation
- **Date handling**: date-fns with Thai Buddhist Era display (พ.ศ.)

---

## DATABASE SCHEMA (Supabase PostgreSQL)

### Table: `companies`
-- Represents วิราญกร's CLIENT companies (e.g. ตราเพชร, TPI). NOT วิราญกร itself.
```sql
id            uuid PRIMARY KEY DEFAULT gen_random_uuid()
name          text NOT NULL        -- e.g. "บริษัทตราเพชร", "TPI"
short_name    text                 -- e.g. "ตราเพชร", "TPI"
company_type  text NOT NULL DEFAULT 'tra_phet'
              -- 'tra_phet' = ตราเพชร payroll logic (Phase 1)
              -- 'tpi'      = TPI payroll logic (Phase 2, structure only for now)
logo_url      text
created_at    timestamptz DEFAULT now()
```
-- IMPORTANT: The app brand on ALL pay slips is always "ห้างหุ้นส่วนจำกัด วิราญกร" (hardcoded, not from DB)
-- companies table = client companies managed by วิราญกร, each with separate employees/factories/payroll

### Table: `factories`
```sql
id          uuid PRIMARY KEY DEFAULT gen_random_uuid()
company_id  uuid REFERENCES companies(id)
name        text NOT NULL
shift_morning_start   time  -- e.g. '06:00'
shift_morning_end     time  -- e.g. '18:00'
shift_afternoon_start time  -- e.g. '14:00'
shift_afternoon_end   time  -- e.g. '02:00'
shift_night_start     time  -- e.g. '22:00'
shift_night_end       time  -- e.g. '10:00'
created_at  timestamptz DEFAULT now()
```

### Table: `profiles` (extends Supabase auth.users)
```sql
id            uuid PRIMARY KEY REFERENCES auth.users(id)
factory_id    uuid REFERENCES factories(id)
role          text CHECK (role IN ('admin','superUser','normalUser'))
full_name     text
created_at    timestamptz DEFAULT now()
```

### Table: `employees`
```sql
id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
factory_id          uuid REFERENCES factories(id) NOT NULL
employee_code       text NOT NULL
prefix              text  -- นาย, นาง, นางสาว
first_name          text NOT NULL
last_name           text NOT NULL
national_id         text  -- Thai ID or foreign ID
nationality         text DEFAULT 'Thai'
payment_method      text CHECK (payment_method IN ('cash','bank_transfer')) DEFAULT 'bank_transfer'
bank_name           text  -- only if payment_method = 'bank_transfer'
bank_account        text  -- only if payment_method = 'bank_transfer'
rate_per_12h        numeric(10,2) NOT NULL  -- base wage per 12-hour shift
status              text CHECK (status IN ('active','inactive')) DEFAULT 'active'
notes               text
created_at          timestamptz DEFAULT now()
updated_at          timestamptz DEFAULT now()
UNIQUE(factory_id, employee_code)
```

### Table: `payroll_periods`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
factory_id      uuid REFERENCES factories(id) NOT NULL
label           text NOT NULL  -- e.g. "16-30 เม.ย. 2569"
period_start    date NOT NULL
period_end      date NOT NULL
status          text CHECK (status IN ('draft','approved')) DEFAULT 'draft'
approved_by     uuid REFERENCES profiles(id)
approved_at     timestamptz
social_security_rate numeric(5,4) DEFAULT 0.05  -- 5% adjustable by superUser
created_at      timestamptz DEFAULT now()
```

### Table: `shift_assignments`
-- Daily shift attendance. One row per employee per day.
```sql
id            uuid PRIMARY KEY DEFAULT gen_random_uuid()
period_id     uuid REFERENCES payroll_periods(id) NOT NULL
employee_id   uuid REFERENCES employees(id) NOT NULL
work_date     date NOT NULL
shift_type    text CHECK (shift_type IN ('morning','afternoon','night'))
is_holiday_ot boolean DEFAULT false  -- flags national holiday: rate x2
entered_by    uuid REFERENCES profiles(id)
created_at    timestamptz DEFAULT now()
UNIQUE(period_id, employee_id, work_date)
```

### Table: `payroll_entries`
-- One row per employee per period. Amounts auto-calculated + manual fields.
```sql
id                      uuid PRIMARY KEY DEFAULT gen_random_uuid()
period_id               uuid REFERENCES payroll_periods(id) NOT NULL
employee_id             uuid REFERENCES employees(id) NOT NULL

-- Income (auto-calculated from shift_assignments, stored for record)
amount_normal           numeric(12,2) DEFAULT 0  -- (rate/12)*8 * working_days
amount_shift            numeric(12,2) DEFAULT 0  -- (rate/12)*4 * working_days
amount_ot               numeric(12,2) DEFAULT 0  -- rate*2 * holiday_days

-- Income overrides (when auto-calc is manually changed)
override_normal         numeric(12,2)  -- NULL = use auto
override_shift          numeric(12,2)
override_ot             numeric(12,2)
override_reason         text  -- required if any override is set

-- Manual income fields
amount_wood_excess      numeric(12,2) DEFAULT 0  -- ค่าไม้ส่วนเกิน
amount_film             numeric(12,2) DEFAULT 0  -- ค่าฟิล์ม
amount_special          numeric(12,2) DEFAULT 0  -- เงินพิเศษ
amount_diligence        numeric(12,2) DEFAULT 0  -- เบี้ยขยัน
amount_position         numeric(12,2) DEFAULT 0  -- ค่าตำแหน่ง

-- Deductions (auto-calculated, locked)
deduct_social_security  numeric(12,2) DEFAULT 0  -- amount_normal * ss_rate (or override_normal if set)
deduct_advance          numeric(12,2) DEFAULT 0  -- sum from advance_payments, locked

-- Manual deduction fields
deduct_safety_equipment numeric(12,2) DEFAULT 0  -- ค่าอุปกรณ์ Safety
deduct_uniform          numeric(12,2) DEFAULT 0  -- ค่าเสื้อพนักงาน

entered_by    uuid REFERENCES profiles(id)
updated_at    timestamptz DEFAULT now()
UNIQUE(period_id, employee_id)
```

### Table: `advance_payments`
-- Salary advance. Max 2 per period per employee.
```sql
id            uuid PRIMARY KEY DEFAULT gen_random_uuid()
period_id     uuid REFERENCES payroll_periods(id) NOT NULL
employee_id   uuid REFERENCES employees(id) NOT NULL
amount        numeric(12,2) NOT NULL
request_date  date NOT NULL DEFAULT CURRENT_DATE
notes         text
entered_by    uuid REFERENCES profiles(id)
created_at    timestamptz DEFAULT now()
```
Enforce max 2 advances per (period_id, employee_id) via application logic or DB trigger.

### Table: `payslip_tokens`
-- Secure token-based pay slip access for employees (sent via LINE)
```sql
id            uuid PRIMARY KEY DEFAULT gen_random_uuid()
period_id     uuid REFERENCES payroll_periods(id) NOT NULL
employee_id   uuid REFERENCES employees(id) NOT NULL
token         text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex')
expires_at    timestamptz NOT NULL DEFAULT now() + interval '30 days'
employee_status text CHECK (employee_status IN ('pending','confirmed','disputed','auto_confirmed')) DEFAULT 'pending'
dispute_reason  text
confirmed_at    timestamptz
auto_confirm_at timestamptz  -- set to sent_at + 48h
created_by    uuid REFERENCES profiles(id)
created_at    timestamptz DEFAULT now()
UNIQUE(period_id, employee_id)
```

---

## BUSINESS LOGIC

### Payroll Calculation (ตราเพชร)

```
rate = employee.rate_per_12h  (บาท per 12-hour shift)

For each working day (non-holiday):
  amount_normal += (rate / 12) * 8    -- 8 hours, base for social security
  amount_shift  += (rate / 12) * 4    -- 4 hours, NOT included in social security base

For each holiday OT day (is_holiday_ot = true):
  amount_ot += rate * 2               -- full 12h x2, NOT in social security base

Effective normal = override_normal ?? amount_normal
Effective shift  = override_shift  ?? amount_shift
Effective ot     = override_ot     ?? amount_ot

total_income = effective_normal + effective_shift + effective_ot
             + amount_wood_excess + amount_film + amount_special
             + amount_diligence + amount_position

deduct_social_security = effective_normal * social_security_rate (default 5%)
deduct_advance = SUM of advance_payments for this period/employee

total_deductions = deduct_social_security + deduct_advance
                 + deduct_safety_equipment + deduct_uniform

net_pay = total_income - total_deductions
```

---

## USER ROLES & PERMISSIONS

### Role: admin
- Full access to everything
- Can manage users, factories, companies
- Can change any setting

### Role: superUser
- Approve / revoke approval of payroll periods
- View Dashboard with financial totals
- Export data (Excel, PDF)
- Generate payslip links (LINE sharing)
- Adjust social security rate per period
- All normalUser permissions

### Role: normalUser
- View and edit employee database
- Shift entry (daily)
- Payroll entry form (after shifts are done)
- Advance payments
- View pay slip (individual only)
- CANNOT: see financial totals/Dashboard, export data

### Row Level Security (Supabase RLS)
- All tables filtered by factory_id = profiles.factory_id
- superUser and admin bypass factory filter for cross-factory access
- normalUser can only read/write their own factory's data

---

## PAGES & FEATURES

### 1. Authentication
- Login page with email/password (Supabase Auth)
- After login: redirect based on role (admin/superUser → Dashboard, normalUser → Shift Entry)
- Route guards based on role
- User sees their factory name in sidebar

---

### 2. Dashboard (admin + superUser only)

**Stats cards row:**
- Total employees this period
- Total gross pay (งวดนี้)
- Total social security deducted
- Net pay (สุทธิ)

**Period summary:**
- Current period status (draft/approved)
- Days filled / 15 days completeness
- Month-to-date total (period 1 + period 2)
- Simple bar chart: last 4 months total

**Approval status panel:**
- Shift data completeness (X/15 days)
- Approval status badge
- Approve/Revoke button (superUser)
- Export button (enabled only when approved)
- Generate payslip links button (enabled only when approved)

---

### 3. Employee Database (all roles)

**List view:**
- Search by name or employee code
- Filter by status (active/inactive)
- Filter by payment method
- Table: code, full name, bank, account (masked), nationality, status, payment method
- Click row to view/edit

**Add/Edit form:**
- All fields from employees table
- Payment method toggle: สดเงินสด / โอนธนาคาร
  - If bank_transfer: show bank_name + bank_account fields
  - If cash: hide bank fields
- Validation: employee_code unique within factory

---

### 4. Shift Entry (all roles)

**Layout:**
- Top bar: date navigator (prev/next day), current date prominent, period label, OT holiday flag toggle, Save Day button
- Progress bar: X / 15 days complete for this period (with warning if trying to approve with incomplete days)
- Left panel: available employee pool (employees not yet assigned today), searchable
- Right area: 3 columns for กะเช้า / กะบ่าย / กะดึก

**Interaction (click-to-assign, NOT drag and drop):**
1. User clicks an employee chip in the left pool → employee chip highlights/selects
2. Tooltip/hint shows: "เลือก [name] แล้ว — คลิกที่กะที่ต้องการ"
3. User clicks on any shift column area (or a dashed + zone) → employee moves to that shift
4. Employee disappears from pool (they can only be in one shift per day)
5. To remove: click the × on the assigned chip → employee returns to pool
6. Pool chips show: name + employee code. Assigned employees are dimmed/gone from pool.

**Yesterday's data:**
- When opening a new day, auto-load previous day's assignments as default
- Each pre-loaded chip shows "เมื่อวาน" badge (gray) vs newly assigned (green "ใหม่" badge)
- Today's date is always shown prominently — no ambiguity
- User must click "บันทึกวันนี้" to save — pre-loaded data is NOT saved until confirmed

**OT Holiday flag:**
- Toggle in topbar: "วันปกติ" / "วันหยุดนักขัตฤกษ์"
- When flagged: all assignments on this date get is_holiday_ot = true
- Visual indicator: amber background on the day header

**Completeness indicator:**
- Bottom bar shows: progress bar + "X / 15 วัน" + warning if incomplete
- Days with data: green dot. Today: blue dot. Empty days: red dot. Future: gray dot.

---

### 5. Payroll Entry (all roles)

**Layout:**
- Period selector + employee selector (dropdown with search)
- Two-column form: Income (left) | Deductions (right)
- Bottom: summary totals

**Income section (left, green accent):**
- ค่าจ้างปกติ: auto-calculated, shown in green read-only field. Override button (pencil icon) → opens input + required reason field
- ค่ากะ: same as above
- OT: same (shown only if there are holiday days)
- ค่าไม้ส่วนเกิน: number input
- ค่าฟิล์ม: number input
- เงินพิเศษ: number input
- เบี้ยขยัน: number input
- ค่าตำแหน่ง: number input
- Subtotal: รวมรายได้

**Deductions section (right, red accent):**
- ประกันสังคม: locked, auto-calculated (5% of effective_normal), shown with lock icon + rate label
- เบิกล่วงหน้า: locked, pulled from advance_payments, shown with lock icon
- ค่าอุปกรณ์ Safety: number input
- ค่าเสื้อพนักงาน: number input
- Subtotal: รวมรายการหัก

**Summary row:**
- รวมรายได้ | รวมรายการหัก | รวมสุทธิ (highlighted green)

**Period-level controls (superUser):**
- Social security rate field (locked for normalUser, editable for superUser)
- "อนุมัติงวดนี้" button — disabled until all 15 days have shift data
- When approved: all entry fields lock, show "อนุมัติแล้ว" badge

---

### 6. Advance Payments (all roles)

**List view:**
- Filter by period + employee
- Table: employee, date, amount, notes, entered by
- Running total per employee per period
- Warning badge if employee has reached 2 advances this period

**Add form:**
- Employee selector (searchable)
- Amount
- Date
- Notes (optional)
- System blocks submit if employee already has 2 advances this period (show error)

**Integration:**
- deduct_advance in payroll_entries auto-sums from this table
- Shows in payroll entry form as locked field

---

### 7. Pay Slip View (all roles)

**Controls:**
- Employee selector
- Period selector
- Print button
- Export PDF button (superUser only)
- Copy LINE link button (superUser only — enabled only when period is approved)

**Pay Slip layout (matches client format):**

```
┌─────────────────────────────────────────────────┐
│       ห้างหุ้นส่วนจำกัด วิราญกร                │
│            Slip เงินเดือน                        │
├─────────────────────────────────────────────────┤
│ ชื่อ: [name]          รหัสพนักงาน: [code]       │
│ ค่าแรงงวด: [period label]                        │
├──────────────────┬──────────────────┬────────────┤
│ รายได้           │ รายการหัก        │ รวมเงินได้ │
├──────────────────┼──────────────────┼────────────┤
│ ค่าจ้างปกติ  X  │ ประกันสังคม   X  │            │
│ ค่ากะ        X  │ เบิกล่วงหน้า  X  │   [NET]    │
│ OT (ถ้ามี)   X  │ ค่าอุปกรณ์    X  │  (yellow)  │
│ ค่าไม้ฯ      X  │ ค่าเสื้อ      X  │            │
│ ค่าฟิล์ม     X  │                  │            │
│ เงินพิเศษ    X  │                  │            │
│ เบี้ยขยัน    X  │                  │            │
│ ค่าตำแหน่ง   X  │                  │            │
├──────────────────┼──────────────────┤            │
│ รวมรายได้   XX  │ รวมรายการหัก XX  │            │
└──────────────────┴──────────────────┴────────────┘
│ วิธีการรับเงิน: [เงินสด / โอนบัญชีธนาคาร]      │
│ [ถ้าโอน: ธนาคาร: XXX  เลขที่บัญชี: XXXXXXXXXX] │
│ วันที่จ่ายเงิน: _______________                 │
└─────────────────────────────────────────────────┘
```

**Notes on Pay Slip:**
- Hide any row where amount = 0 or null (don't show empty rows)
- NET amount highlighted in yellow background, bold
- Payment method section at bottom: if cash → "วิธีการรับเงิน: เงินสด". If bank → show bank name + account number
- NO signature lines
- All amounts formatted as Thai locale (comma thousands separator, 2 decimal places)
- Employee names in Thai

---

### 8. Export Page (admin + superUser only, period must be approved)

**Export options:**

1. **Excel — Payroll Summary**
   - All employees for selected period
   - Columns: code, name, all income fields, all deduction fields, net pay, payment method, bank info
   - Format matching DB_FormPayroll.xlsx structure

2. **PDF — Pay Slips**
   - Select: all employees OR individual employee
   - Generate one PDF with all slips (one per page) OR individual files

3. **Pay Slip Links (LINE sharing)**
   - Generate secure tokens for all employees in the period
   - Show table: employee name, link (copyable), expiry (30 days), status (pending/confirmed/disputed/auto_confirmed)
   - Copy individual link or copy all links as formatted text for LINE broadcast
   - Status auto-updates when employee confirms/disputes

---

### 9. Employee Pay Slip (public, no login required)

Route: `/slip/:token`

- Fetches pay slip data by token
- Validates token not expired
- Shows read-only pay slip (same layout as above)
- Shows confirm/dispute buttons if status = 'pending'
- If confirmed → show "ยืนยันแล้ว ขอบคุณครับ/ค่ะ" screen
- If disputed → show reason text area (required), submit button → saves dispute_reason, notifies system
- If auto_confirmed → show "ยืนยันโดยอัตโนมัติ" notice
- If expired → show "ลิงค์หมดอายุแล้ว กรุณาติดต่อผู้ดูแลระบบ"
- This page has NO sidebar, NO navigation — standalone view only
- Mobile responsive (employees view on phone via LINE)

---

### 10. Settings (admin + superUser)

- Factory shift time configuration (per factory)
- Social security rate (superUser can edit per period)
- User management: list users, invite, assign role + factory (admin only)

---

## UI/UX REQUIREMENTS

**Design language:**
- Clean, minimalist, professional
- Primary color: #1D9E75 (teal green)
- Sidebar navigation with factory name at top
- All Thai text displayed correctly (use appropriate Thai font)
- Responsive for tablet use (not required for mobile except /slip/:token)

**Sidebar navigation:**
```
[Factory Name]
─────────────
Dashboard          (admin, superUser)
ฐานข้อมูลพนักงาน  (all)
กรอกกะ             (all)
กรอกตัวเลข         (all)
เบิกล่วงหน้า       (all)
ดู Pay Slip        (all)
Export ข้อมูล      (admin, superUser)
─────────────
[User name + role badge]
```

**Numbers and currency:**
- Always display with Thai locale formatting: 1,234.56
- Thai Buddhist Era (พ.ศ.): 2025 CE = 2568 พ.ศ.
- Period labels use พ.ศ.: "16–30 เม.ย. 2569"

**Status badges:**
- draft: amber background
- approved: green background
- pending: gray
- confirmed: green
- disputed: red
- auto_confirmed: blue

**Form validation:**
- Required fields marked with *
- Show inline errors on blur
- Disable submit when form is invalid
- Confirm dialogs for destructive actions (approve, revoke approval)

---

## KEY BUSINESS RULES TO ENFORCE

1. **Period approval gate**: Cannot approve until all 15 days in period have at least 1 shift assignment
2. **Export gate**: Export and link generation only available for approved periods
3. **Advance payment limit**: Max 2 advance payments per employee per period — block on form submit with clear error message
4. **Payroll entry lock**: All payroll entry fields lock when period is approved. SuperUser can revoke approval to unlock.
5. **Override requires reason**: If user overrides auto-calculated amount, reason field is required
6. **Social security rate**: Editable only by superUser. Changes apply to the entire period (recalculate all entries).
7. **Auto-confirm**: 48 hours after payslip token is created, status changes to 'auto_confirmed' if still 'pending'. Implement via Supabase Edge Function or cron.
8. **RLS**: normalUser can only access data within their assigned factory_id
9. **Employee uniqueness**: employee_code must be unique within a factory (not globally)
10. **One shift per day**: An employee can only have one shift_assignment per work_date per period

---

## SUPABASE SETUP REQUIREMENTS

- Enable Row Level Security on ALL tables
- Create RLS policies based on profiles.factory_id and profiles.role
- Create database function: `calculate_payroll_entry(period_id, employee_id)` — returns calculated amounts from shift_assignments
- Create database function: `get_period_completeness(period_id)` — returns count of days with data vs total days in period
- Create Supabase Edge Function: `auto_confirm_slips` — updates expired pending tokens to auto_confirmed (run daily)
- Storage bucket: `company-logos` for factory logos (optional)

---

## ENVIRONMENT VARIABLES

```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

---

## PROJECT STRUCTURE

```
src/
├── components/
│   ├── ui/          (shadcn components)
│   ├── layout/      (Sidebar, TopBar, PageHeader)
│   ├── payroll/     (PayrollEntryForm, PaySlipPreview, ShiftColumn)
│   └── shared/      (StatusBadge, EmployeeSelector, PeriodSelector)
├── pages/
│   ├── Dashboard.tsx
│   ├── Employees.tsx
│   ├── ShiftEntry.tsx
│   ├── PayrollEntry.tsx
│   ├── AdvancePayments.tsx
│   ├── PaySlip.tsx
│   ├── Export.tsx
│   ├── Settings.tsx
│   ├── Login.tsx
│   └── EmployeeSlip.tsx   (public, no auth)
├── hooks/
│   ├── useAuth.ts
│   ├── usePayrollCalculation.ts
│   └── useShiftEntry.ts
├── lib/
│   ├── supabase.ts
│   ├── payrollCalc.ts     (pure calculation functions)
│   └── formatters.ts      (Thai number/date formatting)
├── store/
│   └── useAppStore.ts     (Zustand)
└── types/
    └── database.ts        (TypeScript types matching DB schema)
```

---

## IMPORTANT NOTES FOR IMPLEMENTATION

- **Pay Slip header always shows "ห้างหุ้นส่วนจำกัด วิราญกร"** — this is the app owner/payroll processor, hardcoded as a constant. Never pulled from DB.
- **ตราเพชร and TPI are client companies** stored in the `companies` table. Users are scoped to a company via factory → company relationship.
- **Sidebar and app UI** shows the client company name (e.g. "ตราเพชร") as context so users know which company they are working in — but pay slips always show วิราญกร.
- **company_type strategy pattern**: `tra_phet` uses the 8h+4h split logic. `tpi` is a stub for now — same interface, different implementation to be defined in Phase 2. Never mix calculation logic between types.
- All monetary values stored as numeric(12,2) in database — never use float
- Thai language throughout the UI (no English labels visible to end users except technical terms like "Dashboard")
- The /slip/:token page must work without authentication and be mobile-friendly — employees access via LINE on their phones
