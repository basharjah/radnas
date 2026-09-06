import { useEffect, useState } from 'react'
import { api } from '../api'
import { disablePush, enablePush, pushState, type PushState } from '../push'

/**
 * The bell in the header: turns browser notifications on for THIS device.
 *
 * Per-device rather than per-account on purpose — permission belongs to the browser, so an operator
 * who enables it on the office desktop has not enabled it on their phone, and pretending otherwise
 * would leave them waiting for alerts that were never going to arrive. The label says which it is.
 */
export default function PushToggle() {
  const [st, setSt] = useState<PushState | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [devices, setDevices] = useState(0)

  const refresh = async () => {
    setSt(await pushState())
    try { setDevices((await api.get('/push/status')).data.devices ?? 0) } catch { /* not fatal */ }
  }
  useEffect(() => { refresh() }, [])

  const on = !!st && st.supported && st.subscribed && st.permission === 'granted'

  async function turnOn() {
    setBusy(true); setNote('')
    const err = await enablePush()
    setNote(err ?? '✅ تم تفعيل الإشعارات على هذا الجهاز')
    await refresh()
    setBusy(false)
  }
  async function turnOff() {
    setBusy(true); setNote('')
    await disablePush()
    setNote('أُوقفت الإشعارات على هذا الجهاز')
    await refresh()
    setBusy(false)
  }
  async function test() {
    setBusy(true); setNote('')
    try {
      await api.post('/push/test')
      setNote('أُرسل إشعار تجريبي — إن لم يظهر فتحقّق من إعدادات نظامك.')
    } catch (e: any) {
      setNote(e?.response?.data?.message || 'تعذّر الإرسال')
    }
    setBusy(false)
  }

  return (
    <>
      <button className={'icon-btn' + (on ? ' bell-on' : '')} onClick={() => setOpen(true)}
        aria-label="الإشعارات" title={on ? 'الإشعارات مفعّلة على هذا الجهاز' : 'الإشعارات'}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          {!on && <line x1="3" y1="3" x2="21" y2="21" />}
        </svg>
      </button>

      {open && (
        <div className="modal-back" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>الإشعارات</h2>

            {st && !st.supported ? (
              <p className="error" style={{ lineHeight: 1.9 }}>
                {st.reason === 'ios_needs_install'
                  ? 'على iPhone وiPad: افتح قائمة المشاركة ← «إضافة إلى الشاشة الرئيسية»، ثم شغّل الإشعارات من التطبيق المُضاف. سفاري لا يوصّلها من المتصفّح نفسه.'
                  : st.reason === 'insecure'
                    ? 'الإشعارات تحتاج اتصالاً آمناً (HTTPS).'
                    : 'هذا المتصفّح لا يدعم إشعارات الويب. جرّب Chrome أو Edge أو Firefox.'}
              </p>
            ) : (
              <>
                <p style={{ lineHeight: 1.9 }}>
                  تصلك تنبيهات <b>انتهاء الاشتراكات</b> و<b>تجاوز الحصص</b> و<b>التجديدات</b> على
                  هذا الجهاز، حتى واللوحة مغلقة.
                </p>
                <p className="muted" style={{ fontSize: 13, lineHeight: 1.8 }}>
                  الإذن يُمنح لكل متصفّح على حِدة — تفعيله هنا لا يفعّله على جوّالك.
                  {devices > 0 && ` أجهزتك المفعّلة حالياً: ${devices}.`}
                </p>

                <div className="modal-actions">
                  {on
                    ? <button className="btn" disabled={busy} onClick={turnOff}>إيقاف على هذا الجهاز</button>
                    : <button className="btn primary" disabled={busy} onClick={turnOn}>
                        {busy ? 'جارٍ…' : 'تفعيل على هذا الجهاز'}
                      </button>}
                  {devices > 0 && <button className="btn" disabled={busy} onClick={test}>إرسال تجريبي</button>}
                  <button className="btn" onClick={() => setOpen(false)}>إغلاق</button>
                </div>
              </>
            )}

            {note && <div className={note.startsWith('✅') ? 'msg' : 'error'} style={{ marginTop: 12, lineHeight: 1.8 }}>{note}</div>}
          </div>
        </div>
      )}
    </>
  )
}
