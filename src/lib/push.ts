import { DEMO, callFunction, insert, removeWhere, rpc } from './db'
import type { PushSub } from './types'

/** Este navegador sabe receber avisos? (no iPhone, só com o app instalado na Tela de Início) */
export function pushSupport(): 'ok' | 'ios-install' | 'no' {
  if (DEMO) return 'no'
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
  if (ios && !standalone) return 'ios-install'
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window ? 'ok' : 'no'
}

const key = (s: string) => { const p = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4); return Uint8Array.from(atob(p), (c) => c.charCodeAt(0)) }
const b64u = (b: ArrayBuffer | null) => (b ? btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '')

export async function currentSub() {
  if (pushSupport() !== 'ok') return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

function deviceName() {
  const u = navigator.userAgent
  const os = /iphone/i.test(u) ? 'iPhone' : /ipad/i.test(u) ? 'iPad' : /android/i.test(u) ? 'Android' : /mac/i.test(u) ? 'Mac' : /windows/i.test(u) ? 'Windows' : 'Computador'
  const br = /edg\//i.test(u) ? 'Edge' : /chrome|crios/i.test(u) ? 'Chrome' : /firefox|fxios/i.test(u) ? 'Firefox' : /safari/i.test(u) ? 'Safari' : ''
  return [os, br].filter(Boolean).join(' · ')
}

/** Pede permissão, inscreve este aparelho e guarda a inscrição (só a sua conta lê). */
export async function enablePush() {
  if (pushSupport() !== 'ok') throw new Error('Este navegador não recebe avisos.')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Os avisos estão bloqueados nas permissões do navegador.')
  let pub = await rpc<string | null>('push_public_key')
  if (!pub) pub = (await callFunction<{ publicKey: string }>('notify', { action: 'init' })).publicKey
  const reg = await navigator.serviceWorker.ready
  const old = await reg.pushManager.getSubscription()
  const sub = old ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(pub) })
  try {
    await insert<PushSub>('push_subscriptions', { endpoint: sub.endpoint, p256dh: b64u(sub.getKey('p256dh')), auth: b64u(sub.getKey('auth')), device: deviceName() })
  } catch (e) { if (!/duplicate|unique|23505/i.test(String((e as Error)?.message ?? e))) throw e }
  return sub
}

export async function disablePush() {
  const sub = await currentSub()
  if (sub) { await removeWhere('push_subscriptions', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe() }
}

export const testPush = () => callFunction<{ sent: number; devices: number }>('notify', { action: 'test' })
