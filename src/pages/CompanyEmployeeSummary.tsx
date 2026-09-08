import { useAppStore } from '../store/useAppStore'
import { isTpiCompany } from '../features/tpi/model'
import EmployeeSummary from './EmployeeSummary'
import TpiEmployeeSummary from './TpiEmployeeSummary'

export default function CompanyEmployeeSummary() {
  const { user, companyContext } = useAppStore()
  const isTpi = isTpiCompany(companyContext?.factoryName) || isTpiCompany(companyContext?.name)
  return isTpi ? <TpiEmployeeSummary key={user?.factory_id} /> : <EmployeeSummary />
}
