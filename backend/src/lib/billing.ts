import { query } from '../db/pool'

/** Create an invoice with an auto-generated INV-###### number. */
export async function createInvoice(opts: {
  subscriberId?: string | null
  managerId?: string | null
  description: string
  amount: number
  currency?: string
  status?: 'paid' | 'unpaid'
}): Promise<{ id: string; number: string }> {
  const numRes = await query<{ n: string }>(
    `SELECT 'INV-' || lpad(nextval('invoice_number_seq')::text, 6, '0') AS n`,
  )
  const number = numRes.rows[0]!.n
  const res = await query<{ id: string }>(
    `INSERT INTO invoices (number, subscriber_id, manager_id, description, amount, currency, status, paid_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $7 = 'paid' THEN now() ELSE NULL END)
     RETURNING id`,
    [number, opts.subscriberId ?? null, opts.managerId ?? null, opts.description, opts.amount, opts.currency ?? 'USD', opts.status ?? 'unpaid'],
  )
  return { id: res.rows[0]!.id, number }
}

/** Append a row to the financial ledger. */
export async function recordTransaction(opts: {
  managerId?: string | null
  counterpartyId?: string | null
  type: 'charge' | 'commission' | 'topup' | 'withdraw' | 'transfer'
  direction?: 'in' | 'out'
  amount: number
  points?: number
  note?: string
}): Promise<void> {
  await query(
    `INSERT INTO transactions (manager_id, counterparty_id, type, direction, amount, points, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [opts.managerId ?? null, opts.counterpartyId ?? null, opts.type, opts.direction ?? 'out', opts.amount, opts.points ?? 0, opts.note ?? null],
  )
}
