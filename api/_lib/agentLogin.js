// api/_lib/agentLogin.js
// Logique métier de la connexion agent (téléphone + code 6 chiffres),
// sans dépendance Firebase : la base et l'émission du jeton sont injectées,
// ce qui permet de tester ce module directement (voir tests/agentLogin.test.js).
import { createHash, timingSafeEqual } from 'node:crypto';

// Même format que ADMIN-FORAGE/crypto.js#hashAgentPasscode :
// SHA-256 hex de « asufor_agent_v1:<code> ».
const PASSCODE_SALT = 'asufor_agent_v1:';

export const LOGIN_LIMITS = {
    windowMs: 15 * 60 * 1000,
    maxFailuresPerPhone: 5,
    maxFailuresPerIp: 30,
};

// Raisons renvoyées au client (details.reason) : le client les traduit en
// messages clairs (voir JS/agentAuth.js#loginErrorMessage).
export const REASONS = {
    INVALID_FORMAT: 'INVALID_FORMAT',
    AGENT_NOT_FOUND: 'AGENT_NOT_FOUND',
    INVALID_CODE: 'INVALID_CODE',
    NO_PASSCODE: 'NO_PASSCODE',
    AMBIGUOUS_FORAGE: 'AMBIGUOUS_FORAGE',
    TOO_MANY_ATTEMPTS: 'TOO_MANY_ATTEMPTS',
};

export class AgentLoginError extends Error {
    constructor(code, reason, message, details = {}) {
        super(message);
        this.code = code; // code HttpsError (invalid-argument, not-found, ...)
        this.reason = reason;
        this.details = { reason, ...details };
    }
}

export function normalizePhone(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (digits.length === 14 && digits.startsWith('00221')) return digits.slice(5);
    if (digits.length === 12 && digits.startsWith('221')) return digits.slice(3);
    return digits;
}

// agent_tel est saisi librement dans ADMIN-FORAGE (chiffres, avec ou sans
// l'indicatif 221) : on cherche les deux écritures.
export function phoneVariants(phone) {
    return [...new Set([phone, `221${phone}`])];
}

export function hashAgentPasscode(code) {
    return createHash('sha256').update(PASSCODE_SALT + String(code).trim()).digest('hex');
}

function safeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

