import { useAppStore } from '../store/useAppStore'
import { isTpiCompany } from '../features/tpi/model'
import PayrollEntry from './PayrollEntry'
import TpiPayrollEntry from './TpiPayrollEntry'

export default function CompanyPayrollEntry() {
  const { user, companyContext } = useAppStore()
  const isTpi = isTpiCompany(companyContext?.factoryName) || isTpiCompany(companyContext?.name)
  return isTpi ? <TpiPayrollEntry key={user?.factory_id} /> : <PayrollEntry />
}
