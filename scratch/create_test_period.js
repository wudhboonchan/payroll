import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://nlyumhbzlruhpcorwswk.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5seXVtaGJ6bHJ1aHBjb3J3c3drIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNzEwMzQsImV4cCI6MjA5MzY0NzAzNH0.hkrfdZ8rywRwrkgYZyrI5iIKiU5f4ZbqEyftGo6FORY'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function createPeriod() {
  const { data, error } = await supabase
    .from('payroll_periods')
    .insert([{
      factory_id: 'f1e23456-7890-4bcd-ef01-2345678901bc',
      label: '16-30 เมษายน 2569',
      period_start: '2026-04-16',
      period_end: '2026-04-30',
      status: 'draft'
    }])
  
  if (error) {
    console.error('Error:', error)
  } else {
    console.log('Success - Test period created')
  }
}

createPeriod()
