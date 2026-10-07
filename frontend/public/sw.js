/* Gymme service worker — runtime caching (works with Vite's hashed asset names).
   Media (img/gif) cache-first; everything else network-first with offline fallback. */
const CACHE = 'gymme-rt-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()))
})
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {}
  e.waitUntil(self.registration.showNotification(data.title || 'Gymme', {
    body: data.body || '',
    icon: 'icon-512.png',
    badge: 'icon-180.png',
    tag: data.tag || 'gymme',
    data: { url: data.url || '' },   // hash route to open on tap, e.g. '#/crew'
    renotify: true
  }))
})
self.addEventListener('notificationclick', e => {
  e.notification.close()
  const target = new URL('./' + (e.notification.data?.url || ''), self.registration.scope).href
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(async clients => {
    const c = clients.find(c => 'focus' in c)
    if (!c) return self.clients.openWindow(target)
    // Open the screen the notification is about, then bring the window forward.
    try { await c.navigate(target) } catch { /* some browsers cannot navigate a client; focusing is still right */ }
    return c.focus()
  }))
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/')) return    // never cache auth/data

  const isMedia = url.pathname.includes('/img/') || url.pathname.includes('/gif/')
  if (isMedia) {
    e.respondWith(caches.open(CACHE).then(c => c.match(e.request).then(hit =>
      hit || fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res })
    )))
  } else {
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()))
      return res
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match('index.html'))))
  }
})
