import { Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './auth'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import Landing from './pages/Landing'
import Subscribers from './pages/Subscribers'
import Online from './pages/Online'
import Plans from './pages/Plans'
import Managers from './pages/Managers'
import Invoices from './pages/Invoices'
import Transactions from './pages/Transactions'
import Nas from './pages/Nas'
import Hotspot from './pages/Hotspot'
import WireGuard from './pages/WireGuard'
import Reports from './pages/Reports'
import Audit from './pages/Audit'
import Settings from './pages/Settings'
import Telegram from './pages/Telegram'
import Backups from './pages/Backups'
import PortalLogin from './pages/PortalLogin'
import PortalHome from './pages/PortalHome'
import Layout from './components/Layout'
import ResponsiveTables from './components/ResponsiveTables'

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="center">جارٍ التحميل…</div>
  if (!user) return <Navigate to="/login" replace />
  return <Layout>{children}</Layout>
}

export default function App() {
  return (
    <>
      <ResponsiveTables />
      <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      {/* subscriber portal — separate auth, no admin layout */}
      <Route path="/portal/login" element={<PortalLogin />} />
      <Route path="/portal" element={<PortalHome />} />

      {/* public marketing page; signed-in users are redirected to /dashboard inside Landing */}
      <Route path="/" element={<Landing />} />
      <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
      <Route path="/subscribers" element={<Protected><Subscribers /></Protected>} />
      <Route path="/online" element={<Protected><Online /></Protected>} />
      <Route path="/plans" element={<Protected><Plans /></Protected>} />
      <Route path="/hotspot" element={<Protected><Hotspot /></Protected>} />
      <Route path="/managers" element={<Protected><Managers /></Protected>} />
      <Route path="/nas" element={<Protected><Nas /></Protected>} />
      <Route path="/wireguard" element={<Protected><WireGuard /></Protected>} />
      <Route path="/invoices" element={<Protected><Invoices /></Protected>} />
      <Route path="/transactions" element={<Protected><Transactions /></Protected>} />
      <Route path="/reports" element={<Protected><Reports /></Protected>} />
      <Route path="/audit" element={<Protected><Audit /></Protected>} />
      <Route path="/telegram" element={<Protected><Telegram /></Protected>} />
      <Route path="/backups" element={<Protected><Backups /></Protected>} />
      <Route path="/settings" element={<Protected><Settings /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
