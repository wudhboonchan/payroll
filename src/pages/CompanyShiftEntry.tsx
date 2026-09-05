import { useAppStore } from '../store/useAppStore'
import ShiftEntry from './ShiftEntry'
import TpiShiftEntry from './TpiShiftEntry'

export default function CompanyShiftEntry() {
  const { user, companyContext } = useAppStore()
  const isTpi = /ทีพีไอ\s*โพลีน|\btpi\b/i.test(companyContext?.name || '')
  return isTpi ? <TpiShiftEntry key={user?.factory_id}/> : <ShiftEntry/>
}
