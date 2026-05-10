
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing environment variables")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkShifts() {
  console.log("Checking ALL shifts...")
  const { data: allShifts, error: shiftErr } = await supabase
    .from('shift_assignments')
    .select('*, employees(employee_code, first_name, last_name)')
    .limit(100)
  
  if (shiftErr) {
    console.error("Shift Error:", shiftErr)
  } else {
    console.log(`Found ${allShifts?.length || 0} total shifts in DB`)
    allShifts?.slice(0, 10).forEach(s => {
      console.log(`- Date: ${s.work_date}, Employee: ${s.employees?.employee_code}, Shift: ${s.shift_type}`)
    })
  }
  
  console.log("\nChecking payroll periods...")
  const { data: periods, error: periodErr } = await supabase
    .from('payroll_periods')
    .select('*')
  
  if (periodErr) {
    console.error("Period Error:", periodErr)
  } else {
    console.log(`Found ${periods?.length || 0} periods in DB`)
    periods?.forEach(p => {
      console.log(`- ID: ${p.id}, ${p.period_name} (${p.period_start} to ${p.period_end})`)
    })
  }
}

checkShifts()
