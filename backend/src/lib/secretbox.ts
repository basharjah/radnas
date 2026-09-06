import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { env } from '../env'

/**
 * Symmetric encryption for router admin credentials at rest.
 *
 * The `nas.api_password` column is plain text and predates this, so the format is
 * self-describing and backward compatible: anything without the `enc:v1:` prefix is
 * returned as-is by decrypt(). New writes are always encrypted.
 *
 * The key is derived from JWT_SECRET — rotating that invalidates stored router passwords
 * (they must be re-entered), which is the same blast radius as rotating it already has.
 */
const PREFIX = 'enc:v1:'
const key = scryptSync(env.JWT_SECRET, 'radnas.nas.api', 32)

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return PREFIX + [iv, c.getAuthTag(), body].map((b) => b.toString('base64')).join('.')
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null
  if (!stored.startsWith(PREFIX)) return stored // legacy plain-text value
  try {
    const [iv, tag, body] = stored.slice(PREFIX.length).split('.').map((p) => Buffer.from(p, 'base64'))
    if (!iv || !tag || !body) return null
    const d = createDecipheriv('aes-256-gcm', key, iv)
    d.setAuthTag(tag)
    return Buffer.concat([d.update(body), d.final()]).toString('utf8')
  } catch {
    return null // wrong key or tampered value — treat as "no credential", never throw into a request
  }
}
