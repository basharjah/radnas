import { useEffect, useState } from 'react'
import { api } from '../api'
import { NavIcon } from '../components/NavIcon'
import { useAuth } from '../auth'
import Onboarding from '../components/Onboarding'

interface Stats {
  total_subscribers: number
  active: number
  expired: number
  disabled: number
  online: number
  plans: number
  managers: number
  expiring_7d: number
  new_this_month: number
  growth_pct: number
}

type Card = {
  key: keyof Stats; label: string; icon: string; tone: string; growth?: boolean
}

const cards: Card[] = [
  { key: 'total_subscribers', label: 'إجمالي المشتركين', icon: 'subscribers', tone: 'blue', growth: true },
  { key: 'online', label: 'المتصلون الآن', icon: 'online', tone: 'green' },
  { key: 'active', label: 'النشطون', icon: 'check', tone: 'green' },
  { key: 'expiring_7d', label: 'ينتهي خلال 7 أيام', icon: 'clock', tone: 'amber' },
  { key: 'expired', label: 'المنتهون', icon: 'clock', tone: 'red' },
  { key: 'disabled', label: 'المعطّلون', icon: 'ban', tone: 'slate' },
  { key: 'plans', label: 'الباقات', icon: 'plans', tone: 'violet' },
  { key: 'managers', label: 'الموزّعون', icon: 'managers', tone: 'slate' },
]

interface BwPoint { t: string; in_mbps: number; out_mbps: number }
interface Bw { points: BwPoint[]; peak_mbps: number; avg_mbps: number; samples: number }

export default function Dashboard() {
  const { user, quota } = useAuth()
  const isOwner = user?.role === 'owner'
  const [stats, setStats] = useState<Stats | null>(null)
  const [bw, setBw] = useState<Bw | null>(null)

  useEffect(() => {
    api.get('/dashboard/stats').then((r) => setStats(r.data)).catch(() => {})
    if (isOwner) api.get('/dashboard/bandwidth').then((r) => setBw(r.data)).catch(() => {})
  }, [isOwner])

  return (
    <div>
      <div className="page-head">
        <h1>لوحة المعلومات{user?.company ? ` — ${user.company}` : ''}</h1>
        <p>نظرة عامة على مشتركيك واتصالاتهم</p>
      </div>

      <Onboarding />

      <div className="cards">
        {/* Subscriber quota (admins only) — count vs licensed max */}
        {quota && (
          <div className="card tone-teal">
            <div className="card-ico"><NavIcon name="subscribers" size={22} /></div>
            <div className="card-body">
              <div className="card-label">حصّة المشتركين</div>
              <div className={'card-num' + (quota.count >= quota.max ? ' neg' : '')}>{quota.count} / {quota.max}</div>
            </div>
          </div>
        )}
        {cards.map((c) => {
          const v = stats ? stats[c.key] : null
          return (
            <div key={c.key} className={'card tone-' + c.tone}>
              <div className="card-ico"><NavIcon name={c.icon} size={22} /></div>
              <div className="card-body">
                <div className="card-label">{c.label}</div>
                <div className="card-num">{v == null ? '—' : v}</div>
                {c.growth && stats && (
                  <div className={'growth ' + (stats.growth_pct >= 0 ? 'up' : 'down')}>
                    {stats.growth_pct >= 0 ? '▲' : '▼'} {Math.abs(stats.growth_pct)}% هذا الشهر
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {isOwner && (
        <>
          <h2 className="section">الباندويث — آخر 24 ساعة</h2>
          <div className="bw-card"><BandwidthChart bw={bw} /></div>
        </>
      )}
    </div>
  )
}

function BandwidthChart({ bw }: { bw: Bw | null }) {
  if (!bw) return <p className="muted" style={{ textAlign: 'center', padding: '20px 0' }}>جارٍ التحميل…</p>
  if (bw.samples < 2 || bw.peak_mbps === 0) {
    return (
      <p className="muted bw-empty">
        لا توجد بيانات باندويث بعد.<br />
        تُجمَع عيّنة كل 5 دقائق من الجلسات النشطة (radacct)، وتظهر هنا كمنحنى فور مرور حركة عبر راوتر حقيقي.
      </p>
    )
  }

  const W = 820, H = 200, pad = 28
  const pts = bw.points
  const n = pts.length
  const max = Math.max(0.1, ...pts.map((p) => p.in_mbps + p.out_mbps))
  const x = (i: number) => pad + (i / Math.max(1, n - 1)) * (W - 2 * pad)
  const y = (val: number) => H - pad - (val / max) * (H - 2 * pad)

  const line = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const area = (vals: number[]) => `${line(vals)} L ${x(n - 1).toFixed(1)} ${H - pad} L ${x(0).toFixed(1)} ${H - pad} Z`

  const down = pts.map((p) => p.out_mbps)
  const up = pts.map((p) => p.in_mbps)
  const fmtT = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  return (
    <div>
      <div className="bw-legend">
        <span><i className="dot dl" /> التنزيل</span>
        <span><i className="dot ul" /> الرفع</span>
        <span className="bw-meta">الذروة {bw.peak_mbps} Mbps · المتوسط {bw.avg_mbps} Mbps</span>
      </div>
      <svg className="bw-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="مخطط الباندويث آخر 24 ساعة">
        <defs>
          <linearGradient id="bwdl" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563EB" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#2563EB" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} className="bw-axis" />
        <path d={area(down)} fill="url(#bwdl)" stroke="none" />
        <path d={line(down)} className="bw-line dl" fill="none" vectorEffect="non-scaling-stroke" />
        <path d={line(up)} className="bw-line ul" fill="none" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="bw-xaxis">
        <span>{fmtT(pts[0].t)}</span>
        <span>{fmtT(pts[Math.floor(n / 2)].t)}</span>
        <span>{fmtT(pts[n - 1].t)}</span>
      </div>
    </div>
  )
}
