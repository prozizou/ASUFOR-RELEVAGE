// js/agentAuth.js
// Connexion agent : appel de la fonction Vercel /api/agent-login (téléphone +
// code → Custom Token), traduction des erreurs en messages clairs, et
// vérificateur local (PBKDF2) pour la reconnexion hors ligne.
// Aucune dépendance au DOM ni au SDK Firebase : testable sous Node.

export const LOGIN_REASONS = {
    INVALID_PHONE: 'INVALID_PHONE',
    INVALID_FORMAT: 'INVALID_FORMAT',
    AGENT_NOT_FOUND: 'AGENT_NOT_FOUND',
    INVALID_CODE: 'INVALID_CODE',
    NO_PASSCODE: 'NO_PASSCODE',
    AMBIGUOUS_FORAGE: 'AMBIGUOUS_FORAGE',
    TOO_MANY_ATTEMPTS: 'TOO_MANY_ATTEMPTS',
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    SESSION_EXPIRED: 'SESSION_EXPIRED',
    OFFLINE: 'OFFLINE',
    OFFLINE_NO_SESSION: 'OFFLINE_NO_SESSION',
    SERVER_ERROR: 'SERVER_ERROR',
};

const R = LOGIN_REASONS;

const MESSAGES = {
    [R.INVALID_PHONE]: '⚠️ Numéro de téléphone invalide',
    [R.INVALID_FORMAT]: '⚠️ Le code doit contenir 6 chiffres',
    [R.AGENT_NOT_FOUND]: '❌ Agent introuvable : aucun agent enregistré avec ce numéro',
    [R.INVALID_CODE]: '❌ Code agent invalide',
    [R.NO_PASSCODE]: "⚠️ Aucun code n'est configuré pour cet agent. Contactez votre superviseur.",
    [R.AMBIGUOUS_FORAGE]: 'Ce numéro est enregistré sur plusieurs forages : choisissez le vôtre.',
    [R.TOO_MANY_ATTEMPTS]: '⛔ Trop de tentatives. Réessayez dans 15 minutes.',
    [R.PERMISSION_DENIED]: "⛔ Accès refusé (permission_denied). Contactez votre superviseur.",
    [R.SESSION_EXPIRED]: '🔒 Session expirée : saisissez votre code pour continuer.',
    [R.OFFLINE]: '📡 Hors ligne : impossible de joindre le serveur.',
    [R.OFFLINE_NO_SESSION]: '📴 Hors ligne : la première connexion sur cet appareil doit se faire avec internet.',
    [R.SERVER_ERROR]: '⚠️ Erreur serveur, réessayez dans quelques instants.',
};

export function loginErrorMessage(reason) {
    return MESSAGES[reason] || MESSAGES[R.SERVER_ERROR];
}

export class AgentAuthError extends Error {
    constructor(reason, message, details = {}) {
        super(message || loginErrorMessage(reason));
        this.name = 'AgentAuthError';
        this.reason = reason;
        this.details = details || {};
    }
}

// Même normalisation que la fonction serveur (api/_lib/agentLogin.js).
export function normalizePhone(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (digits.length === 14 && digits.startsWith('00221')) return digits.slice(5);
    if (digits.length === 12 && digits.startsWith('221')) return digits.slice(3);
    return digits;
}

export function validateLoginInput(rawPhone, rawCode) {
    const phone = normalizePhone(rawPhone);
    const code = String(rawCode ?? '').trim();
    if (!/^[0-9]{9,15}$/.test(phone)) return { phone, code, error: R.INVALID_PHONE };
    if (!/^[0-9]{6}$/.test(code)) return { phone, code, error: R.INVALID_FORMAT };
    return { phone, code, error: null };
}

