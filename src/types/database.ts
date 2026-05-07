export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      companies: {
        Row: {
          id: string
          name: string
          short_name: string | null
          company_type: string
          logo_url: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          short_name?: string | null
          company_type?: string
          logo_url?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          short_name?: string | null
          company_type?: string
          logo_url?: string | null
          created_at?: string
        }
      }
      factories: {
        Row: {
          id: string
          company_id: string | null
          name: string
          shift_morning_start: string | null
          shift_morning_end: string | null
          shift_afternoon_start: string | null
          shift_afternoon_end: string | null
          shift_night_start: string | null
          shift_night_end: string | null
          created_at: string
        }
        Insert: {
          id?: string
          company_id?: string | null
          name: string
          shift_morning_start?: string | null
          shift_morning_end?: string | null
          shift_afternoon_start?: string | null
          shift_afternoon_end?: string | null
          shift_night_start?: string | null
          shift_night_end?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          company_id?: string | null
          name?: string
          shift_morning_start?: string | null
          shift_morning_end?: string | null
          shift_afternoon_start?: string | null
          shift_afternoon_end?: string | null
          shift_night_start?: string | null
          shift_night_end?: string | null
          created_at?: string
        }
      }
      profiles: {
        Row: {
          id: string
          factory_id: string | null
          role: 'admin' | 'superUser' | 'normalUser' | null
          full_name: string | null
          created_at: string
        }
        Insert: {
          id: string
          factory_id?: string | null
          role?: 'admin' | 'superUser' | 'normalUser' | null
          full_name?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          factory_id?: string | null
          role?: 'admin' | 'superUser' | 'normalUser' | null
          full_name?: string | null
          created_at?: string
        }
      }
      employees: {
        Row: {
          id: string
          factory_id: string
          employee_code: string
          prefix: string | null
          first_name: string
          last_name: string
          national_id: string | null
          nationality: string | null
          payment_method: 'cash' | 'bank_transfer' | null
          bank_name: string | null
          bank_account: string | null
          rate_per_12h: number
          status: 'active' | 'inactive' | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          factory_id: string
          employee_code: string
          prefix?: string | null
          first_name: string
          last_name: string
          national_id?: string | null
          nationality?: string | null
          payment_method?: 'cash' | 'bank_transfer' | null
          bank_name?: string | null
          bank_account?: string | null
          rate_per_12h: number
          status?: 'active' | 'inactive' | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          factory_id?: string
          employee_code?: string
          prefix?: string | null
          first_name?: string
          last_name?: string
          national_id?: string | null
          nationality?: string | null
          payment_method?: 'cash' | 'bank_transfer' | null
          bank_name?: string | null
          bank_account?: string | null
          rate_per_12h?: number
          status?: 'active' | 'inactive' | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      payroll_periods: {
        Row: {
          id: string
          factory_id: string
          label: string
          period_start: string
          period_end: string
          status: 'draft' | 'approved' | null
          approved_by: string | null
          approved_at: string | null
          social_security_rate: number | null
          created_at: string
        }
        Insert: {
          id?: string
          factory_id: string
          label: string
          period_start: string
          period_end: string
          status?: 'draft' | 'approved' | null
          approved_by?: string | null
          approved_at?: string | null
          social_security_rate?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          factory_id?: string
          label?: string
          period_start?: string
          period_end?: string
          status?: 'draft' | 'approved' | null
          approved_by?: string | null
          approved_at?: string | null
          social_security_rate?: number | null
          created_at?: string
        }
      }
      shift_assignments: {
        Row: {
          id: string
          period_id: string
          employee_id: string
          work_date: string
          shift_type: 'morning' | 'afternoon' | 'night' | null
          is_holiday_ot: boolean | null
          entered_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          period_id: string
          employee_id: string
          work_date: string
          shift_type?: 'morning' | 'afternoon' | 'night' | null
          is_holiday_ot?: boolean | null
          entered_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          period_id?: string
          employee_id?: string
          work_date?: string
          shift_type?: 'morning' | 'afternoon' | 'night' | null
          is_holiday_ot?: boolean | null
          entered_by?: string | null
          created_at?: string
        }
      }
      payroll_entries: {
        Row: {
          id: string
          period_id: string
          employee_id: string
          amount_normal: number | null
          amount_shift: number | null
          amount_ot: number | null
          override_normal: number | null
          override_shift: number | null
          override_ot: number | null
          override_reason: string | null
          amount_wood_excess: number | null
          amount_film: number | null
          amount_special: number | null
          amount_diligence: number | null
          amount_position: number | null
          deduct_social_security: number | null
          deduct_advance: number | null
          deduct_safety_equipment: number | null
          deduct_uniform: number | null
          entered_by: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          period_id: string
          employee_id: string
          amount_normal?: number | null
          amount_shift?: number | null
          amount_ot?: number | null
          override_normal?: number | null
          override_shift?: number | null
          override_ot?: number | null
          override_reason?: string | null
          amount_wood_excess?: number | null
          amount_film?: number | null
          amount_special?: number | null
          amount_diligence?: number | null
          amount_position?: number | null
          deduct_social_security?: number | null
          deduct_advance?: number | null
          deduct_safety_equipment?: number | null
          deduct_uniform?: number | null
          entered_by?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          period_id?: string
          employee_id?: string
          amount_normal?: number | null
          amount_shift?: number | null
          amount_ot?: number | null
          override_normal?: number | null
          override_shift?: number | null
          override_ot?: number | null
          override_reason?: string | null
          amount_wood_excess?: number | null
          amount_film?: number | null
          amount_special?: number | null
          amount_diligence?: number | null
          amount_position?: number | null
          deduct_social_security?: number | null
          deduct_advance?: number | null
          deduct_safety_equipment?: number | null
          deduct_uniform?: number | null
          entered_by?: string | null
          updated_at?: string | null
        }
      }
      advance_payments: {
        Row: {
          id: string
          period_id: string
          employee_id: string
          amount: number
          request_date: string
          notes: string | null
          entered_by: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          period_id: string
          employee_id: string
          amount: number
          request_date?: string
          notes?: string | null
          entered_by?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          period_id?: string
          employee_id?: string
          amount?: number
          request_date?: string
          notes?: string | null
          entered_by?: string | null
          created_at?: string | null
        }
      }
      payslip_tokens: {
        Row: {
          id: string
          period_id: string
          employee_id: string
          token: string
          expires_at: string
          employee_status: 'pending' | 'confirmed' | 'disputed' | 'auto_confirmed' | null
          dispute_reason: string | null
          confirmed_at: string | null
          auto_confirm_at: string | null
          created_by: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          period_id: string
          employee_id: string
          token?: string
          expires_at?: string
          employee_status?: 'pending' | 'confirmed' | 'disputed' | 'auto_confirmed' | null
          dispute_reason?: string | null
          confirmed_at?: string | null
          auto_confirm_at?: string | null
          created_by?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          period_id?: string
          employee_id?: string
          token?: string
          expires_at?: string
          employee_status?: 'pending' | 'confirmed' | 'disputed' | 'auto_confirmed' | null
          dispute_reason?: string | null
          confirmed_at?: string | null
          auto_confirm_at?: string | null
          created_by?: string | null
          created_at?: string | null
        }
      }
    }
  }
}
