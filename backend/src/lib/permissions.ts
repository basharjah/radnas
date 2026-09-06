import type { FastifyReply, FastifyRequest } from 'fastify'

/** Roles, highest privilege first. 'owner' = the "super admin". */
export type Role = 'owner' | 'admin' | 'reseller'

export function roleOf(req: FastifyRequest): Role {
  return ((req.user as { role?: string }).role as Role) ?? 'reseller'
}

/**
 * Guard: if the caller's role is not in `allowed`, send 403 and return true
 * (so the handler can `if (deny(...)) return`). Otherwise return false.
 */
export function deny(req: FastifyRequest, reply: FastifyReply, allowed: Role[]): boolean {
  if (!allowed.includes(roleOf(req))) {
    reply.code(403).send({ error: 'forbidden', message: 'ليس لديك صلاحية لهذا الإجراء' })
    return true
  }
  return false
}
