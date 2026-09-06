import { query } from '../db/pool'

export interface Scope {
  /** true => owner/admin, no restriction */
  all: boolean
  /** manager ids the user may see (self + descendants); empty when all=true */
  ids: string[]
}

/**
 * Compute which managers the current user is allowed to see:
 *  - owner (super admin) -> { all: true }            (full visibility)
 *  - admin / reseller    -> { all: false, ids: [...] } (self + entire sub-tree via parent_id)
 *
 * Only the owner sees everyone; an admin is isolated to its own tree (itself + its resellers +
 * their subscribers/finances) and never sees the owner or sibling admins.
 */
export async function managerScope(sub: string, role?: string): Promise<Scope> {
  if (role === 'owner') return { all: true, ids: [] }
  const r = await query<{ id: string }>(
    `WITH RECURSIVE tree AS (
       SELECT id FROM managers WHERE id = $1
       UNION ALL
       SELECT m.id FROM managers m JOIN tree t ON m.parent_id = t.id
     )
     SELECT id FROM tree`,
    [sub],
  )
  return { all: false, ids: r.rows.map((x) => x.id) }
}

/** Convenience: does this scope allow the given manager id? */
export function scopeAllows(scope: Scope, managerId: string | null | undefined): boolean {
  if (scope.all) return true
  return managerId != null && scope.ids.includes(managerId)
}
