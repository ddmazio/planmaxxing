import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { DEMO, insert, select, supabase, update, wipeLocal } from './db'
import type { Area, Profile } from './types'
import { saveToken } from './gcal'

interface AuthState {
  ready: boolean
  session: Session | null
  demo: boolean
  profile: Profile | null
  saveProfile: (p: Partial<Profile>) => Promise<void>
  signInGoogle: () => Promise<void>
  connectGoogleCalendar: () => Promise<void>
  signInEmail: (email: string) => Promise<void>
  startDemo: () => Promise<void>
  signOut: () => Promise<void>
  deleteAccount: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)
const DEMO_FLAG = 'db-demo-started'

const DEFAULT_AREAS: Partial<Area>[] = [
  { name: 'Trabalho', color: 'trabalho', icon: 'briefcase', position: 1 },
  { name: 'Estudos', color: 'estudos', icon: 'book', position: 2 },
  { name: 'Saúde', color: 'saude', icon: 'heart', position: 3 },
  { name: 'Relações', color: 'relacoes', icon: 'users', position: 4 },
  { name: 'Finanças', color: 'financas', icon: 'wallet', position: 5, is_fixed: true },
  { name: 'Eu', color: 'eu', icon: 'sparkle', position: 6 },
]

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [demoOn, setDemoOn] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)

  const loadProfile = useCallback(async () => {
    const rows = await select<Profile>('profiles')
    setProfile(rows[0] ?? null)
  }, [])

  useEffect(() => {
    if (DEMO) {
      const on = localStorage.getItem(DEMO_FLAG) === '1'
      setDemoOn(on)
      ;(on ? loadProfile() : Promise.resolve()).finally(() => setReady(true))
      return
    }
    supabase!.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      if (data.session) await loadProfile().catch(() => setProfile(null))
      setReady(true)
    })
    const { data: sub } = supabase!.auth.onAuthStateChange((_e, s) => {
      if (s?.provider_token) saveToken(s.provider_token)
      setSession(s)
      if (s) loadProfile().catch(() => setProfile(null))
      else setProfile(null)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const saveProfile = async (p: Partial<Profile>) => {
    if (!profile) return
    const saved = await update<Profile>('profiles', profile.id, p)
    setProfile(saved)
  }

  const startDemo = async () => {
    const existing = await select<Profile>('profiles')
    if (!existing.length) {
      await insert<Profile>('profiles', {
        display_name: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Lisbon',
        currency_main: 'EUR', currencies_extra: [], week_starts_on: 1, onboarded: false, birth_date: null, gender: null,
      })
      for (const a of DEFAULT_AREAS) await insert<Area>('areas', { focus: false, is_fixed: false, archived: false, ...a })
    }
    localStorage.setItem(DEMO_FLAG, '1')
    setDemoOn(true)
    await loadProfile()
  }

  const signInGoogle = async () => {
    const { error } = await supabase!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
    if (error) throw error
  }
  /** Pede ao Google permissão só de leitura da agenda. Volta para /config?gcal=1. */
  const connectGoogleCalendar = async () => {
    try { localStorage.setItem('gcal-expect-user', session?.user.id ?? '') } catch { /* */ }
    const { error } = await supabase!.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/config?gcal=1`,
        scopes: 'https://www.googleapis.com/auth/calendar.readonly',
        queryParams: { prompt: 'consent', include_granted_scopes: 'true' },
      },
    })
    if (error) throw error
  }
  const signInEmail = async (email: string) => {
    const { error } = await supabase!.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin, shouldCreateUser: true } })
    if (error) throw error
  }
  const signOut = async () => {
    if (DEMO) { localStorage.removeItem(DEMO_FLAG); setDemoOn(false); setProfile(null); return }
    await supabase!.auth.signOut()
  }
  const deleteAccount = async () => {
    if (DEMO) { await wipeLocal(); localStorage.removeItem(DEMO_FLAG); setDemoOn(false); setProfile(null); return }
    const { error } = await supabase!.rpc('delete_my_account')
    if (error) throw error
    await supabase!.auth.signOut()
  }

  return (
    <Ctx.Provider value={{ ready, session, demo: DEMO && demoOn, profile, saveProfile, signInGoogle, connectGoogleCalendar, signInEmail, startDemo, signOut, deleteAccount }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth fora do AuthProvider')
  return c
}
