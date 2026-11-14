import { describe, expect, it } from 'vitest'
import { createECDH, randomBytes } from 'node:crypto'
// @ts-expect-error sem tipos
import ece from 'http_ece'
import { b64u, encrypt, newVapid } from './webpush'

describe('web push', () => {
  it('cifra de um jeito que o navegador consegue abrir (aes128gcm)', async () => {
    const ua = createECDH('prime256v1'); ua.generateKeys()
    const auth = randomBytes(16)
    const body = await encrypt('{"title":"Vamos planejar a semana 6?"}', b64u(ua.getPublicKey()), b64u(auth))
    const out = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ua, authSecret: auth })
    expect(out.toString()).toBe('{"title":"Vamos planejar a semana 6?"}')
  })
  it('gera chaves VAPID válidas', async () => {
    const v = await newVapid('mailto:x@y.z')
    expect(v.publicKey.length).toBe(87)
    expect(v.privateJwk.d).toBeTruthy()
  })
})
