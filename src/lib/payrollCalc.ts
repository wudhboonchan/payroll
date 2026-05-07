export interface PayrollCalculationInput {
  rate_per_12h: number;
  normal_days: number;
  holiday_ot_days: number;
  
  override_normal?: number | null;
  override_shift?: number | null;
  override_ot?: number | null;

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

  effective_normal: number;
  effective_shift: number;
  effective_ot: number;

  total_income: number;
  
  deduct_social_security: number;
  total_deductions: number;

  net_pay: number;
}

export function calculateTraPhetPayroll(input: PayrollCalculationInput): PayrollCalculationOutput {
  const {
    rate_per_12h,
    normal_days,
    holiday_ot_days,
    override_normal,
    override_shift,
    override_ot,
    amount_wood_excess = 0,
    amount_film = 0,
    amount_special = 0,
    amount_diligence = 0,
    amount_position = 0,
    social_security_rate,
    deduct_advance = 0,
    deduct_safety_equipment = 0,
    deduct_uniform = 0,
  } = input;

  const amount_normal = (rate_per_12h / 12) * 8 * normal_days;
  const amount_shift = (rate_per_12h / 12) * 4 * normal_days;
  const amount_ot = rate_per_12h * 2 * holiday_ot_days;

  const effective_normal = override_normal ?? amount_normal;
  const effective_shift = override_shift ?? amount_shift;
  const effective_ot = override_ot ?? amount_ot;

  const total_income = 
    effective_normal + 
    effective_shift + 
    effective_ot +
    amount_wood_excess + 
    amount_film + 
    amount_special +
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
    effective_normal,
    effective_shift,
    effective_ot,
    total_income,
    deduct_social_security,
    total_deductions,
    net_pay,
  };
}
