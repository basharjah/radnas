import type { FastifyRequest, FastifyReply } from 'fastify'

/** Require a valid manager/owner JWT (rejects subscriber-portal tokens). */
export async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify()
  } catch {
    await reply.code(401).send({ error: 'unauthorized' })
    return
  }
  if ((req.user as { kind?: string }).kind === 'subscriber') {
    await reply.code(403).send({ error: 'forbidden' })
  }
}

/** Require a valid subscriber-portal JWT. */
export async function authenticateSubscriber(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify()
  } catch {
    await reply.code(401).send({ error: 'unauthorized' })
    return
  }
  if ((req.user as { kind?: string }).kind !== 'subscriber') {
    await reply.code(403).send({ error: 'forbidden' })
  }
}
