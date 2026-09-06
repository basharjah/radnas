import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'

/**
 * First-run checklist for a newly approved company.
 *
 * Steps tick themselves from the account's real data (see routes/onboarding.ts), so this is a live
 * progress view rather than a tour that claims things are done. The router step carries the actual
 * commands with THIS tenant's own address and secret — that is the step a new ISP gets stuck on,
 * and sending them off to hunt for their own credentials is where a guide usually fails.
 */
interface Step { key: string; done: boolean; count: number; optional?: boolean }
interface Nas { id: string; nasname: string; secret: string; shortname: string | null; has_tunnel: boolean; iface: string | null }
interface Data { applicable: boolean; steps: Step[]; done: boolean; dismissed: boolean; nas: Nas | null }
interface Check { key: string; ok: boolean; detail: string }
interface TestResult { ok: boolean; checks: Check[] }

/**
 * One per-tenant tag, derived from the router's own name, that names every object RadNas creates on
 * that router: the API account, the comment on each rule, and the tunnel interface `wg-<tag>`
 * written by the provisioning script handed to the operator.
 *
 * The guide used to hand everyone the same `radnas-api` and `wg-radnas`. Neither is a technical clash
 * — the objects live on each company's OWN router — but identical names invite reusing one password
 * across tenants, make two rows indistinguishable in the owner's NAS list, and leave nobody able to
 * tell whose rule they are looking at when two configs ever meet on one device. A distinct tag
 * removes all three. Falls back to the address when the short name has no latin characters
 * (e.g. an Arabic label).
 */
export function tagFor(nas: { shortname: string | null; nasname: string }): string {
  const slug = (nas.shortname || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || nas.nasname.replace(/[.]/g, '-')
}

/**
 * Fetch the router's setup script through the caller's own session and hand it to the browser.
 *
 * It travels as an authenticated API response, not a public link: the file carries the tunnel key and
 * the RADIUS secret, and a URL anyone could replay is the one thing we must not create. Errors arrive
 * as a blob because of `responseType`, so they are read back as text before being shown.
 */
async function downloadScript(nasId: string): Promise<string | null> {
  try {
    const r = await api.get(`/nas/${nasId}/script`, { responseType: 'blob' })
    const cd = (r.headers['content-disposition'] as string) || ''
    const name = /filename="([^"]+)"/.exec(cd)?.[1] || 'radnas.auto.rsc'
    // Re-type the blob for the same reason the server sends octet-stream: a text/plain blob makes
    // Chrome append .txt to the download name even though `a.download` names it exactly.
    const url = URL.createObjectURL(new Blob([r.data as Blob], { type: 'application/octet-stream' }))
    const a = document.createElement('a')
    a.href = url; a.download = name
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return null
  } catch (e: any) {
    const blob = e?.response?.data
    if (blob instanceof Blob) {
      try { return JSON.parse(await blob.text())?.message || 'تعذّر تنزيل الملف' } catch { return 'تعذّر تنزيل الملف' }
    }
    return e?.response?.data?.message || 'تعذّر تنزيل الملف'
  }
}

export const apiUserFor = (nas: { shortname: string | null; nasname: string }) => 'radnas-' + tagFor(nas)

const CHECK_LABEL: Record<string, string> = {
  nas: 'تسجيل الراوتر',
  auth: 'مصادقة RADIUS (UDP 1812)',
  acct: 'محاسبة RADIUS (UDP 1813)',
  api: 'واجهة الراوتر (اختياري)',
  live: 'السرعات اللحظية (اختياري)',
}

