import type { FastifyPluginAsync } from 'fastify'
import { ping } from '../db/pool'

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ({
    status: 'ok',
    service: 'radnas-backend',
    time: new Date().toISOString(),
  }))

  app.get('/health/db', async (_req, reply) => {
    try {
      const ok = await ping()
      return { status: ok ? 'ok' : 'error', db: ok }
    } catch (err) {
      reply.code(503)
      return { status: 'error', db: false, message: (err as Error).message }
    }
  })
}
