// js/session.js
// Session agent locale (localStorage) et état de l'authentification Firebase.
import { hasAgentClaims } from './agentAuth.js';

const KEYS = {
    agentId: 'asufor_id',
    forageKey: 'asufor_forage_key',
    name: 'agent_name',
    zone: 'agent_zone',
    siege: 'agent_siege',
    phone: 'agent_phone',
    verifier: 'agent_offline_verifier',
    // Ancien stockage du code EN CLAIR (versions ≤ 13.9) : lu une seule fois
    // pour migrer la session vers un Custom Token, puis supprimé.
    legacyPasscode: 'agent_passcode',
};

export function saveSession({ agentId, forageKey, profile = {}, phone, verifier }, storage = localStorage) {
    storage.setItem(KEYS.agentId, agentId);
    storage.setItem(KEYS.forageKey, forageKey);
    storage.setItem(KEYS.name, profile.agent || 'Agent');
    storage.setItem(KEYS.zone, profile.zone || 'Zone');
    storage.setItem(KEYS.siege, profile.siege || '');
    if (phone) storage.setItem(KEYS.phone, phone);
    if (verifier) storage.setItem(KEYS.verifier, JSON.stringify(verifier));
    storage.removeItem(KEYS.legacyPasscode);
}

export function loadSession(storage = localStorage) {
    const agentId = storage.getItem(KEYS.agentId);
    const forageKey = storage.getItem(KEYS.forageKey);
    if (!agentId || !forageKey) return null;
    let verifier = null;
    try { verifier = JSON.parse(storage.getItem(KEYS.verifier) || 'null'); } catch { verifier = null; }
    return {
        agentId,
        forageKey,
        name: storage.getItem(KEYS.name) || 'Agent',
        zone: storage.getItem(KEYS.zone) || 'Zone',
        siege: storage.getItem(KEYS.siege) || '',
        phone: storage.getItem(KEYS.phone) || '',
        verifier,
        legacyPasscode: storage.getItem(KEYS.legacyPasscode),
    };
}

export function clearLegacyPasscode(storage = localStorage) {
    storage.removeItem(KEYS.legacyPasscode);
}

// Premier état connu de Firebase Auth (session persistée restaurée depuis
// IndexedDB, y compris hors ligne).
export function waitForAuthUser(auth, timeoutMs = 5000) {
    return new Promise((resolve) => {
        let done = false;
        let unsubscribe = null;
        const finish = (user) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            unsubscribe?.();
            resolve(user || null);
        };
        const timer = setTimeout(() => finish(auth.currentUser), timeoutMs);
        unsubscribe = auth.onAuthStateChanged(finish);
        // Rappel synchrone possible : on se désabonne une fois l'abonnement obtenu.
        if (done) unsubscribe();
    });
}

/**
 * État de l'authentification pour l'agent de la session locale :
 *  - 'ok'         : Custom Token agent avec les bons claims
 *  - 'missing'    : aucun utilisateur Firebase (ou ancien compte anonyme)
 *  - 'mismatch'   : utilisateur connecté, mais pas cet agent / ce forage
 *  - 'unverified' : claims illisibles (hors ligne avec jeton expiré)
 */
export async function getAgentAuthStatus(auth, { agentId, forageKey }) {
    const user = auth?.currentUser;
    if (!user || user.isAnonymous) return 'missing';
    try {
        const { claims } = await user.getIdTokenResult();
        return hasAgentClaims(claims, { agentId, forageKey }) ? 'ok' : 'mismatch';
    } catch {
        return 'unverified';
    }
}
