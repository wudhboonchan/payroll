import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { TopBar } from '../components/layout/TopBar'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Label } from '../components/ui/label'
import { KeyRound, Save, Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

export default function Settings() {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault()

    if (newPassword.length < 6) {
      toast.error('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร')
      return
    }

    if (newPassword !== confirmPassword) {
      toast.error('รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน')
      return
    }

    setIsLoading(true)
    setIsSuccess(false)

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      })

      if (error) throw error

      toast.success('เปลี่ยนรหัสผ่านสำเร็จ')
      setIsSuccess(true)
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: unknown) {
      console.error(err)
      const error = err as Error
      toast.error('ไม่สามารถเปลี่ยนรหัสผ่านได้', {
        description: error.message
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <TopBar title="ตั้งค่าระบบ" />
      
      <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-5">
            <CardTitle className="text-xl flex items-center gap-2 text-slate-800">
              <KeyRound className="w-5 h-5 text-blue-500" />
              เปลี่ยนรหัสผ่าน
            </CardTitle>
            <CardDescription className="text-slate-500">
              ตั้งค่ารหัสผ่านใหม่สำหรับการเข้าสู่ระบบของคุณ รหัสผ่านควรมีความยาวอย่างน้อย 6 ตัวอักษร
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            {isSuccess && (
              <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-emerald-800">รหัสผ่านถูกเปลี่ยนแล้ว</h4>
                  <p className="text-sm text-emerald-700 mt-1">
                    รหัสผ่านบัญชีของคุณได้รับการอัปเดตเรียบร้อยแล้ว กรุณาใช้รหัสผ่านใหม่ในการเข้าสู่ระบบครั้งต่อไป
                  </p>
                </div>
              </div>
            )}

            <form onSubmit={handleUpdatePassword} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="new-password">รหัสผ่านใหม่</Label>
                <Input
                  id="new-password"
                  type="password"
                  placeholder="••••••••"
                  className="h-12 bg-white"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={isLoading}
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="confirm-password">ยืนยันรหัสผ่านใหม่</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  placeholder="••••••••"
                  className="h-12 bg-white"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isLoading}
                  required
                />
              </div>

              <div className="pt-4">
                <Button 
                  type="submit" 
                  className="w-full md:w-auto md:min-w-[200px] h-12 text-base font-bold bg-[#1D9E75] hover:bg-[#157a5a] rounded-xl transition-all active:scale-[0.98]"
                  disabled={isLoading || !newPassword || !confirmPassword}
                >
                  {isLoading ? (
                    <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> กำลังบันทึก...</>
                  ) : (
                    <><Save className="w-5 h-5 mr-2" /> บันทึกรหัสผ่านใหม่</>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
