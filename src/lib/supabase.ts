import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

// ใช้ proxy ผ่าน domain ของเราเอง เพื่อหลีกเลี่ยง AdGuard/extension block
const supabaseUrl = `${window.location.origin}/supabase-api`
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

// ลบ session เก่าที่ถูก key แบบเดิม (direct URL) เพื่อไม่ให้ conflict กับ proxy key ใหม่
const OLD_SESSION_KEY = 'sb-nlyumhbzlruhpcorwswk-auth-token'
if (typeof window !== 'undefined' && localStorage.getItem(OLD_SESSION_KEY)) {
  localStorage.removeItem(OLD_SESSION_KEY)
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // app ใช้ email/password เท่านั้น ไม่ใช้ magic link หรือ OAuth
  },
  realtime: {
    params: { eventsPerSecond: 2 }, // ลด WebSocket load ไม่ให้ Chrome throttle
  },
})
