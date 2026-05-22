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
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: window.location.href })
    return null // กำลัง redirect — component จะไม่ render ต่อ
  }
  return liff.getProfile()
}

export function isInLineClient(): boolean {
  return liff.isInClient()
}
