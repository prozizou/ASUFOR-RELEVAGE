// Connexion côté client : JS/agentAuth.js, JS/session.js, JS/config.js.
import { describe, it, expect, vi } from 'vitest';
import {
    LOGIN_REASONS as R, AgentAuthError, validateLoginInput, requestAgentToken, loginErrorMessage,
    classifyFirebaseError, isPermissionDenied, hasAgentClaims, createOfflineVerifier, verifyOfflineVerifier,
} from '../JS/agentAuth.js';
import { saveSession, loadSession, getAgentAuthStatus, waitForAuthUser } from '../JS/session.js';
import { firebaseConfig, isValidWebAppId, AGENT_LOGIN_URL } from '../JS/config.js';

const URL = 'https://example.test/agentLogin';

function jsonResponse(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function memoryStorage() {
    const map = new Map();
    return {
        getItem: k => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: k => map.delete(k),
        dump: () => Object.fromEntries(map),
    };
}

describe('validateLoginInput', () => {
    it('accepte téléphone + code 6 chiffres (indicatif 221 retiré)', () => {
        expect(validateLoginInput('+221 77 111 11 11', ' 123456 ')).toEqual({ phone: '771111111', code: '123456', error: null });
    });

    it('refuse un téléphone trop court ou un code mal formé', () => {
        expect(validateLoginInput('7711', '123456').error).toBe(R.INVALID_PHONE);
        expect(validateLoginInput('771111111', '12345').error).toBe(R.INVALID_FORMAT);
        expect(validateLoginInput('771111111', '12a456').error).toBe(R.INVALID_FORMAT);
    });
});

describe('requestAgentToken', () => {
    it('envoie le protocole callable et renvoie le résultat', async () => {
        const result = { token: 'tok', forageKey: 'Asufor_a', agentId: 'A1', profile: { agent: 'Awa' } };
        const fetchImpl = vi.fn(async () => jsonResponse(200, { result }));
        await expect(requestAgentToken({ phone: '771111111', code: '123456' }, { url: URL, fetchImpl })).resolves.toEqual(result);
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe(URL);
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ data: { phone: '771111111', code: '123456' } });
    });

    it('transmet le forage choisi', async () => {
        const fetchImpl = vi.fn(async () => jsonResponse(200, { result: { token: 't' } }));
        await requestAgentToken({ phone: '771111111', code: '123456', forageKey: 'Asufor_b' }, { url: URL, fetchImpl });
        expect(JSON.parse(fetchImpl.mock.calls[0][1].body).data.forageKey).toBe('Asufor_b');
    });

    it.each([
        [{ status: 'UNAUTHENTICATED', details: { reason: 'INVALID_CODE' } }, 401, R.INVALID_CODE],
        [{ status: 'NOT_FOUND', details: { reason: 'AGENT_NOT_FOUND' } }, 404, R.AGENT_NOT_FOUND],
        [{ status: 'RESOURCE_EXHAUSTED', details: { reason: 'TOO_MANY_ATTEMPTS' } }, 429, R.TOO_MANY_ATTEMPTS],
        [{ status: 'NOT_FOUND' }, 404, R.AGENT_NOT_FOUND],
        [{ status: 'UNAUTHENTICATED' }, 401, R.INVALID_CODE],
        [{ status: 'INTERNAL' }, 500, R.SERVER_ERROR],
    ])('traduit l\'erreur %j en %s', async (error, httpStatus, reason) => {
        const fetchImpl = async () => jsonResponse(httpStatus, { error });
        const err = await requestAgentToken({ phone: '771111111', code: '123456' }, { url: URL, fetchImpl }).catch(e => e);
        expect(err).toBeInstanceOf(AgentAuthError);
        expect(err.reason).toBe(reason);
        expect(err.message).toBe(loginErrorMessage(reason));
    });

    it('garde la liste des forages en cas d\'ambiguïté', async () => {
        const forages = [{ forageKey: 'Asufor_a', siege: 'A' }, { forageKey: 'Asufor_b', siege: 'B' }];
        const fetchImpl = async () => jsonResponse(400, { error: { status: 'FAILED_PRECONDITION', details: { reason: 'AMBIGUOUS_FORAGE', forages } } });
        const err = await requestAgentToken({ phone: '771111111', code: '123456' }, { url: URL, fetchImpl }).catch(e => e);
        expect(err.reason).toBe(R.AMBIGUOUS_FORAGE);
        expect(err.details.forages).toEqual(forages);
    });

    it('hors ligne (fetch rejeté) → OFFLINE', async () => {
        const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
        await expect(requestAgentToken({ phone: '771111111', code: '123456' }, { url: URL, fetchImpl }))
            .rejects.toMatchObject({ reason: R.OFFLINE });
    });

    it('réponse non JSON → SERVER_ERROR', async () => {
        const fetchImpl = async () => ({ ok: false, status: 502, json: async () => { throw new Error('html'); } });
        await expect(requestAgentToken({ phone: '771111111', code: '123456' }, { url: URL, fetchImpl }))
            .rejects.toMatchObject({ reason: R.SERVER_ERROR });
    });
});

