import { useEffect, useState } from 'react'
import { api } from '../api'

interface Tg {
  chat_ids: string
  has_own_bot: boolean
  is_owner: boolean
  platform_bot_set?: boolean
}

/**
 * Telegram alerts, configured per account.
 *
 * Every role sees this page now and sets its OWN destination — an event about a company's
 * subscribers reaches that company, the same way push already worked. Only the platform bot, which
 * every tenant without its own falls back to, stays owner-only.
 */
export default function Telegram() {
  const [t, setT] = useState<Tg | null>(null)
  const [chatIds, setChatIds] = useState('')
  const [ownToken, setOwnToken] = useState('')
  const [platformToken, setPlatformToken] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [chats, setChats] = useState<{ id: string; type: string; name: string }[] | null>(null)

  useEffect(() => {
    api.get('/telegram').then((r) => { setT(r.data); setChatIds(r.data.chat_ids || '') })
  }, [])

  const flash = (m: string) => { setMsg(m); setErr(''); setTimeout(() => setMsg(''), 4000) }
  const fail = (e: any) => setErr(e?.response?.data?.message || 'حدث خطأ')

  async function save() {
    setBusy('save'); setErr('')
    try {
      // An untouched token field must not clear a stored one, so it is only sent when typed into.
      const body: Record<string, unknown> = { chat_ids: chatIds }
      if (ownToken.trim()) body.bot_token = ownToken.trim()
      const r = await api.put('/telegram', body)
      setT((p) => (p ? { ...p, chat_ids: r.data.chat_ids, has_own_bot: r.data.has_own_bot } : p))
      setOwnToken('')
      flash('تم الحفظ ✅')
    } catch (e) { fail(e) } finally { setBusy('') }
  }

  async function savePlatform() {
    setBusy('plat'); setErr('')
    try {
      const r = await api.put('/telegram/platform-bot', { bot_token: platformToken.trim() })
      setT((p) => (p ? { ...p, platform_bot_set: r.data.platform_bot_set } : p))
      setPlatformToken('')
      flash('تم حفظ بوت المنصّة ✅')
    } catch (e) { fail(e) } finally { setBusy('') }
  }

  async function clearOwnBot() {
    setBusy('save'); setErr('')
    try {
      await api.put('/telegram', { bot_token: '' })
      setT((p) => (p ? { ...p, has_own_bot: false } : p))
      flash('عاد الحساب إلى بوت المنصّة')
    } catch (e) { fail(e) } finally { setBusy('') }
  }

  async function discover() {
    setBusy('find'); setErr(''); setChats(null)
    try {
      const body = ownToken.trim() ? { bot_token: ownToken.trim() } : {}
      const r = await api.post('/telegram/discover', body)
      setChats(r.data.chats)
    } catch (e) { fail(e) } finally { setBusy('') }
  }

  async function test() {
    setBusy('test'); setErr('')
    try {
      const r = await api.post('/telegram/test')
      flash(r.data.via === 'own' ? 'وصلت عبر بوتك ✅' : 'وصلت عبر بوت المنصّة ✅')
    } catch (e) { fail(e) } finally { setBusy('') }
  }

  /** Append rather than replace: a person and a team group may both want the alerts. */
  function useChat(id: string) {
    const have = chatIds.split(/[\s,]+/).filter(Boolean)
    if (!have.includes(id)) setChatIds([...have, id].join(', '))
  }

  if (!t) return <div className="page-head"><h1>إشعارات تيليجرام</h1></div>

  return (
    <div>
      <div className="page-head">
        <h1>إشعارات تيليجرام</h1>
        <p>تنبيهات الانتهاء والحصص تصل إلى محادثتك أنت — لا إلى حساب آخر</p>
      </div>

      {msg && <div className="notice">{msg}</div>}
      {err && <div className="error">{err}</div>}

      <div className="form-card">
        <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>وجهتك</h2>
        <p className="muted" style={{ margin: '0 0 14px', fontSize: 13, lineHeight: 1.8 }}>
          {t.has_own_bot
            ? 'تُرسل الإشعارات عبر بوتك الخاص.'
            : 'تُرسل الإشعارات عبر بوت المنصّة — يكفيك معرّف المحادثة.'}
        </p>

        <label>معرّفات المحادثة</label>
        <input value={chatIds} dir="ltr" spellCheck={false} autoComplete="off"
          onChange={(e) => setChatIds(e.target.value)} placeholder="افصل بينها بفاصلة" />

        <div className="row-actions" style={{ marginTop: 14 }}>
          <button className="btn-primary" disabled={busy === 'save'} onClick={save}>
            {busy === 'save' ? '…' : 'حفظ'}
          </button>
          <button className="btn" disabled={!!busy} onClick={discover}>
            {busy === 'find' ? 'جارٍ البحث…' : 'اكتشف معرّفات المحادثات'}
          </button>
          <button className="btn" disabled={!!busy || !t.chat_ids} onClick={test}>
            {busy === 'test' ? '…' : 'إرسال رسالة اختبار'}
          </button>
        </div>

        {chats && (
          <div className="tg-chats">
            {chats.length === 0 ? (
              <p className="muted" style={{ margin: 0, lineHeight: 1.9 }}>
                لم يراسل أحدٌ البوت بعد. افتح تيليجرام، ابحث عن البوت، واضغط <b>Start</b> — ثم أعد
                الضغط هنا. تيليجرام لا يسمح للبوت بمراسلة من لم يبدأ محادثته، فهذه الخطوة لازمة على
                أي حال.
              </p>
            ) : (
              <>
                <p className="muted" style={{ margin: '0 0 8px' }}>مَن راسل البوت:</p>
                {chats.map((c) => (
                  <div key={c.id} className="tg-chat">
                    <span className="tg-chat-name">{c.name}</span>
                    <span className="tg-chat-id" dir="ltr">{c.id}</span>
                    <span className="tg-chat-type">{c.type === 'private' ? 'خاص' : 'مجموعة'}</span>
                    <button className="btn sm" onClick={() => useChat(c.id)}>استخدم</button>
                  </div>
                ))}
                <p className="muted" style={{ margin: '8px 0 0', fontSize: 12.5 }}>لا تنسَ الحفظ بعد الاختيار.</p>
              </>
            )}
          </div>
        )}
      </div>

      <div className="form-card" style={{ marginTop: 16 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>بوتك الخاص <span className="onb-opt">اختياري</span></h2>
        <p className="muted" style={{ margin: '0 0 14px', fontSize: 13, lineHeight: 1.8 }}>
          اتركه فارغاً لتصلك الرسائل من بوت المنصّة. أضف بوتاً خاصاً إن أردت أن تصل باسم شركتك —
          أنشئه من <span dir="ltr">@BotFather</span> بالأمر <span dir="ltr">/newbot</span>.
        </p>
        <label>رمز البوت{t.has_own_bot ? ' (محفوظ — اكتب رمزاً جديداً لتبديله)' : ''}</label>
        <input value={ownToken} dir="ltr" spellCheck={false} autoComplete="off" type="password"
          onChange={(e) => setOwnToken(e.target.value)}
          placeholder={t.has_own_bot ? '••••••••' : '123456789:AA…'} />
        {t.has_own_bot && (
          <button className="btn sm" style={{ marginTop: 12 }} disabled={!!busy} onClick={clearOwnBot}>
            إزالة بوتي والعودة لبوت المنصّة
          </button>
        )}
      </div>

      {t.is_owner && (
        <div className="form-card" style={{ marginTop: 16 }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>بوت المنصّة</h2>
          <p className="muted" style={{ margin: '0 0 14px', fontSize: 13, lineHeight: 1.8 }}>
            البوت الذي تُرسل عبره كل الشركات التي لم تُضف بوتاً خاصاً. تبديله يغيّر مصدر رسائلهم
            جميعاً، ولهذا يقتصر على حسابك.
            {t.platform_bot_set ? ' — مضبوط حالياً.' : ' — غير مضبوط بعد.'}
          </p>
          <label>رمز بوت المنصّة</label>
          <input value={platformToken} dir="ltr" spellCheck={false} autoComplete="off" type="password"
            onChange={(e) => setPlatformToken(e.target.value)}
            placeholder={t.platform_bot_set ? '••••••••' : '123456789:AA…'} />
          <div className="row-actions" style={{ marginTop: 14 }}>
            <button className="btn-primary" disabled={busy === 'plat'} onClick={savePlatform}>
              {busy === 'plat' ? '…' : 'حفظ بوت المنصّة'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
