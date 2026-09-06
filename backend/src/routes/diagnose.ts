import type { FastifyPluginAsync } from 'fastify'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { query } from '../db/pool'
import { authenticate } from '../plugins/auth'
import { deny, roleOf } from '../lib/permissions'
import { managerScope, scopeAllows } from '../lib/scope'
import { decryptSecret } from '../lib/secretbox'

const run = promisify(execFile)

/**
 * End-to-end diagnosis of one router's link to the platform.
 *
 * Built after a day spent chasing a customer whose PPPoE would not come up. Every fault turned out
 * to be silent: a shared secret that did not match (FreeRADIUS drops the packet without a log line),
 * a subscriber pool outside what the tunnel carries (WireGuard drops it at encryption), local
 * `/ppp secret` accounts that RouterOS checks before RADIUS so the platform is never asked. None of
 * them produce an error anywhere; each had to be found by hand with tcpdump and the router's API.
 *
 * Every link in the chain is checked independently and reports WHY it failed and what fixes it,
 * because "it doesn't work" has a dozen causes and guessing between them is what costs the day.
 */

type Status = 'ok' | 'fail' | 'warn' | 'skip'
interface Check { key: string; label: string; status: Status; detail: string; fix?: string }

const ok = (key: string, label: string, detail: string): Check => ({ key, label, status: 'ok', detail })
const bad = (key: string, label: string, detail: string, fix: string): Check =>
  ({ key, label, status: 'fail', detail, fix })
const warn = (key: string, label: string, detail: string, fix?: string): Check =>
  ({ key, label, status: 'warn', detail, fix })

