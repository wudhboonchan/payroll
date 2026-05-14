import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

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
