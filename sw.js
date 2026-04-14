// sw.js - Service Worker pour ASUFOR Diandioly v9.0 (cache avec hachage)
const CACHE_NAME_PREFIX = 'asufor-cache-';
let CACHE_NAME = CACHE_NAME_PREFIX + 'v1'; // fallback

// Chargement du manifeste d'assets pour obtenir le hash et la liste des fichiers
async function getCacheConfig() {
    try {
        const response = await fetch('./asset-manifest.json');
        const manifest = await response.json();
        CACHE_NAME = CACHE_NAME_PREFIX + manifest.hash;
        return manifest.files || [];
    } catch (err) {
        console.warn('Impossible de charger asset-manifest.json, utilisation du fallback.');
        // Fallback : liste statique
        return [
            './',
            './index.html',
            './manifest.json',
            './offline.html',
            './style.css',
            './app.js',
            './icons/icon-192.png',
            './icons/icon-512.png'
        ];
    }
}

self.addEventListener('install', event => {
    event.waitUntil(
        getCacheConfig().then(filesToCache => {
            return caches.open(CACHE_NAME).then(cache => {
                console.log('[SW] Mise en cache des ressources avec hash:', CACHE_NAME);
                return cache.addAll(filesToCache);
            });
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(name => {
                    if (name.startsWith(CACHE_NAME_PREFIX) && name !== CACHE_NAME) {
                        console.log('[SW] Suppression de l\'ancien cache:', name);
                        return caches.delete(name);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    if (url.hostname.includes('firebaseio.com') ||
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('firebaseapp.com')) {
        event.respondWith(fetch(event.request));
        return;
    }

    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .catch(() => caches.match('./offline.html'))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            if (cachedResponse) {
                const fetchPromise = fetch(event.request).then(networkResponse => {
                    if (networkResponse && networkResponse.status === 200) {
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, networkResponse.clone());
                        });
                    }
                    return networkResponse;
                }).catch(err => console.warn('[SW] Échec de la mise à jour en arrière-plan:', err));
                return cachedResponse;
            }
            return fetch(event.request).then(networkResponse => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            }).catch(error => {
                if (event.request.destination === 'image') {
                    return caches.match('./icons/placeholder.png');
                }
                throw error;
            });
        })
    );
});

self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});