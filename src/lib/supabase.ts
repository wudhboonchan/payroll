import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

// ในโหมดพัฒนาบน localhost ให้เชื่อมต่อไปยัง Supabase โดยตรง เพื่อหลีกเลี่ยง proxy timeout/502
// ในโหมด production (เช่น Vercel) ใช้ proxy ผ่าน domain ของเราเอง เพื่อหลีกเลี่ยง AdGuard/extension block
const isLocalhost =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '')

const directUrl = import.meta.env.VITE_SUPABASE_URL || 'https://nlyumhbzlruhpcorwswk.supabase.co'
const proxyUrl = typeof window !== 'undefined' ? `${window.location.origin}/supabase-api` : directUrl

const supabaseUrl = isLocalhost ? directUrl : proxyUrl
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

// ไมเกรต session เก่ามาไว้ที่ key 'sb-payroll-auth-token' เพื่อให้คงที่ทั้ง proxy และ direct URL
if (typeof window !== 'undefined') {
  const currentToken = localStorage.getItem('sb-payroll-auth-token')
  if (!currentToken) {
    const legacyToken =
      localStorage.getItem('sb-nlyumhbzlruhpcorwswk-auth-token') ||
      localStorage.getItem('sb-localhost-auth-token')
    if (legacyToken) {
      localStorage.setItem('sb-payroll-auth-token', legacyToken)
    }
  }
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // app ใช้ email/password เท่านั้น ไม่ใช้ magic link หรือ OAuth
    storageKey: 'sb-payroll-auth-token',
  },
  realtime: {
    params: { eventsPerSecond: 2 }, // ลด WebSocket load ไม่ให้ Chrome throttle
  },
})
