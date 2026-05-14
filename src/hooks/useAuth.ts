import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import type { Session } from '@supabase/supabase-js'

export function useAuth() {
  const { setUser, setCompanyContext } = useAppStore()
  const [loading, setLoading] = useState(true)
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  interface Company {
    id: string;
    name: string;
    short_name: string;
    company_type: string;
  }

  interface Profile {
    id: string;
    role: string;
    factory_id: string;
    full_name: string;
    factories: {
      id: string;
      name: string;
      companies: Company | Company[];
    };
  }

  const handleSession = useCallback(async (session: Session | null) => {
    if (!session?.user) {
      setUser(null);
      setCompanyContext(null);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, role, factory_id, full_name, factories(id, name, companies(id, name, short_name, company_type))')
        .eq('id', session.user.id)
        .single();

      if (error) {
        console.error('Profile fetch error:', error);
        setUser({
          id: session.user.id,
          role: 'admin',
          factory_id: '',
          full_name: session.user.email
        });
      } else if (data) {
        const profile = data as unknown as Profile;
        setUser({
          id: profile.id,
          role: profile.role || 'admin',
          factory_id: profile.factory_id,
          full_name: profile.full_name || session.user.email
        });

        const factory = profile.factories;
        if (factory?.companies) {
          const company = Array.isArray(factory.companies) ? factory.companies[0] : factory.companies;
          setCompanyContext({
            id: company.id,
            name: company.name,
            type: company.company_type,
            factoryName: factory.name
          });
        }
      }
    } catch (e) {
      console.error('handleSession error:', e);
    } finally {
      setLoading(false);
    }
  }, [setUser, setCompanyContext]);

  useEffect(() => {
    let isMounted = true;
    // ใช้ local variable แทน ref เพื่อ track ว่า initial session ถูก handle แล้วหรือยัง
    let initialSessionHandled = false;

    // Safety net: ปลดแค่ spinner ไม่บล็อก session restore
    // ถ้า getSession() ตอบช้า (AdGuard หน่วง) — หน้าจะโหลดได้ก่อน
    // และพอ session กลับมา handleSession ยังถูกเรียกได้ปกติ
    loadingTimerRef.current = setTimeout(() => {
      if (!isMounted) return;
      setLoading(false);
    }, 6000);

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;
      if (initialSessionHandled) return; // onAuthStateChange handle ไปก่อนแล้ว
      initialSessionHandled = true;
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
      handleSession(session).catch(console.error);
    }).catch(err => {
      console.error('getSession error:', err);
      if (!isMounted || initialSessionHandled) return;
      initialSessionHandled = true;
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!isMounted) return;

        if (event === 'INITIAL_SESSION') {
          if (initialSessionHandled) return;
          initialSessionHandled = true;
          if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
        }

        // Fire-and-forget: ไม่ block Supabase auth flow
        handleSession(session).catch(console.error);
      }
    );

    return () => {
      isMounted = false;
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
      subscription.unsubscribe();
    }
  }, [handleSession]);

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setCompanyContext(null)
  }

  return { loading, signOut }
}
