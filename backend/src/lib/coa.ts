import dgram from 'node:dgram'
import { createHash } from 'node:crypto'

// RFC 5176 Dynamic Authorization codes
const DISCONNECT_REQUEST = 40
const CODE_NAMES: Record<number, string> = {
  40: 'Disconnect-Request', 41: 'Disconnect-ACK', 42: 'Disconnect-NAK',
  43: 'CoA-Request', 44: 'CoA-ACK', 45: 'CoA-NAK',
}
const ATTR = { USER_NAME: 1, NAS_IP_ADDRESS: 4, ACCT_SESSION_ID: 44 }

interface Attr { type: number; value: Buffer }

function ipToBuf(ip: string): Buffer | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const b = Buffer.alloc(4)
  for (let i = 0; i < 4; i++) {
    const n = Number(parts[i])
    if (!Number.isInteger(n) || n < 0 || n > 255) return null
    b[i] = n
  }
  return b
}

function encodeAttrs(attrs: Attr[]): Buffer {
  return Buffer.concat(attrs.map((a) => Buffer.concat([Buffer.from([a.type, a.value.length + 2]), a.value])))
}

/** Build a signed Disconnect-Request. Authenticator = MD5(header | 16 zero bytes | attrs | secret). */
function buildDisconnect(secret: string, id: number, attrs: Attr[]): Buffer {
  const attributes = encodeAttrs(attrs)
  const length = 20 + attributes.length
  const header = Buffer.alloc(4)
  header.writeUInt8(DISCONNECT_REQUEST, 0)
  header.writeUInt8(id, 1)
  header.writeUInt16BE(length, 2)
  const auth = createHash('md5')
    .update(Buffer.concat([header, Buffer.alloc(16), attributes, Buffer.from(secret, 'utf8')]))
    .digest()
  return Buffer.concat([header, auth, attributes])
}

export interface DisconnectParams {
  host: string
  port?: number
  secret: string
  username: string
  acctSessionId?: string
  nasIp?: string
  retries?: number
  timeoutMs?: number
}
export interface DisconnectResult {
  ok: boolean
  response?: string
  error?: string
  attempts: number
  target: string
}

export function buildAttrList(p: Pick<DisconnectParams, 'username' | 'acctSessionId' | 'nasIp'>): Attr[] {
  const attrs: Attr[] = [{ type: ATTR.USER_NAME, value: Buffer.from(p.username, 'utf8') }]
  if (p.acctSessionId) attrs.push({ type: ATTR.ACCT_SESSION_ID, value: Buffer.from(p.acctSessionId, 'utf8') })
  if (p.nasIp) {
    const b = ipToBuf(p.nasIp)
    if (b) attrs.push({ type: ATTR.NAS_IP_ADDRESS, value: b })
  }
  return attrs
}

function sendOnce(host: string, port: number, secret: string, attrs: Attr[], timeoutMs: number): Promise<{ ok: boolean; response?: string; error?: string }> {
  return new Promise((resolve) => {
    let packet: Buffer
    try {
      packet = buildDisconnect(secret, Math.floor(Math.random() * 256), attrs)
    } catch {
      resolve({ ok: false, error: 'encode_failed' })
      return
    }
    const sock = dgram.createSocket('udp4')
    let done = false
    const finish = (r: { ok: boolean; response?: string; error?: string }) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { sock.close() } catch { /* ignore */ }
      resolve(r)
    }
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), timeoutMs)
    sock.on('message', (msg) => {
      const code = msg[0]
      finish({ ok: code === 41, response: CODE_NAMES[code] ?? `code-${code}` })
    })
    sock.on('error', (e) => finish({ ok: false, error: e.message }))
    try {
      sock.send(packet, port, host, (e) => { if (e) finish({ ok: false, error: e.message }) })
    } catch (e) {
      finish({ ok: false, error: (e as Error).message })
    }
  })
}

/** Send a Disconnect-Request with retries (backoff = base * attempt). Resolves on ACK/NAK or exhausting retries. */
export async function sendDisconnect(p: DisconnectParams): Promise<DisconnectResult> {
  const port = p.port ?? 3799
  const attrs = buildAttrList(p)
  const retries = p.retries ?? 3
  const base = p.timeoutMs ?? 2000
  const target = `${p.host}:${port}`
  let last: { ok: boolean; response?: string; error?: string } = { ok: false, error: 'no_attempt' }
  for (let attempt = 1; attempt <= retries; attempt++) {
    last = await sendOnce(p.host, port, p.secret, attrs, base * attempt)
    if (last.ok || last.response) return { ...last, attempts: attempt, target }
  }
  return { ...last, attempts: retries, target }
}
