import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../auth'
import ThemeToggle from './ThemeToggle'
import { NavIcon } from './NavIcon'
import { Logo } from './Logo'
import AccountSettings from './AccountSettings'
import PushToggle from './PushToggle'

const groups = [
  {
    title: 'عام', icon: 'home',
    items: [
      { to: '/dashboard', label: 'لوحة المعلومات', icon: 'dashboard', end: true },
      { to: '/online', label: 'المتصلون الآن', icon: 'online', end: false },
    ],
  },
  {
    title: 'الاشتراكات', icon: 'subscribers',
    items: [
      { to: '/subscribers', label: 'المشتركون', icon: 'subscribers', end: false },
      { to: '/plans', label: 'الباقات', icon: 'plans', end: false },
      { to: '/hotspot', label: 'هوت سبوت', icon: 'hotspot', end: false },
    ],
  },
  {
    title: 'الشبكة', icon: 'network',
    items: [
      { to: '/nas', label: 'أجهزة NAS', icon: 'nas', end: false, roles: ['owner', 'admin'] },
      { to: '/wireguard', label: 'WireGuard', icon: 'wireguard', end: false, roles: ['owner'] },
    ],
  },
  {
    title: 'المالية', icon: 'finance',
    items: [
      { to: '/invoices', label: 'الفواتير', icon: 'invoices', end: false },
      { to: '/transactions', label: 'الحركات المالية', icon: 'transactions', end: false },
      { to: '/reports', label: 'التقارير', icon: 'reports', end: false },
    ],
  },
  {
    title: 'النظام', icon: 'system',
    items: [
      { to: '/managers', label: 'الموزّعون', icon: 'managers', end: false, roles: ['owner', 'admin'] },
      { to: '/telegram', label: 'تيليجرام', icon: 'telegram', end: false, roles: ['owner', 'admin', 'reseller'] },
      { to: '/audit', label: 'سجلّ التدقيق', icon: 'audit', end: false, roles: ['owner'] },
      { to: '/backups', label: 'النسخ الاحتياطية', icon: 'backups', end: false, roles: ['owner', 'admin'] },
      { to: '/settings', label: 'الإعدادات', icon: 'settings', end: false, roles: ['owner'] },
    ],
  },
]

/** Keep only items visible to `role` (items without a `roles` list are visible to everyone). */
function visibleGroupsFor(role: string | undefined) {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((it) => !('roles' in it) || (it as { roles?: string[] }).roles!.includes(role ?? '')) }))
    .filter((g) => g.items.length > 0)
}

function initNavOpen(): boolean {
  // On mobile always start closed (off-canvas drawer) regardless of the saved desktop preference.
  if (typeof window !== 'undefined' && window.innerWidth <= 900) return false
  const s = localStorage.getItem('radnas_nav')
  if (s === 'open') return true
  if (s === 'closed') return false
  return typeof window !== 'undefined' ? window.innerWidth > 900 : true
}

function groupOfPath(path: string): string | undefined {
  return groups.find((g) =>
    g.items.some((it) => (it.to === '/' ? path === '/' : path.startsWith(it.to))),
  )?.title
}

export default function Layout({ children }: { children: ReactNode }) {
  // The static <title> is the public marketing one; inside the panel it should name the panel.
  useEffect(() => { document.title = 'RadNas — لوحة التحكّم' }, [])
  const { user, logout } = useAuth()
  const navGroups = visibleGroupsFor(user?.role)
  const location = useLocation()
  const [navOpen, setNavOpen] = useState(initNavOpen)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const active = groupOfPath(location.pathname)
    const init: Record<string, boolean> = {}
    groups.forEach((g) => { init[g.title] = g.title === active })
    return init
  })

  function toggleNav() {
    setNavOpen((o) => {
      const next = !o
      localStorage.setItem('radnas_nav', next ? 'open' : 'closed')
      return next
    })
  }
  function toggleGroup(title: string) {
    setOpenGroups((o) => ({ ...o, [title]: !o[title] }))
  }
  function onNavigate() {
    if (window.innerWidth <= 900) setNavOpen(false)
  }

  return (
    <div className={'app' + (navOpen ? ' nav-open' : '')}>
      <header className="header">
        <div className="header-start">
          <button className="icon-btn" onClick={toggleNav} aria-label="طيّ/فتح القائمة" title="طيّ/فتح القائمة">
            <NavIcon name="menu" size={20} />
          </button>
          <div className="brand"><Logo /> Rad<b>Nas</b></div>
        </div>
        <div className="header-end">
          <PushToggle />
          <ThemeToggle />
          <div className="header-user">
            <b>{user?.full_name || user?.username}</b>
            <span>{user?.role}</span>
          </div>
          <AccountSettings />
          <button className="icon-btn logout" onClick={logout} aria-label="تسجيل الخروج" title="تسجيل الخروج">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </header>

      <div className="body">
        <aside className="sidebar">
          <nav>
            {navGroups.map((g) => (
              <div className={'nav-group' + (openGroups[g.title] ? ' open' : '')} key={g.title}>
                <button type="button" className="nav-group-header" onClick={() => toggleGroup(g.title)}>
                  <span className="nav-group-label">
                    <NavIcon name={g.icon} size={16} />
                    <span className="nav-group-title">{g.title}</span>
                  </span>
                  <svg className="nav-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <div className="nav-group-items">
                  {g.items.map((n) => (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      end={n.end}
                      title={n.label}
                      onClick={onNavigate}
                      className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
                    >
                      <span className="ico"><NavIcon name={n.icon} /></span>
                      <span className="label">{n.label}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>
          <div className="sidebar-foot">
            <div className="sidebar-user">
              <b>{user?.full_name || user?.username}</b>
              <span>{user?.role}</span>
            </div>
            <button className="btn sidebar-logout" onClick={logout}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              تسجيل الخروج
            </button>
          </div>
        </aside>
        {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}
        <main className="main">{children}</main>
      </div>
    </div>
  )
}
