// sw.js - Service Worker pour ASUFOR Diandioly v8.1
const CACHE_NAME = 'asufor-cache-v1';
const urlsToCache = [
  './',
  './index.html',        // nom de votre fichier HTML principal
  './manifest.json',
  // Ajoutez ici d'autres ressources statiques (icônes, polices, etc.)
  // Note : les imports Firebase sont chargés dynamiquement depuis le CDN,
  // ils ne sont pas mis en cache volontairement pour éviter les problèmes de version.
  // Les requêtes vers Firebase Realtime Database ne sont pas interceptées.
];

// Installation : mise en cache des ressources statiques
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

// Activation : nettoyer les anciens caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(name => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Stratégie de fetch : 
// - Pour les ressources statiques (HTML, CSS, JS, manifest) : cache d'abord, puis réseau.
// - Pour les appels API (Firebase, etc.) : réseau d'abord, pas de cache.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Ignorer les requêtes vers Firebase (base de données et authentification)
  if (url.hostname.includes('firebaseio.com') || 
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('firebaseapp.com')) {
    // Réseau uniquement (pas de cache)
    event.respondWith(fetch(event.request));
    return;
  }

  // Pour les autres requêtes (statiques) : cache first
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request).then(
          networkResponse => {
            // Optionnel : mettre en cache les nouvelles ressources
            if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME)
                .then(cache => cache.put(event.request, responseToCache));
            }
            return networkResponse;
          }
        );
      })
  );
});