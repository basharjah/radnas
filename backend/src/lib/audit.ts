import { query } from '../db/pool'

/** Append an entry to audit_log. Never throws — audit must not break the main flow. */
export async function audit(opts: {
  performedBy?: string | null
  performedByName?: string | null
  action: string
  targetType?: string
  targetId?: string
  details?: string
  ip?: string
}): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_log (performed_by, performed_by_name, action, target_type, target_id, details, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        opts.performedBy ?? null,
        opts.performedByName ?? null,
        opts.action,
        opts.targetType ?? null,
        opts.targetId ?? null,
        opts.details ?? null,
        opts.ip ?? null,
      ],
    )
  } catch {
    /* swallow */
  }
}
