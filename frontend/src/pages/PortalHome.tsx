import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { portalApi } from '../portalApi'
import { date } from '../format'
import { Logo } from '../components/Logo'

interface Account {
  username: string; full_name: string | null; status: string; expiry_at: string | null
  daily_used_mb: string; monthly_used_mb: string; bonus_quota_mb: string
  plan_name: string | null; download_mbps: number; upload_mbps: number
  daily_quota_mb: number | null; monthly_quota_mb: number | null; duration_unit: string | null
  online: boolean
}
const fmt = (mb: number) => (mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : Math.round(mb) + ' MB')

export default function PortalHome() {
  const nav = useNavigate()
  const [acc, setAcc] = useState<Account | null>(null)

  useEffect(() => {
    portalApi.get('/me').then((r) => setAcc(r.data.account)).catch(() => nav('/portal/login'))
  }, [nav])

  function logout() { localStorage.removeItem('radnas_portal_token'); nav('/portal/login') }
  if (!acc) return <div className="center">جارٍ التحميل…</div>

  const daysLeft = acc.expiry_at ? Math.ceil((new Date(acc.expiry_at).getTime() - Date.now()) / 86400000) : null
  const dailyUsed = Number(acc.daily_used_mb), monthlyUsed = Number(acc.monthly_used_mb)
  const dailyQ = acc.daily_quota_mb ? Number(acc.daily_quota_mb) : 0
  const bonus = Number(acc.bonus_quota_mb || 0)
  const monthlyQ = acc.monthly_quota_mb ? Number(acc.monthly_quota_mb) + bonus : 0
  const pct = (u: number, q: number) => (q > 0 ? Math.min(100, (u / q) * 100) : 0)

  const bar = (label: string, used: number, quota: number) => (
    <div className="quota-box">
      <div className="quota-head"><span>{label}</span><b dir="ltr">{fmt(used)} / {fmt(quota)}</b></div>
      <div className="quota-bar"><div className={'quota-fill' + (used >= quota ? ' over' : '')} style={{ width: pct(used, quota) + '%' }} /></div>
    </div>
  )

  return (
    <div className="portal-page">
      <div className="portal-card">
        <div className="portal-head">
          <div className="brand"><Logo /> Rad<b>Nas</b></div>
          <button className="btn sm" onClick={logout}>خروج</button>
        </div>
        <h1>مرحباً، {acc.full_name || acc.username}</h1>

        <div className="portal-grid">
          <div><span>الحالة</span><b className={'badge ' + (acc.online ? 'online' : 'offline')}>{acc.online ? 'متّصل' : 'متوقف'}</b></div>
          <div><span>الباقة</span><b>{acc.plan_name || '—'}</b></div>
        </div>

        <div className="quota-box" style={{ marginTop: 12 }}>
          <div className="quota-head"><span>تاريخ الانتهاء</span><b dir="ltr">{date(acc.expiry_at)}</b></div>
          {daysLeft != null && daysLeft <= 3 && (
            <div className="expiry-alert">
              {daysLeft >= 3 ? '⚠️ باقي 3 أيام — يرجى تجديد الباقة'
                : daysLeft === 2 ? '⚠️ باقي يومان — يرجى تجديد الباقة'
                : daysLeft === 1 ? '⚠️ باقي يوم واحد — يرجى تجديد الباقة'
                : daysLeft === 0 ? '⚠️ تنتهي اليوم — يرجى تجديد الباقة'
                : '⚠️ انتهت الباقة — يرجى تجديد الباقة'}
            </div>
          )}
        </div>

        <h3 className="portal-sec">الاستهلاك</h3>
        {dailyQ > 0
          ? bar('اليوم (منذ منتصف الليل)', dailyUsed, dailyQ)
          : <div className="quota-box"><div className="quota-head"><span>اليوم (منذ منتصف الليل)</span><b dir="ltr">{fmt(dailyUsed)}</b></div></div>}
        {monthlyQ > 0
          ? bar('هذا الشهر' + (bonus > 0 ? ` (+${(bonus / 1024).toFixed(0)}GB مشحون)` : ''), monthlyUsed, monthlyQ)
          : <div className="quota-box"><div className="quota-head"><span>هذا الشهر</span><b dir="ltr">{fmt(monthlyUsed)}</b></div></div>}
      </div>
    </div>
  )
}
