// js/writes.js
// Écriture d'un compteur : directe si en ligne, sinon (ou en cas d'échec)
// mise en file d'attente IndexedDB pour la synchronisation différée.
import { db } from './firebase.js';
import { compteurPath } from './state.js';
import { addPendingWrite } from './offlineDb.js';
import { showToast } from './ui.js';
import { isPermissionDenied } from './agentAuth.js';

/** @returns {Promise<'saved'|'queued'|'queued-error'|'denied'>} */
export async function saveCompteurUpdate(key, updateData) {
    const path = compteurPath(key);
    if (!navigator.onLine) {
        await addPendingWrite({ path, data: updateData });
        return 'queued';
    }
    try {
        await db.ref(path).update(updateData);
        return 'saved';
    } catch (err) {
        console.error('Erreur écriture compteur:', err);
        // Rien n'est perdu : l'écriture sera rejouée après reconnexion.
        await addPendingWrite({ path, data: updateData });
        if (isPermissionDenied(err)) {
            window.dispatchEvent(new CustomEvent('agent-access-denied'));
            return 'denied';
        }
        return 'queued-error';
    }
}

export function toastSaveResult(result, savedMessage, duration = 2000) {
    const messages = {
        saved: savedMessage,
        queued: '📴 Sauvegardé localement',
        'queued-error': '📴 Sauvegardé localement (erreur réseau)',
        denied: '⛔ Accès refusé par le serveur — gardé en attente d\'envoi',
    };
    showToast(messages[result] || savedMessage, result === 'saved' ? duration : 3000);
}
