import { useRegisterSW } from 'virtual:pwa-register/react'
import { Icon } from './Icon'

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
  if (!need) return null
  const go = () => {
    // dá tempo de quem está escrevendo (ex.: o ritual) guardar antes de recarregar
    window.dispatchEvent(new Event('tf-flush'))
    setTimeout(() => { updateServiceWorker(true) }, 600)
  }
  return (
    <div className="update-bar" role="status">
      <Icon name="sparkle" size={16} />
      <span className="grow">Tem uma versão nova do app.</span>
      <button className="update-later" onClick={() => setNeed(false)}>Depois</button>
      <button className="btn small update-go" onClick={go}>Atualizar</button>
    </div>
  )
}

/** Atualiza agora (usado pelo pedido de atualização do painel): ativa a versão que estiver esperando e recarrega. */
export async function updateNow() {
  window.dispatchEvent(new Event('tf-flush'))
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    await reg?.update()
    const waiting = reg?.waiting
    if (waiting) {
      navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true })
      waiting.postMessage({ type: 'SKIP_WAITING' })
      return
    }
  } catch { /* segue para recarregar */ }
  setTimeout(() => window.location.reload(), 600)
}
