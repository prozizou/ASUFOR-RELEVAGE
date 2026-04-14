// sw.js - ASUFOR Diandioly (Stratégie 100% Réseau / Network Only)

self.addEventListener('install', (event) => {
    // Force la prise de contrôle immédiate
    self.skipWaiting(); 
});

self.addEventListener('activate', (event) => {
    // NETTOYAGE RADICAL : Dès que ce nouveau SW s'active, 
    // il supprime absolument TOUS les anciens caches du téléphone.
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((name) => {
                    console.log("[SW] Destruction de l'ancien cache :", name);
                    return caches.delete(name);
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    // STRATÉGIE "NETWORK ONLY"
    // On ne cherche jamais dans le cache, on demande directement au serveur (Vercel).
    event.respondWith(fetch(event.request));
});