const COPY: Record<string, { title: string; desc: string; to: string; cta: string }> = {
  plan: {
    title: 'أنشئ باقة',
    desc: 'السرعة والمدّة والحصّة اليومية. كل مشترك يُربط بباقة، فهي أول ما يلزم.',
    to: '/plans', cta: 'الباقات',
  },
  nas: {
    title: 'اربط راوترك',
    desc: 'نفقك وبركة عناوينك وسجلّ راوترك جاهزة. نزّل ملفاً واحداً وارفعه للراوتر — يضبط كل شيء بنفسه.',
    to: '/nas', cta: 'أجهزة الشبكة',
  },
  api: {
    // Created by the setup file now, not typed in by hand — and it only starts working once the
    // router is actually on the tunnel, so the step must not tick before that.
    title: 'السرعات اللحظية',
    desc: 'يُنشئها ملف الإعداد تلقائياً. تكتمل لحظة اتصال راوترك، فترى سرعة كل مشترك كل ثانيتين.',
    to: '/nas', cta: 'أجهزة الشبكة',
  },
  subscribers: {
    title: 'أضف مشتركيك',
    desc: 'استوردهم من راوترك بأسمائهم وكلمات مرورهم كما هي، أو من ملف اكسل، أو واحداً واحداً.',
    to: '/subscribers', cta: 'المشتركون',
  },
}