describe('erreurs Firebase', () => {
    it('reconnaît permission_denied (RTDB) et les erreurs réseau/session (Auth)', () => {
        const denied = Object.assign(new Error('PERMISSION_DENIED: Permission denied'), { code: 'PERMISSION_DENIED' });
        expect(isPermissionDenied(denied)).toBe(true);
        expect(isPermissionDenied(new Error('permission_denied at /Asufor'))).toBe(true);
        expect(classifyFirebaseError(denied)).toBe(R.PERMISSION_DENIED);
        expect(classifyFirebaseError({ code: 'auth/network-request-failed' })).toBe(R.OFFLINE);
        expect(classifyFirebaseError({ code: 'auth/user-token-expired' })).toBe(R.SESSION_EXPIRED);
        expect(classifyFirebaseError({ code: 'auth/invalid-custom-token' })).toBe(R.SERVER_ERROR);
        expect(classifyFirebaseError(new AgentAuthError(R.INVALID_CODE))).toBe(R.INVALID_CODE);
    });

    it('a un message clair pour chaque cas', () => {
        for (const reason of Object.values(R)) {
            expect(loginErrorMessage(reason)).toBeTruthy();
        }
        expect(loginErrorMessage(R.INVALID_CODE)).toMatch(/code/i);
        expect(loginErrorMessage(R.AGENT_NOT_FOUND)).toMatch(/introuvable/i);
        expect(loginErrorMessage(R.PERMISSION_DENIED)).toMatch(/refusé/i);
        expect(loginErrorMessage(R.OFFLINE)).toMatch(/hors ligne/i);
    });
});

describe('claims agent', () => {
    it('exige role agent + même forage + même agent', () => {
        const ids = { forageKey: 'Asufor_a', agentId: 'A1' };
        expect(hasAgentClaims({ role: 'agent', ...ids }, ids)).toBe(true);
        expect(hasAgentClaims({ role: 'agent', forageKey: 'Asufor_b', agentId: 'A1' }, ids)).toBe(false);
        expect(hasAgentClaims({ role: 'agent', forageKey: 'Asufor_a', agentId: 'A2' }, ids)).toBe(false);
        expect(hasAgentClaims({ forageKey: 'Asufor_a', agentId: 'A1' }, ids)).toBe(false);
        expect(hasAgentClaims(null, ids)).toBe(false);
    });

    it('getAgentAuthStatus : ok / missing (aucun compte ou anonyme) / mismatch / unverified', async () => {
        const ids = { forageKey: 'Asufor_a', agentId: 'A1' };
        const userWith = claims => ({ isAnonymous: false, getIdTokenResult: async () => ({ claims }) });
        expect(await getAgentAuthStatus({ currentUser: userWith({ role: 'agent', ...ids }) }, ids)).toBe('ok');
        expect(await getAgentAuthStatus({ currentUser: null }, ids)).toBe('missing');
        expect(await getAgentAuthStatus({ currentUser: { isAnonymous: true } }, ids)).toBe('missing');
        expect(await getAgentAuthStatus({ currentUser: userWith({ role: 'agent', forageKey: 'Asufor_b', agentId: 'A1' }) }, ids)).toBe('mismatch');
        const offline = { isAnonymous: false, getIdTokenResult: async () => { throw new Error('network'); } };
        expect(await getAgentAuthStatus({ currentUser: offline }, ids)).toBe('unverified');
    });

    it('waitForAuthUser résout au premier état Auth, même synchrone', async () => {
        const user = { uid: 'u' };
        const unsubscribe = vi.fn();
        const auth = { currentUser: null, onAuthStateChanged: cb => { cb(user); return unsubscribe; } };
        await expect(waitForAuthUser(auth)).resolves.toBe(user);
        expect(unsubscribe).toHaveBeenCalled();
    });
});

