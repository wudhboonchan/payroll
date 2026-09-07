import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '../../store/useAppStore'
import { errorMessage, tpiDb } from './api'
import { localDate, type WageProfile, type RateTier } from './model'
export function WageFields({profile,onSave}:{profile?:WageProfile;onSave:(tier:RateTier,date:string|null)=>Promise<void>}) {
 const [tier,setTier]=useState<RateTier>(profile?.rate_tier||'normal')
 const [date,setDate]=useState(profile?.skilled_from||localDate())
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false)
 return <fieldset className="tpi-wage-fields"><legend>เรทค่าแรง</legend><p>เลือกประจำตัวพนักงานครั้งเดียว ระบบใช้เรทนี้กับทุกรหัสงานตามวันที่มีผล</p><div>
 <label><input type="radio" name="tpi-rate-tier" value="normal" checked={tier==='normal'} onChange={()=>setTier('normal')}/> ค่าแรงปกติ (ยังไม่ผ่านโปร)</label>
 <label><input type="radio" name="tpi-rate-tier" value="skilled" checked={tier==='skilled'} onChange={()=>setTier('skilled')}/> ค่าแรงฝีมือ (ผ่านโปรแล้ว)</label></div>
 {tier==='skilled'&&<label>วันที่เริ่มใช้เรทฝีมือ<input className="vk-input" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>}
 <p>ปกติเริ่มต้น 357 บาท/กะ · ฝีมือตามรหัสงาน · กะที่บันทึกแล้วคงเรทเดิม</p>
 <button className="vk-btn" type="button" disabled={busy||(tier==='skilled'&&!date)} onClick={async()=>{setBusy(true);setMessage('');try{await onSave(tier,tier==='skilled'?date:null);setMessage('บันทึกเรทพนักงานแล้ว')}catch(e){setMessage(errorMessage(e))}finally{setBusy(false)}}}>{busy?'กำลังบันทึก...':'บันทึกเรทพนักงาน'}</button><p role="status">{message}</p></fieldset>
}
export function EmployeeWageSelector({employeeId}:{employeeId:string|null}) {
 const {user}=useAppStore();const factory=user?.factory_id||'';const client=useQueryClient()
 const query=useQuery({queryKey:['tpi-employee-wage',factory,employeeId],enabled:!!factory&&!!employeeId,queryFn:async()=>{const {data,error}=await tpiDb.from('tpi_employee_wage_profiles').select('*').eq('employee_id',employeeId!).eq('factory_id',factory).maybeSingle();if(error)throw error;return data}})
 if(!employeeId)return <p className="tpi-hint">พนักงานใหม่เริ่มด้วยเรทปกติ 357 บาทต่อกะตามรหัสงาน บันทึกพนักงานก่อน แล้วเลือกเรทฝีมือเมื่อผ่านโปร</p>
 if(query.isPending)return <p>กำลังโหลดเรทค่าแรง...</p>
 if(query.error)return <p role="alert">โหลดเรทค่าแรงไม่สำเร็จ: {errorMessage(query.error)}</p>
 return <WageFields key={`${employeeId}:${query.data?.updated_at}`} profile={query.data||undefined} onSave={async(rate_tier,skilled_from)=>{const {error}=await tpiDb.from('tpi_employee_wage_profiles').upsert({employee_id:employeeId,factory_id:factory,rate_tier,skilled_from});if(error)throw error;await client.invalidateQueries({queryKey:['tpi-employee-wage',factory,employeeId]});await client.invalidateQueries({queryKey:['tpi-profiles',factory]})}}/>
}
