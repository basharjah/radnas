/* RadNas service worker — push notifications only.
 *
 * Deliberately does NOT cache anything. An offline cache on a live operations panel is a liability:
 * a stale subscriber list or a stale "who is online" view looks authoritative and is wrong. The
 * worker exists so the browser has somewhere to deliver a push while no tab is open.
 *
 * Served from the site root so its scope covers the whole app.
 */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  // A push with no body, or a malformed one, must still show something — a silent push looks like a
  // broken feature, and some browsers penalise a push handler that displays no notification at all.
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (_) { data = {} }

  const title = data.title || 'RadNas'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/favicon.png',
      badge: '/favicon.png',
      tag: data.tag || 'radnas',
      dir: 'rtl',
      lang: 'ar',
      data: { url: data.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // Reuse an open panel tab instead of piling up new ones, and take it to the relevant page.
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus()
        if ('navigate' in c) { try { await c.navigate(target) } catch (_) { /* focus is enough */ } }
        return
      }
    }
    await self.clients.openWindow(target)
  })())
})
