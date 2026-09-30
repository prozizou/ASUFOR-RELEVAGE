import { db } from './firebase.js';
import { getPendingWrites, clearPendingWrite, updatePendingWriteAttempt, setSyncMetadata, getSyncMetadata } from './offlineDb.js';
import { showToast, updateOnlineStatus } from './ui.js';
import { icon } from './icons.js';
import { state } from './state.js';
import { isPermissionDenied } from './agentAuth.js';
import { getAgentAuthStatus } from './session.js';

// Une écriture en attente n'est rejouée que par l'agent qui l'a faite, sur son
// forage : sur un téléphone partagé, les relevés d'un autre agent restent en
// file jusqu'à sa prochaine connexion (ils seraient refusés par les règles).
export function belongsToAgent(op, agentId, forageKey) {
    return !!op && op.agentId === agentId
        && typeof op.path === 'string'
        && op.path.startsWith(`Asufor/${forageKey}/compteurs/`);
}

async function getCurrentAgentWrites() {
    const all = await getPendingWrites();
    return all.filter(op => belongsToAgent(op, state.currentAgentId, state.currentForageKey));
}

let syncInProgress = false;

export async function syncPendingWrites() {
    if (!navigator.onLine) {
        console.log('📴 Hors ligne, synchronisation impossible');
        return;
    }
    // Déclenchée par le retour réseau, l'intervalle de 60 s et chaque relevé :
    // un seul passage à la fois, sinon une même écriture serait envoyée deux fois.
    if (syncInProgress) return;
    syncInProgress = true;
    try {
        await runSync();
    } finally {
        syncInProgress = false;
    }
}

async function runSync() {
    const pending = await getCurrentAgentWrites();
    if (pending.length === 0) {
        // Rien à envoyer, mais on est en ligne : c'est un point de synchro
        // valide, à horodater pour l'info « Dernière synchro » (sinon elle
        // ne s'afficherait jamais pour un agent qui n'a eu aucune écriture
        // hors ligne à rattraper).
        await setSyncMetadata('lastSync', Date.now());
        updateSyncIndicator(0);
        return;
    }
    
    // Sans jeton agent valide, les règles refuseraient tout : on garde la file
    // intacte et on demande une reconnexion (voir auth.js#requireReauth).
    const authStatus = await getAgentAuthStatus(firebase.auth(), {
        agentId: state.currentAgentId,
        forageKey: state.currentForageKey,
    });
    if (authStatus !== 'ok') {
        console.warn(`🔒 Synchronisation suspendue (authentification : ${authStatus})`);
        updateSyncIndicator(pending.length);
        window.dispatchEvent(new CustomEvent('agent-reauth-required'));
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
            if (err.code === 'NETWORK_ERROR' || err.message?.includes('network')) {
                // Coupure réseau : pas une tentative « ratée » de l'opération, qui
                // ne doit pas être abandonnée pour autant.
                console.log('📡 Erreur réseau, pause de la synchronisation');
                break;
            }
            await updatePendingWriteAttempt(op.id, (op.attempts || 0) + 1);
            if (isPermissionDenied(err)) {
                // Compteur retiré de la tournée de l'agent, par exemple : on passe
                // aux suivantes (abandon après MAX_ATTEMPTS refus).
                console.warn(`⛔ Opération ${op.id} refusée par les règles (permission_denied)`);
            }
        }
    }
    
    for (const id of successfulIds) {
        await clearPendingWrite(id);
    }
    
    const remaining = await getCurrentAgentWrites();
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
        const pending = await getCurrentAgentWrites();
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
