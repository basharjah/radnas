import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { NavIcon } from './NavIcon'

/**
 * One header button for everything about your own account.
 *
 * Was two adjacent icon buttons — a profile one and a password one — which read as unrelated tools
 * and cost the header two slots for one idea. Merged, but as two tabs rather than one long form:
 * they are separate endpoints with separate validation and separate success states, and folding the
 * password into the profile form would mean a "leave blank to keep it" field, which is the kind of
 * control people submit by accident.
 */
export default function AccountSettings() {
  const { refresh, user } = useAuth()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'profile' | 'password'>('profile')
  const [form, setForm] = useState({ full_name: '', phone: '', email: '' })
  const [cur, setCur] = useState('')
  const [nw, setNw] = useState('')
  const [cf, setCf] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function openModal() {
    setErr(''); setMsg(''); setTab('profile'); setOpen(true)
    try {
      const r = await api.get('/auth/me')
      const u = r.data.user || {}
      setForm({ full_name: u.full_name ?? '', phone: u.phone ?? '', email: u.email ?? '' })
    } catch { /* keep blanks — the fields are still editable */ }
  }

  function close() {
    setOpen(false)
    setCur(''); setNw(''); setCf(''); setErr(''); setMsg('')
  }

  // A message from one tab must not appear over the other's form.
  function switchTab(t: 'profile' | 'password') {
    setTab(t); setErr(''); setMsg('')
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault()
    setErr(''); setMsg('')
    if (!form.full_name.trim()) { setErr('الاسم مطلوب'); return }
    setBusy(true)
    try {
      await api.post('/auth/profile', form)
      await refresh()
      setMsg('تم حفظ التعديلات ✅')
      setTimeout(close, 1200)
    } catch (e: any) {
      setErr(e?.response?.data?.details?.fieldErrors?.email
        ? 'البريد الإلكتروني غير صالح'
        : 'فشل الحفظ، حاول مجدداً')
    } finally { setBusy(false) }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault()
    setErr(''); setMsg('')
    if (nw.length < 8) { setErr('كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل'); return }
    if (nw !== cf) { setErr('تأكيد كلمة المرور غير مطابق'); return }
    setBusy(true)
    try {
      await api.post('/auth/change-password', { current_password: cur, new_password: nw })
      setMsg('تم تغيير كلمة المرور بنجاح ✅')
      setCur(''); setNw(''); setCf('')
      setTimeout(close, 1400)
    } catch (e: any) {
      setErr(e?.response?.data?.error === 'invalid_current'
        ? 'كلمة المرور الحالية غير صحيحة'
        : 'فشل التغيير، حاول مجدداً')
    } finally { setBusy(false) }
  }

  return (
    <>
      <button className="icon-btn" onClick={openModal} aria-label="حسابي" title="حسابي">
        <NavIcon name="managers" size={18} />
      </button>

      {open && (
        <div className="modal-back" onClick={close}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>حسابي{user?.username ? ` — ${user.username}` : ''}</h2>

            <div className="tabs acct-tabs">
              <button type="button" className={'tab' + (tab === 'profile' ? ' active' : '')}
                onClick={() => switchTab('profile')}>البيانات</button>
              <button type="button" className={'tab' + (tab === 'password' ? ' active' : '')}
                onClick={() => switchTab('password')}>كلمة المرور</button>
            </div>

            {tab === 'profile' ? (
              <form onSubmit={saveProfile}>
                <label>الاسم الكامل</label>
                <input value={form.full_name} autoFocus
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
                <label>الهاتف</label>
                <input value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                <label>البريد الإلكتروني</label>
                <input value={form.email} placeholder="name@example.com"
                  onChange={(e) => setForm({ ...form, email: e.target.value })} />
                {err && <div className="error">{err}</div>}
                {msg && <div className="notice">{msg}</div>}
                <div className="modal-actions">
                  <button type="button" className="btn" onClick={close}>إلغاء</button>
                  <button className="btn-primary" disabled={busy}>{busy ? '…' : 'حفظ'}</button>
                </div>
              </form>
            ) : (
              <form onSubmit={savePassword}>
                <label>كلمة المرور الحالية</label>
                <input type="password" value={cur} autoFocus autoComplete="current-password"
                  onChange={(e) => setCur(e.target.value)} />
                <label>كلمة المرور الجديدة (8 أحرف فأكثر)</label>
                <input type="password" value={nw} autoComplete="new-password"
                  onChange={(e) => setNw(e.target.value)} />
                <label>تأكيد كلمة المرور الجديدة</label>
                <input type="password" value={cf} autoComplete="new-password"
                  onChange={(e) => setCf(e.target.value)} />
                {err && <div className="error">{err}</div>}
                {msg && <div className="notice">{msg}</div>}
                <div className="modal-actions">
                  <button type="button" className="btn" onClick={close}>إلغاء</button>
                  <button className="btn-primary" disabled={busy}>{busy ? '…' : 'تغيير'}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
