import { useEffect, useState } from 'react'
import { api } from '../api'
import { money } from '../format'
import { NavIcon } from '../components/NavIcon'

interface Monthly { month: string; total: number }
interface Reseller { username: string; role: string; total: number; unpaid: number; invoices: number }
interface Summary {
  total: number; active: number; expired: number; expiring7d: number
  income_this_month: number; income_12mo: number
  monthly: Monthly[]; resellers: Reseller[]
}

interface AgingRow { reseller: string; count: number; total: number; d0_30: number; d31_60: number; d61_90: number; d90p: number }
interface Aging { buckets: AgingRow[]; totals: { d0_30: number; d31_60: number; d61_90: number; d90p: number; total: number; count: number } }

export default function Reports() {
  const [r, setR] = useState<Summary | null>(null)
  const [aging, setAging] = useState<Aging | null>(null)
  useEffect(() => {
    api.get('/reports/summary').then((x) => setR(x.data))
    api.get('/reports/aging').then((x) => setAging(x.data)).catch(() => {})
  }, [])
  if (!r) return <div className="center">جارٍ التحميل…</div>
  const max = Math.max(1, ...r.monthly.map((m) => m.total))

  return (
    <div>
      <div className="page-head"><h1>التقارير</h1><p>الإيرادات والأداء</p></div>

      <div className="cards">
        <div className="card tone-blue"><div className="card-ico"><NavIcon name="subscribers" size={22} /></div><div className="card-body"><div className="card-label">إجمالي المشتركين</div><div className="card-num">{r.total}</div></div></div>
        <div className="card tone-green"><div className="card-ico"><NavIcon name="check" size={22} /></div><div className="card-body"><div className="card-label">النشطون</div><div className="card-num">{r.active}</div></div></div>
        <div className="card tone-amber"><div className="card-ico"><NavIcon name="clock" size={22} /></div><div className="card-body"><div className="card-label">ينتهي خلال 7 أيام</div><div className="card-num">{r.expiring7d}</div></div></div>
        <div className="card tone-teal"><div className="card-ico"><NavIcon name="finance" size={22} /></div><div className="card-body"><div className="card-label">دخل هذا الشهر</div><div className="card-num sm">{money(r.income_this_month)}</div></div></div>
        <div className="card tone-violet"><div className="card-ico"><NavIcon name="reports" size={22} /></div><div className="card-body"><div className="card-label">دخل آخر 12 شهر</div><div className="card-num sm">{money(r.income_12mo)}</div></div></div>
      </div>

      <h2 className="section">الدخل الشهري (آخر 12 شهراً)</h2>
      <div className="chart-box">
        {(() => {
          // Build a continuous last-12-months series (fill months with no income as 0).
          const now = new Date()
          const series = Array.from({ length: 12 }, (_, i) => {
            const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1)
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
            const found = r.monthly.find((m) => m.month.startsWith(key))
            return { label: String(d.getMonth() + 1).padStart(2, '0'), total: found ? found.total : 0 }
          })
          if (series.every((s) => s.total === 0)) return <p className="muted" style={{ textAlign: 'center', padding: '30px 0' }}>لا بيانات دخل بعد.</p>
          const maxV = Math.max(1, ...series.map((s) => s.total))
          const W = 720, H = 220, padX = 24, padT = 26, padB = 30
          const iw = W - padX * 2, ih = H - padT - padB
          const X = (i: number) => padX + (i * iw) / (series.length - 1)
          const Y = (v: number) => padT + ih - (v / maxV) * ih
          const pts = series.map((s, i) => [X(i), Y(s.total)] as const)
          const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
          const area = `${line} L ${X(series.length - 1).toFixed(1)} ${padT + ih} L ${X(0).toFixed(1)} ${padT + ih} Z`
          return (
            <svg viewBox={`0 0 ${W} ${H}`} className="income-chart" role="img" aria-label="الدخل الشهري لآخر 12 شهراً">
              <defs>
                <linearGradient id="incFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.30" />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              {[0.5, 1].map((f) => <line key={f} x1={padX} y1={padT + ih - f * ih} x2={W - padX} y2={padT + ih - f * ih} stroke="var(--border)" strokeWidth="1" strokeDasharray={f === 1 ? '0' : '4 5'} />)}
              <path d={area} fill="url(#incFill)" />
              <path d={line} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              {series.map((s, i) => (
                <g key={i}>
                  {s.total > 0 && <circle cx={X(i)} cy={Y(s.total)} r="3.6" fill="var(--surface)" stroke="var(--primary)" strokeWidth="2.5" />}
                  {s.total > 0 && <text x={X(i)} y={Y(s.total) - 10} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text)">{money(s.total)}</text>}
                  <text x={X(i)} y={H - 9} textAnchor="middle" fontSize="11" fill="var(--muted)">{s.label}</text>
                </g>
              ))}
            </svg>
          )
        })()}
      </div>

      <h2 className="section">فوترة الموزّعين</h2>
      <table className="tbl">
        <thead><tr><th>الموزّع</th><th>الدور</th><th>الفواتير</th><th>الإجمالي</th><th>غير مدفوع</th></tr></thead>
        <tbody>
          {r.resellers.map((x) => (
            <tr key={x.username}>
              <td>{x.username}</td>
              <td><span className="role">{x.role}</span></td>
              <td>{x.invoices}</td>
              <td>{money(x.total)}</td>
              <td>{money(x.unpaid)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="section">أعمار الفواتير غير المدفوعة</h2>
      {aging && (
        <>
          <div className="cards">
            <div className="card tone-teal"><div className="card-ico"><NavIcon name="clock" size={22} /></div><div className="card-body"><div className="card-label">0–30 يوم</div><div className="card-num sm">{money(aging.totals.d0_30)}</div></div></div>
            <div className="card tone-blue"><div className="card-ico"><NavIcon name="clock" size={22} /></div><div className="card-body"><div className="card-label">31–60 يوم</div><div className="card-num sm">{money(aging.totals.d31_60)}</div></div></div>
            <div className="card tone-violet"><div className="card-ico"><NavIcon name="clock" size={22} /></div><div className="card-body"><div className="card-label">61–90 يوم</div><div className="card-num sm">{money(aging.totals.d61_90)}</div></div></div>
            <div className="card tone-red"><div className="card-ico"><NavIcon name="clock" size={22} /></div><div className="card-body"><div className="card-label">أكثر من 90 يوم</div><div className="card-num sm">{money(aging.totals.d90p)}</div></div></div>
            <div className="card tone-slate"><div className="card-ico"><NavIcon name="finance" size={22} /></div><div className="card-body"><div className="card-label">إجمالي غير مدفوع</div><div className="card-num sm">{money(aging.totals.total)}</div></div></div>
          </div>
          <table className="tbl">
            <thead><tr><th>الموزّع</th><th>0–30</th><th>31–60</th><th>61–90</th><th>90+</th><th>الإجمالي</th><th>عدد</th></tr></thead>
            <tbody>
              {aging.buckets.map((b) => (
                <tr key={b.reseller}>
                  <td>{b.reseller}</td>
                  <td>{money(b.d0_30)}</td>
                  <td>{money(b.d31_60)}</td>
                  <td>{money(b.d61_90)}</td>
                  <td>{money(b.d90p)}</td>
                  <td>{money(b.total)}</td>
                  <td>{b.count}</td>
                </tr>
              ))}
              {aging.buckets.length === 0 && <tr><td colSpan={7} className="empty">لا فواتير غير مدفوعة 🎉</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