export default function Onboarding() {
  const [d, setD] = useState<Data | null>(null)
  const [openGuide, setOpenGuide] = useState<string | null>(null)
  const [test, setTest] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [dlBusy, setDlBusy] = useState('')
  const [dlErr, setDlErr] = useState('')
  const [showManual, setShowManual] = useState(false)

  useEffect(() => { api.get('/onboarding').then((r) => setD(r.data)).catch(() => {}) }, [])

  if (!d || !d.applicable || d.dismissed || hidden) return null

  const required = d.steps.filter((s) => !s.optional)
  const doneCount = required.filter((s) => s.done).length

  async function runTest() {
    setTesting(true); setTest(null)
    try {
      const r = (await api.post('/onboarding/test')).data as TestResult
      setTest(r)
      // A green run means the setup is finished: retire the checklist permanently (server-side, so
      // it stays gone on any device) and clear the way to the dashboard after a beat to read it.
      if (r.ok) {
        await api.post('/onboarding/dismiss').catch(() => {})
        setTimeout(() => setHidden(true), 4000)
      }
    } catch {
      setTest({ ok: false, checks: [{ key: 'nas', ok: false, detail: 'تعذّر تشغيل الفحص' }] })
    } finally { setTesting(false) }
  }

  async function dismiss() {
    setHidden(true)
    await api.post('/onboarding/dismiss').catch(() => {})
  }

  return (
    <section className="onb">
      <div className="onb-head">
        <div>
          <h2>خطوات البدء</h2>
          <p>{d.done ? 'أنجزت كل الخطوات الأساسية 🎉' : `أنجزت ${doneCount} من ${required.length}`}</p>
        </div>
        <button className="btn sm" onClick={dismiss}>إخفاء</button>
      </div>

      <div className="onb-bar"><i style={{ width: `${(doneCount / required.length) * 100}%` }} /></div>

      <ol className="onb-steps">
        {d.steps.map((s, i) => {
          // The API may send a step this build has no copy for (older backend, or a key added
          // later). Skipping it keeps the dashboard alive — a missing entry must never take the
          // whole page down with it.
          const c = COPY[s.key]
          if (!c) return null
          return (
            <li key={s.key} className={s.done ? 'done' : ''}>
              <span className="onb-mark">{s.done ? '✓' : i + 1}</span>
              <div className="onb-body">
                <h3>
                  {c.title}
                  {s.optional && <em className="onb-opt">اختياري</em>}
                  {s.done && s.count > 0 && <em className="onb-count">{s.count}</em>}
                </h3>
                <p>{c.desc}</p>
                <div className="onb-actions">
                  <Link className="btn sm" to={c.to}>{c.cta}</Link>
                  {['nas', 'firewall', 'api'].includes(s.key) && (
                    <button className="btn sm" onClick={() => setOpenGuide((v) => (v === s.key ? null : s.key))}>
                      {openGuide === s.key ? 'إخفاء الأوامر' : 'أوامر MikroTik'}
                    </button>
                  )}
                </div>

                {openGuide === s.key && (
                  <div className="onb-guide">
                    {!d!.nas ? (
                      <p>أضف الراوتر أولاً من صفحة «أجهزة الشبكة» لتظهر لك أوامره جاهزة ببياناته الخاصة.</p>
                    ) : s.key === 'nas' ? (
                      <>
                        <p>راوترك: <b dir="ltr">{d!.nas.shortname || d!.nas.nasname}</b></p>
                        <p>نزّل ملف الإعداد وارفعه إلى الراوتر مرّة واحدة. يضبط النفق وRADIUS
                          والقطع الفوري وقواعد جدار الحماية دفعةً واحدة — بلا نسخ مفاتيح ولا كتابة أوامر.</p>

                        <div className="onb-actions" style={{ marginBottom: 4 }}>
                          <button className="btn primary" disabled={!!dlBusy} onClick={async () => {
                            setDlBusy('main'); setDlErr('')
                            const err = await downloadScript(d!.nas!.id)
                            if (err) setDlErr(err)
                            setDlBusy('')
                          }}>{dlBusy === 'main' ? 'جارٍ التوليد…' : '⬇ نزّل ملف الإعداد'}</button>

                        </div>
                        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.8, margin: '0 0 6px' }}>
                          ملف واحد يفعل كل شيء: النفق، وRADIUS، والقطع الفوري، وقواعد جدار الحماية،
                          وبركة عناوين خاصّة بشركتك، وخادم PPPoE، وحساب القراءة. لا يبقى عليك إلا
                          إضافة مشتركيك.
                        </p>
                        {dlErr && <div className="error" style={{ marginTop: 10 }}>{dlErr}</div>}

                        <p style={{ marginTop: 16 }}><b>الرفع إلى MikroTik — طريقتان:</b></p>
                        <ol className="onb-ol">
                          <li>
                            <b>بلا تيرمنال (الأسهل):</b> افتح <b>Winbox</b> ← <b>Files</b>، واسحب الملف
                            إلى النافذة. اسم الملف ينتهي بـ <span dir="ltr">.auto.rsc</span> فينفّذه
                            RouterOS بنفسه لحظة اكتمال الرفع. تابع النتيجة في <b>Log</b> — ستجد
                            <span dir="ltr"> RadNas: اكتمل الإعداد</span>.
                          </li>
                          <li>
                            <b>بالتيرمنال:</b> ارفع الملف كما في الأعلى، ثم في <b>New Terminal</b>:
                            <pre dir="ltr">{`/import ${tagFor(d!.nas)}-radnas.auto.rsc`}</pre>
                          </li>
                        </ol>

                        <p className="onb-warn">الملف يحوي مفتاح النفق وسرّ RADIUS. لا تُرسله في محادثة،
                          واحذفه من حاسبك بعد الرفع — الراوتر يمحو نسخته وحده بعد التنفيذ.</p>
                        <p><b>مهم:</b> RouterOS يفحص <span dir="ltr">/ppp secret</span> المحلية أولاً، فتفعيل
                          <span dir="ltr"> use-radius=yes </span> لا يقطع زبائنك الحاليين.</p>

                        <button className="btn sm" onClick={() => setShowManual(!showManual)} style={{ marginTop: 8 }}>
                          {showManual ? 'إخفاء الطريقة اليدوية' : 'أفضّل كتابة الأوامر يدوياً'}
                        </button>
                        {showManual && (
                          <pre dir="ltr">{`/radius add service=ppp \
  address=<عنوان خادم RADIUS> \
  secret=${d!.nas.secret} \
  src-address=${d!.nas.nasname} \
  comment="RadNas ${tagFor(d!.nas)}"

/ppp aaa set use-radius=yes accounting=yes interim-update=1m
/radius incoming set accept=yes port=3799`}</pre>
                        )}
                      </>
                    ) : s.key === 'firewall' ? (
                      <>
                        <p><b>ملف الإعداد في الخطوة السابقة يضبط هذه القواعد بنفسه</b> — إن رفعته فلا
                          حاجة لشيء هنا. القواعد التي يضيفها موسومة
                          <span dir="ltr"> RadNas {tagFor(d!.nas)} </span> فتعرفها في
                          <span dir="ltr"> /ip firewall filter</span>.</p>
                        <p>وإن أعددت الراوتر يدوياً، استبدل <span dir="ltr">&lt;عنوان الخادم&gt;</span>
                          بالعنوان الذي زوّدتك به الإدارة:</p>
                        <pre dir="ltr">{`# CoA — يسمح بقطع/إعادة اتصال المشترك فوراً
/ip firewall filter add chain=input protocol=udp dst-port=3799 \
  src-address=<عنوان الخادم> action=accept place-before=0 \
  comment="RadNas ${tagFor(d!.nas)} CoA"

# واجهة الراوتر — لازمة للسرعات اللحظية فقط
/ip firewall filter add chain=input protocol=tcp dst-port=80 \
  src-address=<عنوان الخادم> action=accept place-before=0 \
  comment="RadNas ${tagFor(d!.nas)} API"

# لتعمل أداة ping نحو المشتركين (استبدل شبكة الـpool بشبكتك)
/ip firewall filter add chain=forward action=accept \
  src-address=<شبكة الخادم> dst-address=<شبكة الـpool> place-before=0 \
  comment="RadNas ${tagFor(d!.nas)} ping-out"
/ip firewall filter add chain=forward action=accept \
  src-address=<شبكة الـpool> dst-address=<شبكة الخادم> place-before=1 \
  comment="RadNas ${tagFor(d!.nas)} ping-in"`}</pre>
                        <p className="onb-warn">منفذا RADIUS الصادران (1812 و1813) مسموحان افتراضياً في RouterOS —
                          المشكلة عادةً في فايروول مزوّدك أو في <span dir="ltr">accounting=no</span>.</p>
                      </>
                    ) : s.key === 'api' ? (
                      <>
                        <p>أنشئ حساب <b>قراءة فقط</b> على الراوتر — القطع يبقى عبر RADIUS فلا يحتاج صلاحية كتابة:</p>
                        <pre dir="ltr">{`/user group add name=${apiUserFor(d!.nas)} policy=read,api,rest-api

/user add name=${apiUserFor(d!.nas)} group=${apiUserFor(d!.nas)} \\
  password=<كلمة مرور قوية> \\
  address=<عنوان الخادم>`}</pre>
                        <p><span dir="ltr">address=</span> يحصر الدخول بعنوان الخادم وحده، فلا يُستعمل الحساب من مكان آخر.
                          ثم أدخل الاسم وكلمة المرور من <b>أجهزة الشبكة ← زر API</b> واضغط «اختبار الاتصال».</p>
                        <p>الاسم <b dir="ltr">{apiUserFor(d!.nas)}</b> خاصّ براوترك — لا تشارك اسماً أو كلمة مرور
                          مع راوتر آخر، فتسريب أحدهما يفتح الاثنين.</p>
                        <p className="onb-warn">لا ترسل كلمة المرور في أي محادثة — الحقل يشفّرها عند الحفظ.</p>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      <div className="onb-test">
        <div className="onb-test-head">
          <div>
            <h3>اختبر الشبكة</h3>
            <p>فحص حيّ للمسار كاملاً: تسجيل الراوتر، المصادقة، المحاسبة، والسرعات.</p>
          </div>
          <button className="btn-primary inline sm" disabled={testing} onClick={runTest}>
            {testing ? 'جارٍ الفحص…' : 'ابدأ الفحص'}
          </button>
        </div>
        {test && (
          <>
            <div className={'onb-test-verdict ' + (test.ok ? 'ok' : 'bad')}>
              {test.ok ? '✓ الشبكة تعمل — اكتمل الإعداد. لن تظهر هذه الخطوات مجدداً.'
                       : '✕ هناك خلل في المسار — التفاصيل أدناه.'}
            </div>
            <ul className="onb-checks">
              {test.checks.map((c) => (
                <li key={c.key} className={c.ok ? 'ok' : 'bad'}>
                  <span>{c.ok ? '✓' : '✕'}</span>
                  <b>{CHECK_LABEL[c.key] || c.key}</b>
                  <em>{c.detail}</em>
                </li>
              ))}
            </ul>
            {test.ok && (
              <Link className="btn-primary inline sm onb-go" to="/dashboard" onClick={() => setHidden(true)}>
                الذهاب إلى لوحة التحكّم ←
              </Link>
            )}
          </>
        )}
      </div>
    </section>
  )
}
