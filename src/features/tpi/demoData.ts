import type { Employee, Entry, ShiftDay, WageProfile } from './model'
import { referenceJobs } from './referenceJobs'

export const demoJobs = referenceJobs.map((job) => {
  if (job.job_group === 'clerk') {
    return { ...job, normal_rate: 357, skilled_rate: 377 }
  }
  // Add realistic skilled rates for jobs where skilled labor applies
  if (job.code.includes('694014') || job.code.includes('P139') || job.code.includes('693051') || job.code.includes('695010')) {
    return { ...job, skilled_rate: 450 }
  }
  if (job.code.includes('P134') || job.code.includes('P301')) {
    return { ...job, skilled_rate: 400 }
  }
  return { ...job, skilled_rate: job.skilled_rate ?? 380 }
})

export const demoEmployees: Employee[] = [
  { id: 'tpi-emp-01', employee_code: 'TPI-001', first_name: 'สมชาย', last_name: 'สุขเกษม', nationality: 'ไทย', status: 'active', position: 'worker' },
  { id: 'tpi-emp-02', employee_code: 'TPI-002', first_name: 'วิชัย', last_name: 'บุญชู', nationality: 'ไทย', status: 'active', position: 'worker' },
  { id: 'tpi-emp-03', employee_code: 'TPI-003', first_name: 'สมศักดิ์', last_name: 'กิจเจริญ', nationality: 'ไทย', status: 'active', position: 'worker' },
  { id: 'tpi-emp-04', employee_code: 'TPI-004', first_name: 'นงลักษณ์', last_name: 'รักษ์ไทย', nationality: 'ไทย', status: 'active', position: 'clerk' },
  { id: 'tpi-emp-05', employee_code: 'TPI-005', first_name: 'อนุชา', last_name: 'เด่นดวง', nationality: 'ไทย', status: 'active', position: 'worker' },
  { id: 'tpi-emp-06', employee_code: 'TPI-006', first_name: 'กิตติพงษ์', last_name: 'แก้วดี', nationality: 'ไทย', status: 'active', position: 'worker' },
  { id: 'tpi-emp-07', employee_code: 'TPI-007', first_name: 'พงษ์ศิริ', last_name: 'บุญล้อม', nationality: 'ไทย', status: 'active', position: 'worker' },
  { id: 'tpi-emp-08', employee_code: 'TPI-008', first_name: 'ชัยวัฒน์', last_name: 'วงศ์คำ', nationality: 'ไทย', status: 'active', position: 'worker' },
  { id: 'tpi-emp-09', employee_code: 'TPI-009', first_name: 'สุดารัตน์', last_name: 'มณีวรรณ', nationality: 'ไทย', status: 'active', position: 'clerk' },
  { id: 'tpi-emp-10', employee_code: 'TPI-010', first_name: 'ธีระพงษ์', last_name: 'สว่างดี', nationality: 'ไทย', status: 'active', position: 'worker' },
  { id: 'tpi-emp-11', employee_code: 'TPI-011', first_name: 'ประเสริฐ', last_name: 'ยืนยง', nationality: 'ไทย', status: 'active', position: 'worker' },
  { id: 'tpi-emp-12', employee_code: 'TPI-012', first_name: 'ณรงค์ศักดิ์', last_name: 'สุริยา', nationality: 'ไทย', status: 'active', position: 'worker' },
  { id: 'tpi-emp-13', employee_code: 'TPI-013', first_name: 'วรรณพร', last_name: 'ศรีสุข', nationality: 'ไทย', status: 'active', position: 'worker' },
  { id: 'tpi-emp-14', employee_code: 'TPI-014', first_name: 'เอกชัย', last_name: 'พึ่งพา', nationality: 'ไทย', status: 'active', position: 'worker' },
  { id: 'tpi-emp-15', employee_code: 'TPI-015', first_name: 'มานพ', last_name: 'ศรทอง', nationality: 'ไทย', status: 'active', position: 'worker' },
  { id: 'tpi-emp-16', employee_code: 'TPI-016', first_name: 'Aung', last_name: 'Kyaw', nationality: 'พม่า', status: 'active', position: 'worker' },
  { id: 'tpi-emp-17', employee_code: 'TPI-017', first_name: 'Kyaw', last_name: 'Swar', nationality: 'พม่า', status: 'active', position: 'worker' },
  { id: 'tpi-emp-18', employee_code: 'TPI-018', first_name: 'Min', last_name: 'Thu', nationality: 'พม่า', status: 'active', position: 'worker' },
  { id: 'tpi-emp-19', employee_code: 'TPI-019', first_name: 'Thura', last_name: 'Zaw', nationality: 'พม่า', status: 'active', position: 'worker' },
  { id: 'tpi-emp-20', employee_code: 'TPI-020', first_name: 'Soe', last_name: 'Lin', nationality: 'พม่า', status: 'active', position: 'worker' },
  { id: 'tpi-emp-21', employee_code: 'TPI-021', first_name: 'Zaw', last_name: 'Myo', nationality: 'พม่า', status: 'active', position: 'worker' },
  { id: 'tpi-emp-22', employee_code: 'TPI-022', first_name: 'Myo', last_name: 'Min', nationality: 'พม่า', status: 'active', position: 'worker' },
  { id: 'tpi-emp-23', employee_code: 'TPI-023', first_name: 'Sokha', last_name: 'Chan', nationality: 'กัมพูชา', status: 'active', position: 'worker' },
  { id: 'tpi-emp-24', employee_code: 'TPI-024', first_name: 'Bunna', last_name: 'Heng', nationality: 'กัมพูชา', status: 'active', position: 'worker' },
  { id: 'tpi-emp-25', employee_code: 'TPI-025', first_name: 'Vanna', last_name: 'Seng', nationality: 'กัมพูชา', status: 'active', position: 'worker' },
  { id: 'tpi-emp-26', employee_code: 'TPI-026', first_name: 'สมเกียรติ', last_name: 'มีสุข', nationality: 'ไทย', status: 'active', position: 'worker' },
  { id: 'tpi-emp-27', employee_code: 'TPI-027', first_name: 'บุญเลิศ', last_name: 'ทองคำ', nationality: 'ไทย', status: 'active', position: 'worker' },
  { id: 'tpi-emp-28', employee_code: 'TPI-028', first_name: 'สุชาติ', last_name: 'ชัยชนะ', nationality: 'ไทย', status: 'active', position: 'worker' },
  { id: 'tpi-emp-29', employee_code: 'TPI-029', first_name: 'ศิริพร', last_name: 'วงศ์ษา', nationality: 'ไทย', status: 'active', position: 'worker' },
  { id: 'tpi-emp-30', employee_code: 'TPI-030', first_name: 'พัชรี', last_name: 'เจริญผล', nationality: 'ไทย', status: 'active', position: 'worker' },
  { id: 'tpi-emp-31', employee_code: 'TPI-031', first_name: 'Tun', last_name: 'Naing', nationality: 'พม่า', status: 'active', position: 'worker' },
  { id: 'tpi-emp-32', employee_code: 'TPI-032', first_name: 'Ko', last_name: 'Latt', nationality: 'พม่า', status: 'active', position: 'worker' },
  { id: 'tpi-emp-33', employee_code: 'TPI-033', first_name: 'Win', last_name: 'Htet', nationality: 'พม่า', status: 'active', position: 'worker' },
  { id: 'tpi-emp-34', employee_code: 'TPI-034', first_name: 'Hla', last_name: 'Myint', nationality: 'พม่า', status: 'active', position: 'worker' },
  { id: 'tpi-emp-35', employee_code: 'TPI-035', first_name: 'Phyo', last_name: 'Wai', nationality: 'พม่า', status: 'active', position: 'worker' },
  { id: 'tpi-emp-36', employee_code: 'TPI-036', first_name: 'Chann', last_name: 'Dara', nationality: 'กัมพูชา', status: 'active', position: 'worker' },
  { id: 'tpi-emp-37', employee_code: 'TPI-037', first_name: 'Rithy', last_name: 'Sam', nationality: 'กัมพูชา', status: 'active', position: 'worker' },
  { id: 'tpi-emp-38', employee_code: 'TPI-038', first_name: 'Pich', last_name: 'Sophal', nationality: 'กัมพูชา', status: 'active', position: 'worker' },
  { id: 'tpi-emp-39', employee_code: 'TPI-039', first_name: 'บดินทร์', last_name: 'แซ่หล่อ', nationality: 'ไทย', status: 'active', position: 'worker' },
  { id: 'tpi-emp-40', employee_code: 'TPI-040', first_name: 'เจษฎา', last_name: 'สืบวงศ์', nationality: 'ไทย', status: 'active', position: 'worker' },
]