describe('session locale et reconnexion hors ligne', () => {
    const creds = { phone: '771111111', code: '123456', forageKey: 'Asufor_a', agentId: 'A1' };

    it('le vérificateur accepte le bon couple et refuse code ou téléphone erronés', async () => {
        const verifier = await createOfflineVerifier(creds, { iterations: 1000 });
        expect(await verifyOfflineVerifier(verifier, { phone: '771111111', code: '123456' })).toBe(true);
        expect(await verifyOfflineVerifier(verifier, { phone: '771111111', code: '654321' })).toBe(false);
        expect(await verifyOfflineVerifier(verifier, { phone: '772222222', code: '123456' })).toBe(false);
        expect(await verifyOfflineVerifier(null, { phone: '771111111', code: '123456' })).toBe(false);
    });

    it('sel aléatoire : deux vérificateurs du même code diffèrent', async () => {
        const a = await createOfflineVerifier(creds, { iterations: 1000 });
        const b = await createOfflineVerifier(creds, { iterations: 1000 });
        expect(a.salt).not.toBe(b.salt);
        expect(a.hash).not.toBe(b.hash);
    });

    it("conserve forageKey/agentId sans jamais stocker le code en clair (et purge l'ancien)", async () => {
        const storage = memoryStorage();
        storage.setItem('agent_passcode', '123456'); // session d'une ancienne version
        const verifier = await createOfflineVerifier(creds, { iterations: 1000 });
        saveSession({
            agentId: 'A1', forageKey: 'Asufor_a', phone: '771111111', verifier,
            profile: { agent: 'Awa', zone: 'Nord', siege: 'Village A' },
        }, storage);

        const session = loadSession(storage);
        expect(session).toMatchObject({ agentId: 'A1', forageKey: 'Asufor_a', name: 'Awa', zone: 'Nord', siege: 'Village A', phone: '771111111' });
        expect(session.legacyPasscode).toBeNull();
        expect(JSON.stringify(storage.dump())).not.toContain('123456');
        expect(await verifyOfflineVerifier(session.verifier, { phone: '771111111', code: '123456' })).toBe(true);
    });

    it('pas de session sans agentId + forageKey', () => {
        const storage = memoryStorage();
        storage.setItem('asufor_id', 'A1');
        expect(loadSession(storage)).toBeNull();
    });
});

describe('firebaseConfig', () => {
    it("n'utilise plus l'appId Android et n'accepte qu'un appId Web", () => {
        expect(String(firebaseConfig.appId || '')).not.toContain(':android:');
        if (firebaseConfig.appId) expect(isValidWebAppId(firebaseConfig.appId)).toBe(true);
        expect(isValidWebAppId('1:621722220561:web:40acdd4d6bf3340f3059b0')).toBe(true);
        expect(isValidWebAppId('1:621722220561:android:40acdd4d6bf3340f3059b0')).toBe(false);
        expect(isValidWebAppId('1:999:web:abc')).toBe(false);
        expect(isValidWebAppId('')).toBe(false);
    });

    it('pointe la connexion agent vers la fonction Vercel', () => {
        expect(firebaseConfig.messagingSenderId).toBe('621722220561');
        expect(AGENT_LOGIN_URL).toBe('/api/agent-login');
    });
});
