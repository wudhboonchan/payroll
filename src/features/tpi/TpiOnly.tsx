import { useQuery } from '@tanstack/react-query'
import { Fragment, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/useAppStore'
import { isTpiCompany } from './model'

export function TpiOnly({ children }: { children: ReactNode }) {
  const { user } = useAppStore()
  const { data: allowed, isPending, error } = useQuery({
    queryKey: ['tpi-factory-boundary', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('factories').select('name').eq('id', user!.factory_id).single()
      if (error) throw error
      return isTpiCompany(data.name)
    },
    enabled: !!user?.factory_id,
  })
  if (!user?.factory_id || isPending) return <p role="status">กำลังตรวจสอบโรงงาน...</p>
  if (error || !allowed) return <p role="alert">หน้านี้ใช้ได้เฉพาะโรงงาน TPI</p>
  return <Fragment key={user.factory_id}>{children}</Fragment>
}