export const demoWageProfiles: WageProfile[] = [
  { employee_id: 'tpi-emp-01', factory_id: 'demo', rate_tier: 'skilled', skilled_from: '2026-01-01', updated_at: '2026-01-01T00:00:00Z' },
  { employee_id: 'tpi-emp-02', factory_id: 'demo', rate_tier: 'skilled', skilled_from: '2026-02-01', updated_at: '2026-02-01T00:00:00Z' },
  { employee_id: 'tpi-emp-05', factory_id: 'demo', rate_tier: 'skilled', skilled_from: '2026-03-01', updated_at: '2026-03-01T00:00:00Z' },
  { employee_id: 'tpi-emp-16', factory_id: 'demo', rate_tier: 'skilled', skilled_from: '2026-01-15', updated_at: '2026-01-15T00:00:00Z' },
  { employee_id: 'tpi-emp-17', factory_id: 'demo', rate_tier: 'skilled', skilled_from: '2026-02-15', updated_at: '2026-02-15T00:00:00Z' },
  { employee_id: 'tpi-emp-26', factory_id: 'demo', rate_tier: 'skilled', skilled_from: '2026-01-01', updated_at: '2026-01-01T00:00:00Z' },
  { employee_id: 'tpi-emp-31', factory_id: 'demo', rate_tier: 'skilled', skilled_from: '2026-02-01', updated_at: '2026-02-01T00:00:00Z' },
]

