import type { FastifyPluginAsync } from 'fastify'
import { query } from '../db/pool'
import { authenticate } from '../plugins/auth'
import { managerScope } from '../lib/scope'

export const reportRoutes: FastifyPluginAsync = async (app) => {
  app.get('/summary', { preHandler: authenticate }, async (req) => {
    const scope = await managerScope(req.user.sub, (req.user as { role?: string }).role)
    const mp: unknown[] = scope.all ? [] : [scope.ids]
    const mgr = scope.all ? '' : 'manager_id = ANY($1::uuid[])'
    const cond = (extra: string) => `WHERE ${[mgr, extra].filter(Boolean).join(' AND ')}`

    const one = async (sql: string, p: unknown[] = []): Promise<number> => Number((await query<{ c: number }>(sql, p)).rows[0]?.c ?? 0)
    const money = async (sql: string, p: unknown[] = []): Promise<number> => Number((await query<{ s: string }>(sql, p)).rows[0]?.s ?? 0)

    const [total, active, expired, expiring7d, paid12] = await Promise.all([
      one(`SELECT count(*)::int c FROM subscribers ${mgr ? 'WHERE ' + mgr : ''}`, mp),
      one(`SELECT count(*)::int c FROM subscribers ${cond(`status='active'`)}`, mp),
      one(`SELECT count(*)::int c FROM subscribers ${cond(`status='expired'`)}`, mp),
      one(`SELECT count(*)::int c FROM subscribers ${cond(`status='active' AND expiry_at BETWEEN now() AND now() + interval '7 days'`)}`, mp),
      one(`SELECT count(*)::int c FROM invoices ${cond(`status='paid' AND paid_at >= now() - interval '12 months'`)}`, mp),
    ])
    const income_this_month = await money(`SELECT COALESCE(sum(amount),0) s FROM invoices ${cond(`status='paid' AND date_trunc('month',paid_at)=date_trunc('month',now())`)}`, mp)
    const income_12mo = await money(`SELECT COALESCE(sum(amount),0) s FROM invoices ${cond(`status='paid' AND paid_at >= now() - interval '12 months'`)}`, mp)

    const monthly = (await query<{ month: string; total: number }>(
      `SELECT to_char(date_trunc('month', paid_at),'YYYY-MM') AS month, sum(amount)::float AS total
         FROM invoices ${cond(`status='paid' AND paid_at >= now() - interval '12 months'`)}
        GROUP BY 1 ORDER BY 1`,
      mp,
    )).rows

    const resWhere = scope.all ? '' : 'WHERE m.id = ANY($1::uuid[])'
    const resellers = (await query(
      `SELECT m.username, m.full_name, m.role,
              COALESCE(sum(i.amount),0)::float AS total,
              COALESCE(sum(i.amount) FILTER (WHERE i.status='unpaid'),0)::float AS unpaid,
              count(i.id)::int AS invoices
         FROM managers m LEFT JOIN invoices i ON i.manager_id = m.id
         ${resWhere}
        GROUP BY m.id ORDER BY total DESC`,
      mp,
    )).rows

    return { total, active, expired, expiring7d, paid_invoices_12mo: paid12, income_this_month, income_12mo, monthly, resellers }
  })

  // Invoice-aging report: outstanding (unpaid) invoices bucketed by debt age, grouped by reseller.
  app.get('/aging', { preHandler: authenticate }, async (req) => {
    const scope = await managerScope(req.user.sub, (req.user as { role?: string }).role)
    const mp: unknown[] = scope.all ? [] : [scope.ids]
    const w = scope.all ? `status = 'unpaid'` : `status = 'unpaid' AND manager_id = ANY($1::uuid[])`

    const buckets = (await query(
      `SELECT COALESCE(m.username, '—') AS reseller,
              count(*)::int AS count,
              COALESCE(sum(i.amount), 0)::float AS total,
              COALESCE(sum(i.amount) FILTER (WHERE i.age <= 30), 0)::float AS d0_30,
              COALESCE(sum(i.amount) FILTER (WHERE i.age > 30 AND i.age <= 60), 0)::float AS d31_60,
              COALESCE(sum(i.amount) FILTER (WHERE i.age > 60 AND i.age <= 90), 0)::float AS d61_90,
              COALESCE(sum(i.amount) FILTER (WHERE i.age > 90), 0)::float AS d90p
         FROM (SELECT manager_id, amount, (current_date - issued_at)::int AS age FROM invoices WHERE ${w}) i
         LEFT JOIN managers m ON m.id = i.manager_id
        GROUP BY m.username
        ORDER BY total DESC`,
      mp,
    )).rows

    const totals = (await query(
      `SELECT COALESCE(sum(amount) FILTER (WHERE age <= 30), 0)::float AS d0_30,
              COALESCE(sum(amount) FILTER (WHERE age > 30 AND age <= 60), 0)::float AS d31_60,
              COALESCE(sum(amount) FILTER (WHERE age > 60 AND age <= 90), 0)::float AS d61_90,
              COALESCE(sum(amount) FILTER (WHERE age > 90), 0)::float AS d90p,
              COALESCE(sum(amount), 0)::float AS total,
              count(*)::int AS count
         FROM (SELECT amount, (current_date - issued_at)::int AS age FROM invoices WHERE ${w}) x`,
      mp,
    )).rows[0]

    return { buckets, totals }
  })
}