// Statuts du protocole « callable » Firebase → raison par défaut (quand la
// fonction ne précise pas details.reason).
const STATUS_TO_REASON = {
    INVALID_ARGUMENT: R.INVALID_FORMAT,
    NOT_FOUND: R.AGENT_NOT_FOUND,
    UNAUTHENTICATED: R.INVALID_CODE,
    RESOURCE_EXHAUSTED: R.TOO_MANY_ATTEMPTS,
    PERMISSION_DENIED: R.PERMISSION_DENIED,
};

/**
 * Appelle la fonction Vercel /api/agent-login (POST { data }, réponse { result } ou { error }).
 * @returns {Promise<{token: string, forageKey: string, agentId: string, profile: object}>}
 */
export async function requestAgentToken({ phone, code, forageKey }, { url, fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let res;
    try {
        res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: { phone, code, ...(forageKey ? { forageKey } : {}) } }),
            signal: controller?.signal,
        });
    } catch {
        // fetch rejette sur coupure réseau / DNS / délai dépassé.
        throw new AgentAuthError(R.OFFLINE);
    } finally {
        if (timer) clearTimeout(timer);
    }

    let body = null;
    try { body = await res.json(); } catch { /* réponse non JSON */ }

    if (res.ok && body?.result?.token) return body.result;

    const error = body?.error || {};
    const reason = error.details?.reason || STATUS_TO_REASON[error.status] || R.SERVER_ERROR;
    throw new AgentAuthError(reason, loginErrorMessage(reason), error.details);
}

export function isPermissionDenied(err) {
    const text = `${err?.code || ''} ${err?.message || ''}`.toLowerCase();
    return text.includes('permission_denied') || text.includes('permission-denied');
}

// Erreurs du SDK Firebase (signInWithCustomToken, lectures/écritures RTDB).
export function classifyFirebaseError(err) {
    if (err instanceof AgentAuthError) return err.reason;
    const code = String(err?.code || '');
    if (code === 'auth/network-request-failed') return R.OFFLINE;
    if (isPermissionDenied(err)) return R.PERMISSION_DENIED;
    if (['auth/user-token-expired', 'auth/user-disabled', 'auth/invalid-user-token'].includes(code)) {
        return R.SESSION_EXPIRED;
    }
    return R.SERVER_ERROR;
}

export function hasAgentClaims(claims, { forageKey, agentId }) {
    return !!claims && claims.role === 'agent'
        && claims.forageKey === forageKey && claims.agentId === agentId;
}

// ── Vérificateur hors ligne ─────────────────────────────────────────────
// Remplace l'ancien stockage du code en clair dans localStorage : on garde
// seulement un dérivé PBKDF2 salé (aléatoire, propre à l'appareil) du couple
// téléphone + code, pour autoriser la reconnexion sans réseau.
const PBKDF2_ITERATIONS = 150000;

const toHex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
const fromHex = hex => new Uint8Array((hex.match(/../g) || []).map(h => parseInt(h, 16)));

async function derive(cryptoImpl, phone, code, salt, iterations) {
    const material = await cryptoImpl.subtle.importKey(
        'raw', new TextEncoder().encode(`${phone}:${code}`), 'PBKDF2', false, ['deriveBits']);
    const bits = await cryptoImpl.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, 256);
    return toHex(bits);
}

export async function createOfflineVerifier({ phone, code, forageKey, agentId }, { cryptoImpl = globalThis.crypto, iterations = PBKDF2_ITERATIONS } = {}) {
    const salt = cryptoImpl.getRandomValues(new Uint8Array(16));
    return {
        v: 1, iterations, forageKey, agentId,
        salt: toHex(salt),
        hash: await derive(cryptoImpl, phone, code, salt, iterations),
    };
}

export async function verifyOfflineVerifier(verifier, { phone, code }, { cryptoImpl = globalThis.crypto } = {}) {
    if (!verifier || verifier.v !== 1 || !verifier.salt || !verifier.hash) return false;
    const hash = await derive(cryptoImpl, phone, code, fromHex(verifier.salt), verifier.iterations);
    let diff = hash.length ^ verifier.hash.length;
    for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ verifier.hash.charCodeAt(i);
    return diff === 0;
}
