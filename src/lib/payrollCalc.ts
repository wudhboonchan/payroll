export interface PayrollCalculationInput {
  // Employee type
  position?: 'worker' | 'clerk' | null;
  wage_type?: 'daily' | 'monthly' | null;

  // For regular workers (position === 'worker')
  rate_per_12h: number;       // daily rate for workers, monthly salary for clerks
  normal_days: number;        // full 12h shifts
  half_shift_days?: number;   // 8h only shifts (no shift pay for these)
  holiday_ot_full_days?: number;  // holiday OT full 12h days (paid 2× daily rate)
  holiday_ot_half_days?: number;  // holiday OT 8h-only days (paid 2× base_normal_rate)
  partial_hours_total?: number;   // total hours for < 8h partial shifts (paid per hour at 357/8)

  // For clerk (position === 'clerk')
  // rate_per_12h stores monthly salary
  // ot_hours: hours worked beyond 8h per day (sum of all OT hours in period)
  clerk_ot_hours?: number;
  clerk_ot_1x_hours?: number;

  override_normal?: number | null;
  override_shift?: number | null;
  override_ot?: number | null;
  override_special?: number | null;

  amount_wood_excess?: number;
  amount_film?: number;
  amount_special?: number;
  amount_diligence?: number;
  amount_position?: number;

  social_security_rate: number;
  deduct_advance?: number;
  deduct_safety_equipment?: number;
  deduct_uniform?: number;
}

export interface PayrollCalculationOutput {
  amount_normal: number;
  amount_shift: number;
  amount_ot: number;
  amount_ot_1x: number; // Weekend 1x OT (0 for workers)

  effective_normal: number;
  effective_shift: number;
  effective_ot: number;
  effective_ot_1x: number;
  effective_special: number;

  amount_wood_excess: number;
  amount_film: number;
  amount_special: number;
  amount_diligence: number;
  amount_position: number;

  total_income: number;
  
  deduct_social_security: number;
  deduct_safety_equipment: number;
  deduct_uniform: number;
  deduct_advance: number;
  total_deductions: number;

  net_pay: number;

  // For display info
  normal_days: number;
  half_shift_days: number;
}

/**
 * Regular worker calculation (12h shifts, rate_per_12h is daily rate)
 * - 8h of 12h = base pay (amount_normal)
 * - 4h of 12h = shift pay (amount_shift)
 * - Half shift days (8h only) = only base pay, no shift pay
 */
export function calculateTraPhetPayroll(input: PayrollCalculationInput): PayrollCalculationOutput {
  const {
    rate_per_12h,
    normal_days,
    half_shift_days = 0,
    holiday_ot_full_days = 0,
    holiday_ot_half_days = 0,
    partial_hours_total = 0,
    override_normal,
    override_shift,
    override_ot,
    amount_wood_excess = 0,
    amount_film = 0,
    amount_special = 0,
    amount_diligence = 0,
    amount_position = 0,
    social_security_rate,
    override_special,
    deduct_advance = 0,
    deduct_safety_equipment = 0,
    deduct_uniform = 0,
  } = input;

  // Full 12h days contribute both normal (8h) + shift (4h)
  const fullShiftDays = normal_days;
  // Half shift days (8h only) contribute only normal pay, no shift pay
  const totalNormalDays = fullShiftDays + half_shift_days;

  // New Logic: Normal pay is fixed at 357 THB per 8h. Shift pay is the remainder of the daily rate.
  // If rate_per_12h is 0, they receive 0 base wage.
  const base_normal_rate = rate_per_12h === 0 ? 0 : 357;
  const base_shift_rate = Math.max(0, rate_per_12h - base_normal_rate);

  // Normal pay = 357 * totalNormalDays (including half shift days which only get 8h)
  // Plus partial hours pay at hourly rate (357/8 per hour)
  const amount_normal = base_normal_rate * totalNormalDays + Math.round((base_normal_rate / 8) * partial_hours_total);
  // Shift pay = Remainder * fullShiftDays ONLY (no shift pay for half/8h days)
  const amount_shift = base_shift_rate * fullShiftDays;
  // Holiday OT = 2× daily rate per full day + 2× base_normal_rate per 8h-only day
  // Use at least base_normal_rate as floor for full days (matches normal pay floor of 357)
  const effective_daily_rate = Math.max(rate_per_12h, base_normal_rate);
  const amount_ot = holiday_ot_full_days * effective_daily_rate * 2 + holiday_ot_half_days * base_normal_rate * 2;

  const effective_normal = override_normal ?? amount_normal;
  const effective_shift = override_shift ?? amount_shift;
  const effective_ot = override_ot ?? amount_ot;
  const effective_special = override_special ?? amount_special;

  const total_income = 
    effective_normal + 
    effective_shift + 
    effective_ot +
    amount_wood_excess + 
    amount_film + 
    effective_special +
    amount_diligence + 
    amount_position;

  const deduct_social_security = Math.round(effective_normal * social_security_rate);

  const total_deductions = 
    deduct_social_security + 
    deduct_advance + 
    deduct_safety_equipment + 
    deduct_uniform;

  const net_pay = total_income - total_deductions;

  return {
    amount_normal,
    amount_shift,
    amount_ot,
    amount_ot_1x: 0,
    effective_normal,
    effective_shift,
    effective_ot,
    effective_ot_1x: 0,
    amount_wood_excess,
    amount_film,
    amount_special,
    effective_special,
    amount_diligence,
    amount_position,
    total_income,
    deduct_social_security,
    deduct_safety_equipment,
    deduct_uniform,
    deduct_advance,
    total_deductions,
    net_pay,
    normal_days: totalNormalDays,
    half_shift_days,
  };
}

