import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from '../api'
import { dt } from '../format'
import { useAuth } from '../auth'
import UsageModal from '../components/UsageModal'
import PingModal from '../components/PingModal'
import ImportModal from '../components/ImportModal'

interface Sub {
  id: string
  username: string
  full_name: string | null
  phone: string | null
  address: string | null
  status: string
  plan_id: string | null
  plan_name: string | null
  plan_price: string | null
  monthly_quota_mb: number | null
  daily_quota_mb: number | null
  bonus_quota_mb: number
  manager_id: string | null
  manager_name: string | null
  static_ip: string | null
  live_ip: string | null
  starts_at: string | null
  expiry_at: string | null
  is_paid: boolean
  online: boolean
  quota_locked: boolean
  fup_active: boolean
}

/** Live status badge: account state first, then live connection (green = currently online). */
function statusBadge(s: Sub): { cls: string; label: string } {
  if (s.status === 'disabled') return { cls: 'disabled', label: 'معطّل' }
  if (s.status === 'expired') return { cls: 'expired', label: 'منتهٍ' }
  if (s.status === 'inactive') return { cls: 'inactive', label: 'غير مفعّل' }
  return s.online ? { cls: 'online', label: 'متّصل' } : { cls: 'offline', label: 'متوقف' }
}

const TABS = [
  { key: 'all', label: 'الكل' },
  { key: 'online', label: 'متّصل' },
  { key: 'offline', label: 'غير متّصل' },
  { key: 'expiring_1d', label: 'ينتهي غداً' },
  { key: 'expiring_7d', label: 'خلال أسبوع' },
  { key: 'active', label: 'مفعّل' },
  { key: 'inactive', label: 'غير مفعّل' },
  { key: 'disabled', label: 'موقوف' },
  { key: 'expired', label: 'منتهٍ' },
]

const emptyForm = { username: '', password: '', full_name: '', phone: '', plan_id: '', static_ip: '', manager_id: '' }

const gb = (mb: number) => +(mb / 1024).toFixed(1)   // MB → GB (1 decimal)

// <input type="date"> is a bare calendar day with no time and no zone. Both conversions are done
// by hand on purpose: `new Date('2026-09-01')` parses as UTC midnight, which lands on the previous
// day for anyone east of Greenwich — building the Date from its parts keeps it LOCAL midnight.
const toLocalInput = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const localMidnight = (v: string): Date | null => {
  const [y, m, d] = v.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d, 0, 0, 0, 0)
}
const fromLocalInput = (v: string): string | null => {
  const d = v ? localMidnight(v) : null
  return d ? d.toISOString() : null
}

/** Mirrors the server: end = start + the plan's own duration. Returns an ISO string, or '' when
 *  either input is missing (no start chosen, or the plan carries no duration). */
function makeDerivedEnd(plans: { id: string; duration_value?: number; duration_unit?: string }[]) {
  return (startLocal: string, planId: string): string => {
    if (!startLocal || !planId) return ''
    const p = plans.find((x) => x.id === planId)
    if (!p?.duration_value) return ''
    const d = localMidnight(startLocal)
    if (!d) return ''
    const n = p.duration_value
    if (p.duration_unit === 'hours') d.setHours(d.getHours() + n)
    else if (p.duration_unit === 'months') d.setMonth(d.getMonth() + n)
    else d.setDate(d.getDate() + n)
    return d.toISOString()
  }
}

// Arabic duration label — renewal is expressed in the PLAN's own unit (hourly plan → hours, daily → days).
const DUR_FORMS: Record<string, [string, string, string, string]> = {
  // [1, 2 (dual), 3–10, 11+]
  hours: ['ساعة واحدة', 'ساعتان', 'ساعات', 'ساعة'],
  days: ['يوم واحد', 'يومان', 'أيام', 'يوماً'],
  months: ['شهر واحد', 'شهران', 'أشهر', 'شهراً'],
}
function durLabel(total: number, unit: string): string {
  const f = DUR_FORMS[unit] || DUR_FORMS.days
  if (total === 1) return f[0]
  if (total === 2) return f[1]
  if (total >= 3 && total <= 10) return total + ' ' + f[2]
  return total + ' ' + f[3]
}
const unitNoun: Record<string, string> = { hours: 'الساعات', days: 'الأيام', months: 'الأشهر' }

