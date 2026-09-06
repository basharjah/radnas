import { useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'

interface General { timezone: string; fixed_expiry_time: string; mac_auto_lock: boolean; expired_pool_redirect: boolean }

const SIGNUP_TIERS = [25, 50, 100, 200, 500, 1000] // mirrors auth.ts SIGNUP_TIERS

export default function Settings() {
  const { user } = useAuth()
  const isOwner = user?.role === 'owner'
  const [s, setS] = useState<General | null>(null)
  const [msg, setMsg] = useState('')
  // Prices shown on the public landing page. Kept as strings so a field can be emptied —
  // an empty price is meaningful here: the tier renders as «تواصل معنا» instead of a number.
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [currency, setCurrency] = useState('USD')
  const [note, setNote] = useState('')

  useEffect(() => { api.get('/settings').then((r) => setS(r.data)) }, [])
  useEffect(() => {
    if (!isOwner) return
    api.get('/settings/tiers').then((r) => {
      const p = r.data?.prices ?? {}
      setPrices(Object.fromEntries(SIGNUP_TIERS.map((t) => [String(t), p[String(t)] != null ? String(p[String(t)]) : ''])))
      setCurrency(r.data?.currency || 'USD')
      setNote(r.data?.note || '')
    }).catch(() => {})
  }, [isOwner])

  async function saveTiers() {
    await api.put('/settings/tiers', { prices, currency, note })
    setMsg('حُفظت الأسعار ✅'); setTimeout(() => setMsg(''), 3000)
  }

  async function save() {
    const r = await api.put('/settings', s)
    setS(r.data); setMsg('تم الحفظ ✅'); setTimeout(() => setMsg(''), 3000)
  }
  if (!s) return <div className="center">جارٍ التحميل…</div>

  return (
    <div>
      <div className="page-head"><h1>الإعدادات</h1><p>إعدادات النظام العامة</p></div>
      {msg && <div className="notice">{msg}</div>}
      <div className="form-card">
        <label>المنطقة الزمنية</label>
        <input value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} />
        <label>وقت الانتهاء الثابت (ساعة:دقيقة)</label>
        <input value={s.fixed_expiry_time} onChange={(e) => setS({ ...s, fixed_expiry_time: e.target.value })} placeholder="15:00" />
        <label className="chk"><input type="checkbox" checked={s.mac_auto_lock} onChange={(e) => setS({ ...s, mac_auto_lock: e.target.checked })} /> قفل MAC تلقائياً عند أول اتصال</label>
        <label className="chk"><input type="checkbox" checked={s.expired_pool_redirect} onChange={(e) => setS({ ...s, expired_pool_redirect: e.target.checked })} /> تحويل المشتركين المنتهين إلى expired pool</label>
        <button className="btn-primary" onClick={save}>حفظ</button>
      </div>

      {isOwner && (
        <div className="form-card" style={{ marginTop: 16 }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>أسعار الشرائح (الصفحة الرئيسية)</h2>
          <p className="muted" style={{ fontSize: 13, margin: '0 0 10px', lineHeight: 1.7 }}>
            تظهر للزوّار على radnas.com. اترك الحقل فارغاً لتُعرض الشريحة كـ«تواصل معنا»
            بدل رقم. الشريحة الأولى ({SIGNUP_TIERS[0]} مشتركاً) مجانية دائماً.
          </p>
          <div className="tier-price-grid">
            {SIGNUP_TIERS.map((t, i) => (
              <div className="tier-price" key={t}>
                <label>{t.toLocaleString('en-US')} مشترك{i === 0 ? ' (مجاني)' : ''}</label>
                <input dir="ltr" inputMode="decimal" disabled={i === 0}
                  placeholder={i === 0 ? 'مجاني' : 'السعر الشهري'}
                  value={i === 0 ? '' : (prices[String(t)] ?? '')}
                  onChange={(e) => setPrices({ ...prices, [String(t)]: e.target.value.replace(/[^\d.]/g, '') })} />
              </div>
            ))}
          </div>
          <label>العملة</label>
          <input dir="ltr" value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="USD" />
          <label>ملاحظة تحت الأسعار (اختياري)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: الأسعار سنوية بخصم شهرين" />
          <button className="btn-primary" onClick={saveTiers}>حفظ الأسعار</button>
        </div>
      )}
    </div>
  )
}
