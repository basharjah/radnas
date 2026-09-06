import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from './api'

interface User {
  id: string
  username: string
  full_name: string | null
  role: string
  company?: string | null
  max_subscribers?: number | null
  points?: number
}

interface Quota { max: number; count: number }

interface AuthCtx {
  user: User | null
  quota: Quota | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [quota, setQuota] = useState<Quota | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    try {
      const r = await api.get('/auth/me')
      setUser(r.data.user)
      setQuota(r.data.quota ?? null)
    } catch {
      /* ignore — token may be invalid; handled on load */
    }
  }

  useEffect(() => {
    const token = localStorage.getItem('radnas_token')
    if (!token) {
      setLoading(false)
      return
    }
    api
      .get('/auth/me')
      .then((r) => { setUser(r.data.user); setQuota(r.data.quota ?? null) })
      .catch(() => localStorage.removeItem('radnas_token'))
      .finally(() => setLoading(false))
  }, [])

  const login = async (username: string, password: string) => {
    const r = await api.post('/auth/login', { username, password })
    localStorage.setItem('radnas_token', r.data.token)
    setUser(r.data.user)
    await refresh() // pull full profile incl. quota
  }

  const logout = () => {
    localStorage.removeItem('radnas_token')
    setUser(null)
    setQuota(null)
  }

  return <Ctx.Provider value={{ user, quota, loading, login, logout, refresh }}>{children}</Ctx.Provider>
}
