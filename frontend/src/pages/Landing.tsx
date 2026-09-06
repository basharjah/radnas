import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { Logo } from '../components/Logo'
import ThemeToggle from '../components/ThemeToggle'

/**
 * Public landing page at "/" — the first thing a visitor to radnas.com sees.
 *
 * The visitor is an ISP owner deciding whether this replaces the panel they already run, so the
 * page's job is to let them recognise their own work in it: the tunnel that reaches a router behind
 * NAT, the quota that throttles at midnight, the reseller who must not see another reseller. The
 * features are therefore grouped the way an operator's day is, not listed as a flat marketing wall.
 *
 * Prices come from the panel's settings, never from the code: a tier the owner has not priced yet
 * shows "تواصل معنا" instead of a number nobody approved. Anyone already signed in is sent
 * straight to the dashboard so daily operators are never bounced through marketing.
 */
interface Tier { subscribers: number; free: boolean; price: number | null }
interface TiersResponse { currency: string; note: string; tiers: Tier[] }

/**
 * Support contact. One number, reachable two ways.
 *
 * Stored in full international form because half this page's readers are outside Syria and a local
 * 0-prefixed number simply does not dial for them. wa.me demands the same form with no punctuation,
 * so the digits are kept once and the spaced version is only ever for display.
 */
const SUPPORT_E164 = '963930583522'
const SUPPORT_SHOWN = '+963 930 583 522'
const WHATSAPP_URL =
  `https://wa.me/${SUPPORT_E164}?text=` +
  encodeURIComponent('مرحباً، أودّ الاستفسار عن RadNas')

/** The nav and the page read from one list, so a section can never exist without a way to reach it. */
const NAV = [
  { id: 'features', label: 'الميزات' },
  { id: 'how', label: 'كيف تبدأ' },
  { id: 'pricing', label: 'الأسعار' },
  { id: 'support', label: 'الدعم' },
]

const GROUPS: { id: string; title: string; lead: string; items: { t: string; d: string }[] }[] = [
  {
    id: 'network',
    title: 'الشبكة والراوتر',
    lead: 'كل ما يلزم ليصبح راوترك جزءاً من المنصّة — بلا عنوان عام ولا إعداد يدوي.',
    items: [
      { t: 'خادم RADIUS مُدار', d: 'FreeRADIUS جاهز: مصادقة ومحاسبة وتحديد سرعة لكل باقة، وفصل فوري عبر CoA بلا لمس الراوتر.' },
      { t: 'نفق WireGuard لكل شركة', d: 'يُبنى تلقائياً لحظة الموافقة على حسابك، ويصل راوترك حتى خلف NAT — بلا عنوان عام ثابت.' },
      { t: 'ملف إعداد واحد', d: 'نزّله من اللوحة وارفعه إلى الراوتر، فيُنفّذ نفسه: النفق وRADIUS والفايروول والبركة وخادم PPPoE.' },
      { t: 'فحص اتصال من عشرين نقطة', d: 'يفحص المسار كاملاً ويقول أين توقّف بالضبط — ومع كل خلل الأمر الذي يُصلحه، جاهزاً للنسخ.' },
      { t: 'شبكة عناوين معزولة', d: 'لكل شركة بركة عناوين خاصّة بها، فلا تتقاطع مع شركة أخرى ولا مع شبكة مزوّدك.' },
      { t: 'اختبار ping عبر النفق', d: 'اختبر خطّ أي مشترك من اللوحة، ويُرسله الخادم عبر نفق شركتك وحدها لا عبر أي نفق آخر.' },
    ],
  },
  {
    id: 'subs',
    title: 'المشتركون',
    lead: 'من إدخال أول مشترك إلى تجديد أربعمئة دفعةً واحدة.',
    items: [
      { t: 'PPPoE وهوت سبوت', d: 'النوعان جنباً إلى جنب، وكروت الهوت سبوت تُولَّد بالدفعات وتُطبع.' },
      { t: 'استيراد من ملف أو من الراوتر', d: 'اكسل أو CSV، أو من ملف يُصدّره راوترك بنفسه — فلا تُعيد كتابة اسم واحد.' },
      { t: 'تجديد جماعي', d: 'حدّد من تشاء وجدّدهم بضغطة، وتُخصم القيم من رصيدك دفعةً واحدة.' },
      { t: 'حصص وسياسة استهلاك', d: 'حصّة يومية وشهرية، ثم تخفيض السرعة أو القطع أو الحظر عند التجاوز — تلقائياً.' },
      { t: 'شحن بيانات إضافية', d: 'بِع غيغابايت لمن نفدت حصّته، فيُرفع التخفيض ويعود بسرعته الكاملة في ثوانٍ.' },
      { t: 'مراقبة لحظية', d: 'سرعة التنزيل والرفع لكل جلسة مفتوحة، تُقرأ من الراوتر مباشرة وتتحدّث كل ثانيتين.' },
    ],
  },
  {
    id: 'money',
    title: 'المالية والتقارير',
    lead: 'الفوترة والرصيد والدخل في مكان واحد، بلا جدول جانبي.',
    items: [
      { t: 'باقات وأسعار', d: 'سرعة ومدّة وحصّة وسعر لكل باقة، وتُطبَّق على المشترك لحظة تجديده.' },
      { t: 'فواتير ومدفوعات', d: 'فاتورة لكل تجديد، وتسجيل الدفع بضغطة، مع إجمالي المستحقّ غير المدفوع أمامك.' },
      { t: 'رصيد وحركات', d: 'دفتر حركات لكل حساب وموزّع — كل شحن وخصم مسجّل بتاريخه وسببه.' },
      { t: 'تقارير الدخل', d: 'دخل الشهر ودخل اثني عشر شهراً مرسوماً، وتقرير أعمار الديون لكل موزّع.' },
    ],
  },
  {
    id: 'system',
    title: 'الإدارة والوصول',
    lead: 'شجرة صلاحيات حقيقية، ولوحتك معك أينما كنت.',
    items: [
      { t: 'تطبيق جوّال لأندرويد', d: 'اللوحة كاملة على هاتفك بنفس الحساب ونفس الصلاحيات — جدّد مشتركاً من الطريق، أو افحص راوتراً وأنت واقف بجانبه.' },
      { t: 'موزّعون وصلاحيات', d: 'مدير وموزّعون تحته، وكل حساب يرى فرعه فقط — والعزل مفروض في الخادم لا في الواجهة.' },
      { t: 'حصّة مشتركين لكل شركة', d: 'سقف يمنع تجاوز الشريحة المشتراة، ويُحتسب على الفرع كاملاً.' },
      { t: 'سجلّ تدقيق', d: 'من فعل ماذا ومتى ومن أي عنوان — كل تغيير مسجّل.' },
      { t: 'نسخ احتياطية', d: 'نسخة يومية تلقائية تُتحقَّق باستعادة فعلية، ونسخة فورية متى شئت.' },
      { t: 'إشعارات فورية', d: 'على المتصفّح وعلى تيليجرام: تسجيل جديد، اشتراك ينتهي، مشترك يتجاوز حصّته.' },
      { t: 'بوّابة المشترك', d: 'صفحة يتابع فيها زبونك استهلاكه وتاريخ انتهاء باقته بنفسه، فتقلّ المكالمات.' },
      { t: 'دعم فنّي دائم', d: 'على مدار اليوم وطوال الأسبوع، اتصالاً أو واتساب — لأن شبكتك لا تتوقّف في العطلة.' },
    ],
  },
]

