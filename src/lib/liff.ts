import liff from '@line/liff'

const LIFF_ID = import.meta.env.VITE_LIFF_ID as string

let initialized = false

export async function initLiff(): Promise<void> {
  if (initialized) return
  await liff.init({ liffId: LIFF_ID })
  initialized = true
}

export async function getLiffProfile(): Promise<{ userId: string; displayName: string; pictureUrl?: string } | null> {
  await initLiff()
  // ถ้าอยู่ใน LINE app → LINE จัดการ auth ให้อัตโนมัติ ไม่ต้อง login()
  // ถ้าเปิดจาก browser ปกติ → redirect ไปหน้า LINE Login
  if (!liff.isInClient() && !liff.isLoggedIn()) {
    liff.login({ redirectUri: window.location.href })
    return null
  }
  return liff.getProfile()
}

export function isInLineClient(): boolean {
  return liff.isInClient()
}