export const diagnoseRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:id/diagnose', { preHandler: authenticate }, async (req, reply) => {
    if (deny(req, reply, ['owner', 'admin'])) return
    const { id } = req.params as { id: string }
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.code(404).send({ error: 'not_found' })

    const nasRes = await query<{
      nasname: string; shortname: string | null; secret: string; manager_id: string | null
      api_enabled: boolean; api_user: string | null; api_password: string | null; api_port: number | null
      iface: string | null; tunnel_ip: string | null; pool_cidr: string | null
    }>(
      `SELECT n.nasname, n.shortname, n.secret, n.manager_id, n.api_enabled, n.api_user,
              n.api_password, n.api_port, w.iface, host(w.tunnel_ip) AS tunnel_ip, w.pool_cidr
         FROM nas n LEFT JOIN wireguard_peers w ON w.nas_id = n.id
        WHERE n.id = $1`, [id],
    )
    if (!nasRes.rowCount) return reply.code(404).send({ error: 'not_found' })
    const n = nasRes.rows[0]!
    const scope = await managerScope(req.user.sub, roleOf(req))
    if (!scopeAllows(scope, n.manager_id)) return reply.code(404).send({ error: 'not_found' })

    const checks: Check[] = []
    const net = n.tunnel_ip ? n.tunnel_ip.split('.').slice(0, 3).join('.') : ''
    const radiusIp = net ? `${net}.1` : ''
    const tag = (n.shortname || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

    // ---- tunnel ---------------------------------------------------------------------------
    if (!n.iface || !n.tunnel_ip) {
      checks.push(bad('tunnel', 'النفق', 'لا يوجد نفق مرتبط بهذا الراوتر',
        'تواصل مع الإدارة — النفق يُجهَّز تلقائياً عند الموافقة على الحساب'))
      return { router: { nasname: n.nasname, shortname: n.shortname }, checks, summary: tally(checks) }
    }

    let handshakeAge: number | null = null
    try {
      const { stdout } = await run('wg', ['show', n.iface, 'latest-handshakes'], { timeout: 4000 })
      const hs = Number(stdout.trim().split(/\s+/)[1] || 0)
      handshakeAge = hs > 0 ? Math.floor(Date.now() / 1000) - hs : null
    } catch { /* interface gone */ }

    checks.push(handshakeAge !== null && handshakeAge < 180
      ? ok('handshake', 'النفق متّصل', `آخر مصافحة قبل ${handshakeAge} ثانية`)
      : bad('handshake', 'النفق متّصل',
          handshakeAge === null ? 'لم يتّصل الراوتر بالنفق قطّ' : `آخر مصافحة قبل ${handshakeAge} ثانية`,
          'ارفع ملف الإعداد إلى الراوتر. إن رفعته فتحقّق أن RouterOS إصدار 7 أو أحدث، وأن منفذ UDP الصادر غير محجوب'))

    // The pool the router hands out must be inside what the tunnel is willing to carry, or every
    // subscriber address is dropped at encryption with no error anywhere.
    let carries = false
    try {
      const { stdout } = await run('wg', ['show', n.iface, 'allowed-ips'], { timeout: 4000 })
      const allowed = stdout.trim().split(/\s+/).slice(1)
      carries = !!n.pool_cidr && allowed.includes(n.pool_cidr)
      checks.push(carries
        ? ok('pool', 'النفق يحمل بركة المشتركين', n.pool_cidr!)
        : bad('pool', 'النفق يحمل بركة المشتركين',
            `البركة ${n.pool_cidr} ليست ضمن ${allowed.join(' · ')}`,
            'أبلغ الإدارة بشبكة مشتركيك الفعلية ليُوسَّع النفق — حتى ذلك الحين تُسقَط حزم مشتركيك بصمت'))
    } catch { /* reported by the handshake check */ }

    // ---- reachability ---------------------------------------------------------------------
    const ping = async (ip: string) => {
      try { await run('ping', ['-c2', '-W2', '-I', n.iface!, ip], { timeout: 8000 }); return true }
      catch { return false }
    }
    const routerUp = await ping(n.tunnel_ip)
    checks.push(routerUp
      ? ok('reach', 'الوصول إلى الراوتر', n.tunnel_ip)
      : bad('reach', 'الوصول إلى الراوتر', `${n.tunnel_ip} لا يستجيب`,
          'الواجهة على الراوتر قد تكون بلا عنوان IP. نفّذ /ip/address print وتحقّق، أو أعِد تنفيذ ملف الإعداد'))

    // ---- router API -----------------------------------------------------------------------
    const pw = decryptSecret(n.api_password)
    if (!n.api_enabled || !n.api_user || !pw) {
      checks.push(warn('api', 'حساب القراءة', 'غير مضبوط — لا يمكن فحص إعداد الراوتر نفسه',
        'نزّل ملف الإعداد ونفّذه؛ يُنشئ حساب القراءة تلقائياً'))
      return { router: pub(n), checks, summary: tally(checks) }
    }
    const auth = 'Basic ' + Buffer.from(`${n.api_user}:${pw}`).toString('base64')
    const get = async (path: string): Promise<unknown> => {
      const res = await fetch(`http://${n.nasname}:${n.api_port ?? 80}${path}`,
        { headers: { Authorization: auth }, signal: AbortSignal.timeout(7000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return JSON.parse(await res.text())
    }

    let reachableApi = true
    try { await get('/rest/system/resource'); checks.push(ok('api', 'حساب القراءة', n.api_user)) }
    catch (e) {
      reachableApi = false
      checks.push(bad('api', 'حساب القراءة', (e as Error).message,
        'تحقّق من قاعدة جدار الحماية التي تسمح للخادم بالمنفذ 80، ومن وجود الحساب على الراوتر'))
    }

    if (reachableApi) {
      // ---- RADIUS client, and the secret that silently breaks everything -------------------
      try {
        const rad = (await get('/rest/radius')) as Record<string, string>[]
        const ours = rad.find((x) => x.address === radiusIp)
        if (!ours) {
          checks.push(bad('radius_entry', 'سجلّ RADIUS على الراوتر', `لا سجلّ يشير إلى ${radiusIp}`,
            'أعِد تنفيذ ملف الإعداد'))
        } else {
          checks.push(ok('radius_entry', 'سجلّ RADIUS على الراوتر', `${ours.address} · حالة ${ours.status || 'ok'}`))
          checks.push(ours['src-address'] === n.tunnel_ip
            ? ok('radius_src', 'عنوان المصدر', ours['src-address']!)
            : bad('radius_src', 'عنوان المصدر', `${ours['src-address']} بدل ${n.tunnel_ip}`,
                'أعِد تنفيذ ملف الإعداد'))

          // The secret is NOT compared: RouterOS returns `*****` for it over REST and never the real
          // value, so any comparison here is a mask against a secret and always reports a mismatch.
          // It is verified behaviourally further down instead — whether the server has actually
          // accepted a request from this router since its secret last changed.

          // Any OTHER RADIUS entry is reported, and its position matters. RouterOS queries entries in
          // order and only falls through on timeout, so a leftover entry ahead of ours — a survivor of
          // a config copied from another router — delays every single authentication by its full
          // timeout budget, and its src-address does not even exist on this router. It is invisible
          // otherwise: our own entry is present and correct, so every check here would pass.
          const strays = rad.filter((x) => x.address !== radiusIp && (x.service || '').includes('ppp'))
          if (strays.length) {
            const first = rad.findIndex((x) => (x.service || '').includes('ppp'))
            const oursAt = rad.findIndex((x) => x.address === radiusIp)
            checks.push(bad('radius_stray', 'سجلّات RADIUS غريبة',
              `${strays.length} سجلّاً لا يخصّ هذه المنصّة: ${strays.map((x) => x.address).join(' · ')}`
              + (oursAt > first ? ' — وأحدها يسبق سجلّنا في الترتيب' : ''),
              // Each stray is named explicitly rather than matched by exclusion. `address` is an IP
              // property in RouterOS, so `address!="1.2.3.4"` does NOT compare the way it reads and
              // matches every row — an exclusion filter here deletes the tenant's own entry too, and
              // then the router has no server left to ask. Enumerating is the only safe form.
              strays.map((x) => `/radius remove [find address=${x.address}]`).join(' ; ')))
          }
        }
      } catch { checks.push(warn('radius_entry', 'سجلّ RADIUS على الراوتر', 'تعذّرت القراءة')) }

      // ---- ppp aaa ------------------------------------------------------------------------
      try {
        const aaa = (await get('/rest/ppp/aaa')) as Record<string, string>
        checks.push(aaa['use-radius'] === 'true'
          ? ok('use_radius', 'المصادقة عبر RADIUS', 'مفعّلة')
          : bad('use_radius', 'المصادقة عبر RADIUS', 'معطّلة',
              '/ppp/aaa set use-radius=yes — أو أعِد تنفيذ ملف الإعداد'))
        checks.push(aaa.accounting === 'true'
          ? ok('accounting_on', 'إرسال المحاسبة', `مفعّل · تحديث كل ${aaa['interim-update'] || '?'}`)
          : bad('accounting_on', 'إرسال المحاسبة', 'معطّل — لن يُحتسب استهلاك أحد',
              '/ppp/aaa set accounting=yes interim-update=1m'))
      } catch { /* covered by the API check */ }

      // ---- PPPoE server and the profile that gives subscribers an address -----------------
      try {
        const srv = (await get('/rest/interface/pppoe-server/server')) as Record<string, string>[]
        const up = srv.filter((s) => s.disabled !== 'true')
        if (!up.length) {
          checks.push(bad('pppoe', 'خادم PPPoE', 'لا خادم مفعّل',
            'نزّل ملف إعداد PPPoE، عدّل الواجهة في أعلاه، ونفّذه'))
        } else {
          checks.push(ok('pppoe', 'خادم PPPoE', up.map((s) => s.interface).join(' · ')))
          const profs = (await get('/rest/ppp/profile')) as Record<string, string>[]
          const pools = (await get('/rest/ip/pool')) as Record<string, string>[]
          const poolNet = (n.pool_cidr || '').split('/')[0]!.split('.').slice(0, 3).join('.')
          for (const s of up) {
            const p = profs.find((x) => x.name === s['default-profile'])
            if (!p) {
              checks.push(bad('profile', 'الملف الافتراضي', `${s['default-profile']} غير موجود`,
                'أنشئه من ملف إعداد PPPoE ثم: /interface/pppoe-server/server set [find] default-profile=radnas-' + tag))
              continue
            }
            const pool = pools.find((x) => x.name === p['remote-address'])
            const inside = pool ? String(pool.ranges).includes(poolNet) : false
            checks.push(inside
              ? ok('profile', 'الملف الافتراضي وبركته', `${p.name} → ${pool!.ranges}`)
              : bad('profile', 'الملف الافتراضي وبركته',
                  pool ? `${pool.name} = ${pool.ranges} خارج ${n.pool_cidr}` : `${p.name} بلا بركة`,
                  'اجعل البركة داخل الشبكة التي يحملها نفقك، وإلّا لن يصل مشتركوك رغم نجاح مصادقتهم'))
          }
        }
      } catch { /* covered above */ }

      // ---- does the pool collide with a network already on the router? ---------------------
      // The pool is handed out by the platform without seeing the customer's WAN. Starlink gives its
      // subscribers a 100.64.0.0/10 address, which puts that entire /10 on the router as a connected
      // route at distance 0 — and the platform's original pools were carved out of exactly that
      // range. The result reads as success everywhere: the tunnel is up, authentication passes,
      // per-session /32 routes even answer ping. Only the subscribers' internet is gone, and nothing
      // logs a word about it. This check is the only place that would say why.
      try {
        const addrs = (await get('/rest/ip/address')) as Record<string, string>[]
        const clash = n.pool_cidr ? addrs.filter((a) => {
          // Skip the dynamic /32s PPP creates for each live session — those ARE the pool.
          if (String(a.interface || '').startsWith('<')) return false
          return overlaps(String(a.address), n.pool_cidr!)
        }) : []
        if (clash.length) {
          const where = clash.map((a) => `${a.address} على ${a.interface}`).join(' · ')
          checks.push(bad('pool_clash', 'تقاطع بركة المشتركين',
            `${n.pool_cidr} داخل شبكة موجودة على الراوتر: ${where}`,
            'البركة تتنازع مع شبكة متّصلة، فيعمل ping ولا يعمل الإنترنت. غيّر بركة هذه الشركة '
            + 'من صفحة الراوتر إلى نطاق لا يظهر في /ip/address، ثم أعِد تنفيذ ملف الإعداد'))
        } else if (n.pool_cidr) {
          checks.push(ok('pool_clash', 'تقاطع بركة المشتركين', `${n.pool_cidr} لا تتقاطع مع شيء`))
        }
      } catch { /* the address list is optional; the rest of the diagnosis still stands */ }

      // ---- the usual blocker ---------------------------------------------------------------
      let sessions: Record<string, string>[] = []
      try {
        const secrets = (await get('/rest/ppp/secret')) as Record<string, string>[]
        const enabled = secrets.filter((s) => s.disabled !== 'true')
        sessions = (await get('/rest/ppp/active')) as Record<string, string>[]
        const viaRadius = sessions.filter((a) => a.radius === 'true')
        const allViaRadius = sessions.length > 0 && viaRadius.length === sessions.length

        // Enabled local accounts are only a fault when something is actually using them. A router
        // whose every session already comes through the platform has leftovers, not a blocker.
        checks.push(enabled.length === 0
          ? ok('local_secrets', 'الحسابات المحلّية', 'لا شيء — كل المصادقة تمرّ على المنصّة')
          : allViaRadius
            ? warn('local_secrets', 'الحسابات المحلّية',
                `${enabled.length} حساباً مفعّلاً، ولا جلسة تستعملها`,
                'بقايا لا تعطّل شيئاً الآن، لكن أي مشترك يطابق أحدها سيتجاوز المنصّة. عطّلها بـ /ppp/secret disable [find]')
            : bad('local_secrets', 'الحسابات المحلّية',
                `${enabled.length} حساباً مفعّلاً على الراوتر`,
                'RouterOS يفحصها قبل RADIUS فلا تصل المنصّة شيئاً. عطّلها بـ /ppp/secret disable [find] — بعد التأكّد أن كل مشترك موجود ومفعّل في اللوحة'))
        checks.push(sessions.length === 0
          ? warn('sessions', 'الجلسات عبر المنصّة', 'لا جلسات نشطة الآن')
          : viaRadius.length === sessions.length
            ? ok('sessions', 'الجلسات عبر المنصّة', `${viaRadius.length} من ${sessions.length}`)
            : bad('sessions', 'الجلسات عبر المنصّة', `${viaRadius.length} من ${sessions.length} فقط`,
                'الباقي يُصادَق محلياً — عطّل الحسابات المحلّية'))
      } catch { /* covered above */ }

      // ---- the precondition that protects live customers ----------------------------------
      if (sessions.length) {
        const names = sessions.map((a) => a.name).filter(Boolean)
        const missing = await query<{ username: string }>(
          `SELECT u AS username FROM unnest($1::text[]) u
            WHERE NOT EXISTS (SELECT 1 FROM subscribers s WHERE s.username = u AND s.status = 'active')`,
          [names])
        checks.push(missing.rowCount === 0
          ? ok('coverage', 'كل جلسة لها مشترك مفعّل', `${names.length} جلسة`)
          : bad('coverage', 'كل جلسة لها مشترك مفعّل',
              `${missing.rowCount} بلا مشترك مفعّل: ${missing.rows.map((r) => r.username).join('، ')}`,
              'أنشئهم في اللوحة وفعّلهم قبل تعطيل الحسابات المحلّية — وإلّا انقطعوا فور التبديل'))
      }

      // ---- firewall -----------------------------------------------------------------------
      try {
        const fw = (await get('/rest/ip/firewall/filter')) as Record<string, string>[]
        for (const [k, what] of [['coa', 'CoA'], ['api_rule', 'API']] as [string, string][]) {
          const rule = fw.find((f) => f.comment === `RadNas ${tag} ${what}`)
          checks.push(rule && rule['src-address'] === radiusIp
            ? ok(k, `قاعدة ${what}`, `تسمح لـ${radiusIp}`)
            : warn(k, `قاعدة ${what}`,
                rule ? `تسمح لـ${rule['src-address']} بدل ${radiusIp}` : 'غير موجودة',
                'أعِد تنفيذ ملف الإعداد — يشتقّ العنوان من إعداد نفقك'))
        }
      } catch { /* covered above */ }
    }

    // ---- platform side ----------------------------------------------------------------------
    const subs = await query<{ total: number; active: number }>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'active')::int AS active
         FROM subscribers WHERE manager_id = $1`, [n.manager_id])
    const s0 = subs.rows[0]!
    checks.push(s0.active > 0
      ? ok('subs', 'مشتركون في اللوحة', `${s0.total} إجمالاً · ${s0.active} مفعّل`)
      : warn('subs', 'مشتركون في اللوحة', 'لا مشترك مفعّل بعد', 'أضف مشتركيك أو استوردهم من الراوتر'))

    // Passwords RouterOS refused to reveal. It masks sensitive values over REST unconditionally —
    // the `sensitive` policy does not lift it, proven on a live RB5009 whose RADIUS secret still came
    // back as asterisks with the policy granted — and an early import stored those verbatim. Every affected subscriber then fails authentication with the
    // generic "user name and password not recognized", which points at the wrong thing entirely.
    // Nothing else in this diagnosis would catch it: the tunnel, secret, pool and firewall are all
    // fine, and the panel looks fully populated.
    const junk = await query<{ c: number; sample: string | null }>(
      `SELECT count(*)::int AS c, min(c.username) AS sample
         FROM radcheck c JOIN subscribers s ON s.username = c.username
        WHERE s.manager_id = $1 AND c.attribute = 'Cleartext-Password' AND c.value ~ '^[*]+$'`,
      [n.manager_id])
    const j0 = junk.rows[0]!
    if (j0.c > 0) {
      checks.push(bad('masked_passwords', 'كلمات مرور المشتركين',
        `${j0.c} مشتركاً كلمة مروره نجوم (مثل ${j0.sample}) — استُوردت مخفيّة من الراوتر`,
        'RouterOS لا يكشف كلمات المرور عبر الشبكة. نفّذ في طرفية الراوتر: '
        + '/ppp/secret/export file=radnas-secrets show-sensitive '
        + 'ثم نزّل radnas-secrets.rsc من Files وارفعه في نافذة الاستيراد باللوحة'))
    } else if (s0.total > 0) {
      checks.push(ok('masked_passwords', 'كلمات مرور المشتركين', 'كلها صالحة'))
    }

    const acct = await query<{ c: number; last: string | null; since_change: number }>(
      `SELECT count(*)::int AS c, max(acctupdatetime)::text AS last,
              count(*) FILTER (WHERE acctstarttime > (SELECT updated_at FROM nas WHERE id = $2))::int AS since_change
         FROM radacct WHERE nasipaddress = $1::inet`, [n.nasname, id])
    const a0 = acct.rows[0]!
    checks.push(a0.c > 0
      ? ok('accounting', 'محاسبة واردة من هذا الراوتر', `${a0.c} جلسة · آخرها ${a0.last?.slice(0, 16)}`)
      : bad('accounting', 'محاسبة واردة من هذا الراوتر', 'لم يصل طلب واحد',
          'إن كانت بقيّة الفحوص سليمة فالسبب غالباً الحسابات المحلّية أو سرّ قديم على الراوتر'))

    // Behavioural proof that the shared secret is right — the only proof available, since the router
    // will not reveal it. A NAS whose secret was changed and has accepted nothing since is the exact
    // signature of a router still holding the old one: requests arrive, get dropped for a failed
    // Message-Authenticator, and nothing is logged anywhere.
    if (a0.c > 0 && a0.since_change === 0) {
      checks.push(bad('secret_proof', 'السرّ المشترك',
        'لم تُقبل أي مصادقة منذ آخر تغيير لبيانات هذا الراوتر',
        'الراوتر يحمل السرّ القديم. أعِد تنفيذ ملف الإعداد — يكتب السرّ الحالي. ولا تكتبه بيدك'))
    } else if (a0.since_change > 0) {
      checks.push(ok('secret_proof', 'السرّ المشترك', 'مُثبَت — الخادم يقبل طلبات هذا الراوتر'))
    }

    return { router: pub(n), checks, summary: tally(checks) }
  })
}

/**
 * Do a router address (a.b.c.d/len) and a pool CIDR share any address?
 *
 * Written out rather than pulled from a library because it decides whether a customer is told their
 * pool is unusable, and a wrong answer here is a wrong diagnosis. Both sides are reduced to their
 * network number under the shorter prefix; equal networks mean the ranges intersect.
 */
function overlaps(addrWithLen: string, cidr: string): boolean {
  const num = (ip: string): number | null => {
    const p = ip.split('.')
    if (p.length !== 4) return null
    let v = 0
    for (const part of p) {
      const b = Number(part)
      if (!Number.isInteger(b) || b < 0 || b > 255) return null
      v = v * 256 + b
    }
    return v
  }
  const parse = (s: string): [number, number] | null => {
    const [ip, len] = s.split('/')
    const v = num(String(ip))
    const l = Number(len)
    if (v === null || !Number.isInteger(l) || l < 0 || l > 32) return null
    return [v, l]
  }
  const a = parse(addrWithLen)
  const b = parse(cidr)
  if (!a || !b) return false
  const shortest = Math.min(a[1], b[1])
  // A /0 mask would shift by 32, which is undefined for JS bitwise ops — and everything overlaps 0.
  if (shortest === 0) return true
  const mask = (-1 << (32 - shortest)) >>> 0
  return ((a[0] >>> 0) & mask) === ((b[0] >>> 0) & mask)
}

const pub = (n: { nasname: string; shortname: string | null; iface: string | null; tunnel_ip: string | null; pool_cidr: string | null }) =>
  ({ nasname: n.nasname, shortname: n.shortname, iface: n.iface, tunnel_ip: n.tunnel_ip, pool_cidr: n.pool_cidr })

const tally = (c: Check[]) => ({
  ok: c.filter((x) => x.status === 'ok').length,
  fail: c.filter((x) => x.status === 'fail').length,
  warn: c.filter((x) => x.status === 'warn').length,
})
