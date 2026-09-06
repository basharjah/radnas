import { api } from './api'

/**
 * Browser push, client side.
 *
 * Standard Web Push (VAPID) — no Firebase. Every step can legitimately fail on a given device, so
 * each returns a reason the panel can show instead of a dead toggle: an unsupported browser, a
 * denied permission and a server without keys are three different problems with three different
 * fixes, and "لم يعمل" tells the operator none of them.
 */

export type PushState =
  | { supported: false; reason: 'unsupported' | 'insecure' | 'ios_needs_install' }
  | { supported: true; permission: NotificationPermission; subscribed: boolean }

/** iOS delivers web push only to a PWA the user added to the Home Screen (16.4+). */
function isIosBrowserNotInstalled(): boolean {
  const ua = navigator.userAgent
  const isIos = /iPad|iPhone|iPod/.test(ua)
    // iPadOS 13+ reports itself as a Mac; touch points give it away.
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (!isIos) return false
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true
  return !standalone
}

export async function pushState(): Promise<PushState> {
  // Service workers need a secure context; localhost counts as one.
  if (!window.isSecureContext) return { supported: false, reason: 'insecure' }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { supported: false, reason: isIosBrowserNotInstalled() ? 'ios_needs_install' : 'unsupported' }
  }
  if (isIosBrowserNotInstalled()) return { supported: false, reason: 'ios_needs_install' }

  const reg = await navigator.serviceWorker.getRegistration('/sw.js')
  const sub = reg ? await reg.pushManager.getSubscription() : null
  return { supported: true, permission: Notification.permission, subscribed: !!sub }
}

/**
 * The VAPID key travels as base64url; PushManager wants raw bytes.
 * Backed by an explicit ArrayBuffer — `Uint8Array.from` is typed over ArrayBufferLike, which
 * PushManager's BufferSource will not accept.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const view = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i)
  return view
}

/** Returns null on success, or an Arabic reason to show the operator. */
export async function enablePush(): Promise<string | null> {
  const st = await pushState()
  if (!st.supported) {
    if (st.reason === 'ios_needs_install') {
      return 'على iPhone وiPad: افتح قائمة المشاركة ثم «إضافة إلى الشاشة الرئيسية»، وشغّل الإشعارات من التطبيق المُضاف. سفاري لا يوصّلها من المتصفّح.'
    }
    if (st.reason === 'insecure') return 'الإشعارات تحتاج اتصالاً آمناً (HTTPS).'
    return 'هذا المتصفّح لا يدعم إشعارات الويب.'
  }

  const { data } = await api.get('/push/public-key')
  if (!data.enabled || !data.key) return 'الإشعارات غير مفعّلة على الخادم بعد.'

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return permission === 'denied'
      ? 'الإشعارات محظورة لهذا الموقع في متصفّحك. اسمح بها من إعدادات الموقع ثم أعد المحاولة.'
      : 'لم تُمنح الإذن.'
  }

  const reg = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  // An existing subscription may carry an older server key; reuse it only if it still matches.
  const existing = await reg.pushManager.getSubscription()
  const sub = existing ?? await reg.pushManager.subscribe({
    userVisibleOnly: true,                       // required by Chrome: no silent background pushes
    applicationServerKey: urlBase64ToUint8Array(data.key),
  })

  await api.post('/push/subscribe', sub.toJSON())
  return null
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration('/sw.js')
  const sub = reg ? await reg.pushManager.getSubscription() : null
  // Tell the server first: if unsubscribing locally succeeded but the row survived, we would keep
  // pushing to a dead endpoint until the push service finally reported it gone.
  await api.post('/push/unsubscribe', { endpoint: sub?.endpoint }).catch(() => {})
  if (sub) await sub.unsubscribe().catch(() => {})
}
