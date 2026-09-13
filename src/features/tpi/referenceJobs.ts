import type { Job } from './model'
// Transcribed from user-supplied request sheet dated 2 September 2569.
// Printed A/B/C are planned allocations; handwriting is historical actual usage, not today's assignments.
const rows: [string,string,string,number,number[] | null,string,string | null,string][] = [
 ['690003','Research & Development','งานทดลองผลิตภัณฑ์ RD และเป็นผู้ช่วยงานเทคนิคทดลองวัตถุดิบ Line 1–4',1,[1,0,0],'D1',null,'1 กะ/5 วัน'],
 ['690102','Batching Plant','โครงการรถไฟฟ้าความเร็วสูงช่วงสระบุรี–แก่งคอย',2,[2,0,0],'A2',null,''],
 ['692021','FCB Warehouse','เสมียนรับจ่ายสินค้า FCB Warehouse',1,[1,0,0],'A1',null,''],
 ['692032','CRT Warehouse','เสมียนรับจ่ายสินค้า CRT Warehouse',1,[1,0,0],'A1',null,''],
 ['692041','Export','เสมียนรับสินค้าเข้าคลัง',8,[4,4,0],'A4,B4',null,'7 วัน/สัปดาห์; ในภาพใช้จริง เช้า 3 บ่าย 3 ดึก 2'],
 ['692050','Raw Material','เสมียนรับ–จ่ายวัตถุดิบและบรรจุภัณฑ์',1,[1,0,0],'A1',null,''],
 ['693051/VRK','Vehicle & General','งานผู้ช่วยช่าง',3,[3,0,0],'D3',null,'6 วัน/สัปดาห์'],
 ['694014/VRK','CRT / Special Line','งานผลิตครอบ',6,[2,2,2],'A2,B2,C2',null,'3 กะ/7 วัน; ในภาพใช้จริง เช้า 6 บ่าย 0 ดึก 0'],
 ['694016','CRT / Special Line','งาน Packing ครอบ',3,[3,0,0],'A3',null,'1 กะ/7 วัน; ในภาพใช้จริง เช้า 2 บ่าย 1'],
 ['695010/VRK','QC FCB Finishing & Coating','งานคัดแยกของเสีย Coating Line 3,4,6 ETEX 1,2,3 (Finishing)',6,[2,2,2],'A2,B2,C2',null,'3 กะ/5 วัน'],
 ['695020','QC CRT','งานคัดแยกเกรด F ท้าย Line 1,5 CRT',2,[2,0,0],'A2',null,'1 กะ/5 วัน = 1 คน และ 1 กะ/7 วัน = 1 คน'],
 ['696055','WIP & Facility','งานควบคุมงานแพ็ค WIP (หยุดวันอาทิตย์)',1,[1,0,0],'D1',null,'6 วัน/สัปดาห์'],
 ['697004','Cutting & Profiling','งานยกชิ้นงานเข้า–ออก ยกแผ่นรอง Section 11 Water Jet + Punching',3,[3,0,0],'A3',null,'จันทร์–ศุกร์; 1 กะ/5 วัน'],
 ['697032','Furniture','งานพ่นน้ำส้มควันไม้และประทับตราพาเลท Dryer',2,[1,1,0],'A1,B1',null,'2 กะ/วัน'],
 ['P133/69','CRT / Special Line','งานซ่อมสีหลังคาคอนกรีต CRT',2,[2,0,0],'A2','2026-09-30','เริ่ม 10/1/69; อังคาร–เสาร์ 1 กะ/5 วัน'],
 ['P134/69','CRT / Special Line','พ่นและแพ็คกระเบื้องปูพื้น 40 × 40 × 3.5',7,[0,7,0],'B7','2026-09-30','ในภาพใช้จริง เช้า 7'],
 ['P139/69','CRT / Special Line','ขับรถยก Support ผลิตครอบ Nakano 1,2 และผลิตครอบสันโค้ง',3,[1,1,1],'A1,B1,C1','2026-09-30','ในภาพยอดใช้ 2 เช้า 1 บ่าย 1'],
 ['P301/69','Finishing','สำหรับงานจัดเตรียมสินค้าเกรด QI,B,X ส่งขาย',6,[2,2,2],'A2,B2,C2','2026-09-30','เริ่ม 22/6/69; 3 กะ/7 วัน'],
 ['P3107/69','Finishing / Cutting & Profiling','งานยกชิ้นงานเข้า–ออก ยกแผ่นรองเครื่องจักร Water Jet',3,[0,3,0],'B3','2026-09-30','เริ่ม 11/8/69 กะบ่าย 1 กะ/5 วัน; ในภาพใช้จริงกะบ่าย 3'],
 ['P315/69VRK','Finishing / Cutting & Profiling','งานยกชิ้นงานเข้า–ออก Feed-In, Feed-Out Section 8+13',12,[6,6,0],'A6,B6','2026-09-30','2 กะ/5 วัน'],
 ['P322/69VRK','Finishing / Packaging','งาน BGC 3 Flooring Line Section 16',8,[4,4,0],'A4,B4','2026-09-30','เริ่ม 26/6/69; 2 กะ/5 วัน'],
 ['P422/69','Coating Process / Fibre Cement Coating','สำหรับเดินงาน Coating Line 6',24,[8,8,8],'A8,B8,C8','2026-09-30','3 กะ/5 วัน'],
 ['Q121/69','Quality Control / QC FCB Finishing & Coating','คัดแยกของเสีย Sec15 (BGC2)',6,[2,2,2],'A2,B2,C2','2026-09-27','เฉพาะเสาร์–อาทิตย์'],
 ['Q131/69','Quality Control / QC CRT','คัดงานกระเบื้องพื้น Line 2',1,[0,1,0],'B1','2026-10-31','5 วัน/สัปดาห์'],
 ['Q132/69','Quality Control / QC CRT','คัดแยกงานกระเบื้องครอบท้ายไลน์',1,[1,0,0],'A1','2026-09-30','เฉพาะกะที่ว่าง'],
]
export const departmentSectionMap: Record<string, string> = {
  'Research & Development': 'Research & Standard',
  'Batching Plant': 'Cement Plant Operate',
  'FCB Warehouse': 'Plant Administration',
  'CRT Warehouse': 'Plant Administration',
  'Export': 'Plant Administration',
  'Raw Material': 'Plant Administration',
  'Vehicle & General': 'Mechanical',
  'Special Line': 'CRT',
  'QC FCB Finishing & Coating': 'Quality Control',
  'QC CRT': 'Quality Control',
  'WIP & Facility': 'MFL Production',
  'Cutting & Profiling': 'Finishing',
  'Furniture': 'Finishing'
}

