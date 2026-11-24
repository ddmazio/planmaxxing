import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Icon } from './Icon'

let reloading = false
const reload = () => { if (reloading) return; reloading = true; window.location.reload() }

/** Ativa a versão que estiver esperando e recarrega quando ela assumir. */
async function activateWaiting() {
  const reg = await navigator.serviceWorker?.getRegistration()
  if (!reg) return false
  let waiting = reg.waiting
  if (!waiting) { await reg.update().catch(() => {}); waiting = reg.waiting }
  if (!waiting) return false
  navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true })
  waiting.postMessage({ type: 'SKIP_WAITING' })
  // se a versão nova já assumiu sem avisar, recarrega
  waiting.addEventListener('statechange', () => { if (waiting!.state === 'activated') reload() })
  return true
}

/** Avisa quando existe uma versão nova do app e atualiza com um toque, sem precisar fechar e abrir. */
export function UpdatePrompt() {
  const { needRefresh: [need, setNeed], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (!reg) return
      // o app instalado fica aberto por dias: procura versão nova ao voltar para ele e de meia em meia hora
      const check = () => { if (navigator.onLine && document.visibilityState === 'visible') reg.update().catch(() => {}) }
      document.addEventListener('visibilitychange', check)
      window.addEventListener('focus', check)
      setInterval(check, 30 * 60_000)
    },
  })
  const [busy, setBusy] = useState(false)
  const [slow, setSlow] = useState(false)
  // às vezes o navegador demora a trocar a versão (outra janela do app aberta, por exemplo): avisa em vez de parecer travado
  useEffect(() => { if (!busy) return; const t = setTimeout(() => setSlow(true), 10_000); return () => clearTimeout(t) }, [busy])
  if (!need) return null
  const go = async () => {
    setBusy(true)
    // dá tempo de quem está escrevendo (ex.: o ritual) guardar antes de recarregar
    window.dispatchEvent(new Event('tf-flush'))
    await new Promise((r) => setTimeout(r, 500))
    updateServiceWorker(true).catch(() => {})
    activateWaiting().catch(() => {})
  }
  return (
    <div className="update-bar" role="status" aria-live="polite">
      <Icon name="sparkle" size={16} />
      <span className="grow">{slow ? 'Quase lá. Se não recarregar, feche as janelas do app e abra de novo.' : busy ? 'Atualizando…' : 'Tem uma versão nova do app.'}</span>
      {!busy && <button className="update-later" onClick={() => setNeed(false)}>Depois</button>}
      {slow ? <button className="btn small update-go" onClick={() => window.location.reload()}>Recarregar</button>
        : <button className="btn small update-go" onClick={go} disabled={busy}>{busy ? <span className="spin" aria-hidden /> : 'Atualizar'}</button>}
    </div>
  )
}

/** Atualiza agora (usado pelo pedido de atualização do painel). */
export async function updateNow() {
  window.dispatchEvent(new Event('tf-flush'))
  await new Promise((r) => setTimeout(r, 500))
  const ok = await activateWaiting().catch(() => false)
  if (!ok) window.location.reload()
}
