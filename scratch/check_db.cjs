const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://nlyumhbzlruhpcorwswk.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5seXVtaGJ6bHJ1aHBjb3J3c3drIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNzEwMzQsImV4cCI6MjA5MzY0NzAzNH0.hkrfdZ8rywRwrkgYZyrI5iIKiU5f4ZbqEyftGo6FORY'
const supabase = createClient(supabaseUrl, supabaseKey)

async function checkEmployees() {
  const { data: employees, error } = await supabase
    .from('employees')
    .select('id, employee_code, first_name, last_name, status, factory_id')
  
  if (error) {
    console.error(error)
    return
  }

  console.log('Employees in DB:')
  console.table(employees)

  const { data: tokens, error: tokenError } = await supabase
    .from('payslip_tokens')
    .select('id, employee_id, period_id')
  
  if (tokenError) {
    console.error(tokenError)
    return
  }

  console.log('\nTokens in DB:')
  console.table(tokens)
}

checkEmployees()
