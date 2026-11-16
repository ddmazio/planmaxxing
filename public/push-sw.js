/* Twelvefold · avisos (Web Push). Carregado pelo service worker do app (vite.config.ts → workbox.importScripts). */
self.addEventListener('push', (event) => {
  let m = {}
  try { m = event.data ? event.data.json() : {} } catch { m = { title: event.data ? event.data.text() : 'Twelvefold' } }
  const title = m.title || 'Twelvefold'
  event.waitUntil(self.registration.showNotification(title, {
    body: m.body || '',
    tag: m.tag || undefined,
    icon: '/icons/tf-icon-192.png',
    data: { url: typeof m.url === 'string' && m.url.startsWith('/') ? m.url : '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin && 'focus' in c) { await c.focus(); if ('navigate' in c) await c.navigate(url); return }
    }
    await self.clients.openWindow(url)
  })())
})
