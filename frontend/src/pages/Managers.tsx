import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'

interface Manager {
  id: string
  parent_id: string | null
  username: string
  full_name: string | null
  company: string | null
  phone: string | null
  email: string | null
  role: string
  points: number
  status: string
  max_subscribers: number | null
  sub_count: number
}

const TIERS = ['50', '100', '200', '500', '1000', ''] // '' = غير محدود
const emptyForm = { username: '', password: '', full_name: '', phone: '', email: '', company: '', role: 'reseller', parent_id: '', max_subscribers: '100' }

export default function Managers() {
  const { user } = useAuth()
  const isOwner = user?.role === 'owner'
  const [rows, setRows] = useState<Manager[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ ...emptyForm })
  const [resetFor, setResetFor] = useState<Manager | null>(null)
  const [resetPw, setResetPw] = useState('')
  const [resetErr, setResetErr] = useState('')
  const [tierFor, setTierFor] = useState<Manager | null>(null)
  const [tierVal, setTierVal] = useState('')
  const [editFor, setEditFor] = useState<Manager | null>(null)
  const [editForm, setEditForm] = useState({ full_name: '', phone: '', email: '', company: '', disabled: false })
  const [editErr, setEditErr] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [view, setView] = useState<'table' | 'tree'>('table')

  // Companies that signed up at /register land as status='pending' and cannot log in until
  // the owner decides here.
  const [pending, setPending] = useState<any[]>([])
  const [deciding, setDeciding] = useState('')
  const loadPending = () => {
    if (!isOwner) return
    api.get('/managers/pending').then((r) => setPending(r.data.data)).catch(() => {})
  }
  const load = () => {
    loadPending()
    return api.get('/managers').then((r) => setRows(r.data.data))
  }
  useEffect(() => { load() }, [])

  async function decide(m: any, approve: boolean) {
    if (!approve && !confirm(`رفض طلب ${m.company || m.username}؟`)) return
    setDeciding(m.id)
    try {
      await api.post(`/managers/${m.id}/${approve ? 'approve' : 'reject'}`)
      load()
    } catch {
      alert('تعذّر تنفيذ الإجراء')
    } finally { setDeciding('') }
  }

  const admins = rows.filter((m) => m.role === 'admin')
  const nameById = new Map(rows.map((m) => [m.id, m.full_name || m.username]))

  // Hierarchy tree built from parent_id. Roots = nodes whose parent isn't in the visible set.
  const childrenOf = (pid: string) => rows.filter((m) => m.parent_id === pid)
  const roots = rows.filter((m) => m.parent_id == null || !rows.some((x) => x.id === m.parent_id))
  const roleLabel: Record<string, string> = { owner: 'المالك', admin: 'مدير', reseller: 'موزّع' }
  const renderNode = (m: Manager, depth: number): any => {
    const kids = childrenOf(m.id)
    return (
      <div key={m.id} className="tree-node">
        <div className="tree-row">
          <span className={'tree-badge tree-' + m.role}>{roleLabel[m.role] ?? m.role}</span>
          <b className="tree-name">{m.username}</b>
          {m.full_name && <span className="tree-fn muted">— {m.full_name}</span>}
          {m.status !== 'active' && <span className="badge disabled">معطّل</span>}
          <span className="tree-count">
            {m.role === 'admin' ? `${m.sub_count} / ${m.max_subscribers ?? '∞'} مشترك`
              : m.role === 'reseller' ? `${m.sub_count} مشترك` : ''}
          </span>
        </div>
        {kids.length > 0 && <div className="tree-children">{kids.map((k) => renderNode(k, depth + 1))}</div>}
      </div>
    )
  }

  async function add(e: FormEvent) {
    e.preventDefault(); setErr('')
    if (isOwner && form.role === 'reseller' && !form.parent_id) {
      setErr('يجب تحديد المدير (admin) التابع له الموزّع'); return
    }
    try {
      await api.post('/managers', {
        ...form,
        parent_id: form.parent_id || undefined,
        max_subscribers: form.max_subscribers ? Number(form.max_subscribers) : null,
      })
      setShowAdd(false); setForm({ ...emptyForm }); load()
    } catch (e: any) {
      const er = e?.response?.data
      if (er?.error === 'username_taken') setErr('اسم المستخدم مستخدم مسبقاً')
      else if (er?.error === 'invalid_input') {
        const fe = er.details?.fieldErrors || {}
        if (fe.email) setErr('البريد الإلكتروني غير صالح — أدخل بريداً صحيحاً أو اتركه فارغاً')
        else if (fe.password) setErr('كلمة المرور يجب أن تكون 4 أحرف على الأقل')
        else if (fe.username) setErr('اسم المستخدم مطلوب')
        else setErr('تحقّق من الحقول المُدخلة')
      } else setErr(er?.message || 'فشل الإضافة')
    }
  }

  async function resetPassword(e: FormEvent) {
    e.preventDefault(); setResetErr('')
    if (!resetFor) return
    if (resetPw.length < 4) { setResetErr('كلمة المرور 4 أحرف على الأقل'); return }
    try {
      await api.post(`/managers/${resetFor.id}/reset-password`, { new_password: resetPw })
      const name = resetFor.username
      setResetFor(null); setResetPw('')
      setMsg(`✅ تم تعيين كلمة مرور جديدة لـ ${name}`); setTimeout(() => setMsg(''), 6000)
    } catch (e: any) {
      setResetErr(e?.response?.data?.message || 'فشل إعادة التعيين')
    }
  }

  async function saveTier(e: FormEvent) {
    e.preventDefault()
    if (!tierFor) return
    try {
      await api.put(`/managers/${tierFor.id}`, { max_subscribers: tierVal === '' ? null : Number(tierVal) })
      const name = tierFor.username
      setTierFor(null)
      setMsg(`✅ حُدّثت حصّة ${name}`); setTimeout(() => setMsg(''), 5000); load()
    } catch { setMsg('فشل تحديث الحصّة'); setTimeout(() => setMsg(''), 5000) }
  }

  function openEdit(m: Manager) {
    setEditFor(m); setEditErr('')
    setEditForm({ full_name: m.full_name ?? '', phone: m.phone ?? '', email: m.email ?? '', company: m.company ?? '', disabled: m.status !== 'active' })
  }
  async function saveEdit(e: FormEvent) {
    e.preventDefault(); setEditErr('')
    if (!editFor) return
    try {
      await api.put(`/managers/${editFor.id}`, {
        full_name: editForm.full_name, phone: editForm.phone, email: editForm.email,
        company: editForm.company, status: editForm.disabled ? 'disabled' : 'active',
      })
      const name = editForm.company || editForm.full_name || editFor.username
      setEditFor(null)
      setMsg(`✅ حُفظت بيانات ${name}`); setTimeout(() => setMsg(''), 5000); load()
    } catch (e: any) {
      setEditErr(e?.response?.data?.details?.fieldErrors?.email ? 'البريد الإلكتروني غير صالح' : 'فشل الحفظ')
    }
  }

  async function del(m: Manager) {
    if (m.role === 'owner') return
    if (!confirm('حذف هذا الحساب؟')) return
    await api.post(`/managers/${m.id}/delete`); load()
  }

  return (
    <div>
      <div className="page-head row">
        <div><h1>المدراء والموزّعون</h1><p>شجرة الموزّعين وحصص المشتركين — {rows.length}</p></div>
        <button className="btn-primary inline" onClick={() => setShowAdd(true)}>{isOwner ? '+ مدير / موزّع' : '+ موزّع جديد'}</button>
      </div>

      {isOwner && pending.length > 0 && (
        <section className="approvals">
          <h2>طلبات تسجيل بانتظار الموافقة <span className="appr-count">{pending.length}</span></h2>
          {pending.map((m) => (
            <div className="appr-row" key={m.id}>
              <div className="appr-who">
                <b>{m.company || m.username}</b>
                <small>{m.full_name} · {m.username}{m.phone ? ` · ${m.phone}` : ''}{m.email ? ` · ${m.email}` : ''}</small>
              </div>
              <span className="appr-tier">{m.max_subscribers} مشترك</span>
              <div className="appr-actions">
                <button className="btn sm" disabled={deciding === m.id} onClick={() => decide(m, false)}>رفض</button>
                <button className="btn-primary inline sm" disabled={deciding === m.id} onClick={() => decide(m, true)}>موافقة</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {msg && <div className="notice">{msg}</div>}

      <div className="tabs" style={{ marginBottom: 14 }}>
        <button className={'tab' + (view === 'table' ? ' active' : '')} onClick={() => setView('table')}>جدول</button>
        <button className={'tab' + (view === 'tree' ? ' active' : '')} onClick={() => setView('tree')}>الشجرة</button>
      </div>

      {view === 'tree' && (
        <div className="tree">
          {roots.length === 0 ? <p className="muted">لا حسابات بعد</p> : roots.map((r) => renderNode(r, 0))}
        </div>
      )}

      {view === 'table' && (
      <table className="tbl">
        <thead>
          <tr><th>الشركة</th><th>الاسم</th><th>الدور</th>{isOwner && <th>المدير التابع له</th>}<th>المشتركون</th><th>الحالة</th><th>إجراءات</th></tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <td data-label="الشركة">
                <b>{m.company || m.username}</b>
                {m.company && <div className="muted" style={{ fontSize: 12 }}>{m.username}</div>}
              </td>
              <td data-label="الاسم">{m.full_name || '—'}</td>
              <td data-label="الدور"><span className="role">{m.role}</span></td>
              {isOwner && (
                <td data-label="المدير التابع له">
                  {m.role === 'reseller'
                    ? (m.parent_id && nameById.get(m.parent_id)
                        ? <span className="tree-badge tree-admin">{nameById.get(m.parent_id)}</span>
                        : <span className="muted">— غير محدّد</span>)
                    : m.role === 'admin' ? <span className="muted">المالك</span> : '—'}
                </td>
              )}
              <td data-label="المشتركون">
                {m.role === 'admin'
                  ? <span className={m.max_subscribers != null && m.sub_count >= m.max_subscribers ? 'neg' : ''}>{m.sub_count} / {m.max_subscribers ?? '∞'}</span>
                  : m.sub_count}
              </td>
              <td data-label="الحالة"><span className={'badge ' + (m.status === 'active' ? 'active' : 'disabled')}>{m.status === 'active' ? 'نشط' : 'معطّل'}</span></td>
              <td data-label="إجراءات" className="row-actions">
                {isOwner && m.role === 'admin' && <button className="btn sm" onClick={() => { setTierFor(m); setTierVal(m.max_subscribers?.toString() ?? '') }}>الحصّة</button>}
                {m.role !== 'owner' && m.id !== user?.id && <button className="btn sm" onClick={() => { setResetFor(m); setResetPw(''); setResetErr('') }}>كلمة المرور</button>}
                {m.role !== 'owner' && <button className="btn sm" onClick={() => openEdit(m)}>تعديل</button>}
                {m.role !== 'owner' && <button className="btn sm danger" onClick={() => del(m)}>حذف</button>}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={isOwner ? 7 : 6} className="empty">لا حسابات بعد</td></tr>}
        </tbody>
      </table>
      )}

      {showAdd && (
        <div className="modal-back" onClick={() => setShowAdd(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={add}>
            <h2>{isOwner ? 'إضافة مدير / موزّع' : 'موزّع جديد'}</h2>
            {isOwner && (
              <>
                <label>الدور</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  <option value="reseller">موزّع (reseller)</option>
                  <option value="admin">مدير (admin)</option>
                </select>
                {form.role === 'admin' && (
                  <>
                    <label>حصّة المشتركين (السقف)</label>
                    <select value={form.max_subscribers} onChange={(e) => setForm({ ...form, max_subscribers: e.target.value })}>
                      {TIERS.map((t) => <option key={t || 'inf'} value={t}>{t === '' ? 'غير محدود' : t + ' مشترك'}</option>)}
                    </select>
                  </>
                )}
                {form.role === 'reseller' && (
                  <>
                    <label>المدير التابع له *</label>
                    {admins.length === 0 ? (
                      <p className="muted" style={{ fontSize: 13 }}>لا يوجد مدراء بعد — أنشئ مديراً (admin) أولاً.</p>
                    ) : (
                      <select value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })}>
                        <option value="">— اختر المدير —</option>
                        {admins.map((a) => <option key={a.id} value={a.id}>{a.full_name || a.username}</option>)}
                      </select>
                    )}
                  </>
                )}
              </>
            )}
            <label>اسم المستخدم</label><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoFocus />
            <label>كلمة المرور</label><input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <label>الاسم الكامل</label><input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            <label>الهاتف</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <label>البريد الإلكتروني</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            {isOwner && form.role === 'admin' && (<><label>اسم الشركة</label><input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="اسم شركة/مزوّد الخدمة" /></>)}
            {err && <div className="error">{err}</div>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setShowAdd(false)}>إلغاء</button>
              <button className="btn-primary">حفظ</button>
            </div>
          </form>
        </div>
      )}

      {resetFor && (
        <div className="modal-back" onClick={() => setResetFor(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={resetPassword}>
            <h2>إعادة تعيين كلمة المرور — {resetFor.username}</h2>
            <p className="muted" style={{ fontSize: 13 }}>سيدخل «{resetFor.username}» بكلمة المرور الجديدة فوراً. أبلِغه بها.</p>
            <label>كلمة المرور الجديدة</label>
            <input type="text" value={resetPw} onChange={(e) => setResetPw(e.target.value)} autoFocus placeholder="4 أحرف على الأقل" />
            {resetErr && <div className="error">{resetErr}</div>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setResetFor(null)}>إلغاء</button>
              <button className="btn-primary">تعيين</button>
            </div>
          </form>
        </div>
      )}

      {tierFor && (
        <div className="modal-back" onClick={() => setTierFor(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={saveTier}>
            <h2>حصّة المشتركين — {tierFor.username}</h2>
            <p className="muted" style={{ fontSize: 13 }}>الاستخدام الحالي: {tierFor.sub_count} مشترك.</p>
            <label>الحدّ الأقصى للمشتركين</label>
            <select value={tierVal} onChange={(e) => setTierVal(e.target.value)}>
              {['4', '50', '100', '200', '500', '1000', ''].map((t) => <option key={t || 'inf'} value={t}>{t === '' ? 'غير محدود' : t + ' مشترك'}</option>)}
            </select>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setTierFor(null)}>إلغاء</button>
              <button className="btn-primary">حفظ</button>
            </div>
          </form>
        </div>
      )}

      {editFor && (
        <div className="modal-back" onClick={() => setEditFor(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={saveEdit}>
            <h2>تعديل الحساب — {editFor.company || editFor.username}</h2>
            {editFor.role === 'admin' && (<><label>اسم الشركة</label><input value={editForm.company} onChange={(e) => setEditForm({ ...editForm, company: e.target.value })} autoFocus /></>)}
            <label>الاسم الكامل</label><input value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} />
            <label>الهاتف</label><input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
            <label>البريد الإلكتروني</label><input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
            <label className="chk"><input type="checkbox" checked={editForm.disabled} onChange={(e) => setEditForm({ ...editForm, disabled: e.target.checked })} /> تعطيل الحساب (منع الدخول)</label>
            {editErr && <div className="error">{editErr}</div>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setEditFor(null)}>إلغاء</button>
              <button className="btn-primary">حفظ</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
