// ✅ sw.js — placé à la RACINE du projet (même niveau qu'index.html)
// Les chemins doivent refléter la vraie structure : JS/ pour les scripts, icons/ pour les images

const CACHE_NAME = 'asufor-v12.2';

const urlsToCache = [
  'index.html',
  'style.css',
  'offline.html',
  'manifest.json',
  // ✅ Chemin correct : sous-dossier JS/
  'JS/main.js',
  'JS/config.js',
  'JS/state.js',
  'JS/ui.js',
  'JS/auth.js',
  'JS/clients.js',
  'JS/actions.js',
  'JS/media.js',
  'JS/sync.js',
  'JS/offlineDb.js',
  'JS/reports.js',
  'JS/pwa.js',
  // ✅ Chemin correct : sous-dossier icons/
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      console.log('📦 Mise en cache des fichiers en cours...');
      for (let url of urlsToCache) {
        try {
          await cache.add(url);
        } catch (error) {
          console.warn(`⚠️ Fichier ignoré pour le cache hors-ligne : ${url}`);
        }
      }
      console.log('✅ Mise en cache terminée.');
    })
  );
  self.skipWaiting();
});

self.addEventListener('fetch', event => {
  // Ne pas intercepter les requêtes Firebase ou Cloudinary
  if (
    event.request.url.includes('firebaseio.com') ||
    event.request.url.includes('googleapis.com') ||
    event.request.url.includes('cloudinary.com')
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(response => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        }
        return networkResponse;
      }).catch(() => {
        console.log('Mode hors-ligne actif pour cette ressource.');
      });
      return response || fetchPromise;
    })
  );
});

self.addEventListener('activate', event => {
  console.log('🔄 Activation du nouveau Service Worker...');
  const cacheWhitelist = [CACHE_NAME];

  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (!cacheWhitelist.includes(cacheName)) {
            console.log('🗑️ Suppression de l\'ancien cache :', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});