const FORAGE_KEY_RE = /^[^.$#[\]/]{1,128}$/;

function validateInput({ phone, code, forageKey }) {
    const normalized = normalizePhone(phone);
    const codeStr = String(code ?? '').trim();
    if (!/^[0-9]{7,15}$/.test(normalized) || !/^[0-9]{6}$/.test(codeStr)) {
        throw new AgentLoginError('invalid-argument', REASONS.INVALID_FORMAT,
            'Numéro de téléphone ou code au mauvais format.');
    }
    if (forageKey != null && forageKey !== '' && !FORAGE_KEY_RE.test(String(forageKey))) {
        throw new AgentLoginError('invalid-argument', REASONS.INVALID_FORMAT, 'Forage invalide.');
    }
    return { phone: normalized, code: codeStr, forageKey: forageKey ? String(forageKey) : null };
}

function hashKey(prefix, value) {
    return createHash('sha256').update(`${prefix}:${value}`).digest('hex').slice(0, 40);
}

// Vérifie le code d'un agent candidat. Renvoie 'ok', 'bad' ou 'none' (aucun
// code configuré). Le champ legacy `passcode` (en clair) n'est lu QUE côté
// serveur, et converti en passcode_hash dès la première connexion réussie.
function checkPasscode(agent, code) {
    if (typeof agent.passcode_hash === 'string' && agent.passcode_hash) {
        return safeEqual(hashAgentPasscode(code), agent.passcode_hash) ? 'ok' : 'bad';
    }
    if (agent.passcode != null && agent.passcode !== '') {
        return safeEqual(String(agent.passcode), code) ? 'ok' : 'bad';
    }
    return 'none';
}

/**
 * @param {object} deps
 * @param {object} deps.store  adaptateur base (voir rtdbStore.js) :
 *   listForageKeys(), findAgentsByPhone(forageKey, phones), getForageSiege(forageKey),
 *   migrateLegacyPasscode(forageKey, agentId, hash), getFailures(key, now),
 *   recordFailure(key, now, windowMs), clearFailures(key)
 * @param {(uid: string, claims: object) => Promise<string>} deps.createCustomToken
 * @param {() => number} [deps.now]
 */
export function createAgentLogin({ store, createCustomToken, now = Date.now, limits = LOGIN_LIMITS }) {
    return async function agentLogin(rawInput, { ip } = {}) {
        const { phone, code, forageKey } = validateInput(rawInput || {});
        const t = now();
        const phoneKey = hashKey('phone', phone);
        const ipKey = ip ? hashKey('ip', ip) : null;

        const [phoneFailures, ipFailures] = await Promise.all([
            store.getFailures(phoneKey, t),
            ipKey ? store.getFailures(ipKey, t) : 0,
        ]);
        if (phoneFailures >= limits.maxFailuresPerPhone || ipFailures >= limits.maxFailuresPerIp) {
            throw new AgentLoginError('resource-exhausted', REASONS.TOO_MANY_ATTEMPTS,
                'Trop de tentatives. Réessayez dans 15 minutes.');
        }

        const fail = async (error) => {
            await Promise.all([
                store.recordFailure(phoneKey, t, limits.windowMs),
                ipKey ? store.recordFailure(ipKey, t, limits.windowMs) : null,
            ]);
            throw error;
        };

        const forageKeys = forageKey ? [forageKey] : await store.listForageKeys();
        const variants = phoneVariants(phone);
        const perForage = await Promise.all(forageKeys.map(async (fk) => {
            const agents = await store.findAgentsByPhone(fk, variants);
            return agents.map(a => ({ forageKey: fk, agentId: a.agentId, data: a.data || {} }));
        }));
        const candidates = perForage.flat().filter(c => normalizePhone(c.data.agent_tel) === phone);

        if (candidates.length === 0) {
            return fail(new AgentLoginError('not-found', REASONS.AGENT_NOT_FOUND,
                'Aucun agent enregistré avec ce numéro.'));
        }

        const checked = candidates.map(c => ({ ...c, result: checkPasscode(c.data, code) }));
        const matches = checked.filter(c => c.result === 'ok');

        if (matches.length === 0) {
            if (checked.every(c => c.result === 'none')) {
                return fail(new AgentLoginError('failed-precondition', REASONS.NO_PASSCODE,
                    "Aucun code n'est configuré pour cet agent."));
            }
            return fail(new AgentLoginError('unauthenticated', REASONS.INVALID_CODE, 'Code agent invalide.'));
        }

        if (matches.length > 1) {
            const forages = await Promise.all(matches.map(async m => ({
                forageKey: m.forageKey,
                siege: m.data.siege || (await store.getForageSiege(m.forageKey)) || m.forageKey,
            })));
            throw new AgentLoginError('failed-precondition', REASONS.AMBIGUOUS_FORAGE,
                'Ce numéro est enregistré sur plusieurs forages : choisissez le vôtre.', { forages });
        }

        const match = matches[0];
        await store.clearFailures(phoneKey);

        if (!match.data.passcode_hash) {
            await store.migrateLegacyPasscode(match.forageKey, match.agentId, hashAgentPasscode(code));
        }

        const claims = { role: 'agent', forageKey: match.forageKey, agentId: match.agentId };
        const token = await createCustomToken(`agent:${match.forageKey}:${match.agentId}`, claims);
        const siege = match.data.siege || (await store.getForageSiege(match.forageKey)) || '';

        return {
            token,
            forageKey: match.forageKey,
            agentId: match.agentId,
            profile: { agent: match.data.agent || 'Agent', zone: match.data.zone || '', siege },
        };
    };
}
