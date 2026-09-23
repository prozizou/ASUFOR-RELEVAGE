import { db } from './main.js';
import { getPendingWrites, clearPendingWrite, updatePendingWriteAttempt, setSyncMetadata, getSyncMetadata } from './offlineDb.js';
import { showToast, updateOnlineStatus } from './ui.js';
import { icon } from './icons.js';
import { state } from './state.js';

export async function syncPendingWrites() {
    if (!navigator.onLine) {
        console.log('📴 Hors ligne, synchronisation impossible');
        return;
    }
    
    const pending = await getPendingWrites();
    if (pending.length === 0) {
        updateSyncIndicator(0);
        return;
    }
    
    console.log(`🔄 Synchronisation de ${pending.length} opérations en attente...`);
    updateSyncIndicator(pending.length);
    
    const MAX_ATTEMPTS = 3;
    const successfulIds = [];
    
    for (const op of pending) {
        try {
            if (op.attempts >= MAX_ATTEMPTS) {
                console.warn(`⚠️ Opération ${op.id} abandonnée après ${MAX_ATTEMPTS} tentatives`);
                successfulIds.push(op.id);
                continue;
            }
            
            const snapshot = await db.ref(op.path).once('value');
            const currentData = snapshot.val() || {};
            const remoteTimestamp = currentData.last_modified || 0;
            const localTimestamp = op.data.last_modified || Date.now();
            
            if (remoteTimestamp > localTimestamp) {
                console.log(`📝 Opération ${op.id} obsolète, abandon`);
                successfulIds.push(op.id);
                continue;
            }
            
            await db.ref(op.path).update(op.data);
            console.log(`✅ Opération ${op.id} synchronisée avec succès`);
            successfulIds.push(op.id);
            
        } catch (err) {
            console.error(`❌ Erreur synchro op ${op.id}:`, err);
            await updatePendingWriteAttempt(op.id, (op.attempts || 0) + 1);
            if (err.code === 'NETWORK_ERROR' || err.message?.includes('network')) {
                console.log('📡 Erreur réseau, pause de la synchronisation');
                break;
            }
        }
    }
    
    for (const id of successfulIds) {
        await clearPendingWrite(id);
    }
    
    const remaining = await getPendingWrites();
    updateSyncIndicator(remaining.length);
    await setSyncMetadata('lastSync', Date.now());
    
    if (remaining.length === 0) {
        showToast('✅ Toutes les données ont été envoyées !', 2000);
    }
}

export function updateSyncIndicator(count) {
    const indicator = document.getElementById('sync-indicator');
    if (!indicator) return;

    indicator.classList.remove('hidden');
    if (count > 0) {
        indicator.className = 'sync-pending is-pending';
        indicator.innerHTML = `${icon('clock', { size: 11 })}<span class="sync-label">À synchroniser (${count})</span>`;
        indicator.title = `${count} élément(s) en attente d'envoi`;
        hideSyncDetail();
    } else {
        indicator.className = 'sync-pending is-ok';
        indicator.innerHTML = `${icon('check', { size: 11 })}<span class="sync-label">Synchronisé</span>`;
        indicator.title = 'Toutes les données sont synchronisées';
        updateSyncDetail();
    }
}

function hideSyncDetail() {
    document.getElementById('sync-detail')?.classList.add('hidden');
}

// Info discrète affichée sous la pastille « Synchronisé » (heure de la
// dernière synchronisation réussie). Volontairement fire-and-forget : ne
// bloque jamais l'affichage de l'état principal de synchronisation.
async function updateSyncDetail() {
    const detail = document.getElementById('sync-detail');
    if (!detail) return;
    try {
        const lastSync = await getSyncMetadata('lastSync');
        if (lastSync) {
            const time = new Date(lastSync).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            detail.textContent = `Dernière synchro : ${time}`;
            detail.classList.remove('hidden');
        } else {
            hideSyncDetail();
        }
    } catch {
        hideSyncDetail();
    }
}

// Reflète l'état réel de la file d'attente hors ligne (utile même sans réseau,
// où syncPendingWrites() ne s'exécute pas et ne mettrait donc pas l'indicateur à jour).
export async function refreshSyncIndicator() {
    try {
        const pending = await getPendingWrites();
        updateSyncIndicator(pending.length);
    } catch (e) {
        console.warn('Impossible de lire la file hors ligne:', e);
    }
}

export function handleOnline() {
    console.log('🌐 Connexion rétablie');
    updateOnlineStatus();
    showToast('📡 Connexion internet retrouvée - Envoi des données en cours...', 3000);
    
    if (state.networkStatusDebounce) clearTimeout(state.networkStatusDebounce);
    state.networkStatusDebounce = setTimeout(() => {
        syncPendingWrites();
        state.networkStatusDebounce = null;
    }, 500);
}

// Toute écriture ajoutée/retirée de la file hors ligne (même sans réseau,
// donc en dehors de syncPendingWrites()) doit se refléter sur l'indicateur.
window.addEventListener('offline-queue-changed', refreshSyncIndicator);

export function handleOffline() {
    console.log('📴 Mode hors ligne activé');
    updateOnlineStatus();
    showToast('📴 Pas de connexion internet - Vos données seront envoyées automatiquement au retour du réseau', 4000);
}
