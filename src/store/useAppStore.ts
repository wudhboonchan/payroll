import { create } from 'zustand'

interface AppState {
  user: null | { id: string, role: string, factory_id: string, full_name: string | null }
  setUser: (user: any) => void
  companyContext: null | { id: string, name: string, type: string, factoryName?: string }
  setCompanyContext: (company: any) => void
  selectedPeriodId: string | null
  setSelectedPeriodId: (id: string | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  companyContext: null,
  setCompanyContext: (companyContext) => set({ companyContext }),
  selectedPeriodId: null,
  setSelectedPeriodId: (selectedPeriodId) => set({ selectedPeriodId }),
}))
