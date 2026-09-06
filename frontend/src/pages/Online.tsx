import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import UsageModal from '../components/UsageModal'
import PingModal from '../components/PingModal'

interface Session {
  radacctid: number
  subscriber_id: string | null
  username: string
  full_name: string | null
  mac: string | null
  framed_ip: string | null
  acctstarttime: string
  acctsessiontime: number | null
  acctinputoctets: string
  acctoutputoctets: string
  updated_ago_s: number | null
  sub_status: string | null
  fup_active?: boolean
  quota_locked?: boolean
  plan_name: string | null
  daily_bytes?: string
  down_bps: number | null
  up_bps: number | null
  live: boolean
}
interface Totals { down_bps: number; up_bps: number; down_bytes: number; up_bytes: number }
interface RouterHealth { nas_id: string; label: string; ok: boolean; error: string | null }
interface Tenant {
  admin_name: string; company: string | null; routers: string | null
  sessions: number; down_bytes: string; up_bytes: string; down_bps: number; up_bps: number
}

type SortKey = 'name' | 'down' | 'up'

// ---- formatting ----------------------------------------------------------
const bytes = (n: number | string): string => {
  const v = Number(n) || 0
  if (v >= 1073741824) return (v / 1073741824).toFixed(1) + ' GB'
  if (v >= 1048576) return (v / 1048576).toFixed(v / 1048576 >= 100 ? 0 : 1) + ' MB'
  return Math.round(v / 1024) + ' KB'
}
const bps = (n: number | null): string => {
  if (n == null) return '—'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + ' Mbps'
  if (n >= 1000) return Math.round(n / 1000) + ' Kbps'
  return Math.round(n) + ' bps'
}
const dur = (s: number | null): string => {
  const t = Number(s) || 0
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60)
  if (h && m) return `${h} ساعة ${m} دقيقة`
  if (h) return `${h} ساعة`
  return `${m} دقيقة`
}