/**
 * Clerk calculation (monthly salary, 8h/day, OT at 1.5x)
 * - monthly_salary (stored in rate_per_12h) / 30 = daily rate
 * - Per period (15 days): monthly_salary / 2 = base pay
 * - OT: (monthly_salary / 30) / 8 * 1.5 per hour
 */
export function calculateClerkPayroll(input: PayrollCalculationInput): PayrollCalculationOutput {
  const {
    rate_per_12h: monthly_salary,
    normal_days,
    clerk_ot_hours = 0,
    clerk_ot_1x_hours = 0,
    override_normal,
    override_ot,
    amount_wood_excess = 0,
    amount_film = 0,
    amount_special = 0,
    amount_diligence = 0,
    amount_position = 0,
    social_security_rate,
    override_special,
    deduct_advance = 0,
    deduct_safety_equipment = 0,
    deduct_uniform = 0,
  } = input;

  // Clerk's 15-day base pay = monthly_salary / 2
  // But we calculate day by day: monthly_salary / 30 * days_worked
  const daily_rate = monthly_salary / 30;
  const amount_normal = daily_rate * normal_days;

  // Clerk has no "shift pay" — always 8h only
  const amount_shift = 0;

  // OT rate: daily_rate / 8 * 1.5
  const hourly_rate = daily_rate / 8;
  const ot_rate_per_hour = hourly_rate * 1.5;
  const amount_ot = ot_rate_per_hour * clerk_ot_hours;

  // Weekend OT rate: daily_rate / 8 * 1.0
  const amount_ot_1x = hourly_rate * clerk_ot_1x_hours;

  const effective_normal = override_normal ?? amount_normal;
  const effective_shift = 0;
  const effective_ot = override_ot ?? amount_ot;
  const effective_ot_1x = amount_ot_1x;
  const effective_special = override_special ?? amount_special;

  const total_income =
    effective_normal +
    effective_ot +
    effective_ot_1x +
    amount_wood_excess +
    amount_film +
    effective_special +
    amount_diligence +
    amount_position;

  const deduct_social_security = Math.round(effective_normal * social_security_rate);

  const total_deductions =
    deduct_social_security +
    deduct_advance +
    deduct_safety_equipment +
    deduct_uniform;

  const net_pay = total_income - total_deductions;

  return {
    amount_normal,
    amount_shift,
    amount_ot,
    amount_ot_1x,
    effective_normal,
    effective_shift,
    effective_ot,
    effective_ot_1x,
    amount_wood_excess,
    amount_film,
    amount_special,
    effective_special,
    amount_diligence,
    amount_position,
    total_income,
    deduct_social_security,
    deduct_safety_equipment,
    deduct_uniform,
    deduct_advance,
    total_deductions,
    net_pay,
    normal_days,
    half_shift_days: 0,
  };
}

/** Dispatcher — picks the correct calculation based on position */
export function calculatePayroll(input: PayrollCalculationInput): PayrollCalculationOutput {
  if (input.position === 'clerk') {
    return calculateClerkPayroll(input);
  }
  return calculateTraPhetPayroll(input);
}
