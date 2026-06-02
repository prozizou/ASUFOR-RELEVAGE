import { db } from './main.js';
import { getPendingWrites, clearPendingWrite, updatePendingWriteAttempt, setSyncMetadata } from './offlineDb.js';
import { showToast, updateOnlineStatus } from './ui.js';
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
        showToast('✅ Toutes les données sont synchronisées !', 2000);
    }
}

export function updateSyncIndicator(count) {
    const indicator = document.getElementById('sync-indicator');
    if (indicator) {
        if (count > 0) {
            indicator.textContent = `⏳ ${count}`;
            indicator.classList.remove('hidden');
            indicator.title = `${count} opération(s) en attente`;
        } else {
            indicator.classList.add('hidden');
        }
    }
}

export function handleOnline() {
    console.log('🌐 Connexion rétablie');
    updateOnlineStatus();
    showToast('📡 Connexion rétablie - Synchronisation en cours...', 3000);
    
    if (state.networkStatusDebounce) clearTimeout(state.networkStatusDebounce);
    state.networkStatusDebounce = setTimeout(() => {
        syncPendingWrites();
        state.networkStatusDebounce = null;
    }, 500);
}

export function handleOffline() {
    console.log('📴 Mode hors ligne activé');
    updateOnlineStatus();
    showToast('📴 Mode hors ligne - Les données seront synchronisées automatiquement', 4000);
}
