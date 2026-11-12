/** "state" assinado do OAuth: diz de quem é a ligação e expira em 10 minutos. */
const enc = new TextEncoder()
const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64u = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'))

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode('dreamboard-oauth-state:' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)))
}

export async function signState(secret: string, owner: string, provider: string, now = Date.now()) {
  const payload = b64u(enc.encode(JSON.stringify({ u: owner, p: provider, e: now + 10 * 60 * 1000, n: crypto.randomUUID() })))
  return `${payload}.${await hmac(secret, payload)}`
}

export async function verifyState(secret: string, state: string, now = Date.now()): Promise<{ u: string; p: string } | null> {
  const [payload, sig] = state.split('.')
  if (!payload || !sig) return null
  const expected = await hmac(secret, payload)
  if (expected.length !== sig.length) return null
  let diff = 0
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
  if (diff !== 0) return null
  try {
    const v = JSON.parse(fromB64u(payload)) as { u: string; p: string; e: number }
    return v.e > now && /^[0-9a-f-]{36}$/.test(v.u) && (v.p === 'google' || v.p === 'microsoft') ? { u: v.u, p: v.p } : null
  } catch { return null }
}
