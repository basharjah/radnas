import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import ThemeToggle from '../components/ThemeToggle'
import { Logo } from '../components/Logo'

const TIERS = [
  { v: 25, name: 'مجاني', desc: '25 مشتركاً — ابدأ فوراً', free: true },
  { v: 50, name: '50', desc: 'مشترك' },
  { v: 100, name: '100', desc: 'مشترك' },
  { v: 200, name: '200', desc: 'مشترك' },
  { v: 500, name: '500', desc: 'مشترك' },
  { v: 1000, name: '1000', desc: 'مشترك' },
]

interface TierPrice { subscribers: number; free: boolean; price: number | null }

/**
 * Saving = how much cheaper this tier is PER SUBSCRIBER than the smallest paid tier. That is the
 * only comparison the tier ladder actually makes, and it is what makes moving up look worthwhile.
 * Returns null unless both prices are known, so an unpriced tier never shows an invented figure.
 */
function savingPct(t: TierPrice, base: TierPrice | undefined): number | null {
  if (!base || t.free || t.price == null || base.price == null || base.subscribers === t.subscribers) return null
  const per = t.price / t.subscribers
  const basePer = base.price / base.subscribers
  if (!(basePer > 0) || per >= basePer) return null
  return Math.round((1 - per / basePer) * 100)
}

export default function Register() {
  const [step, setStep] = useState(1)
  // Landing page links here as /register?tier=N — honour it, but only if it is a real tier.
  const [params] = useSearchParams()
  const wanted = Number(params.get('tier'))
  const [tier, setTier] = useState(TIERS.some((t) => t.v === wanted) ? wanted : 25)
  const [form, setForm] = useState({ company: '', full_name: '', email: '', phone: '', username: '', password: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  // Prices come from the same public endpoint the landing page uses, so the two can never disagree.
  const [prices, setPrices] = useState<TierPrice[]>([])
  const [currency, setCurrency] = useState('USD')
  useEffect(() => {
    api.get('/auth/tiers').then((r) => { setPrices(r.data.tiers || []); setCurrency(r.data.currency || 'USD') }).catch(() => {})
  }, [])
  const sym = currency === 'USD' ? '$' : currency
  const basePaid = prices.find((t) => !t.free && t.price != null)
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      await api.post('/auth/register', { ...form, max_subscribers: tier })
      setDone(true) // no token any more — the account waits for the owner's approval
    } catch (e: any) {
      const er = e?.response?.data
      setErr(
        er?.error === 'username_taken' ? 'اسم المستخدم مستخدم مسبقاً'
          : er?.error === 'invalid_tier' ? 'باقة غير صالحة'
          : er?.error === 'invalid_input' ? 'تحقّق: كلمة المرور 6 أحرف على الأقل، اسم المستخدم 3 على الأقل، والبريد صحيح أو فارغ'
          : 'فشل إنشاء الحساب',
      )
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <ThemeToggle />
      <div className="login-card register-card">
        <div className="brand"><Logo /> Rad<b>Nas</b></div>
        <p className="brand-sub">إنشاء حساب شركة جديدة</p>

        {done ? (
          <div className="reg-done">
            <div className="reg-done-mark" aria-hidden="true">✓</div>
            <h2>تم استلام طلبك</h2>
            <p>
              حساب <b>{form.company || form.username}</b> أُنشئ وهو <b>بانتظار موافقة الإدارة</b>.
              لن تتمكّن من تسجيل الدخول حتى تتم الموافقة.
            </p>
            <p className="muted">سنبلغك عند التفعيل. يمكنك إغلاق هذه الصفحة.</p>
            <a className="btn-primary inline" href="/login">العودة لتسجيل الدخول</a>
          </div>
        ) : (
        <>
        <div className="reg-steps">
          <span className={step === 1 ? 'on' : ''}>①&nbsp; الباقة</span>
          <span className={step === 2 ? 'on' : ''}>②&nbsp; بيانات الشركة</span>
        </div>

        {step === 1 && (
          <>
            <div className="tier-grid">
              {TIERS.map((t) => {
                const pr = prices.find((x) => x.subscribers === t.v)
                const save = pr ? savingPct(pr, basePaid) : null
                return (
                    <button type="button" key={t.v}
                      className={'tier-card' + (tier === t.v ? ' sel' : '') + (t.free ? ' free' : '')}
                      onClick={() => setTier(t.v)}>
                      {t.free && <span className="tier-badge">مجاني</span>}
                      {save != null && <span className="tier-save">وفّر {save}%</span>}
                      <b>{t.name}</b>
                      <span>{t.desc}</span>
                      {!t.free && (
                        <span className="tier-price-line">
                          {pr?.price != null
                            ? <><b dir="ltr">{sym}{pr.price}</b> / شهرياً</>
                            : 'تواصل معنا'}
                        </span>
                      )}
                  </button>
                )
              })}
            </div>
            <button className="btn-primary" onClick={() => setStep(2)}>التالي ←</button>
            <a className="reg-alt" href="/login">لديك حساب؟ تسجيل الدخول</a>
          </>
        )}

        {step === 2 && (
          <form onSubmit={submit}>
            <label>اسم الشركة</label>
            <input value={form.company} onChange={(e) => set('company', e.target.value)} autoFocus />
            <label>الاسم الكامل</label>
            <input value={form.full_name} onChange={(e) => set('full_name', e.target.value)} />
            <label>الهاتف</label>
            <input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            <label>البريد الإلكتروني (اختياري)</label>
            <input value={form.email} onChange={(e) => set('email', e.target.value)} />
            <label>اسم المستخدم (للدخول)</label>
            <input value={form.username} onChange={(e) => set('username', e.target.value)} />
            <label>كلمة المرور</label>
            <input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} />
            <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>الباقة المختارة: <b>{tier === 25 ? 'مجاني (25 مشتركاً)' : tier + ' مشترك'}</b></p>
            {err && <div className="error">{err}</div>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setStep(1)}>رجوع</button>
              <button className="btn-primary" disabled={busy}>{busy ? '…' : 'إنشاء الحساب'}</button>
            </div>
          </form>
        )}
        </>
        )}
        <Link className="back-home" to="/">← العودة إلى الصفحة الرئيسية</Link>
      </div>
    </div>
  )
}
