/**
 * Web Push sem dependências (RFC 8291 aes128gcm + VAPID RFC 8292), só com WebCrypto.
 * Roda no Deno das Edge Functions e no Node dos testes.
 */
const enc = new TextEncoder()
type U8 = Uint8Array<ArrayBuffer>
const enc8 = (t: string) => new Uint8Array(enc.encode(t)) as U8

export const b64u = (b: ArrayBuffer | Uint8Array) => {
  const a = b instanceof Uint8Array ? b : new Uint8Array(b)
  let s = ''
  for (const x of a) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export const fromB64u = (s: string): U8 => {
  const p = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0))
}
const concat = (...xs: Uint8Array[]): U8 => { const o = new Uint8Array(xs.reduce((a, x) => a + x.length, 0)); let i = 0; for (const x of xs) { o.set(x, i); i += x.length } return o }

export interface Vapid { publicKey: string; privateJwk: JsonWebKey; subject: string }

/** Novo par de chaves VAPID (P-256). A privada fica só no servidor (Vault). */
export async function newVapid(subject: string): Promise<Vapid> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair
  return { publicKey: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), privateJwk: await crypto.subtle.exportKey('jwk', kp.privateKey), subject }
}

async function vapidAuth(endpoint: string, v: Vapid, now = Date.now()) {
  const aud = new URL(endpoint).origin
  const head = b64u(enc8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const body = b64u(enc8(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: v.subject })))
  const key = await crypto.subtle.importKey('jwk', v.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc8(`${head}.${body}`))
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${v.publicKey}`
}

async function hkdf(ikm: U8, salt: U8, info: U8, len: number): Promise<U8> {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8))
}

/** Cifra a mensagem para uma inscrição (p256dh + auth do navegador). */
export async function encrypt(payload: string, p256dh: string, auth: string, salt: U8 = crypto.getRandomValues(new Uint8Array(16))) {
  const ua = fromB64u(p256dh)
  const secret = fromB64u(auth)
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256))
  const ikm = await hkdf(shared, secret, concat(enc8('WebPush: info\0'), ua, asPub), 32)
  const cek = await hkdf(ikm, salt, enc8('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(ikm, salt, enc8('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc8(payload), new Uint8Array([2]))))
  const rs = new Uint8Array([0, 0, 16, 0]) // 4096
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct)
}

export interface Sub { endpoint: string; p256dh: string; auth: string }

/** Manda um aviso. Devolve o status HTTP (404/410 = inscrição morta, pode apagar). */
export async function sendPush(sub: Sub, message: { title: string; body?: string; url?: string; tag?: string }, v: Vapid, ttl = 3600) {
  const body = await encrypt(JSON.stringify(message), sub.p256dh, sub.auth)
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidAuth(sub.endpoint, v), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: 'normal' },
    body,
  })
  await r.body?.cancel().catch(() => {})
  return r.status
}
