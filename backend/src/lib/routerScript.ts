import { readFileSync } from 'node:fs'

/**
 * The RouterOS setup script a company downloads from its own panel session.
 *
 * Everything it creates on the router is tagged with the company's own name — the tunnel interface
 * `wg-<tag>`, the API account `radnas-<tag>`, a comment on the RADIUS entry and on every firewall
 * rule. Two companies' configs can then sit on one device without anybody guessing whose rule is
 * whose, and the script's own cleanup can never touch a neighbour's objects.
 *
 * `/import` aborts at the first failing line, so each step is wrapped and made idempotent: a second
 * run removes what the previous run tagged, then rewrites it. A half-configured router is worse than
 * an unconfigured one.
 */

/** One tag per tenant, derived from the router's own short name. Mirrors the panel's `tagFor`. */
export function tagFor(nas: { shortname: string | null; nasname: string }): string {
  const slug = (nas.shortname || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || nas.nasname.replace(/[.]/g, '-')
}

export interface ScriptInput {
  nasname: string
  shortname: string | null
  secret: string
  tunnel_ip: string
  iface: string            // the SERVER-side interface, e.g. wg1 — names the key file
  endpoint: string
  listen_port: number
  server_public_key: string
  api_user: string         // the read-only account the panel polls for live speeds
  api_password: string
}

/**
 * The tunnel's private key stays in /etc/wireguard and is read only when a script is generated —
 * never copied into the database. One canonical location for a secret is easier to protect than two.
 */
export function readClientKey(iface: string): string | null {
  if (!/^wg[0-9]+$/.test(iface)) return null   // never build a path from unvalidated input
  try {
    const key = readFileSync(`/etc/wireguard/${iface}-client.key`, 'utf8').trim()
    return key || null
  } catch {
    return null
  }
}

export function buildRouterScript(i: ScriptInput, key: string, poolCidr: string): { filename: string; body: string } {
  const tag = tagFor(i)
  const dev = `wg-${tag}`
  const filename = `${tag}-radnas.auto.rsc`
  const net = i.tunnel_ip.split('.').slice(0, 3).join('.')
  const radiusIp = `${net}.1`
  const tunnelNet = `${net}.0/24`
  // Derived from the tenant's own pool, never guessed. `.1` is the subscriber gateway; when the
  // pool happens to share the tunnel's /24 that address is the platform server, so `.3` is used.
  const poolNet = poolCidr.split('/')[0]!.split('.').slice(0, 3).join('.')
  const gateway = poolNet === net ? `${poolNet}.3` : `${poolNet}.1`
  const poolFirst = `${poolNet}.100`
  const poolLast = `${poolNet}.254`

  const body = `# ═══════════════════════════════════════════════════════════
# RadNas — إعداد تلقائي لراوتر ${i.shortname || i.nasname}
# سرّي: يحوي مفتاح النفق وسرّ RADIUS. لا تشاركه، واحذفه من
# حاسبك بعد الرفع — الراوتر يمحو نسخته وحده.
#
# طريقتان:
#  أ) بلا تيرمنال — اسحب هذا الملف إلى Winbox ← Files.
#     الاسم ينتهي بـ .auto.rsc فينفّذه الراوتر وحده. تابع Log.
#  ب) بالتيرمنال — ارفع الملف ثم: /import ${filename}
#
# يفعل كل شيء: النفق، وعميل RADIUS، والقطع الفوري، وقواعد جدار
# الحماية، وبركة عناوين خاصّة بشركتك، وملف تعريف PPP، وخادم PPPoE،
# وحساب القراءة. لا يبقى عليك إلا إضافة مشتركيك في اللوحة.
#
# كل ما يُنشئه موسوم باسم شركتك (${tag}): الواجهة ${dev}، والبركة
# radnas-${tag}، وتعليق سجلّ RADIUS، وتعليق كل قاعدة جدار حماية.
#
# آمن للتكرار: يمحو ما وسمه هو فقط قبل كتابة الجديد.
# ═══════════════════════════════════════════════════════════

:log info "RadNas (${tag}): بدء الإعداد"

# ── 0) إزالة إعداد RadNas السابق لهذه الشركة وحدها ──
:do { /interface/wireguard/peers remove [find interface="${dev}"] } on-error={}
:do { /ip/address remove [find interface="${dev}"] } on-error={}
:do { /interface/wireguard remove [find name="${dev}"] } on-error={}
:do { /radius remove [find comment="RadNas ${tag}"] } on-error={}
# مطابقة دقيقة لا تعبيراً نمطياً: هذا جدار حماية إنتاجي، ولا نحذف
# إلا القواعد التي كتبها RadNas بوسم شركتك.
:do { /ip/firewall/filter remove [find comment="RadNas ${tag} CoA"] } on-error={}
:do { /ip/firewall/filter remove [find comment="RadNas ${tag} API"] } on-error={}
:do { /ip/firewall/filter remove [find comment="RadNas ${tag} ping-out"] } on-error={}
:do { /ip/firewall/filter remove [find comment="RadNas ${tag} ping-in"] } on-error={}
:do { /ip/firewall/nat remove [find comment="RadNas ${tag} nat"] } on-error={}
:do { /ip/firewall/nat remove [find comment="RadNas ${tag} nat-bypass"] } on-error={}

# ── 1) نفق WireGuard ──
:do {
  /interface/wireguard add name=${dev} private-key="${key}" comment="RadNas ${tag}"
  /ip/address add address=${i.tunnel_ip}/24 interface=${dev} comment="RadNas ${tag}"
  /interface/wireguard/peers add interface=${dev} public-key="${i.server_public_key}" endpoint-address=${i.endpoint} endpoint-port=${i.listen_port} allowed-address=${net}.0/24 persistent-keepalive=25s
  :log info "RadNas (${tag}): النفق جاهز"
} on-error={ :log error "RadNas (${tag}): فشل إنشاء النفق"; :error "تعذّر إنشاء النفق — يلزم RouterOS 7 أو أحدث" }

# ── 2) عميل RADIUS ──
:do {
  /radius add service=ppp address=${radiusIp} src-address=${i.tunnel_ip} secret="${i.secret}" timeout=3s comment="RadNas ${tag}"
  /ppp/aaa set use-radius=yes accounting=yes interim-update=1m
  :log info "RadNas (${tag}): RADIUS جاهز"
} on-error={ :log error "RadNas (${tag}): فشل إعداد RADIUS" }

# ملاحظة: RouterOS يفحص /ppp secret المحلية أولاً،
# فهذا لا يقطع المشتركين الحاليين.

# ── 3) القطع الفوري (CoA) وفتح المنافذ للخادم ──
:do { /radius/incoming set accept=yes port=3799 } on-error={}
:do {
  :if ([:len [/ip/firewall/filter find]] > 0) do={
    /ip/firewall/filter add chain=input protocol=udp dst-port=3799 src-address=${radiusIp} action=accept comment="RadNas ${tag} CoA" place-before=[:pick [/ip/firewall/filter find] 0]
    /ip/firewall/filter add chain=input protocol=tcp dst-port=80 src-address=${radiusIp} action=accept comment="RadNas ${tag} API" place-before=[:pick [/ip/firewall/filter find] 0]
  } else={
    /ip/firewall/filter add chain=input protocol=udp dst-port=3799 src-address=${radiusIp} action=accept comment="RadNas ${tag} CoA"
    /ip/firewall/filter add chain=input protocol=tcp dst-port=80 src-address=${radiusIp} action=accept comment="RadNas ${tag} API"
  }
} on-error={ :log warning "RadNas (${tag}): تعذّر ضبط جدار الحماية — أضف القواعد يدوياً" }

# ── 3ب) مرور الفحص بين الخادم وبِرك مشتركيك ──
# مشتقّ من إعداد نفقك: ${tunnelNet} هو النفق و ${poolCidr} هي بركة مشتركيك.
# بدون هاتين القاعدتين تعتمد أداة الفحص في اللوحة على تسامح سلسلة forward،
# فإن كانت مقيّدة عندك فشل الفحص بلا رسالة تشرح السبب.
:do {
  /ip/firewall/filter add chain=forward action=accept src-address=${tunnelNet} dst-address=${poolCidr} comment="RadNas ${tag} ping-out"
  /ip/firewall/filter add chain=forward action=accept src-address=${poolCidr} dst-address=${tunnelNet} comment="RadNas ${tag} ping-in"
  :log info "RadNas (${tag}): مرور الفحص مسموح"
} on-error={ :log warning "RadNas (${tag}): تعذّر ضبط مرور الفحص" }

# ── 4) حساب القراءة للسرعات اللحظية ──
# حساب مقروء فقط بصلاحيات read و api و rest-api — لا يستطيع تغيير شيء على راوترك.
# اللوحة تستعمله لقراءة /ppp/active و/ppp/secret و/radius.
#
# ولا نمنحه sensitive: اختبرناها على RB5009 حقيقي وثبت أن REST يُخفي القيم الحسّاسة
# دائماً — رجع سرّ RADIUS نفسه ***** والصلاحية مضافة. فمنحُها يوسّع الأذونات بلا
# فائدة. كلمات مرور المشتركين تأتي من ملف يُصدّره الراوتر نفسه:
#   /ppp/secret/export file=radnas-secrets show-sensitive
# ثم يُرفَع الملف في نافذة الاستيراد باللوحة.
:do { /user remove [find name="${i.api_user}"] } on-error={}
:do { /user/group remove [find name="${i.api_user}"] } on-error={}
:do {
  /user/group add name=${i.api_user} policy=read,api,rest-api comment="RadNas ${tag}"
  /user add name=${i.api_user} password="${i.api_password}" group=${i.api_user} comment="RadNas ${tag}"
  # مقيّدة بعنوان الخادم في النفق، لا مفتوحة: تفعيل خدمة الويب بلا تقييد
  # يكشف واجهة راوترك لكل من تسمح له سلسلة input — وهي متسامحة عادةً.
  /ip/service set www address=${radiusIp}/32 disabled=no
  :log info "RadNas (${tag}): حساب القراءة جاهز"
} on-error={ :log warning "RadNas (${tag}): تعذّر إنشاء حساب القراءة — السرعات اللحظية فقط تتأثر" }



# ── 5) بركة المشتركين وملف التعريف وخادم PPPoE ──
# البركة ${poolCidr} خاصّة بشركتك ولا تتقاسمها مع أي عميل آخر على المنصّة،
# وهي الشبكة الوحيدة التي يحملها نفقك.
# لا نحذف خادم PPPoE: قد يكون خادم الشركة نفسه وقد عدّلناه فقط. حذفه يقطع مشتركيها.
:do {
  # يُعدَّل إن وُجد ولا يُحذَف ويُعاد إنشاؤه. الحذف يُبطل معرّف الملف بينما خادم PPPoE
  # ما زال يشير إليه كـ default-profile، فيبقى الخادم معلّقاً على ملف غير موجود ويفشل
  # كل مشترك يقع عليه بلا رسالة تُفسّر السبب. رأينا ذلك على راوتر حقيقي: خادم الشركة
  # كان يشير إلى *6 وقد حُذف، فلم يعمل أيّ مشترك لا يحمل ملفاً صريحاً.
  :if ([:len [/ip/pool find name="radnas-${tag}"]] > 0) do={
    /ip/pool set [find name="radnas-${tag}"] ranges=${poolFirst}-${poolLast} comment="RadNas ${tag}"
  } else={
    /ip/pool add name="radnas-${tag}" ranges=${poolFirst}-${poolLast} comment="RadNas ${tag}"
  }
  # السرعة لا تُكتب هنا: RADIUS يُرسل Mikrotik-Rate-Limit لكل مشترك حسب باقته،
  # وأي قيمة ثابتة هنا ستُلغيها اللوحة وتصير مصدر حَيرة.
  :if ([:len [/ppp/profile find name="radnas-${tag}"]] > 0) do={
    /ppp/profile set [find name="radnas-${tag}"] local-address=${gateway} remote-address="radnas-${tag}" \
      dns-server="8.8.8.8,1.1.1.1" use-encryption=no only-one=yes comment="RadNas ${tag}"
  } else={
    /ppp/profile add name="radnas-${tag}" local-address=${gateway} remote-address="radnas-${tag}" \
      dns-server="8.8.8.8,1.1.1.1" use-encryption=no only-one=yes comment="RadNas ${tag}"
  }
  :log info "RadNas (${tag}): البركة وملف التعريف جاهزان"
} on-error={ :log error "RadNas (${tag}): فشل إنشاء البركة أو ملف التعريف" }

# ── 5ب) ترجمة عناوين المشتركين إلى الإنترنت ──
# بركتك شبكة جديدة على راوترك، وقاعدة NAT القائمة عندك مكتوبة لشبكتك القديمة.
# بدون هذه القاعدة يُصادَق مشتركوك ويأخذون عناوين ولا يصلهم إنترنت — فشل صامت.
#
# ويستثني النفق بقصد: لو تُرجمت ردود مشتركيك الداخلة إلى النفق أيضاً لرأى
# الخادم عنوان راوترك بدل عنوان المشترك، فينكسر الفحص وتضيع هوية كل جلسة.
:do { /ip/firewall/nat remove [find comment="RadNas ${tag} nat"] } on-error={}
:do { /ip/firewall/nat remove [find comment="RadNas ${tag} nat-bypass"] } on-error={}
:do {
  # قاعدة الاستثناء تُدرَج أوّلاً بقصد: أي masquerade عامّة قائمة عندك ستطابق قبل
  # قاعدتنا وتترجم أيضاً ردود مشتركيك المتّجهة إلى النفق، فيرى الخادم عنوان راوترك
  # بدل عنوان المشترك وتضيع هوية كل جلسة.
  :if ([:len [/ip/firewall/nat find]] > 0) do={
    /ip/firewall/nat add chain=srcnat action=accept src-address=${poolCidr} dst-address=${tunnelNet} comment="RadNas ${tag} nat-bypass" place-before=[:pick [/ip/firewall/nat find] 0]
  } else={
    /ip/firewall/nat add chain=srcnat action=accept src-address=${poolCidr} dst-address=${tunnelNet} comment="RadNas ${tag} nat-bypass"
  }
  /ip/firewall/nat add chain=srcnat action=masquerade src-address=${poolCidr} comment="RadNas ${tag} nat"
  :log info "RadNas (${tag}): ترجمة العناوين جاهزة"
} on-error={ :log warning "RadNas (${tag}): تعذّر ضبط ترجمة العناوين — أضفها يدوياً وإلّا فلا إنترنت لمشتركيك" }

# ── 5ج) خادم PPPoE ──
# نُعدّل الخادم القائم ولا نُضيف ثانياً. RouterOS يقبل خادمين على واجهة واحدة بلا
# شكوى، فتُرسَل عروض PADO مزدوجة ويصير أي مشترك يقع على أيّهما مسألة حظّ — وقد
# رأينا ذلك فعلاً: خادم بملف الشركة القديم وآخر بملفنا على bridge واحد.
# خادم أضافته نسخة أقدم من هذا الملف يُحذف أولاً، وفقط إن كان للشركة خادمها الخاص.
# بدون هذا يبقى خادمان على الواجهة نفسها ويصير وقوع المشترك على أحدهما مسألة حظّ —
# وهذا ما وجدناه على راوتر حقيقي: خادم الشركة service1 وخادمنا radnas على bridge واحد.
:do {
  :if ([:len [/interface/pppoe-server/server find where comment!~"RadNas"]] > 0) do={
    :local rnDup [/interface/pppoe-server/server find where comment~"RadNas ${tag}"]
    :if ([:len $rnDup] > 0) do={
      /interface/pppoe-server/server remove $rnDup
      :log info "RadNas (${tag}): حُذف خادم PPPoE المكرّر — بقي خادم الشركة وحده"
      :put "RadNas: حُذف خادم PPPoE المكرّر الذي أضافته نسخة أقدم"
    }
  }
} on-error={}

:local rnSrv [/interface/pppoe-server/server find]
:if ([:len $rnSrv] > 0) do={
  :do {
    # الملف السابق يُحفَظ في تعليق الخادم، فيمكن إرجاعه إن لزم.
    :local rnOld [/interface/pppoe-server/server get [:pick $rnSrv 0] default-profile]
    /interface/pppoe-server/server set [:pick $rnSrv 0] default-profile="radnas-${tag}" \\
      comment=("RadNas ${tag} · الملف السابق: " . $rnOld)
    :log info ("RadNas (${tag}): حُوّل خادم PPPoE القائم من " . $rnOld . " إلى radnas-${tag}")
    :put ("RadNas: حُوّل خادم PPPoE القائم إلى radnas-${tag} (كان " . $rnOld . ")")
  } on-error={ :log error "RadNas (${tag}): تعذّر تحويل خادم PPPoE القائم" }
} else={
  # لا خادم قائم: نُنشئ واحداً على أوّل bridge. ولا نُخمّن واجهة فيزيائية —
  # تخمينها على شبكة حيّة يقطع مشتركين.
  :local rnIf ""
  :do {
    :if ([:len [/interface/bridge find]] > 0) do={
      :set rnIf [/interface/bridge get [:pick [/interface/bridge find] 0] name]
    }
  } on-error={}
  :if ([:len $rnIf] > 0) do={
    :do {
      /interface/pppoe-server/server add service-name="radnas" interface=$rnIf \\
        default-profile="radnas-${tag}" authentication=pap,chap,mschap1,mschap2 disabled=no \\
        one-session-per-host=yes comment="RadNas ${tag}"
      :log info ("RadNas (${tag}): خادم PPPoE يعمل على " . $rnIf)
      :put ("RadNas: خادم PPPoE على الواجهة " . $rnIf)
    } on-error={ :log error ("RadNas (${tag}): فشل خادم PPPoE على " . $rnIf) }
  } else={
    :log warning "RadNas (${tag}): لم تُعرَف واجهة المشتركين — أضف خادم PPPoE يدوياً"
    :put "RadNas: لم أجد واجهة للمشتركين. أضف خادم PPPoE على واجهتك ثم اضبط default-profile=radnas-${tag}"
  }
}

# ── 6) تنبيه إن كانت هناك حسابات محلّية تسبق المنصّة ──
:local rnLocal [:len [/ppp/secret find where disabled=no]]
:if ($rnLocal > 0) do={
  :log warning ("RadNas (${tag}): " . $rnLocal . " حساب محلّي مفعّل يسبق RADIUS")
  :put ("RadNas: تنبيه — " . $rnLocal . " حساباً محلّياً في /ppp secret يسبق المنصّة.")
  :put "RadNas: بعد إضافة مشتركيك في اللوحة نفّذ:  /ppp/secret disable [find]"
} else={
  :put "RadNas: لا حسابات محلّية — كل مصادقة ستمرّ على المنصّة."
}

:log info "RadNas (${tag}): اكتمل الإعداد"
:put "RadNas (${tag}): اكتمل الإعداد. تحقّق بـ /ping ${radiusIp}"

# ── 7) محو الملف من قرص الراوتر ──
:delay 2s
:do { /file remove [find name="${filename}"] } on-error={}
`
  return { filename, body }
}
