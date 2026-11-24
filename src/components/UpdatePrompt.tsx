import { useEffect, useState } from 'react'
import { Icon } from './Icon'

/**
 * Versão nova do app. O service worker novo assume sozinho em segundo plano (skipWaiting + clientsClaim);
 * esta página continua com o código antigo até recarregar, então mostramos "Atualizar", que guarda o que
 * estiver pendente e recarrega. Registramos o service worker aqui mesmo (sem biblioteca), para nada
 * recarregar a página sem a pessoa pedir.
 */
async function reloadToNew() {
  window.dispatchEvent(new Event('tf-flush'))
  await new Promise((r) => setTimeout(r, 500))
  try {
    // se ainda houver uma versão esperando (de versões antigas do app), pede para ela assumir antes
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg?.waiting) {
      const changed = new Promise<void>((res) => navigator.serviceWorker.addEventListener('controllerchange', () => res(), { once: true }))
      reg.waiting.postMessage({ type: 'SKIP_WAITING' })
      await Promise.race([changed, new Promise((r) => setTimeout(r, 3000))])
    }
  } catch { /* recarrega mesmo assim */ }
  window.location.reload()
}

export function UpdatePrompt() {
  const [need, setNeed] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const sw = navigator.serviceWorker
    if (!sw || import.meta.env.DEV) return
    const hadController = !!sw.controller
    // a versão nova assumiu com esta página aberta (na primeira visita não há o que trocar)
    const onChange = () => { if (hadController) setNeed(true) }
    sw.addEventListener('controllerchange', onChange)
    let timer: number | undefined
    let check = () => {}
    sw.register('/sw.js', { scope: '/' }).then((reg) => {
      if (reg.waiting && hadController) setNeed(true) // sobra de versões antigas, esperando
      // o app instalado fica aberto por dias: procura versão nova ao voltar para ele e de meia em meia hora
      check = () => { if (navigator.onLine && document.visibilityState === 'visible') reg.update().catch(() => {}) }
      timer = window.setInterval(check, 30 * 60_000)
    }).catch(() => {})
    const onVisible = () => check()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      sw.removeEventListener('controllerchange', onChange)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      if (timer) clearInterval(timer)
    }
  }, [])
  if (!need || hidden) return null
  return (
    <div className="update-bar" role="status" aria-live="polite">
      <Icon name="sparkle" size={16} />
      <span className="grow">{busy ? 'Atualizando…' : 'Tem uma versão nova do app.'}</span>
      {!busy && <button className="update-later" onClick={() => setHidden(true)}>Depois</button>}
      <button className="btn small update-go" disabled={busy} onClick={() => { setBusy(true); reloadToNew() }}>{busy ? <span className="spin" aria-hidden /> : 'Atualizar'}</button>
    </div>
  )
}

/** Atualiza agora (usado pelo pedido de atualização do painel). */
export async function updateNow() {
  try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update() } catch { /* */ }
  await reloadToNew()
}
