export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      advance_payments: {
        Row: {
          amount: number
          created_at: string | null
          employee_id: string
          entered_by: string | null
          id: string
          notes: string | null
          period_id: string
          request_date: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          employee_id: string
          entered_by?: string | null
          id?: string
          notes?: string | null
          period_id: string
          request_date?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          employee_id?: string
          entered_by?: string | null
          id?: string
          notes?: string | null
          period_id?: string
          request_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "advance_payments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advance_payments_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advance_payments_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          company_type: string
          created_at: string | null
          id: string
          logo_url: string | null
          name: string
          short_name: string | null
        }
        Insert: {
          company_type: string
          created_at?: string | null
          id?: string
          logo_url?: string | null
          name: string
          short_name?: string | null
        }
        Update: {
          company_type?: string
          created_at?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          short_name?: string | null
        }
        Relationships: []
      }
      employees: {
        Row: {
          bank_account: string | null
          bank_name: string | null
          created_at: string | null
          data_complete: boolean | null
          employee_code: string
          factory_id: string
          first_name: string
          id: string
          job_title: string | null
          last_name: string
          national_id: string | null
          nationality: string | null
          notes: string | null
          payment_method: string | null
          position: string | null
          prefix: string | null
          rate_per_12h: number
          status: string | null
          updated_at: string | null
          wage_type: string | null
        }
        Insert: {
          bank_account?: string | null
          bank_name?: string | null
          created_at?: string | null
          data_complete?: boolean | null
          employee_code: string
          factory_id: string
          first_name: string
          id?: string
          job_title?: string | null
          last_name: string
          national_id?: string | null
          nationality?: string | null
          notes?: string | null
          payment_method?: string | null
          position?: string | null
          prefix?: string | null
          rate_per_12h: number
          status?: string | null
          updated_at?: string | null
          wage_type?: string | null
        }
        Update: {
          bank_account?: string | null
          bank_name?: string | null
          created_at?: string | null
          data_complete?: boolean | null
          employee_code?: string
          factory_id?: string
          first_name?: string
          id?: string
          job_title?: string | null
          last_name?: string
          national_id?: string | null
          nationality?: string | null
          notes?: string | null
          payment_method?: string | null
          position?: string | null
          prefix?: string | null
          rate_per_12h?: number
          status?: string | null
          updated_at?: string | null
          wage_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      factories: {
        Row: {
          company_id: string | null
          created_at: string | null
          id: string
          name: string
          shift_afternoon_end: string | null
          shift_afternoon_start: string | null
          shift_morning_end: string | null
          shift_morning_start: string | null
          shift_night_end: string | null
          shift_night_start: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          id?: string
          name: string
          shift_afternoon_end?: string | null
          shift_afternoon_start?: string | null
          shift_morning_end?: string | null
          shift_morning_start?: string | null
          shift_night_end?: string | null
          shift_night_start?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          id?: string
          name?: string
          shift_afternoon_end?: string | null
          shift_afternoon_start?: string | null
          shift_morning_end?: string | null
          shift_morning_start?: string | null
          shift_night_end?: string | null
          shift_night_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "factories_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_entries: {
        Row: {
          amount_diligence: number | null
          amount_film: number | null
          amount_normal: number | null
          amount_ot: number | null
          amount_position: number | null
          amount_shift: number | null
          amount_special: number | null
          amount_wood_excess: number | null
          deduct_advance: number | null
          deduct_safety_equipment: number | null
          deduct_social_security: number | null
          deduct_uniform: number | null
          employee_id: string
          entered_by: string | null
          id: string
          override_normal: number | null
          override_ot: number | null
          override_reason: string | null
          override_shift: number | null
          period_id: string
          updated_at: string | null
        }
        Insert: {
          amount_diligence?: number | null
          amount_film?: number | null
          amount_normal?: number | null
          amount_ot?: number | null
          amount_position?: number | null
          amount_shift?: number | null
          amount_special?: number | null
          amount_wood_excess?: number | null
          deduct_advance?: number | null
          deduct_safety_equipment?: number | null
          deduct_social_security?: number | null
          deduct_uniform?: number | null
          employee_id: string
          entered_by?: string | null
          id?: string
          override_normal?: number | null
          override_ot?: number | null
          override_reason?: string | null
          override_shift?: number | null
          period_id: string
          updated_at?: string | null
        }
        Update: {
          amount_diligence?: number | null
          amount_film?: number | null
          amount_normal?: number | null
          amount_ot?: number | null
          amount_position?: number | null
          amount_shift?: number | null
          amount_special?: number | null
          amount_wood_excess?: number | null
          deduct_advance?: number | null
          deduct_safety_equipment?: number | null
          deduct_social_security?: number | null
          deduct_uniform?: number | null
          employee_id?: string
          entered_by?: string | null
          id?: string
          override_normal?: number | null
          override_ot?: number | null
          override_reason?: string | null
          override_shift?: number | null
          period_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_entries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entries_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entries_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_periods: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          factory_id: string
          id: string
          label: string
          period_end: string
          period_start: string
          social_security_rate: number | null
          status: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          factory_id: string
          id?: string
          label: string
          period_end: string
          period_start: string
          social_security_rate?: number | null
          status?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          factory_id?: string
          id?: string
          label?: string
          period_end?: string
          period_start?: string
          social_security_rate?: number | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_periods_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_periods_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      payslip_tokens: {
        Row: {
          auto_confirm_at: string | null
          confirmed_at: string | null
          created_at: string | null
          created_by: string | null
          dispute_reason: string | null
          employee_id: string
          employee_status: string | null
          expires_at: string
          id: string
          period_id: string
          token: string
        }
        Insert: {
          auto_confirm_at?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          dispute_reason?: string | null
          employee_id: string
          employee_status?: string | null
          expires_at: string
          id?: string
          period_id: string
          token?: string
        }
        Update: {
          auto_confirm_at?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          dispute_reason?: string | null
          employee_id?: string
          employee_status?: string | null
          expires_at?: string
          id?: string
          period_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "payslip_tokens_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payslip_tokens_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payslip_tokens_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string | null
          factory_id: string | null
          full_name: string | null
          id: string
          role: string | null
        }
        Insert: {
          created_at?: string | null
          factory_id?: string | null
          full_name?: string | null
          id: string
          role?: string | null
        }
        Update: {
          created_at?: string | null
          factory_id?: string | null
          full_name?: string | null
          id?: string
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_assignments: {
        Row: {
          created_at: string | null
          employee_id: string
          entered_by: string | null
          film_amount: number | null
          id: string
          is_half_shift: boolean | null
          is_holiday_ot: boolean | null
          ot_hours: number | null
          period_id: string
          shift_type: string | null
          wood_excess: number | null
          work_date: string
        }
        Insert: {
          created_at?: string | null
          employee_id: string
          entered_by?: string | null
          film_amount?: number | null
          id?: string
          is_half_shift?: boolean | null
          is_holiday_ot?: boolean | null
          ot_hours?: number | null
          period_id: string
          shift_type?: string | null
          wood_excess?: number | null
          work_date: string
        }
        Update: {
          created_at?: string | null
          employee_id?: string
          entered_by?: string | null
          film_amount?: number | null
          id?: string
          is_half_shift?: boolean | null
          is_holiday_ot?: boolean | null
          ot_hours?: number | null
          period_id?: string
          shift_type?: string | null
          wood_excess?: number | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_assignments_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_assignments_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_payslip_data: { Args: { p_token: string }; Returns: Json }
      update_payslip_status: {
        Args: { p_reason?: string; p_status: string; p_token: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
