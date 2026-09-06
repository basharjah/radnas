import type { FastifyPluginAsync } from 'fastify'
import { query } from '../db/pool'
import { authenticate } from '../plugins/auth'
import { deny, roleOf } from '../lib/permissions'
import { managerScope, scopeAllows } from '../lib/scope'
import { decryptSecret } from '../lib/secretbox'

/**
 * Read a router's local PPP accounts so they can be imported into the panel.
 *
 * Every ISP arriving here already has subscribers — as `/ppp secret` entries on their own router.
 * RouterOS checks those BEFORE RADIUS, so until each one exists in the panel under the exact same
 * username, the platform is never consulted and the migration cannot begin. Retyping them by hand is
 * how a real customer gets disconnected by a typo.
 *
 * This only READS. It hands back rows in the shape /subscribers/import already accepts, so the
 * decisions that matter — quota, duplicate detection, which tenant owns a username — stay in that
 * one place rather than being re-implemented here.
 */

/**
 * RouterOS masks every sensitive value over REST — a run of asterisks, HTTP 200, no warning anywhere.
 * This is NOT a permissions problem: verified against a live RB5009 where the `sensitive` policy was
 * granted and `/rest/radius` still returned `*****` for a secret whose real value we hold. So the
 * REST API can never yield subscriber passwords, and a masked value must never be stored — doing so
 * writes `*****` as the password and the failure surfaces days later as a customer who cannot dial in.
 *
 * The passwords come from a file the router writes itself:
 *     /ppp/secret/export file=radnas-secrets show-sensitive
 * uploaded in the panel's import dialog, which parses it.
 */
const MASKED = /^\*+$/

interface Secret {
  name?: string
  password?: string
  profile?: string
  disabled?: string
  comment?: string
  'caller-id'?: string
}

export const routerSecretsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:id/router-secrets', { preHandler: authenticate }, async (req, reply) => {
    if (deny(req, reply, ['owner', 'admin'])) return
    const { id } = req.params as { id: string }
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.code(404).send({ error: 'not_found' })

    const nas = await query<{
      nasname: string; manager_id: string | null
      api_enabled: boolean; api_user: string | null; api_password: string | null; api_port: number | null
    }>(
      `SELECT nasname, manager_id, api_enabled, api_user, api_password, api_port
         FROM nas WHERE id = $1`, [id],
    )
    if (!nas.rowCount) return reply.code(404).send({ error: 'not_found' })
    const n = nas.rows[0]!
    const scope = await managerScope(req.user.sub, roleOf(req))
    if (!scopeAllows(scope, n.manager_id)) return reply.code(404).send({ error: 'not_found' })

    const pw = decryptSecret(n.api_password)
    if (!n.api_enabled || !n.api_user || !pw) {
      return reply.code(409).send({
        error: 'api_not_configured',
        message: 'حساب القراءة على الراوتر غير مضبوط. نزّل ملف الإعداد ونفّذه أولاً.',
      })
    }

    let secrets: Secret[]
    try {
      const auth = 'Basic ' + Buffer.from(`${n.api_user}:${pw}`).toString('base64')
      const res = await fetch(`http://${n.nasname}:${n.api_port ?? 80}/rest/ppp/secret`, {
        headers: { Authorization: auth },
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) {
        return reply.code(502).send({
          error: 'router_refused',
          message: res.status === 401 ? 'الراوتر رفض بيانات القراءة' : `الراوتر أجاب ${res.status}`,
        })
      }
      secrets = JSON.parse(await res.text())
      if (!Array.isArray(secrets)) throw new Error('unexpected shape')
    } catch (e) {
      return reply.code(502).send({
        error: 'unreachable',
        message: 'تعذّر الوصول إلى الراوتر. تأكّد أن النفق يعمل.',
      })
    }

    // Which of these the panel already knows, and whether they belong to this tenant. Computed here
    // so the preview can say "already yours" apart from "taken by another company" — the second is
    // the one that must never be silently overwritten.
    const names = secrets.map((s) => s.name).filter((x): x is string => !!x)
    const known = names.length
      ? await query<{ username: string; manager_id: string | null }>(
          'SELECT username, manager_id FROM subscribers WHERE username = ANY($1::text[])', [names])
      : { rows: [] as { username: string; manager_id: string | null }[] }
    const byName = new Map(known.rows.map((k) => [k.username, k.manager_id]))

    // Counted before filtering so the operator is told the reason rather than shown an empty list.
    const masked = secrets.filter((s) => s.name && s.password && MASKED.test(s.password)).length
    const fix = '/ppp/secret/export file=radnas-secrets show-sensitive'

    const rows = secrets
      .filter((s) => s.name && s.password && !MASKED.test(s.password))
      .map((s) => {
        const owner = byName.get(s.name!)
        return {
          username: s.name!,
          password: s.password!,
          // The router's profile name, NOT a guessed plan: `profile4m` is not `4mb`, and silently
          // mismatching a plan sets the wrong speed and the wrong quota for a paying subscriber.
          // The panel asks which plan each profile maps to.
          profile: s.profile || '(default)',
          full_name: s.comment || undefined,
          mac: s['caller-id'] || undefined,
          disabled_on_router: s.disabled === 'true',
          state: byName.has(s.name!)
            ? (scopeAllows(scope, owner) ? 'mine' : 'other_tenant')
            : 'new',
        }
      })

    if (!rows.length && masked > 0) {
      return reply.code(409).send({
        error: 'passwords_masked',
        message: `الراوتر لا يكشف كلمات المرور عبر الشبكة — أخفى ${masked} حساباً. `
          + `نفّذ هذا السطر في طرفية الراوتر، ثم نزّل الملف radnas-secrets.rsc من Files وارفعه هنا:
${fix}`,
        masked,
        fix,
      })
    }

    return {
      router: n.nasname,
      total: rows.length,
      // Surfaced even when some rows did come through: a partial import that silently drops half the
      // subscribers is the same outage, only harder to notice.
      masked,
      fix: masked > 0 ? fix : undefined,
      profiles: [...new Set(rows.map((r) => r.profile))],
      rows,
    }
  })
}
