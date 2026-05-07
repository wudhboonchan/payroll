# UPDATE PROMPT — LINE Integration Change

## Context
This is an update to the previously built payroll system prototype. LINE Notify is discontinued (as of April 2025). The client will send payslip links manually via LINE. No LINE API integration is needed.

---

## Changes Required

### 1. Remove all LINE API code
- Remove any LINE Notify or LINE Messaging API calls, tokens, webhook handlers, and environment variables related to LINE.
- Remove any `VITE_LINE_*` or `LINE_*` env variables.

### 2. Update `payslip_tokens` table (if not already done)
No schema change needed. The token and link generation logic stays the same. Only the delivery mechanism changes.

### 3. Update the Export / Pay Slip Links page

Replace any "Send via LINE API" button or automated send logic with the following UI:

**"ส่งผ่าน LINE" section layout:**

```
┌─────────────────────────────────────────────────────────┐
│  ลิงค์ Pay Slip งวด [period label]                      │
│  อนุมัติแล้ว — พร้อมส่ง                                 │
├─────────────────────────────────────────────────────────┤
│  [ คัดลอกลิงค์ทั้งหมด ]  [ Export เป็น .txt ]          │
├──────────┬───────────────────────────────┬──────────────┤
│ รหัส     │ ชื่อ                          │ สถานะ        │
├──────────┼───────────────────────────────┼──────────────┤
│ 1001     │ สัมพันธ์ นาทะคำ              │ ⏳ รอยืนยัน  │
│          │ https://app/slip/abc123...    │ [ คัดลอก ]  │
├──────────┼───────────────────────────────┼──────────────┤
│ 1002     │ สมพงษ์ แก้วบุดดา             │ ✅ ยืนยันแล้ว│
│          │ https://app/slip/def456...    │ [ คัดลอก ]  │
├──────────┼───────────────────────────────┼──────────────┤
│ 1003     │ อนัน เนื่องแอม               │ ❌ ทักท้วง  │
│          │ https://app/slip/ghi789...    │ [ คัดลอก ]  │
└──────────┴───────────────────────────────┴──────────────┘
```

### 4. "คัดลอกลิงค์ทั้งหมด" button behavior

When clicked, copy the following formatted text to clipboard:

```
ใบแจ้งค่าแรง [period label] — ห้างหุ้นส่วนจำกัด วิราญกร

1001 สัมพันธ์ นาทะคำ
https://app/slip/abc123

1002 สมพงษ์ แก้วบุดดา
https://app/slip/def456

1003 อนัน เนื่องแอม
https://app/slip/ghi789

กรุณาตรวจสอบและกดยืนยันภายใน 48 ชั่วโมง
หากยอดไม่ถูกต้อง กรุณากดแจ้งในลิงค์ดังกล่าว
```

Show a toast: "คัดลอกลิงค์ทั้งหมดแล้ว — นำไปวางใน LINE ได้เลย"

### 5. "Export เป็น .txt" button behavior

Download a `.txt` file named `payslip_links_[period_label].txt` with the same formatted text as above. Useful as a backup if clipboard fails.

### 6. Individual "คัดลอก" button per row

Copies only that employee's line:
```
[code] [name]
https://app/slip/[token]
```

Show inline confirmation: "คัดลอกแล้ว ✓" that fades after 2 seconds.

### 7. Status display (real-time, auto-refresh every 60s or via Supabase Realtime)

| Status value        | Badge display          | Color  |
|---------------------|------------------------|--------|
| `pending`           | ⏳ รอยืนยัน           | Gray   |
| `confirmed`         | ✅ ยืนยันแล้ว         | Green  |
| `disputed`          | ❌ ทักท้วง            | Red    |
| `auto_confirmed`    | 🔄 ยืนยันอัตโนมัติ    | Blue   |

When status is `disputed`: show the dispute_reason text below the employee's name in the table (in red), so superUser knows what to fix without leaving the page.

### 8. Filter/sort controls above the table

- Filter by status: ทั้งหมด / รอยืนยัน / ยืนยันแล้ว / ทักท้วง
- Sort by: รหัสพนักงาน / ชื่อ / สถานะ
- Search by name or employee code

### 9. "Regenerate link" button (per row, superUser only)

If a token is expired (past 30 days) or the employee requests a new link after disputing:
- Creates a new token (old one invalidated)
- Resets status to `pending`
- Shows the new link immediately for copying

### 10. Summary counters at top

```
ทั้งหมด 87 คน  |  ✅ ยืนยัน 52  |  ⏳ รอ 30  |  ❌ ทักท้วง 5
```

---

## What does NOT change
- The `/slip/:token` public page (employee-facing) remains exactly the same
- Token generation logic remains the same
- 48-hour auto-confirm logic remains the same
- Approval workflow remains the same
- All other pages remain unchanged
