import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { env } from './env'
import { healthRoutes } from './routes/health'
import { authRoutes } from './routes/auth'
import { dashboardRoutes } from './routes/dashboard'
import { subscriberRoutes } from './routes/subscribers'
import { subscriberImportRoutes } from './routes/subscribersImport'
import { planRoutes } from './routes/plans'
import { managerRoutes } from './routes/managers'
import { invoiceRoutes } from './routes/invoices'
import { transactionRoutes } from './routes/transactions'
import { nasRoutes } from './routes/nas'
import { routerSecretsRoutes } from './routes/routerSecrets'
import { diagnoseRoutes } from './routes/diagnose'
import { hotspotRoutes } from './routes/hotspot'
import { radiusRoutes } from './routes/radius'
import { wireguardRoutes } from './routes/wireguard'
import { coaRoutes } from './routes/coa'
import { reportRoutes } from './routes/reports'
import { auditRoutes } from './routes/audit'
import { settingsRoutes } from './routes/settings'
import { telegramRoutes } from './routes/telegram'
import { portalRoutes } from './routes/portal'
import { backupRoutes } from './routes/backups'
import { onboardingRoutes } from './routes/onboarding'
import { pushRoutes } from './routes/push'
import { startTrafficSampler } from './lib/trafficSampler'
import { ensureAutomationSchema, startScheduler } from './lib/scheduler'
import { initPush } from './lib/push'
import { startRouterPoller } from './lib/routerPoller'

async function buildServer() {
  const app = Fastify({
    logger: { level: env.NODE_ENV === 'production' ? 'info' : 'debug' },
    trustProxy: true, // behind Apache reverse-proxy: derive real client IP from X-Forwarded-For
  })

  // Accept body-less POSTs regardless of Content-Type (clients vary); JSON is still parsed normally.
  app.addContentTypeParser(/^(?!application\/json).*$/, { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body && (body as Buffer).length ? body : undefined)
  })

  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true })
  await app.register(cookie)
  await app.register(jwt, { secret: env.JWT_SECRET })
  // Global rate limit (per real client IP) — baseline abuse/DoS protection.
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' })

  await app.register(healthRoutes)
  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' })
  await app.register(subscriberRoutes, { prefix: '/api/subscribers' })
  await app.register(subscriberImportRoutes, { prefix: '/api/subscribers' })
  await app.register(planRoutes, { prefix: '/api/plans' })
  await app.register(managerRoutes, { prefix: '/api/managers' })
  await app.register(invoiceRoutes, { prefix: '/api/invoices' })
  await app.register(transactionRoutes, { prefix: '/api/transactions' })
  await app.register(nasRoutes, { prefix: '/api/nas' })
  await app.register(routerSecretsRoutes, { prefix: '/api/nas' })
  await app.register(diagnoseRoutes, { prefix: '/api/nas' })
  await app.register(hotspotRoutes, { prefix: '/api/hotspot' })
  await app.register(radiusRoutes, { prefix: '/api/radius' })
  await app.register(wireguardRoutes, { prefix: '/api/wireguard' })
  await app.register(coaRoutes, { prefix: '/api/coa' })
  await app.register(reportRoutes, { prefix: '/api/reports' })
  await app.register(auditRoutes, { prefix: '/api/audit' })
  await app.register(settingsRoutes, { prefix: '/api/settings' })
  await app.register(telegramRoutes, { prefix: '/api/telegram' })
  await app.register(portalRoutes, { prefix: '/api/portal' })
  await app.register(backupRoutes, { prefix: '/api/backups' })
  await app.register(onboardingRoutes, { prefix: '/api/onboarding' })
  await app.register(pushRoutes, { prefix: '/api/push' })

  return app
}

const app = await buildServer()
await ensureAutomationSchema() // add automation columns before serving any request
app
  .listen({ port: env.PORT, host: '0.0.0.0' })
  .then((addr) => {
    app.log.info(`RadNas backend listening on ${addr}`)
    startTrafficSampler().catch((e) => app.log.error(e, 'traffic sampler failed to start'))
    // Without VAPID keys push stays inert rather than throwing on every notification.
    if (!initPush()) app.log.warn('push disabled — VAPID keys not set')
    startScheduler().catch((e) => app.log.error(e, 'scheduler failed to start'))
    startRouterPoller().catch((e) => app.log.error(e, 'router poller failed to start'))
  })
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