export default function Online() {
  const [rows, setRows] = useState<Session[]>([])
  // The API's own count — the source of truth for the header, since the owner's rows are withheld
  // and rows.length would read 0 while 50 sessions are actually live.
  const [total, setTotal] = useState(0)
  const [totals, setTotals] = useState<Totals>({ down_bps: 0, up_bps: 0, down_bytes: 0, up_bytes: 0 })
  const [liveOn, setLiveOn] = useState(false)
  const [routers, setRouters] = useState<RouterHealth[]>([])
  // Sent by the API for the owner only, so its presence is the permission check.
  const [tenants, setTenants] = useState<Tenant[] | null>(null)
  // True when the API withheld the session rows (owner). There is no way to reveal them — the
  // platform owner manages companies, not their end customers.
  const [withheld, setWithheld] = useState(false)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortKey>('name')
  const [desc, setDesc] = useState(false)
  const [paused, setPaused] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [usageSub, setUsageSub] = useState<{ id: string; username: string } | null>(null)
  const [cutSub, setCutSub] = useState<Session | null>(null)
  const [pingSub, setPingSub] = useState<Session | null>(null)
  // Polling reads these through refs so the 2s interval is never rebuilt (and never doubled).
  const pausedRef = useRef(false)
  pausedRef.current = paused || !!cutSub

  const load = async () => {
    const r = await api.get('/radius/online')
    setRows(r.data.data); setTotal(Number(r.data.total) || 0); setTotals(r.data.totals); setLiveOn(!!r.data.live); setRouters(r.data.routers || [])
    setTenants(r.data.tenants ?? null); setWithheld(!!r.data.sessions_withheld)
  }
  useEffect(() => {
    load().catch(() => {})
    // 2s matches the router poller's own tick — faster would return the same numbers.
    const t = setInterval(() => { if (!pausedRef.current) load().catch(() => {}) }, 2000)
    return () => clearInterval(t)
  }, [])

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 5000) }

  async function cut(s: Session) {
    if (!s.subscriber_id) return
    setBusy('cut' + s.radacctid)
    try {
      await api.put(`/subscribers/${s.subscriber_id}`, { status: 'disabled' })
      flash(`تم قطع الاتصال عن ${s.username}`)
      setCutSub(null); load()
    } catch { flash('فشل القطع') } finally { setBusy('') }
  }

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = needle
      ? rows.filter((r) => [r.username, r.full_name, r.framed_ip, r.mac].some((v) => (v || '').toLowerCase().includes(needle)))
      : rows
    const key = (r: Session) => sort === 'name' ? r.username.toLowerCase() : sort === 'down' ? (r.down_bps ?? -1) : (r.up_bps ?? -1)
    return [...list].sort((a, b) => {
      const x = key(a), y = key(b)
      const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number)
      return desc ? -c : c
    })
  }, [rows, q, sort, desc])

  const brokenRouter = routers.find((r) => !r.ok)

  return (
    <div>
      <div className="page-head row">
        <div>
          <h1>المتصلون الآن</h1>
          <p>{total} جلسة نشطة{liveOn ? ' — سرعات لحظية من الراوتر' : ''}</p>
        </div>
      </div>

      {msg && <div className="notice">{msg}</div>}
      {!liveOn && (
        <div className="notice warn">
          السرعات اللحظية غير مفعّلة. من صفحة <b>أجهزة الشبكة (NAS)</b> افتح الراوتر واضغط «API» وأدخل بيانات دخول
          للقراءة فقط — عندها تظهر سرعة كل مشترك لحظياً.
        </div>
      )}
      {brokenRouter && <div className="error">تعذّر الوصول إلى الراوتر {brokenRouter.label} — السرعات متوقّفة.</div>}

      {/* Aggregate cards are for a tenant. The owner gets the same numbers as the table's total
          row, so showing both would just be the same figures twice. */}
      {!tenants && (
      <div className="live-totals">
        <div className="lt-item">
          <span>المتصلون</span>
          <b dir="ltr">{withheld ? total : view.length}{!withheld && <i>/{rows.length}</i>}</b>
        </div>
        <div className="lt-item down">
          <span>↓ التحميل</span>
          <b dir="ltr">{bps(liveOn ? totals.down_bps : null)}</b>
          <em dir="ltr">{bytes(totals.down_bytes)}</em>
        </div>
        <div className="lt-item up">
          <span>↑ الرفع</span>
          <b dir="ltr">{bps(liveOn ? totals.up_bps : null)}</b>
          <em dir="ltr">{bytes(totals.up_bytes)}</em>
        </div>
      </div>
      )}

      {/* Owner view: the platform's shape at a glance — which company carries what right now. */}
      {tenants && tenants.length > 0 && (
        <section className="tnt">
          <h2>حسب الشركة <span className="tnt-count">{tenants.length}</span></h2>
          <div className="tnt-scroll">
            <table className="tnt-tbl">
              <thead>
                <tr>
                  <th>الشركة</th><th>الشبكة</th><th>المتصلون</th>
                  <th>↓ التحميل</th><th>↑ الرفع</th><th>الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.admin_name}>
                    <td>
                      <b>{t.company || t.admin_name}</b>
                      {t.company && <small>{t.admin_name}</small>}
                    </td>
                    <td>{t.routers || <span className="muted">— بلا راوتر</span>}</td>
                    <td className="num">{t.sessions}</td>
                    <td className="num down">{bps(liveOn ? t.down_bps : null)}</td>
                    <td className="num up">{bps(liveOn ? t.up_bps : null)}</td>
                    <td className="num">{bytes(Number(t.down_bytes) + Number(t.up_bytes))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td><b>الإجمالي</b></td>
                  <td className="muted">{tenants.length} شركة</td>
                  <td className="num">{total}</td>
                  <td className="num down">{bps(liveOn ? totals.down_bps : null)}</td>
                  <td className="num up">{bps(liveOn ? totals.up_bps : null)}</td>
                  <td className="num">{bytes(totals.down_bytes + totals.up_bytes)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {!withheld && (
      <>
      <div className="live-bar">
        <input className="live-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="بحث بالاسم، IP، MAC…" />
        <div className="live-sort">
          <span>ترتيب</span>
          {([['name', 'الاسم'], ['down', 'التحميل'], ['up', 'الرفع']] as [SortKey, string][]).map(([k, label]) => (
            <button key={k} className={'chip' + (sort === k ? ' on' : '')} onClick={() => setSort(k)}>{label}</button>
          ))}
          <button className="chip" onClick={() => setDesc((d) => !d)} title={desc ? 'تنازلي' : 'تصاعدي'}>{desc ? '↓' : '↑'}</button>
          <button className={'chip' + (paused ? ' on' : '')} onClick={() => setPaused((p) => !p)}
            title={paused ? 'استئناف التحديث' : 'إيقاف التحديث مؤقتاً'}>{paused ? '▶' : '❙❙'}</button>
        </div>
      </div>

      <div className="live-grid">
        {view.map((s) => (
          <article key={s.radacctid} className="live-card">
            <div className="lc-head">
              <div className="lc-id">
                <span className="live-dot" />
                <b>{s.username}</b>
                {/* Why a customer is slow has to be visible here — otherwise "النت بطيء" reads
                    as a fault when it is really the plan's own FUP policy doing its job. */}
                {s.quota_locked
                  ? <span className="badge disabled lc-flag">محظور حصة</span>
                  : s.fup_active ? <span className="badge inactive lc-flag">مخفّض FUP</span> : null}
                {s.full_name && <small>{s.full_name}</small>}
              </div>
              <div className="lc-head-l">
                <span className="lc-uptime">{dur(s.acctsessiontime)}</span>
                {s.subscriber_id && (
                  <button className="lc-cut" onClick={() => setCutSub(s)} title="قطع الاتصال" aria-label={`قطع الاتصال عن ${s.username}`}>⛓</button>
                )}
              </div>
            </div>

            <div className="lc-meta" dir="ltr">
              <span>{s.framed_ip || '—'}</span>
              {s.mac && <><i>·</i><span>{s.mac}</span></>}

            </div>

            <div className="lc-metrics">
              <div>
                {/* Today's traffic (server-computed from the period marks), not the session total —
                    a session running since yesterday would otherwise overstate today. Falls back to
                    the session total on a backend that predates daily_bytes, so the label never lies. */}
                <span>{s.daily_bytes != null ? 'الاستهلاك اليومي' : 'الاستهلاك الحالي'}</span>
                <b dir="ltr">{bytes(s.daily_bytes ?? Number(s.acctinputoctets) + Number(s.acctoutputoctets))}</b>
              </div>
              <div>
                <span>↑ سرعة الرفع</span>
                <b dir="ltr" className={s.up_bps ? 'act' : ''}>{bps(s.up_bps)}</b>
              </div>
              <div>
                <span>↓ سرعة التحميل</span>
                <b dir="ltr" className={s.down_bps ? 'act' : ''}>{bps(s.down_bps)}</b>
              </div>
            </div>

            <div className="lc-actions">
              {s.subscriber_id && (
                <button className="btn sm" onClick={() => setUsageSub({ id: s.subscriber_id!, username: s.username })}>الاستهلاك</button>
              )}
              {s.framed_ip && (
                <button className="btn sm" onClick={() => setPingSub(s)}>ping</button>
              )}
              {s.plan_name && <span className="lc-plan">{s.plan_name}</span>}
            </div>
          </article>
        ))}
        {view.length === 0 && <p className="empty">{rows.length ? 'لا نتائج مطابقة للبحث.' : 'لا جلسات نشطة حالياً.'}</p>}
      </div>
      </>
      )}

      {cutSub && (
        <div className="modal-back" onClick={() => setCutSub(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>قطع الاتصال</h2>
            <p>سيُعطَّل حساب <b>{cutSub.username}</b> ويُفصل فوراً عن الشبكة. يمكن إعادة تفعيله من صفحة المشتركين.</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setCutSub(null)}>إلغاء</button>
              <button className="btn-primary danger" disabled={busy === 'cut' + cutSub.radacctid} onClick={() => cut(cutSub)}>تأكيد القطع</button>
            </div>
          </div>
        </div>
      )}

      {pingSub && (
        <PingModal username={pingSub.username} ip={pingSub.framed_ip} onClose={() => setPingSub(null)} />
      )}

      {usageSub && <UsageModal subId={usageSub.id} username={usageSub.username} onClose={() => setUsageSub(null)} />}
    </div>
  )
}