export default function Subscribers() {
  const { user, quota } = useAuth()
  const showManager = user?.role === 'owner' || user?.role === 'admin' // show the owning reseller column
  const [rows, setRows] = useState<Sub[]>([])
  const [plans, setPlans] = useState<{ id: string; name: string; duration_value?: number; duration_unit?: string }[]>([])
  const [managers, setManagers] = useState<{ id: string; username: string; full_name: string | null; role: string }[]>([])
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState('all')
  const [mgrFilter, setMgrFilter] = useState('') // '' = كل الحسابات
  const [showAdd, setShowAdd] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [form, setForm] = useState({ ...emptyForm })
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [usageSub, setUsageSub] = useState<Sub | null>(null)
  const [editSub, setEditSub] = useState<Sub | null>(null)
  const [editForm, setEditForm] = useState({ full_name: '', phone: '', address: '', password: '', plan_id: '', static_ip: '', manager_id: '', disabled: false, starts_at: '' })
  const [chargeSub, setChargeSub] = useState<Sub | null>(null)
  const [deleteSub, setDeleteSub] = useState<Sub | null>(null)
  const [cutSub, setCutSub] = useState<Sub | null>(null)
  const [renewMonths, setRenewMonths] = useState(1)
  const [topupSub, setTopupSub] = useState<Sub | null>(null)
  const [topupGb, setTopupGb] = useState(1)
  // Ping tool lives in components/PingModal — this page only picks the target.
  const [pingSub, setPingSub] = useState<Sub | null>(null)

  // Bulk renewal. The selection is deliberately dropped whenever the visible list changes: a tick
  // the operator can no longer see is a renewal they did not mean to pay for.
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [bulkAsk, setBulkAsk] = useState(false)
  const [bulkFails, setBulkFails] = useState<{ username: string | null; error?: string }[]>([])

  const derivedEnd = makeDerivedEnd(plans)

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 7000) }

  useEffect(() => { setSel(new Set()) }, [tab, mgrFilter, q])

  const toggle = (id: string) => setSel((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const allShown = rows.length > 0 && rows.every((r) => sel.has(r.id))
  const toggleAll = () => setSel(sel.size > 0 ? new Set() : new Set(rows.map((r) => r.id)))

  async function bulkRenew() {
    // Send only ids still on screen — the selection could otherwise carry a row the list no longer has.
    const ids = rows.filter((r) => sel.has(r.id)).map((r) => r.id)
    if (!ids.length) return
    setBusy('bulk'); setErr(''); setBulkFails([])
    try {
      const r = await api.post('/subscribers/bulk-charge', { ids })
      const fails = (r.data.results as { username: string | null; ok: boolean; error?: string }[])
        .filter((x) => !x.ok)
      setBulkFails(fails)
      flash(fails.length
        ? `تم تجديد ${r.data.renewed} من ${r.data.requested} — ${fails.length} لم تُجدّد`
        : `✅ تم تجديد ${r.data.renewed} مشترك`)
      setBulkAsk(false); setSel(new Set()); load()
    } catch (e: any) {
      setErr(e?.response?.data?.message || 'تعذّر التجديد الجماعي')
    } finally { setBusy('') }
  }

  // Search runs on the server, so a live field needs both a debounce and an ordering guard:
  // without the guard a slow early request can land after a newer one and show stale rows.
  const searchSeq = useRef(0)
  const [searching, setSearching] = useState(false)

  const load = () => {
    const filter = tab === 'all' ? undefined : tab
    const seq = ++searchSeq.current
    return api.get('/subscribers', { params: { q, limit: 100, filter, manager_id: mgrFilter || undefined } }).then((r) => {
      if (seq !== searchSeq.current) return // a newer search already answered — drop this one
      setRows(r.data.data)
      setTotal(r.data.total)
    }).finally(() => {
      if (seq === searchSeq.current) setSearching(false)
    })
  }

  // Live search: 250ms after the last keystroke (and immediately on a tab change).
  useEffect(() => {
    setSearching(true)
    const t = setTimeout(() => { load() }, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [q, tab, mgrFilter])
  useEffect(() => {
    api.get('/plans').then((r) => setPlans(r.data.data)).catch(() => {})
    if (showManager) api.get('/managers').then((r) => setManagers(r.data.data.filter((m: { role: string }) => m.role !== 'owner'))).catch(() => {})
  }, [])

  async function requestUpgrade() {
    try {
      await api.post('/managers/request-upgrade', {})
      flash('✅ تم إرسال طلب الترقية إلى الإدارة')
    } catch { flash('تعذّر إرسال الطلب') }
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    setErr('')
    if (user?.role === 'owner' && !form.manager_id) { setErr('اختر الحساب التابع له المشترك (مدير أو موزّع)'); return }
    try {
      await api.post('/subscribers', { ...form, plan_id: form.plan_id || undefined, manager_id: form.manager_id || undefined })
      setShowAdd(false)
      setForm({ ...emptyForm })
      load()
      flash('✅ أُضيف المشترك — بحالة «غير مفعّل». جدّد باقته لتفعيله.')
    } catch (e: any) {
      const er = e?.response?.data
      setErr(er?.error === 'username_taken' ? 'اسم المستخدم مستخدم مسبقاً'
        : er?.error === 'quota_reached' ? (er.message || 'بلغتَ الحدّ المسموح للمشتركين')
        : er?.message || 'فشل الإضافة')
    }
  }

  async function doCharge() {
    if (!chargeSub) return
    setBusy('charge')
    try {
      const r = await api.post(`/subscribers/${chargeSub.id}/charge`, { months: renewMonths })
      flash(`✅ تم تجديد باقة ${chargeSub.username} (${renewMonths}×) — ينتهي ${dt(r.data.expiry_at)}`)
      setChargeSub(null)
      load()
    } catch (e: any) {
      const err = e?.response?.data
      if (err?.error === 'no_plan') flash('⚠️ لا يمكن التجديد — عيّن باقة أولاً')
      else flash('فشل التجديد')
    } finally { setBusy('') }
  }

  async function doTopup() {
    if (!topupSub) return
    setBusy('topup')
    try {
      const r = await api.post(`/subscribers/${topupSub.id}/topup`, { gb: topupGb })
      flash(`✅ شُحن ${topupGb} غيغا لـ ${topupSub.username}${r.data.restored ? ' — أُعيدت السرعة الكاملة' : ''}`)
      setTopupSub(null)
      load()
    } catch (e: any) {
      const er = e?.response?.data
      flash(er?.error === 'no_quota' ? (er.message || 'باقة هذا المشترك غير محدودة') : 'فشل شحن البيانات')
    } finally { setBusy('') }
  }

  function openEdit(s: Sub) {
    setEditSub(s)
    setEditForm({
      full_name: s.full_name ?? '', phone: s.phone ?? '', address: s.address ?? '',
      password: '', plan_id: s.plan_id ?? '', static_ip: s.static_ip ?? '',
      manager_id: s.manager_id ?? '',
      disabled: s.status === 'disabled',
      starts_at: toLocalInput(s.starts_at),
    })
  }
  async function saveEdit(e: FormEvent) {
    e.preventDefault()
    if (!editSub) return
    setBusy('edit')
    const body: Record<string, unknown> = {
      full_name: editForm.full_name, phone: editForm.phone, address: editForm.address,
      plan_id: editForm.plan_id || null, static_ip: editForm.static_ip || null,
    }
    if (showManager && editForm.manager_id && editForm.manager_id !== editSub.manager_id) body.manager_id = editForm.manager_id
    if (editForm.password) body.password = editForm.password
    // Only send a window field when the operator actually changed it; '' clears it server-side.
    if (editForm.starts_at !== toLocalInput(editSub.starts_at)) body.starts_at = fromLocalInput(editForm.starts_at) ?? ''
    if (editForm.disabled) body.status = 'disabled'
    else if (editSub.status === 'disabled') body.status = 'active' // re-enable
    try {
      await api.put(`/subscribers/${editSub.id}`, body)
      setEditSub(null)
      load()
      flash('✅ حُفظت التعديلات')
    } catch { flash('فشل حفظ التعديلات') } finally { setBusy('') }
  }

  async function doDelete() {
    if (!deleteSub) return
    setBusy('delete')
    try {
      await api.post(`/subscribers/${deleteSub.id}/delete`)
      flash(`🗑️ حُذف المشترك ${deleteSub.username}`)
      setDeleteSub(null)
      load()
    } catch { flash('فشل الحذف') } finally { setBusy('') }
  }

  // Cut = disable the account (RADIUS reject) + CoA-disconnect the live session (backend PUT does both).
  // Restore = re-enable. The row button reflects the state: قطع ↔ اتصال.
  async function toggleService(s: Sub, newStatus: 'active' | 'disabled') {
    setBusy('svc' + s.id)
    try {
      await api.put(`/subscribers/${s.id}`, { status: newStatus })
      flash(newStatus === 'disabled' ? `✅ تم قطع الاتصال عن ${s.username}` : `✅ تمت إعادة اتصال ${s.username}`)
      setCutSub(null)
    } catch {
      flash('فشل تنفيذ العملية')
    } finally { setBusy(''); setTimeout(load, 800) }
  }

  const openUsage = (s: Sub) => setUsageSub(s)


  return (
    <div>
      <div className="page-head row">
        <div>
          <h1>المشتركون</h1>
          <p>إدارة الحسابات والباقات والاتصالات — {total}</p>
        </div>
        <button className="btn" onClick={() => setShowImport(true)} title="استيراد من ملف اكسل أو CSV">⬆ استيراد</button>
        <button className="btn-primary inline" onClick={() => setShowAdd(true)}>+ مشترك جديد</button>
      </div>

      {msg && <div className="notice">{msg}</div>}

      {quota && quota.count >= quota.max && (
        <div className="upgrade-banner">
          <span>⚠️ بلغتَ حصّة المشتركين ({quota.count}/{quota.max}). لإضافة المزيد، رقّ باقتك.</span>
          <button className="btn sm primary" onClick={requestUpgrade}>طلب ترقية</button>
        </div>
      )}

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={'tab' + (tab === t.key ? ' active' : '')} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      <div className="toolbar">
        <div className="search-wrap">
          <input placeholder="بحث فوري بالاسم أو المستخدم أو الهاتف…" value={q}
            onChange={(e) => setQ(e.target.value)} />
          {searching && q ? <span className="search-spin" aria-hidden="true" /> : null}
          {q && <button type="button" className="search-clear" onClick={() => setQ('')} aria-label="مسح البحث">✕</button>}
        </div>
        {/* Owner/admin only: narrow the list to one owning account. The server intersects this with
            the caller's scope, so it can only ever narrow what they already see. */}
        {rows.length > 0 && (
          <button type="button" className={'btn sm' + (sel.size > 0 ? ' active' : '')} onClick={toggleAll}>
            {sel.size > 0 ? `إلغاء التحديد (${sel.size})` : `تحديد الكل (${rows.length})`}
          </button>
        )}
        {showManager && managers.length > 0 && (
          <select className="mgr-filter" value={mgrFilter} onChange={(e) => setMgrFilter(e.target.value)}
            aria-label="تصفية حسب الحساب المالك">
            <option value="">كل الحسابات</option>
            <optgroup label="المدراء">
              {managers.filter((m) => m.role === 'admin').map((m) => (
                <option key={m.id} value={m.id}>{m.full_name || m.username}</option>
              ))}
            </optgroup>
            <optgroup label="الموزّعون">
              {managers.filter((m) => m.role === 'reseller').map((m) => (
                <option key={m.id} value={m.id}>{m.full_name || m.username}</option>
              ))}
            </optgroup>
          </select>
        )}
      </div>

      {sel.size > 0 && (
        <div className="bulk-bar">
          <span className="bulk-count">محدَّد: <b>{sel.size}</b></span>
          <button className="btn primary sm" disabled={busy === 'bulk'} onClick={() => setBulkAsk(true)}>
            {busy === 'bulk' ? 'جارٍ التجديد…' : '↻ تجديد المحدّدين'}
          </button>
        </div>
      )}

      {bulkFails.length > 0 && (
        <div className="error bulk-fails">
          <b>لم تُجدّد {bulkFails.length}:</b>{' '}
          {bulkFails.map((f) => f.username || '(غير معروف)').join('، ')}
          {bulkFails.some((f) => f.error === 'no_plan') && ' — السبب الأشيع: لا باقة مرتبطة بالمشترك.'}
        </div>
      )}

      <table className="tbl">
        <thead>
          <tr><th className="sel-th">
            <input type="checkbox" checked={allShown} onChange={toggleAll}
              aria-label="تحديد كل المعروضين" title="تحديد كل المعروضين" />
          </th><th>اسم المستخدم</th><th>الاسم</th>{showManager && <th>الموزّع</th>}<th>الباقة</th><th>IP</th><th>الحالة</th><th>الانتهاء</th><th>إجراءات</th></tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const b = statusBadge(s)
            const ip = s.online ? s.live_ip : s.static_ip
            return (
              <tr key={s.id} className={sel.has(s.id) ? 'row-sel' : ''}>
                <td data-label="تحديد" className="sel-cell">
                  <input type="checkbox" checked={sel.has(s.id)} onChange={() => toggle(s.id)}
                    aria-label={`تحديد ${s.username}`} />
                </td>
                <td data-label="اسم المستخدم">{s.username}</td>
                <td data-label="الاسم">{s.full_name || '—'}</td>
                {showManager && <td data-label="الموزّع">{s.manager_name || '—'}</td>}
                <td data-label="الباقة">{s.plan_name || '—'}</td>
                <td data-label="IP">
                  {ip
                    ? (s.online
                        ? <a href={'http://' + ip} target="_blank" rel="noopener noreferrer" className="ip-link" title="فتح صفحة الراوتر (تبويب جديد)"><code>{ip}</code></a>
                        : <code>{ip}</code>)
                    : '—'}
                </td>
                <td data-label="الحالة" className="status-cell">
                  <span className={'badge ' + b.cls}>{b.label}</span>
                  {s.fup_active && <span className="badge expired">مخفّض FUP</span>}
                  {s.quota_locked && <span className="badge disabled">محظور حصة</span>}
                </td>
                <td data-label="الانتهاء">{s.expiry_at ? <span className="muted">{dt(s.expiry_at)}</span> : '—'}</td>
                <td data-label="إجراءات" className="row-actions">
                  <button className="btn sm primary" onClick={() => { setChargeSub(s); setRenewMonths(1) }} disabled={!s.plan_id} title={s.plan_id ? 'تجديد الباقة' : 'عيّن باقة أولاً'}>تجديد</button>
                  {s.monthly_quota_mb ? <button className="btn sm" onClick={() => { setTopupSub(s); setTopupGb(1) }} title="شحن غيغا إضافية">بيانات+</button> : null}
                  <button className="btn sm" onClick={() => openEdit(s)}>تعديل</button>
                  <button className="btn sm" onClick={() => openUsage(s)}>الاستهلاك</button>
                  <button className="btn sm" onClick={() => setPingSub(s)} title="أداة Ping">ping</button>
                  {s.status === 'disabled'
                    ? <button className="btn sm primary" onClick={() => toggleService(s, 'active')} disabled={busy === 'svc' + s.id} title="إعادة الاتصال">{busy === 'svc' + s.id ? '…' : 'اتصال'}</button>
                    : <button className="btn sm danger" onClick={() => setCutSub(s)} disabled={busy === 'svc' + s.id} title="قطع الاتصال">قطع</button>}
                  <button className="btn sm danger" onClick={() => setDeleteSub(s)}>حذف</button>
                </td>
              </tr>
            )
          })}
          {rows.length === 0 && <tr><td colSpan={showManager ? 9 : 8} className="empty">لا يوجد مشتركون في هذا التبويب</td></tr>}
        </tbody>
      </table>

      {/* Add subscriber */}
      {showAdd && (
        <div className="modal-back" onClick={() => setShowAdd(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={add}>
            <h2>مشترك جديد</h2>
            {showManager && (
              <>
                <label>الحساب التابع له {user?.role === 'owner' ? '*' : ''}</label>
                <select value={form.manager_id} onChange={(e) => setForm({ ...form, manager_id: e.target.value })}>
                  <option value="">{user?.role === 'admin' ? '— أنا (المدير) —' : '— اختر المدير / الموزّع —'}</option>
                  {managers.map((m) => <option key={m.id} value={m.id}>{(m.full_name || m.username) + ' (' + (m.role === 'admin' ? 'مدير' : 'موزّع') + ')'}</option>)}
                </select>
              </>
            )}
            <label>اسم المستخدم</label>
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoFocus />
            <label>كلمة المرور</label>
            <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <label>الاسم الكامل</label>
            <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            <label>الهاتف</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <label>الباقة</label>
            <select value={form.plan_id} onChange={(e) => setForm({ ...form, plan_id: e.target.value })}>
              <option value="">— بلا باقة —</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <label>IP ثابت (اختياري — Framed-IP-Address)</label>
            <input value={form.static_ip} onChange={(e) => setForm({ ...form, static_ip: e.target.value })} placeholder="10.50.0.7" />
            <p className="muted" style={{ fontSize: 13 }}>يُنشأ بحالة «غير مفعّل» ولا يعمل حتى تُجدّد باقته.</p>
            {err && <div className="error">{err}</div>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setShowAdd(false)}>إلغاء</button>
              <button className="btn-primary">حفظ</button>
            </div>
          </form>
        </div>
      )}

      {/* Renew plan — the extension unit follows the plan type (hourly→hours, daily→days, monthly→months) */}
      {bulkAsk && (
        <div className="modal-back" onClick={() => setBulkAsk(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>تجديد جماعي</h2>
            <p>ستُجدّد <b>{rows.filter((r) => sel.has(r.id)).length}</b> باقة بمقدار <b>مدّة الباقة</b> لكل
              مشترك. التجديد المبكّر يحافظ على الوقت المتبقّي ولا يُهدره. ولتجديد أكثر من مدّة لمشترك
              واحد، استخدم زرّ التجديد في صفّه.</p>
            <p className="muted" style={{ fontSize: 13, lineHeight: 1.8 }}>
              {rows.filter((r) => sel.has(r.id)).slice(0, 8).map((r) => r.username).join('، ')}
              {sel.size > 8 && ` … و${sel.size - 8} غيرهم`}
            </p>
            <div className="modal-actions">
              <button className="btn primary" disabled={busy === 'bulk'} onClick={bulkRenew}>
                {busy === 'bulk' ? 'جارٍ…' : 'تأكيد التجديد'}
              </button>
              <button className="btn" onClick={() => setBulkAsk(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {chargeSub && (() => {
        const cp = plans.find((p) => p.id === chargeSub.plan_id)
        const cv = cp?.duration_value ?? 1          // one plan period = cv units
        const cu = cp?.duration_unit ?? 'months'    // the plan's own unit
        return (
        <div className="modal-back" onClick={() => setChargeSub(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>تجديد الباقة — {chargeSub.username}</h2>
            <div className="charge-info">
              <div><span>الباقة</span><b>{chargeSub.plan_name || '—'}</b></div>
              <div><span>مدّة الباقة</span><b>{durLabel(cv, cu)}</b></div>
            </div>
            <label style={{ display: 'block', margin: '14px 0 6px', fontSize: 13, color: 'var(--muted)' }}>مدّة التجديد ({unitNoun[cu] ?? 'الأشهر'})</label>
            <select value={renewMonths} onChange={(e) => setRenewMonths(Number(e.target.value))} style={{ width: '100%' }}>
              {[1, 2, 3, 6, 12].map((n) => <option key={n} value={n}>{durLabel(n * cv, cu)}</option>)}
            </select>
            <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>سيُفعَّل المشترك ويُمدَّد انتهاؤه بمقدار <b>{durLabel(renewMonths * cv, cu)}</b>. (بلا أي خصم مالي.)</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setChargeSub(null)}>إلغاء</button>
              <button className="btn-primary" onClick={doCharge} disabled={busy === 'charge'}>{busy === 'charge' ? '…' : 'تجديد الآن'}</button>
            </div>
          </div>
        </div>
      )})()}

      {/* Edit */}
      {editSub && (
        <div className="modal-back" onClick={() => setEditSub(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={saveEdit}>
            <h2>تعديل — {editSub.username}</h2>
            {showManager && (
              <>
                <label>الحساب التابع له</label>
                <select value={editForm.manager_id} onChange={(e) => setEditForm({ ...editForm, manager_id: e.target.value })}>
                  {!managers.some((m) => m.id === editForm.manager_id) && editSub.manager_id &&
                    <option value={editSub.manager_id}>{editSub.manager_name || 'الحالي'}</option>}
                  {managers.map((m) => <option key={m.id} value={m.id}>{(m.full_name || m.username) + ' (' + (m.role === 'admin' ? 'مدير' : 'موزّع') + ')'}</option>)}
                </select>
              </>
            )}
            <label>الاسم الكامل</label>
            <input value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} />
            <label>الهاتف</label>
            <input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
            <label>العنوان</label>
            <input value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} />
            <label>كلمة المرور (اتركها فارغة لعدم التغيير)</label>
            <input value={editForm.password} onChange={(e) => setEditForm({ ...editForm, password: e.target.value })} placeholder="••••••" />
            <label>الباقة</label>
            <select value={editForm.plan_id} onChange={(e) => setEditForm({ ...editForm, plan_id: e.target.value })}>
              <option value="">— بلا باقة —</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <label>IP ثابت</label>
            <input value={editForm.static_ip} onChange={(e) => setEditForm({ ...editForm, static_ip: e.target.value })} placeholder="10.50.0.7" />
            <label>تاريخ البدء</label>
            <input type="date" value={editForm.starts_at}
              onChange={(e) => setEditForm({ ...editForm, starts_at: e.target.value })} />
            {/* The end is derived, not typed — showing it here so the operator sees the consequence
                of the date they picked instead of discovering it after saving. */}
            {(() => {
              const end = derivedEnd(editForm.starts_at, editForm.plan_id)
              return (
                <p className="muted" style={{ fontSize: 12.5, margin: '8px 0 0', lineHeight: 1.75 }}>
                  {end
                    ? <>ينتهي تلقائياً في <b>{dt(end)}</b> — حسب مدّة الباقة.</>
                    : editForm.starts_at
                      ? 'اختر باقة ليُحسب تاريخ الانتهاء.'
                      : 'اتركه فارغاً ليعمل الحساب بلا قيد زمني.'}
                  {editForm.starts_at && ' تاريخ بدء في المستقبل يُبقي الحساب «غير مفعّل» ويفتحه تلقائياً في موعده.'}
                </p>
              )
            })()}
            <label className="chk"><input type="checkbox" checked={editForm.disabled} onChange={(e) => setEditForm({ ...editForm, disabled: e.target.checked })} /> تعطيل الحساب (منع الاتصال) — يتجاوز التواريخ</label>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setEditSub(null)}>إلغاء</button>
              <button className="btn-primary" disabled={busy === 'edit'}>{busy === 'edit' ? '…' : 'حفظ'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Delete confirm */}
      {deleteSub && (
        <div className="modal-back" onClick={() => setDeleteSub(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>حذف المشترك</h2>
            <p>هل تريد حذف <b>{deleteSub.username}</b> نهائياً؟ سيُقطع اتصاله ويُزال من RADIUS.</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setDeleteSub(null)}>إلغاء</button>
              <button className="btn-primary danger" onClick={doDelete} disabled={busy === 'delete'}>{busy === 'delete' ? '…' : 'حذف نهائي'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Cut connection confirm */}
      {cutSub && (
        <div className="modal-back" onClick={() => setCutSub(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>قطع الاتصال — {cutSub.username}</h2>
            <p>سيُقطع اتصال <b>{cutSub.username}</b> فوراً ويُمنع من الاتصال حتى تُعيد تفعيله بزر «اتصال». هل تريد المتابعة؟</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setCutSub(null)}>إلغاء</button>
              <button className="btn-primary danger" onClick={() => toggleService(cutSub, 'disabled')} disabled={busy === 'svc' + cutSub.id}>{busy === 'svc' + cutSub.id ? '…' : 'قطع الاتصال'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Data top-up (bonus GB) — for quota plans */}
      {topupSub && (
        <div className="modal-back" onClick={() => setTopupSub(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>شحن غيغابايت — {topupSub.username}</h2>
            {/* Show the quota that actually governs this plan — a daily plan has no monthly figure,
                and printing "—" there made the top-up look inapplicable. */}
            <div className="charge-info">
              <div>
                <span>{topupSub.daily_quota_mb ? 'حصّة الباقة اليومية' : 'حصّة الباقة الشهرية'}</span>
                <b>{topupSub.daily_quota_mb
                  ? gb(topupSub.daily_quota_mb) + ' GB'
                  : topupSub.monthly_quota_mb ? gb(topupSub.monthly_quota_mb) + ' GB' : '—'}</b>
              </div>
              <div><span>المشحون سابقاً</span><b>{gb(topupSub.bonus_quota_mb || 0)} GB</b></div>
            </div>
            <label style={{ display: 'block', margin: '14px 0 6px', fontSize: 13, color: 'var(--muted)' }}>الكمية المضافة</label>
            <select value={topupGb} onChange={(e) => setTopupGb(Number(e.target.value))} style={{ width: '100%' }}>
              {[1, 2, 5, 10, 20, 50, 100].map((n) => <option key={n} value={n}>{n} GB</option>)}
            </select>
            <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
              تُضاف فوق حصّة الباقة، وتُعاد السرعة الكاملة تلقائياً إن كان المشترك مخفّضاً.
              {topupSub.daily_quota_mb
                ? ' هذه باقة يومية — الشحنة لليوم الحالي فقط وتنتهي عند منتصف الليل.'
                : ' تُصفّر عند التجديد.'}
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setTopupSub(null)}>إلغاء</button>
              <button className="btn-primary" onClick={doTopup} disabled={busy === 'topup'}>{busy === 'topup' ? '…' : 'شحن الآن'}</button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <ImportModal managers={managers} isOwner={user?.role === 'owner'}
          onClose={() => setShowImport(false)} onDone={load} />
      )}

      {pingSub && (
        <PingModal username={pingSub.username} ip={pingSub.live_ip || pingSub.static_ip}
          onClose={() => setPingSub(null)} />
      )}

      {/* Usage — shared component */}
      {usageSub && <UsageModal subId={usageSub.id} username={usageSub.username} onClose={() => setUsageSub(null)} />}
    </div>
  )
}
