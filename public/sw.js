const STATIC_CACHE = 'book-studio-static-v1'
const STATIC_ASSET_PATHS = new Set(['/manifest.webmanifest'])

function isStaticAsset(request) {
  if (request.method !== 'GET' || request.mode === 'navigate') {
    return false
  }

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) {
    return false
  }

  if (STATIC_ASSET_PATHS.has(url.pathname)) {
    return true
  }

  return (
    ['style', 'script', 'image', 'font'].includes(request.destination) &&
    /\.(?:css|js|mjs|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf)$/i.test(
      url.pathname,
    )
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll([...STATIC_ASSET_PATHS])),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => cacheName !== STATIC_CACHE)
            .map((cacheName) => caches.delete(cacheName)),
        ),
      ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (!isStaticAsset(event.request)) {
    return
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse
      }

      return fetch(event.request).then((response) => {
        if (!response.ok || response.type !== 'basic') {
          return response
        }

        const responseForCache = response.clone()
        void caches
          .open(STATIC_CACHE)
          .then((cache) => cache.put(event.request, responseForCache))
        return response
      })
    }),
  )
})
