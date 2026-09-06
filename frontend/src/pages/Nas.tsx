import { useEffect, useState, type FormEvent } from 'react'
import { apiUserFor } from '../components/Onboarding'
import { api } from '../api'
import { useAuth } from '../auth'

interface Nas {
  id: string
  nasname: string
  shortname: string | null
  type: string
  secret: string
  description: string | null
  manager_id: string | null
  owner_username: string | null
  ports: number | null
  api_enabled: boolean
  api_port: number | null
  api_user: string | null
}
interface Status { radcheck: number; radreply: number; nas: number; subscribers: number }

const emptyForm = { nasname: '', shortname: '', type: 'mikrotik', secret: '', ports: '', description: '', parent_admin_id: '' }

/** Failures, then warnings, then what already works. */
const rank = (s: string) => (s === 'fail' ? 0 : s === 'warn' ? 1 : 2)

export default function Nas() {
  const { user } = useAuth()
  const isOwner = user?.role === 'owner'
  const [rows, setRows] = useState<Nas[]>([])
  const [admins, setAdmins] = useState<{ id: string; username: string; full_name: string | null }[]>([])
  const [status, setStatus] = useState<Status | null>(null)
  const [show, setShow] = useState(false)
  const [form, setForm] = useState({ ...emptyForm })
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  // Router API credentials — entered here and stored encrypted; never rendered back.
  const [apiNas, setApiNas] = useState<Nas | null>(null)
  const [apiForm, setApiForm] = useState({ api_enabled: false, api_port: '80', api_user: '', api_password: '' })
  const [apiTest, setApiTest] = useState<{ ok: boolean; text: string } | null>(null)
  const [apiBusy, setApiBusy] = useState(false)
  // End-to-end diagnosis. Built because every fault in a real onboarding turned out to be silent —
  // a mismatched secret, a pool the tunnel refuses, local accounts that shadow RADIUS — and none of
  // them surface anywhere without asking the router directly.
  const [diag, setDiag] = useState<{
    router: { nasname: string; shortname: string | null; iface: string | null; tunnel_ip: string | null; pool_cidr: string | null }
    checks: { key: string; label: string; status: 'ok' | 'fail' | 'warn' | 'skip'; detail: string; fix?: string }[]
    summary: { ok: number; fail: number; warn: number }
  } | null>(null)
  const [diagBusy, setDiagBusy] = useState('')

  async function diagnose(n: Nas) {
    setDiagBusy(n.id); setErr(''); setDiag(null)
    try {
      const r = await api.get(`/nas/${n.id}/diagnose`)
      setDiag(r.data)
    } catch (e: any) {
      setErr(e?.response?.data?.message || 'تعذّر إجراء الفحص')
    } finally { setDiagBusy('') }
  }

  function openApi(n: Nas) {
    setApiNas(n); setApiTest(null); setErr('')
    setApiForm({ api_enabled: n.api_enabled, api_port: String(n.api_port ?? 80), api_user: n.api_user ?? '', api_password: '' })
  }
  // PUT validates the whole NAS, so the untouched fields are sent back alongside the API ones.
  const apiPayload = (n: Nas) => ({
    nasname: n.nasname, shortname: n.shortname ?? '', type: n.type, ports: n.ports,
    secret: n.secret, description: n.description ?? '',
    api_enabled: apiForm.api_enabled,
    api_port: apiForm.api_port === '' ? null : Number(apiForm.api_port),
    api_user: apiForm.api_user || null,
    api_password: apiForm.api_password || null, // blank => keep the stored one
  })
  async function testApi() {
    if (!apiNas) return
    setApiBusy(true); setApiTest(null)
    try {
      const r = await api.post(`/nas/${apiNas.id}/test-api`, {
        api_user: apiForm.api_user || undefined,
        api_password: apiForm.api_password || undefined,
        api_port: apiForm.api_port ? Number(apiForm.api_port) : undefined,
      })
      setApiTest(r.data.ok
        ? { ok: true, text: `✓ متصل بـ ${r.data.identity} — ${r.data.sessions} جلسة نشطة` }
        : { ok: false, text: r.data.error })
    } catch (e: any) {
      setApiTest({ ok: false, text: e?.response?.data?.error || 'فشل الاختبار' })
    } finally { setApiBusy(false) }
  }
  async function saveApi() {
    if (!apiNas) return
    // Enabling without a username silently produces a NAS the poller skips (it requires user AND
    // password), leaving the page stuck on "live speeds not enabled" with no clue why.
    if (apiForm.api_enabled && !apiForm.api_user.trim()) {
      setErr(`أدخل اسم المستخدم على الراوتر (مثال: ${apiUserFor(apiNas!)}) قبل التفعيل`)
      return
    }
    if (apiForm.api_enabled && !apiForm.api_password && !apiNas.api_user) {
      setErr('أدخل كلمة المرور')
      return
    }
    setApiBusy(true); setErr('')
    try {
      await api.put(`/nas/${apiNas.id}`, apiPayload(apiNas))
      setApiNas(null); load()
      setMsg('تم حفظ بيانات الراوتر — السرعات اللحظية ستبدأ خلال ثوانٍ'); setTimeout(() => setMsg(''), 5000)
    } catch (e: any) {
      setErr(e?.response?.data?.message || 'فشل الحفظ')
    } finally { setApiBusy(false) }
  }

  const load = async () => {
    setRows((await api.get('/nas')).data.data)
    if (isOwner) {
      setStatus((await api.get('/radius/status')).data)
      api.get('/managers').then((r) => setAdmins(r.data.data.filter((m: { role: string }) => m.role === 'admin'))).catch(() => {})
    }
  }
  useEffect(() => { load() }, [])

  async function add(e: FormEvent) {
    e.preventDefault(); setErr('')
    if (isOwner && !form.parent_admin_id) { setErr('اختر المدير (admin) المالك للجهاز'); return }
    try {
      await api.post('/nas', {
        ...form,
        ports: form.ports === '' ? null : Number(form.ports),
        parent_admin_id: form.parent_admin_id || undefined,
      })
      setShow(false); setForm({ ...emptyForm }); load()
    } catch (e: any) {
      setErr(e?.response?.data?.message || 'فشل إضافة الراوتر')
    }
  }
  async function del(id: string) {
    if (!confirm('حذف هذا الراوتر؟')) return
    await api.post(`/nas/${id}/delete`); load()
  }
  async function restart() {
    const r = await api.post('/nas/restart'); setMsg(r.data.message); setTimeout(() => setMsg(''), 4000)
  }
  async function syncAll() {
    const r = await api.post('/radius/sync-all'); setMsg(`تمّت مزامنة ${r.data.synced} مشترك إلى FreeRADIUS`); load(); setTimeout(() => setMsg(''), 4000)
  }

  return (
    <div>
      <div className="page-head row">
        <div><h1>أجهزة الشبكة (NAS)</h1><p>{isOwner ? 'راوترات كل المدراء' : 'راوتراتك الخاصة'} — {rows.length}</p></div>
        <div className="head-actions">
          {isOwner && <button className="btn" onClick={restart}>↻ إعادة تشغيل FreeRADIUS</button>}
          <button className="btn-primary inline" onClick={() => { setForm({ ...emptyForm }); setErr(''); setShow(true) }}>+ راوتر جديد</button>
        </div>
      </div>

      {msg && <div className="notice">{msg}</div>}

      {isOwner && status && (
        <div className="sum-row">
          <div className="sum-card teal"><span>radcheck (بيانات دخول)</span><b>{status.radcheck}</b></div>
          <div className="sum-card"><span>radreply (سمات)</span><b>{status.radreply}</b></div>
          <div className="sum-card"><span>أجهزة NAS</span><b>{status.nas}</b></div>
          <div className="sum-card"><span>المزامنة</span><b><button className="btn sm" onClick={syncAll}>مزامنة الكل</button></b></div>
        </div>
      )}

      <table className="tbl">
        <thead><tr><th>الاسم المختصر</th><th>العنوان (IP)</th>{isOwner && <th>المدير</th>}<th>النوع</th><th>السر</th><th>الوصف</th><th>إجراء</th></tr></thead>
        <tbody>
          {rows.map((n) => (
            <tr key={n.id}>
              <td data-label="الاسم المختصر">{n.shortname || '—'}</td>
              <td data-label="العنوان">{n.nasname}</td>
              {isOwner && <td data-label="المدير">{n.owner_username ? <span className="tree-badge tree-admin">{n.owner_username}</span> : <span className="muted">— غير مرتبط</span>}</td>}
              <td data-label="النوع"><span className="role">{n.type}</span></td>
              <td data-label="السر"><code>{n.secret}</code></td>
              <td data-label="الوصف">{n.description || '—'}</td>
              <td data-label="إجراء" className="row-actions">
                <button className="btn sm" disabled={diagBusy === n.id} onClick={() => diagnose(n)}
                  title="فحص كامل لسلسلة الاتصال">
                  {diagBusy === n.id ? '…' : '🩺 فحص الاتصال'}
                </button>
                <button className="btn sm" onClick={() => openApi(n)} title="بيانات دخول الراوتر للسرعات اللحظية">
                  API {n.api_enabled ? <span className="live-dot" /> : ''}
                </button>
                <button className="btn sm danger" onClick={() => del(n.id)}>حذف</button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={isOwner ? 7 : 6} className="empty">لا راوترات. أضف راوتراً.</td></tr>}
        </tbody>
      </table>

      {diag && (
        <div className="modal-back" onClick={() => setDiag(null)}>
          <div className="modal diag-modal" onClick={(e) => e.stopPropagation()}>
            <h2>فحص الاتصال — {diag.router.shortname || diag.router.nasname}</h2>
            <p className="muted diag-meta">
              نفق <b dir="ltr">{diag.router.iface || '—'}</b> ·
              الراوتر <b dir="ltr">{diag.router.tunnel_ip || '—'}</b> ·
              بركة المشتركين <b dir="ltr">{diag.router.pool_cidr || '—'}</b>
            </p>

            <div className="diag-tally">
              <span className="dt ok">{diag.summary.ok} سليم</span>
              {diag.summary.warn > 0 && <span className="dt warn">{diag.summary.warn} تنبيه</span>}
              {diag.summary.fail > 0 && <span className="dt fail">{diag.summary.fail} فاشل</span>}
              {diag.summary.fail === 0 && diag.summary.warn === 0 && (
                <span className="dt all">السلسلة كاملة ✅</span>
              )}
            </div>

            {/* Failures first: the whole point is to answer "what do I fix" without reading a list. */}
            <ul className="diag-list">
              {[...diag.checks].sort((a, b) => rank(a.status) - rank(b.status)).map((c, i) => (
                <li key={`${c.key}-${i}`} className={`diag-item ${c.status}`}>
                  <span className="diag-dot" aria-hidden="true" />
                  <div>
                    <div className="diag-head">
                      <b>{c.label}</b>
                      <span className="diag-detail">{c.detail}</span>
                    </div>
                    {c.fix && <p className="diag-fix">{c.fix}</p>}
                  </div>
                </li>
              ))}
            </ul>

            <div className="modal-actions">
              <button className="btn primary" onClick={() => {
                const again = rows.find((x) => x.nasname === diag.router.nasname)
                if (again) diagnose(again)
              }}>إعادة الفحص</button>
              <button className="btn" onClick={() => setDiag(null)}>إغلاق</button>
            </div>
          </div>
        </div>
      )}

      {apiNas && (
        <div className="modal-back" onClick={() => setApiNas(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>واجهة الراوتر — {apiNas.shortname || apiNas.nasname}</h2>
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              تُستخدم لقراءة سرعة كل مشترك لحظياً. صلاحية قراءة فقط تكفي — القطع يتم عبر RADIUS.
            </p>
            <label>
              <input type="checkbox" checked={apiForm.api_enabled}
                onChange={(e) => setApiForm({ ...apiForm, api_enabled: e.target.checked })} /> تفعيل السرعات اللحظية
            </label>
            <label>المنفذ</label>
            <input value={apiForm.api_port} dir="ltr" inputMode="numeric"
              onChange={(e) => setApiForm({ ...apiForm, api_port: e.target.value.replace(/[^\d]/g, '') })} placeholder="80" />
            <label>اسم المستخدم</label>
            <input value={apiForm.api_user} dir="ltr" autoComplete="off"
              onChange={(e) => setApiForm({ ...apiForm, api_user: e.target.value })} placeholder={apiUserFor(apiNas)} />
            <label>كلمة المرور</label>
            <input type="password" value={apiForm.api_password} dir="ltr" autoComplete="new-password"
              onChange={(e) => setApiForm({ ...apiForm, api_password: e.target.value })}
              placeholder={apiNas.api_user ? 'اتركها فارغة للإبقاء على المحفوظة' : ''} />
            {apiTest && <div className={apiTest.ok ? 'notice' : 'error'}>{apiTest.text}</div>}
            {err && <div className="error">{err}</div>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setApiNas(null)}>إغلاق</button>
              <button type="button" className="btn" disabled={apiBusy} onClick={testApi}>اختبار الاتصال</button>
              <button type="button" className="btn-primary" disabled={apiBusy} onClick={saveApi}>حفظ</button>
            </div>
          </div>
        </div>
      )}

      {show && (
        <div className="modal-back" onClick={() => setShow(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={add}>
            <h2>راوتر جديد</h2>
            {isOwner && (
              <>
                <label>المدير المالك *</label>
                {admins.length === 0 ? (
                  <p className="muted" style={{ fontSize: 13 }}>لا يوجد مدراء بعد — أنشئ مديراً (admin) أولاً.</p>
                ) : (
                  <select value={form.parent_admin_id} onChange={(e) => setForm({ ...form, parent_admin_id: e.target.value })}>
                    <option value="">— اختر المدير —</option>
                    {admins.map((a) => <option key={a.id} value={a.id}>{a.full_name || a.username}</option>)}
                  </select>
                )}
              </>
            )}
            <label>الاسم المختصر</label><input value={form.shortname} onChange={(e) => setForm({ ...form, shortname: e.target.value })} placeholder="mt-branch1" />
            <label>العنوان (IP)</label><input value={form.nasname} onChange={(e) => setForm({ ...form, nasname: e.target.value })} placeholder="10.0.0.1" autoFocus />
            <label>النوع</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="mikrotik">MikroTik</option><option value="other">أخرى</option>
            </select>
            <label>السر (RADIUS secret)</label><input value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} />
            <label>الوصف</label><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            {err && <div className="error">{err}</div>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setShow(false)}>إلغاء</button>
              <button className="btn-primary">حفظ</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