const STEPS = [
  { n: '١', t: 'اختر الشريحة', d: 'حسب عدد مشتركيك. ابدأ مجاناً وارفعها متى كبرت.' },
  { n: '٢', t: 'أرسل طلب التسجيل', d: 'بيانات شركتك واسم الدخول — دقيقة واحدة.' },
  { n: '٣', t: 'موافقة الإدارة', d: 'نراجع الطلب ونفعّل حسابك، ويُجهَّز لك نفق وراوتر تلقائياً.' },
  { n: '٤', t: 'اربط راوترك وابدأ', d: 'ارفع ملف الإعداد، استورد مشتركيك، وشغّل الفحص للتأكّد.' },
]

export default function Landing() {
  const { user, loading } = useAuth()
  const [data, setData] = useState<TiersResponse | null>(null)
  const [menu, setMenu] = useState(false)

  useEffect(() => { api.get('/auth/tiers').then((r) => setData(r.data)).catch(() => {}) }, [])

  // An operator who is already signed in has no business on the marketing page.
  if (loading) return <div className="center">جارٍ التحميل…</div>
  if (user) return <Navigate to="/dashboard" replace />

  const cur = data?.currency || 'USD'
  const sym = cur === 'USD' ? '$' : cur

  return (
    <div className="lp" dir="rtl">
      <header className="lp-nav">
        <div className="brand"><Logo /> Rad<b>Nas</b></div>

        {/* The section links are the page's table of contents, so they stay visible while
            scrolling. On a phone they collapse rather than wrap into three cramped rows. */}
        <nav className="lp-links">
          {NAV.map((n) => (
            <a key={n.id} href={`#${n.id}`}>{n.label}</a>
          ))}
        </nav>

        <div className="lp-nav-actions">
          <ThemeToggle />
          <Link className="btn lp-hide-sm" to="/login">تسجيل الدخول</Link>
          <Link className="btn-primary inline" to="/register">ابدأ مجاناً</Link>
          <button
            className="lp-burger"
            aria-label={menu ? 'إغلاق القائمة' : 'فتح القائمة'}
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
          >
            {menu ? '✕' : '☰'}
          </button>
        </div>
      </header>

      {menu && (
        <nav className="lp-menu" onClick={() => setMenu(false)}>
          {NAV.map((n) => <a key={n.id} href={`#${n.id}`}>{n.label}</a>)}
          <Link to="/login">تسجيل الدخول</Link>
        </nav>
      )}

      <section className="lp-hero">
        <h1>أدِر مشتركي شبكتك من مكان واحد</h1>
        <p>
          منصّة كاملة لمزوّدي الإنترنت: خادم RADIUS مُدار، ونفق يصل راوترك حتى خلف NAT،
          ومشتركون وباقات وفواتير وتقارير — على الويب وعلى هاتفك.
        </p>
        <div className="lp-hero-cta">
          <Link className="btn-primary inline" to="/register">أنشئ حسابك</Link>
          <a className="btn" href="#features">شاهد الميزات</a>
        </div>
        <p className="lp-hero-note">
          تبدأ مجاناً حتى {data?.tiers[0]?.subscribers ?? 25} مشتركاً — بلا بطاقة ائتمان.
        </p>

        {/* The four facts a visitor uses to decide whether this is built for their scale. */}
        <div className="lp-facts">
          <div><b>RADIUS</b><span>مُدار بالكامل</span></div>
          <div><b>WireGuard</b><span>نفق لكل شركة</span></div>
          <div><b>20</b><span>فحصاً للاتصال</span></div>
          <div><b>٢٤/٧</b><span>دعم فنّي</span></div>
        </div>
      </section>

      <section className="lp-section" id="features">
        <h2>ما الذي تحصل عليه</h2>
        <p className="lp-sub">
          كل ما تحتاجه لتشغيل شبكتك — مرتّباً كما يمرّ يومك، لا كقائمة مسطّحة.
        </p>

        {GROUPS.map((g) => (
          <div className="lp-group" key={g.id}>
            <div className="lp-group-head">
              <h3>{g.title}</h3>
              <p>{g.lead}</p>
            </div>
            <div className="lp-features">
              {g.items.map((f) => (
                <div className="lp-feature" key={f.t}>
                  <h4>{f.t}</h4>
                  <p>{f.d}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="lp-section" id="how">
        <h2>كيف تبدأ</h2>
        <p className="lp-sub">أربع خطوات، وأطولها انتظار الموافقة.</p>
        <div className="lp-steps">
          {STEPS.map((s) => (
            <div className="lp-step" key={s.n}>
              <span className="lp-step-n">{s.n}</span>
              <div>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-section" id="pricing">
        <h2>الأسعار</h2>
        <p className="lp-sub">
          ادفع حسب عدد مشتركيك. كل الميزات متاحة في جميع الشرائح — الفرق في السعة فقط.
        </p>
        <div className="lp-tiers">
          {data?.tiers.map((t) => (
            <div className={'lp-tier' + (t.free ? ' free' : '')} key={t.subscribers}>
              {t.free && <span className="lp-tag">مجاني</span>}
              <div className="lp-tier-cap">
                <b>{t.subscribers.toLocaleString('en-US')}</b><span>مشترك</span>
              </div>
              <div className="lp-price">
                {t.free
                  ? <b>مجاناً</b>
                  : t.price != null
                    ? <><b>{sym}{t.price}</b><span>/ شهرياً</span></>
                    : <b className="lp-ask">تواصل معنا</b>}
              </div>
              {!t.free && t.price != null && (
                <span className="lp-per">≈ {sym}{(t.price / t.subscribers).toFixed(3)} لكل مشترك</span>
              )}
              <Link className={t.free ? 'btn-primary inline' : 'btn'} to="/register">
                {t.free ? 'ابدأ مجاناً' : 'اختر هذه'}
              </Link>
            </div>
          ))}
          {!data && <p className="muted">جارٍ تحميل الأسعار…</p>}
        </div>
        {data?.note && <p className="lp-note">{data.note}</p>}
      </section>

      <section className="lp-section" id="support">
        <div className="lp-support">
          <div className="lp-support-badge">
            <span className="lp-live" aria-hidden="true" />
            دعم فنّي على مدار اليوم، طوال أيام الأسبوع
          </div>
          <h2>لن تُترك وحدك مع شبكتك</h2>
          <p>
            شبكتك تعمل ليلاً ونهاراً، فالدعم كذلك. اتصل أو راسلنا على واتساب في أي وقت —
            نفس الرقم للاثنين.
          </p>

          <a className="lp-support-num" href={`tel:+${SUPPORT_E164}`} dir="ltr">
            {SUPPORT_SHOWN}
          </a>

          <div className="lp-support-cta">
            <a className="btn-primary inline lp-wa" href={WHATSAPP_URL}
               target="_blank" rel="noopener noreferrer">
              راسلنا على واتساب
            </a>
            <a className="btn" href={`tel:+${SUPPORT_E164}`}>اتصال مباشر</a>
          </div>

          <p className="lp-hero-note">
            الرقم يقبل الاتصال والواتساب معاً، ويعمل من داخل سوريا وخارجها.
          </p>
        </div>
      </section>

      <section className="lp-cta">
        <h2>جاهز للبدء؟</h2>
        <p>أنشئ حسابك اليوم، واربط راوترك الأول خلال دقائق.</p>
        <Link className="btn-primary inline" to="/register">ابدأ مجاناً</Link>
      </section>

      <footer className="lp-foot">
        <span>RadNas — إدارة مشتركي الإنترنت</span>
        <span className="lp-foot-links">
          {NAV.map((n) => <a key={n.id} href={`#${n.id}`}>{n.label}</a>)}
          <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">واتساب</a>
          <Link to="/login">دخول</Link>
        </span>
      </footer>
    </div>
  )
}
