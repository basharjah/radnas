import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'
import { money } from '../format'
import { useAuth } from '../auth'

interface Plan {
  id: string
  name: string
  type: string
  price: string
  download_mbps: number
  upload_mbps: number
  duration_value: number
  duration_unit: string
  daily_quota_mb: number | null
  monthly_quota_mb: number | null
  mikrotik_pool: string | null
  expired_pool: string | null
  fup_down_kbps: number | null
  fup_up_kbps: number | null
  fup_behavior: string | null
  owner_username: string | null
  subscribers_count: number
}

const empty = {
  name: '', type: 'pppoe', price: 0, daily_reset_price: 0,
  download_mbps: 0, upload_mbps: 0, duration_value: 30, duration_unit: 'days',
  quota_mode: 'unlimited', fup_behavior: 'throttle',
  daily_quota_gb: '', monthly_quota_gb: '', mikrotik_pool: '', expired_pool: '',
  fup_down_kbps: '', fup_up_kbps: '',
}

const unitLabel: Record<string, string> = { days: 'يوم', hours: 'ساعة', months: 'شهر' }
const gb = (mb: number) => +(mb / 1024).toFixed(2)   // MB → GB

export default function Plans() {
  const { user } = useAuth()
  const isOwner = user?.role === 'owner'
  const canManage = user?.role === 'admin'   // only admins create/edit/delete their own plans; owner = view-only
  const [plans, setPlans] = useState<Plan[]>([])
  const [show, setShow] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, any>>(empty)
  const [err, setErr] = useState('')

  const load = () => api.get('/plans').then((r) => setPlans(r.data.data))
  useEffect(() => { load() }, [])

  const openNew = () => { setForm(empty); setEditId(null); setErr(''); setShow(true) }
  const openEdit = (p: Plan) => {
    const limited = !!(p.daily_quota_mb || p.monthly_quota_mb)
    setForm({
      name: p.name, type: p.type, price: Number(p.price), daily_reset_price: 0,
      download_mbps: p.download_mbps, upload_mbps: p.upload_mbps,
      duration_value: p.duration_value, duration_unit: p.duration_unit,
      quota_mode: limited ? 'limited' : 'unlimited',
      fup_behavior: p.fup_behavior ?? 'throttle',
      daily_quota_gb: p.daily_quota_mb ? String(gb(p.daily_quota_mb)) : '',
      monthly_quota_gb: p.monthly_quota_mb ? String(gb(p.monthly_quota_mb)) : '',
      mikrotik_pool: p.mikrotik_pool ?? '', expired_pool: p.expired_pool ?? '',
      fup_down_kbps: p.fup_down_kbps ?? '', fup_up_kbps: p.fup_up_kbps ?? '',
    })
    setEditId(p.id); setErr(''); setShow(true)
  }

  async function save(e: FormEvent) {
    e.preventDefault(); setErr('')
    const limited = form.quota_mode === 'limited'
    const monthly = form.duration_unit === 'months'   // month-plan → monthly quota; day/hour-plan → daily quota
    if (limited) {
      const qty = Number(monthly ? form.monthly_quota_gb : form.daily_quota_gb)
      if (!(qty > 0)) { setErr(monthly ? 'الحصّة الشهرية إجبارية (أكبر من صفر).' : 'الحصّة اليومية إجبارية (أكبر من صفر).'); return }
      if (form.fup_behavior === 'throttle' && (!(Number(form.fup_down_kbps) > 0) || !(Number(form.fup_up_kbps) > 0))) {
        setErr('عند «تخفيض السرعة»: حدّد سرعتَي التنزيل والرفع بعد التجاوز (Kbps).'); return
      }
    }
    const body = {
      ...form,
      daily_quota_mb: limited && !monthly ? Math.round(Number(form.daily_quota_gb) * 1024) : null,
      monthly_quota_mb: limited && monthly ? Math.round(Number(form.monthly_quota_gb) * 1024) : null,
      fup_behavior: limited ? form.fup_behavior : 'throttle',
      fup_down_kbps: limited && form.fup_behavior === 'throttle' && form.fup_down_kbps !== '' ? Number(form.fup_down_kbps) : null,
      fup_up_kbps: limited && form.fup_behavior === 'throttle' && form.fup_up_kbps !== '' ? Number(form.fup_up_kbps) : null,
    }
    try {
      if (editId) await api.put(`/plans/${editId}`, body)
      else await api.post('/plans', body)
      setShow(false); load()
    } catch { setErr('فشل حفظ الباقة') }
  }

  async function del(id: string) {
    if (!confirm('حذف هذه الباقة؟')) return
    await api.post(`/plans/${id}/delete`); load()
  }

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }))
  const limited = form.quota_mode === 'limited'
  const isMonthly = form.duration_unit === 'months'
  // Duration is «يوم» or «شهر». Day-based plans use a daily quota; monthly plans use a monthly quota.
  const changeUnit = (u: string) => setForm((f) => ({
    ...f, duration_unit: u, duration_value: u === 'months' ? 1 : u === 'hours' ? 1 : 7,
    ...(u === 'months' ? { daily_quota_gb: '' } : { monthly_quota_gb: '' }),
  }))
  // Day dropdown goes 1..30; picking 30 promotes the plan to «شهري» (monthly).
  const changeDays = (n: number) => n >= 30
    ? setForm((f) => ({ ...f, duration_unit: 'months', duration_value: 1, daily_quota_gb: '' }))
    : setForm((f) => ({ ...f, duration_unit: 'days', duration_value: n }))

  return (
    <div>
      <div className="page-head row">
        <div><h1>الباقات</h1><p>{isOwner ? 'عرض باقات كل المدراء (للاطّلاع فقط)' : 'إدارة باقاتك الخاصة'} — {plans.length}</p></div>
        {canManage && <button className="btn-primary inline" onClick={openNew}>+ باقة جديدة</button>}
      </div>

      <div className="plan-grid">
        {plans.map((p) => {
          const isLimited = !!(p.daily_quota_mb || p.monthly_quota_mb)
          return (
          <div key={p.id} className="plan-card">
            <div className="plan-top">
              <span className="plan-name">{p.name}</span>
              <span className="plan-count">{p.subscribers_count} مشترك</span>
            </div>
            <div className="plan-price">{money(p.price)} <small>/ {p.duration_value} {unitLabel[p.duration_unit] ?? p.duration_unit}</small></div>
            {isOwner && <div className="plan-spec"><span>المدير</span><b>{p.owner_username || '— عام'}</b></div>}
            <div className="plan-spec"><span>⬇ تنزيل</span><b>{p.download_mbps} Mbps</b></div>
            <div className="plan-spec"><span>⬆ رفع</span><b>{p.upload_mbps} Mbps</b></div>
            <div className="plan-spec"><span>النوع</span><b>{isLimited ? 'محدودة' : 'غير محدودة'}</b></div>
            {isLimited && <div className="plan-spec"><span>حصة شهرية</span><b>{p.monthly_quota_mb ? gb(p.monthly_quota_mb) + ' GB' : '—'}</b></div>}
            {isLimited && p.daily_quota_mb ? <div className="plan-spec"><span>حصة يومية</span><b>{gb(p.daily_quota_mb)} GB</b></div> : null}
            {canManage && (
              <div className="plan-actions">
                <button className="btn sm" onClick={() => openEdit(p)}>تعديل</button>
                <button className="btn sm danger" onClick={() => del(p.id)}>حذف</button>
              </div>
            )}
          </div>
          )
        })}
        {plans.length === 0 && <p className="muted">لا باقات بعد.</p>}
      </div>

      {show && (
        <div className="modal-back" onClick={() => setShow(false)}>
          <form className="modal wide" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <h2>{editId ? 'تعديل باقة' : 'باقة جديدة'}</h2>
            <div className="grid2">
              <div><label>اسم الباقة</label><input value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
              <div><label>السعر</label><input type="number" value={form.price} onChange={(e) => set('price', e.target.value)} /></div>
              <div><label>سرعة التنزيل (Mbps)</label><input type="number" value={form.download_mbps} onChange={(e) => set('download_mbps', e.target.value)} /></div>
              <div><label>سرعة الرفع (Mbps)</label><input type="number" value={form.upload_mbps} onChange={(e) => set('upload_mbps', e.target.value)} /></div>
              <div><label>وحدة المدة</label>
                <select value={isMonthly ? 'months' : form.duration_unit === 'hours' ? 'hours' : 'days'} onChange={(e) => changeUnit(e.target.value)}>
                  <option value="days">يوم</option><option value="months">شهر</option><option value="hours">ساعة</option>
                </select>
              </div>
              <div><label>{isMonthly ? 'عدد الأشهر' : form.duration_unit === 'hours' ? 'عدد الساعات' : 'عدد الأيام'}</label>
                {form.duration_unit === 'days'
                  ? <select value={form.duration_value} onChange={(e) => changeDays(Number(e.target.value))}>
                      {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d === 30 ? '30 (شهري)' : d + ' يوم'}</option>)}
                    </select>
                  : isMonthly
                  ? <select value={form.duration_value} onChange={(e) => set('duration_value', Number(e.target.value))}>
                      {[1, 2, 3, 6, 12].map((m) => <option key={m} value={m}>{m} شهر</option>)}
                    </select>
                  : <input type="number" min="1" value={form.duration_value} onChange={(e) => set('duration_value', e.target.value)} />}
              </div>
              <div><label>Mikrotik pool</label><input value={form.mikrotik_pool} onChange={(e) => set('mikrotik_pool', e.target.value)} placeholder="main_PPP" /></div>
              <div><label>Expired pool</label><input value={form.expired_pool} onChange={(e) => set('expired_pool', e.target.value)} placeholder="expired_PPP" /></div>
            </div>

            <label style={{ marginTop: 16 }}>نوع الاستهلاك</label>
            <div className="tabs" style={{ marginTop: 6 }}>
              <button type="button" className={'tab' + (!limited ? ' active' : '')} onClick={() => set('quota_mode', 'unlimited')}>غير محدودة</button>
              <button type="button" className={'tab' + (limited ? ' active' : '')} onClick={() => set('quota_mode', 'limited')}>محدودة (بحصّة استهلاك)</button>
            </div>

            {limited && (
              <div className="grid2" style={{ marginTop: 14 }}>
                {isMonthly
                  ? <div><label>الحصّة الشهرية (GB) *</label><input type="number" step="0.1" min="0" value={form.monthly_quota_gb} onChange={(e) => set('monthly_quota_gb', e.target.value)} placeholder="مثال: 50" /></div>
                  : <div><label>الحصّة اليومية (GB) *</label><input type="number" step="0.1" min="0" value={form.daily_quota_gb} onChange={(e) => set('daily_quota_gb', e.target.value)} placeholder="مثال: 2" /></div>}
                <div><label>عند تجاوز الحصّة</label>
                  <select value={form.fup_behavior} onChange={(e) => set('fup_behavior', e.target.value)}>
                    <option value="throttle">تخفيض السرعة (FUP)</option>
                    <option value="block">حظر الدخول</option>
                    <option value="disconnect">قطع الاتصال</option>
                  </select>
                </div>
                {form.fup_behavior === 'throttle' && <>
                  <div><label>سرعة التنزيل بعد التجاوز (Kbps) *</label><input type="number" min="0" value={form.fup_down_kbps} onChange={(e) => set('fup_down_kbps', e.target.value)} placeholder="مثال: 512" /></div>
                  <div><label>سرعة الرفع بعد التجاوز (Kbps) *</label><input type="number" min="0" value={form.fup_up_kbps} onChange={(e) => set('fup_up_kbps', e.target.value)} placeholder="مثال: 512" /></div>
                </>}
              </div>
            )}

            {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}
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
