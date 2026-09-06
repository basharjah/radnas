import type { FastifyPluginAsync } from 'fastify'
import { query } from '../db/pool'
import { authenticate } from '../plugins/auth'
import { managerScope } from '../lib/scope'

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get('/stats', { preHandler: authenticate }, async (req) => {
    const scope = await managerScope(req.user.sub, (req.user as { role?: string }).role)
    const mp: unknown[] = scope.all ? [] : [scope.ids] // $1 = in-scope manager ids (when scoped)
    const subWhere = scope.all ? '' : 'manager_id = ANY($1::uuid[])'
    const withCond = (extra: string) => `WHERE ${[subWhere, extra].filter(Boolean).join(' AND ')}`

    const one = async (sql: string, p: unknown[] = []): Promise<number> =>
      Number((await query<{ c: number }>(sql, p)).rows[0]?.c ?? 0)

    const [total, active, expired, disabled, newThisMonth, expiring7d] = await Promise.all([
      one(`SELECT count(*)::int AS c FROM subscribers ${subWhere ? 'WHERE ' + subWhere : ''}`, mp),
      one(`SELECT count(*)::int AS c FROM subscribers ${withCond(`status = 'active'`)}`, mp),
      one(`SELECT count(*)::int AS c FROM subscribers ${withCond(`status = 'expired'`)}`, mp),
      one(`SELECT count(*)::int AS c FROM subscribers ${withCond(`status = 'disabled'`)}`, mp),
      one(`SELECT count(*)::int AS c FROM subscribers ${withCond(`date_trunc('month', created_at) = date_trunc('month', now())`)}`, mp),
      one(`SELECT count(*)::int AS c FROM subscribers ${withCond(`status = 'active' AND expiry_at IS NOT NULL AND expiry_at BETWEEN now() AND now() + interval '7 days'`)}`, mp),
    ])

    const online = scope.all
      ? await one(`SELECT count(*)::int AS c FROM radacct WHERE acctstoptime IS NULL`)
      : await one(
          `SELECT count(*)::int AS c FROM radacct r
            WHERE r.acctstoptime IS NULL
              AND r.username IN (SELECT username FROM subscribers WHERE manager_id = ANY($1::uuid[]))`,
          mp,
        )

    // Plans scoped per tenant: an admin sees its own plans + the global (owner-less) catalog.
    const plans = scope.all
      ? await one(`SELECT count(*)::int AS c FROM plans`)
      : await one(`SELECT count(*)::int AS c FROM plans WHERE manager_id = ANY($1::uuid[]) OR manager_id IS NULL`, mp)
    const managers = scope.all
      ? await one(`SELECT count(*)::int AS c FROM managers`)
      : Math.max(0, scope.ids.length - 1) // sub-resellers only (exclude self)

    const baseStart = total - newThisMonth
    const growth_pct = baseStart > 0 ? Math.round((newThisMonth / baseStart) * 1000) / 10 : newThisMonth > 0 ? 100 : 0

    return {
      total_subscribers: total, active, expired, disabled, online, plans, managers,
      expiring_7d: expiring7d, new_this_month: newThisMonth, growth_pct,
    }
  })

  // Bandwidth over the last 24h (owner/admin only — resellers don't see server-wide traffic).
  app.get('/bandwidth', { preHandler: authenticate }, async (req) => {
    const scope = await managerScope(req.user.sub, (req.user as { role?: string }).role)
    if (!scope.all) return { points: [], peak_mbps: 0, avg_mbps: 0, samples: 0 }

    const rows = (
      await query<{ t: string; dt: string | null; din: string | null; dout: string | null }>(
        `SELECT sampled_at AS t,
                EXTRACT(EPOCH FROM (sampled_at - LAG(sampled_at) OVER w)) AS dt,
                total_in_bytes  - LAG(total_in_bytes)  OVER w AS din,
                total_out_bytes - LAG(total_out_bytes) OVER w AS dout
           FROM traffic_samples
          WHERE sampled_at >= now() - interval '24 hours'
         WINDOW w AS (ORDER BY sampled_at)
          ORDER BY sampled_at`,
      )
    ).rows

    const points = rows
      .filter((r) => r.dt != null && Number(r.dt) > 0)
      .map((r) => {
        const dt = Number(r.dt)
        const din = Math.max(0, Number(r.din ?? 0))
        const dout = Math.max(0, Number(r.dout ?? 0))
        return {
          t: r.t,
          in_mbps: Math.round(((din * 8) / dt / 1e6) * 100) / 100,
          out_mbps: Math.round(((dout * 8) / dt / 1e6) * 100) / 100,
        }
      })

    const peak_mbps = points.reduce((m, p) => Math.max(m, p.in_mbps + p.out_mbps), 0)
    const avg_mbps =
      points.length > 0
        ? Math.round((points.reduce((s, p) => s + p.in_mbps + p.out_mbps, 0) / points.length) * 100) / 100
        : 0

    return { points, peak_mbps: Math.round(peak_mbps * 100) / 100, avg_mbps, samples: points.length }
  })
}