// Sample initial assignments
export const demoInitialEntries: Entry[] = [
  // 690003 (reference-0) — Research & Development (ยอด 1: เช้า 1) [ครบ]
  { employee_id: 'tpi-emp-26', shift_index: 0, job_id: 'reference-0' },

  // 690102 (reference-1) — Batching Plant (ยอด 2: เช้า 2) [ครบ]
  { employee_id: 'tpi-emp-27', shift_index: 0, job_id: 'reference-1' },
  { employee_id: 'tpi-emp-28', shift_index: 0, job_id: 'reference-1' },

  // 692021 (reference-2) — FCB Warehouse (ยอด 1: เช้า 1) [ครบ]
  { employee_id: 'tpi-emp-29', shift_index: 0, job_id: 'reference-2' },

  // 692041 (reference-4) — Export เสมียนรับสินค้า (ยอดเต็ม 8: เช้า 3, บ่าย 3, ดึก 2) [ครบ 8/8]
  { employee_id: 'tpi-emp-05', shift_index: 0, job_id: 'reference-4' },
  { employee_id: 'tpi-emp-06', shift_index: 0, job_id: 'reference-4' },
  { employee_id: 'tpi-emp-17', shift_index: 0, job_id: 'reference-4' },
  { employee_id: 'tpi-emp-07', shift_index: 1, job_id: 'reference-4' },
  { employee_id: 'tpi-emp-08', shift_index: 1, job_id: 'reference-4' },
  { employee_id: 'tpi-emp-31', shift_index: 1, job_id: 'reference-4' },
  { employee_id: 'tpi-emp-18', shift_index: 2, job_id: 'reference-4' },
  { employee_id: 'tpi-emp-32', shift_index: 2, job_id: 'reference-4' },

  // 694014/VRK (reference-7) — CRT ผลิตครอบ (ยอดเต็ม 6: เช้า 6 ในภาพ หรือ เช้า 2 บ่าย 2 ดึก 2) [ครบ 6/6]
  { employee_id: 'tpi-emp-01', shift_index: 0, job_id: 'reference-7' },
  { employee_id: 'tpi-emp-01', shift_index: 1, job_id: 'reference-7' }, // 2 shifts
  { employee_id: 'tpi-emp-02', shift_index: 0, job_id: 'reference-7' },
  { employee_id: 'tpi-emp-03', shift_index: 1, job_id: 'reference-7' },
  { employee_id: 'tpi-emp-04', shift_index: 2, job_id: 'reference-7' },
  { employee_id: 'tpi-emp-16', shift_index: 2, job_id: 'reference-7' },

  // 694016 (reference-8) — CRT Packing ครอบ (ยอดเต็ม 3: เช้า 2, บ่าย 1) [ครบ 3/3]
  { employee_id: 'tpi-emp-33', shift_index: 0, job_id: 'reference-8' },
  { employee_id: 'tpi-emp-34', shift_index: 0, job_id: 'reference-8' },
  { employee_id: 'tpi-emp-35', shift_index: 1, job_id: 'reference-8' },

  // 695010/VRK (reference-9) — QC FCB Finishing (ยอดเต็ม 6: เช้า 2, บ่าย 2, ดึก 2) [ครบ 6/6]
  { employee_id: 'tpi-emp-36', shift_index: 0, job_id: 'reference-9' },
  { employee_id: 'tpi-emp-37', shift_index: 0, job_id: 'reference-9' },
  { employee_id: 'tpi-emp-38', shift_index: 1, job_id: 'reference-9' },
  { employee_id: 'tpi-emp-39', shift_index: 1, job_id: 'reference-9' },
  { employee_id: 'tpi-emp-40', shift_index: 2, job_id: 'reference-9' },
  { employee_id: 'tpi-emp-11', shift_index: 2, job_id: 'reference-9' },

  // P134/69 (reference-15) — CRT พ่นและแพ็คกระเบื้อง (ยอดเต็ม 7: ลงแล้ว 4/7) [ยังไม่ครบ ขาดอีก 3]
  { employee_id: 'tpi-emp-09', shift_index: 0, job_id: 'reference-15' },
  { employee_id: 'tpi-emp-10', shift_index: 0, job_id: 'reference-15' },
  { employee_id: 'tpi-emp-19', shift_index: 0, job_id: 'reference-15' },
  { employee_id: 'tpi-emp-20', shift_index: 0, job_id: 'reference-15' },

  // P139/69 (reference-16) — CRT ขับรถยก Support (ยอดเต็ม 3: ลงแล้ว 2/3: เช้า 1, บ่าย 1) [ยังไม่ครบ ขาดอีก 1]
  { employee_id: 'tpi-emp-21', shift_index: 0, job_id: 'reference-16' },
  { employee_id: 'tpi-emp-22', shift_index: 1, job_id: 'reference-16' },

  // P301/69 (reference-17) — Finishing จัดเตรียมสินค้า (ยอดเต็ม 6: ลงแล้ว 6/6) [ครบ 6/6]
  { employee_id: 'tpi-emp-12', shift_index: 0, job_id: 'reference-17' },
  { employee_id: 'tpi-emp-13', shift_index: 0, job_id: 'reference-17' },
  { employee_id: 'tpi-emp-14', shift_index: 1, job_id: 'reference-17' },
  { employee_id: 'tpi-emp-15', shift_index: 1, job_id: 'reference-17' },
  { employee_id: 'tpi-emp-23', shift_index: 2, job_id: 'reference-17' },
  { employee_id: 'tpi-emp-24', shift_index: 2, job_id: 'reference-17' },
]

export const createDefaultPreviewState = (): ShiftDay => ({
  revision: 1,
  entries: [...demoInitialEntries],
})

