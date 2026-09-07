import { useState } from 'react'
import { TpiDialog } from './Dialog'
import { referenceJobs } from './referenceJobs'
import { localDate, type Job } from './model'
import { errorMessage } from './api'
export function JobManager({jobs,onSave,onImport,onClose}:{jobs:Job[];onSave:(job:Job)=>Promise<void>;onImport:()=>Promise<void>;onClose:()=>void}) {
 const [editing,setEditing]=useState<Job|null>(null)
 const [search,setSearch]=useState('')
 const [error,setError]=useState('')
 const [busy,setBusy]=useState(false)
 async function importJobs(){setBusy(true);setError('');try{await onImport()}catch(e){setError(errorMessage(e))}finally{setBusy(false)}}
 return <TpiDialog title="ฐานข้อมูลรหัสงาน" onClose={onClose}>
  {editing ? <JobForm key={editing.id} job={editing} onSave={onSave} onClose={()=>setEditing(null)}/> : <div className="tpi-dialog-body">
   <div className="tpi-manager-toolbar"><input className="vk-input" aria-label="ค้นหารหัสงาน" placeholder="ค้นหารหัสงาน / แผนก / รายละเอียด" value={search} onChange={e=>setSearch(e.target.value)}/><button className="vk-btn vk-btn--primary" onClick={()=>setEditing({...referenceJobs[0],id:'',code:'',department:'',description:'',quota:0,planned_morning:null,planned_afternoon:null,planned_night:null,notes:'',valid_from:localDate()})}>เพิ่มรหัสงาน</button></div>
   <p className="tpi-hint">ค่าแรงเป็นบาทต่อกะ · แผนรายกะเป็นแนวทาง สามารถจัดแรงจริงต่างจากแผนได้ · ปิดใช้งานแทนการลบเพื่อรักษาประวัติ</p>
   {error&&<p role="alert">{error}</p>}
   <div className="tpi-job-table"><table><thead><tr><th>รหัสงาน / แผนก</th><th>ยอดเต็ม</th><th>ค่าแรงปกติ</th><th>ค่าแรงฝีมือ</th><th>หมดอายุ</th><th>สถานะ</th><th/></tr></thead><tbody>{jobs.filter(j=>`${j.code} ${j.department} ${j.description}`.toLowerCase().includes(search.toLowerCase())).map(j=><tr key={j.id}><td><strong>{j.code}</strong><small>{j.department}</small><small>{j.description}</small></td><td>{j.quota}</td><td>฿{j.normal_rate.toLocaleString()}</td><td>{j.skilled_rate ? `฿${j.skilled_rate.toLocaleString()}` : '—'}</td><td>{j.expires_on || 'ไม่กำหนด'}</td><td>{!j.active?'ปิดใช้งาน':j.expires_on && j.expires_on < localDate()?'หมดอายุ':'ใช้งาน'}</td><td><button className="vk-btn" onClick={()=>setEditing(j)}>แก้ไข {j.code}</button></td></tr>)}</tbody></table></div>
   {jobs.length===0&&<p>ยังไม่มีรหัสงาน เพิ่มเองหรือนำเข้ารายการจากภาพที่แนบ</p>}
   <details className="tpi-source-review"><summary>รายการจากภาพ 25 รหัส · ตรวจทานก่อนนำเข้า</summary><p>งานประจำ 40 แรง และชั่วคราว 73 แรง รวม 113 แรง ค่าแรงปกติ 357 บาท ค่าแรงฝีมือยังไม่กำหนด ตัวเลขเขียนมือเป็นยอดใช้ในวันของเอกสาร ไม่ใช่ยอดใช้วันนี้</p><ul>{referenceJobs.map(j=><li key={j.code}>{j.code} · {j.department} · {j.quota} แรง · หมดอายุ {j.expires_on || 'ไม่ระบุ'}</li>)}</ul><button className="vk-btn" disabled={busy} onClick={importJobs}>{busy?'กำลังนำเข้า...':'นำเข้ารหัสที่ยังไม่มีจากภาพ'}</button><p>รหัสที่มีอยู่แล้วจะไม่ถูกเขียนทับ รายการที่ระบุ “หยุด” ในภาพยังต้องตรวจสอบก่อนใช้งานจริง</p></details>
  </div>}
 </TpiDialog>
}
function JobForm({job,onSave,onClose}:{job:Job;onSave:(j:Job)=>Promise<void>;onClose:()=>void}) {
 const [form,setForm]=useState(job),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const patch=(value:Partial<Job>)=>setForm(p=>({...p,...value}))
 return <form onSubmit={async e=>{e.preventDefault();setError('');if(form.job_type==='temporary'&&!form.expires_on){setError('งานชั่วคราวต้องมีวันหมดอายุ');return}if(form.valid_from&&form.expires_on&&form.expires_on<form.valid_from){setError('วันหมดอายุต้องไม่ก่อนวันเริ่ม');return}setBusy(true);try{await onSave({...form,code:form.code.trim()});onClose()}catch(err){setError(errorMessage(err))}finally{setBusy(false)}}}>
 <div className="tpi-dialog-body tpi-form-grid">
 <label>รหัสงาน<input required className="vk-input" value={form.code} onChange={e=>patch({code:e.target.value})}/></label>
 <label>แผนก / ฝ่าย<input className="vk-input" value={form.department} onChange={e=>patch({department:e.target.value})}/></label>
 <label className="tpi-wide">รายละเอียดงาน<textarea className="vk-input" value={form.description} onChange={e=>patch({description:e.target.value})}/></label>
 <label>ประเภทงาน<select className="vk-input" value={form.job_type} onChange={e=>patch({job_type:e.target.value as Job['job_type']})}><option value="regular">งานประจำ</option><option value="temporary">งานชั่วคราว</option></select></label>
 <label>ยอดเต็ม (แรงต่อวัน)<input className="vk-input" type="number" required min="0" step="1" value={form.quota} onChange={e=>patch({quota:Number(e.target.value)})}/></label>
 <label>วันที่เริ่มใช้<input className="vk-input" type="date" value={form.valid_from||''} onChange={e=>patch({valid_from:e.target.value||null})}/></label>
 <label>วันหมดอายุ (รวมวันนี้)<input className="vk-input" type="date" required={form.job_type==='temporary'} value={form.expires_on||''} onChange={e=>patch({expires_on:e.target.value||null})}/></label>
 <label>ค่าแรงปกติ (บาท/กะ)<input className="vk-input" required type="number" min="0" step="0.01" value={form.normal_rate} onChange={e=>patch({normal_rate:Number(e.target.value)})}/></label>
 <label>ค่าแรงฝีมือ (บาท/กะ)<input className="vk-input" type="number" min="0" step="0.01" placeholder="ยังไม่กำหนด" value={form.skilled_rate??''} onChange={e=>patch({skilled_rate:e.target.value===''?null:Number(e.target.value)})}/></label>
 <label className="tpi-wide">หมายเหตุ<textarea className="vk-input" value={form.notes} onChange={e=>patch({notes:e.target.value})}/></label>
 <label className="tpi-wide"><span><input type="checkbox" checked={form.active} onChange={e=>patch({active:e.target.checked})}/> เปิดใช้งานรหัสงาน</span></label>
 {error&&<p className="tpi-wide" role="alert">{error}</p>}
 </div><footer><button className="vk-btn" type="button" disabled={busy} onClick={onClose}>ยกเลิก</button><button className="vk-btn vk-btn--primary" disabled={busy}>{busy?'กำลังบันทึก...':'บันทึกรหัสงาน'}</button></footer></form>
}
