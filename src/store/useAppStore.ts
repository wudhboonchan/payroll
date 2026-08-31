import { create } from 'zustand'

interface User {
  id: string
  role: string
  factory_id: string
  full_name: string | null
}

interface CompanyContext {
  id: string
  name: string
  type: string
  factoryName?: string
}

interface AppState {
  user: User | null
  setUser: (user: User | null) => void
  companyContext: CompanyContext | null
  setCompanyContext: (company: CompanyContext | null) => void
  selectedPeriodId: string | null
  setSelectedPeriodId: (id: string | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  setUser: (user) => set((state) => ({
    user,
    selectedPeriodId: state.user?.id === user?.id && state.user?.factory_id === user?.factory_id
      ? state.selectedPeriodId : null,
  })),
  companyContext: null,
  setCompanyContext: (companyContext) => set({ companyContext }),
  selectedPeriodId: null,
  setSelectedPeriodId: (selectedPeriodId) => set({ selectedPeriodId }),
}))
