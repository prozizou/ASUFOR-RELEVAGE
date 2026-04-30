const CACHE_NAME = 'asufor-v12';

// Liste des fichiers à mettre en mémoire pour le mode hors-ligne
const urlsToCache = [
  'index.html',
  'style.css',
  'offline.html',
  'js/config.js',
  'js/state.js',
  'js/main.js',
  'js/ui.js',
  'js/auth.js',
  'js/clients.js',
  'js/actions.js',
  'js/media.js',
  'js/sync.js',
  'js/offlineDb.js',
  'js/reports.js',
  'js/pwa.js',
  'manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      console.log('📦 Mise en cache des fichiers en cours...');
      // Au lieu de addAll() qui plante à la moindre erreur, on fait une boucle sécurisée
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
  // On ne met pas en cache les requêtes vers les bases de données
  if (event.request.url.includes('firebaseio.com') || event.request.url.includes('cloudinary.com')) {
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
      }).catch(err => {
         console.log('Mode hors-ligne actif pour cette ressource.');
      });
      return response || fetchPromise;
    })
  );
});

// sw.js (à ajouter à la fin)

// Écouteur d'activation : Supprime les anciens caches quand on change de version
self.addEventListener('activate', event => {
  console.log('🔄 Activation du nouveau Service Worker...');
  
  const cacheWhitelist = [CACHE_NAME]; // On garde uniquement la version actuelle
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('🗑️ Suppression de l\'ancien cache :', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // Force la prise de contrôle immédiate
  );
});
