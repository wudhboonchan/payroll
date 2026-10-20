type JobSaveError = { code?: string; message?: string }

export function jobSaveErrorMessage(error: JobSaveError): string {
  const message = error.message || ''
  if (error.code === 'PGRST205' || (error.code === '42P01' && message.includes('tpi_job_codes'))) {
    return 'ยังไม่พบตารางรหัสงาน กรุณาให้ผู้ดูแลระบบตรวจสอบฐานข้อมูล'
  }
  if (error.code === 'PGRST204' || (error.code === '42703' && message.includes('tpi_job_codes'))) {
    return 'ฐานข้อมูลยังไม่รองรับข้อมูลรหัสงานชุดนี้ กรุณาให้ผู้ดูแลระบบติดตั้งการปรับปรุงฐานข้อมูลก่อนบันทึก'
  }
  return `เกิดข้อผิดพลาด: ${message || 'ไม่สามารถบันทึกได้'}`
}
