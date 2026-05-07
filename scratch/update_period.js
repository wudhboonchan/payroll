import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://nlyumhbzlruhpcorwswk.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5seXVtaGJ6bHJ1aHBjb3J3c3drIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNzEwMzQsImV4cCI6MjA5MzY0NzAzNH0.hkrfdZ8rywRwrkgYZyrI5iIKiU5f4ZbqEyftGo6FORY'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function fix() {
  const { data, error } = await supabase
    .from('payroll_periods')
    .update({ label: '1-15 พฤษภาคม 2569' })
    .ilike('label', 'งวดพฤษภาคม%')
  
  if (error) {
    console.error('Error:', error)
  } else {
    console.log('Success - label updated')
  }
}

fix()