export function getMainDepartment(job: Job): string {
  if (job.job_type === 'regular') {
    return departmentSectionMap[job.department] || job.department
  }
  // For temporary jobs, simplify to clean section title
  if (job.department.startsWith('Quality Control')) return 'Quality Control'
  if (job.department.startsWith('Finishing / Packaging')) return 'Finishing / Packaging'
  if (job.department.startsWith('Finishing / Cutting & Profiling')) return 'Finishing / Cutting & Profiling'
  if (job.department.startsWith('Finishing')) return 'Finishing'
  if (job.department.startsWith('Coating Process')) return 'Coating Process'
  if (job.department.startsWith('CRT')) return 'CRT / Special Line'
  return job.department
}

export function cleanJobNotes(rawNotes?: string | null): string {
  if (!rawNotes) return ''
  let s = rawNotes
    .replace(/อ้างอิงภาพวันที่\s*2\/9\/2569\s*·?\s*/g, '')
    .replace(/กะตามเอกสาร:\s*[^·\n\r]*(\(ยังไม่ยืนยันความหมายรหัส D จึงเว้นแผนรายกะ\))?\s*·?\s*/g, '')
    .replace(/;?\s*(ในภาพ)?ระบุหยุด/g, '')
    .trim()
  s = s.replace(/^[·\s;-]+|[·\s;-]+$/g, '').trim()
  return s
}

export const CLERK_JOB_CODES = new Set(['692021', '692032', '692041', '692050'])

export const referenceJobs: Job[] = rows.map(([code,department,description,quota,plan,source,expiry,notes],i)=>{
 const isClerk = CLERK_JOB_CODES.has(code)
 return {
  id:`reference-${i}`,factory_id:'preview',code,department,description,quota,
  planned_morning:plan?.[0] ?? null,planned_afternoon:plan?.[1] ?? null,planned_night:plan?.[2] ?? null,
  job_type:expiry?'temporary':'regular',valid_from:null,expires_on:expiry,
  job_group: isClerk ? 'clerk' : 'general',
  normal_rate: 357,
  skilled_rate: isClerk ? 377 : null,
  active: true,
  updated_at:'',
  notes: notes ? cleanJobNotes(notes) : '',
 }
})
