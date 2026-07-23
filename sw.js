// LOGBOOK service worker — кэширует оболочку приложения для офлайн-работы.
// При изменении файлов приложения увеличивайте CACHE_VERSION, иначе
// у пользователей останется старая версия из кэша.
const CACHE_VERSION = 'logbook-v3';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
// Внешние CDN-скрипты (Supabase, jsQR) намеренно НЕ входят в обязательный
// precache — если один из них недоступен в момент установки SW, вся
// установка проваливалась бы целиком (cache.addAll — всё или ничего).
// Они всё равно закэшируются при первом успешном онлайн-запросе через
// обработчик fetch ниже.

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Стратегия: cache-first для оболочки приложения, network-first для данных Supabase.
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Никогда не кэшируем запросы к Supabase API (данные всегда свежие, если есть сеть)
  if (url.includes('supabase.co')) {
    event.respondWith(
      fetch(event.request).catch(() => new Response(JSON.stringify({ offline: true }), { headers: { 'Content-Type': 'application/json' } }))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((resp) => {
        const respClone = resp.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, respClone));
        return resp;
      }).catch(() => cached);
    })
  );
});
