import type { Job } from './model'
import { cleanJobNotes } from './referenceJobs'
import { formatThaiBuddhistDate } from '../../lib/formatters'

const money = (amount: number | null | undefined) => amount == null ? '–' : `฿${amount.toLocaleString('th-TH', { maximumFractionDigits: 2 })}`
function Margin({ billed, paid }: { billed: number | null | undefined; paid: number | null }) {
  if (billed == null || paid == null) return <span className="tpi-job-muted">–</span>
  const difference = billed - paid
  return <span className={`tpi-job-margin ${difference < 0 ? 'is-negative' : ''}`}>{difference >= 0 ? '+' : '−'}{money(Math.abs(difference))}<small>{billed ? (difference / billed * 100).toFixed(0) : 0}%</small></span>
}
export function JobCodeTable({ jobs, onEdit }: { jobs: Job[]; onEdit: (job: Job) => void }) {
  return <div className="tpi-job-table-wrap"><table className="tpi-job-codes-table">
    <colgroup>{[7, 8, 14, 6, 5, 6, 6, 6, 6, 6, 6, 6, 7, 6, 5].map((width, i) => <col key={i} style={{ width: `${width}%` }} />)}</colgroup>
    <thead>
      <tr><th rowSpan={2} scope="col">รหัสงาน</th><th rowSpan={2} scope="col">แผนก / ฝ่าย</th><th rowSpan={2} scope="col">รายละเอียดงาน</th><th rowSpan={2} scope="col">ประเภท</th><th rowSpan={2} scope="col">กลุ่มงาน</th><th rowSpan={2} scope="col" className="tpi-job-quota">ยอดเต็ม</th><th colSpan={2} scope="colgroup" className="tpi-job-group-head">ตั้งเบิก (บาท/กะ)</th><th colSpan={2} scope="colgroup" className="tpi-job-group-head">จ่าย (บาท/กะ)</th><th colSpan={2} scope="colgroup" className="tpi-job-group-head">ส่วนต่าง (บาท/กะ)</th><th rowSpan={2} scope="col">วันหมดอายุ</th><th rowSpan={2} scope="col">สถานะ</th><th rowSpan={2} scope="col">จัดการ</th></tr>
      <tr>{['ตั้งเบิก', 'จ่าย', 'ส่วนต่าง'].flatMap(group => ['ปกติ', 'ฝีมือ'].map((tier, i) => <th key={`${group}-${tier}`} scope="col" aria-label={`${group}${tier}`} className={i === 0 ? 'tpi-job-group-start' : ''}>{tier}</th>))}</tr>
    </thead>
    <tbody>{jobs.length === 0 ? <tr><td colSpan={15}>ไม่พบรหัสงานที่ตรงกับเงื่อนไขการค้นหา</td></tr> : jobs.map(job => {
      const normal = job.billing_normal_rate ?? job.billing_rate
      const skilled = job.billing_skilled_rate
      const special = job.job_type === 'non_billable'
      const clerk = job.job_group === 'clerk' || ['692021', '692032', '692041', '692050'].includes(job.code.trim())
      const notes = cleanJobNotes(job.notes)
      return <tr key={job.id} className={job.active ? '' : 'tpi-job-inactive'}>
        <td className="tpi-job-code"><strong>{job.code}</strong></td>
        <td>{job.department}</td>
        <td className="tpi-job-description"><p>{job.description}</p>{notes && <small>{notes}</small>}</td>
        <td className="tpi-job-center"><span className={`tpi-job-type tpi-job-type-${job.job_type}`}>{special ? 'ไม่ตั้งเบิก' : job.job_type === 'regular' ? 'งานประจำ' : 'งานชั่วคราว'}</span></td>
        <td className="tpi-job-center"><span className={clerk ? 'tpi-job-clerk' : 'tpi-job-general'}>{clerk ? 'เสมียน' : 'ทั่วไป'}</span></td>
        <td className="tpi-job-center tpi-job-quota">{job.quota} <small className="tpi-job-unit">คน</small></td>
        <td className="tpi-job-number tpi-job-group-start tpi-job-billing">{money(special ? 0 : normal)}</td>
        <td className="tpi-job-number tpi-job-billing">{money(special ? 0 : skilled)}</td>
        <td className="tpi-job-number tpi-job-group-start">{money(job.normal_rate)}</td>
        <td className="tpi-job-number">{money(job.skilled_rate)}</td>
        <td className="tpi-job-number tpi-job-group-start">{special ? '–' : <Margin billed={normal} paid={job.normal_rate} />}</td>
        <td className="tpi-job-number">{special ? '–' : <Margin billed={skilled} paid={job.skilled_rate} />}</td>
        <td className="tpi-job-center">{formatThaiBuddhistDate(job.expires_on, 'ไม่มีกำหนด')}</td>
        <td className="tpi-job-center"><span className={`tpi-job-status ${job.active ? 'is-active' : ''}`}>{job.active ? 'เปิดใช้งาน' : 'ยกเลิก'}</span></td>
        <td className="tpi-job-center"><button type="button" className="vk-btn vk-btn-secondary tpi-job-edit" onClick={() => onEdit(job)} aria-label={`แก้ไข ${job.code}`}>แก้ไข</button></td>
      </tr>
    })}</tbody>
  </table></div>
}
