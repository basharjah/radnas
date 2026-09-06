import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'
const KEY = 'radnas_theme'

export function getInitialTheme(): Theme {
  const saved = localStorage.getItem(KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(t: Theme): void {
  document.documentElement.setAttribute('data-theme', t)
  localStorage.setItem(KEY, t)
}

/** Theme state hook — reads persisted/system preference, applies to <html>. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  useEffect(() => { applyTheme(theme) }, [theme])
  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }
}
