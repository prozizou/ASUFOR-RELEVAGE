// Cloud Function agentLogin (functions/src/agentLogin.js) avec une base en mémoire.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    createAgentLogin, hashAgentPasscode, normalizePhone, REASONS, LOGIN_LIMITS,
} from '../functions/src/agentLogin.js';

// Vecteur de référence calculé avec ADMIN-FORAGE/crypto.js#hashAgentPasscode('123456').
const HASH_123456 = '3d38dcc62a8f5a0a350007e95c932c3d83d2bb1599e436414d355351679679ec';

function createMemoryStore(data) {
    const guard = new Map();
    return {
        data,
        guard,
        listForageKeys: vi.fn(async () => Object.keys(data)),
        findAgentsByPhone: vi.fn(async (forageKey, phones) =>
            Object.entries(data[forageKey]?.agents || {})
                .filter(([, a]) => phones.includes(a.agent_tel))
                .map(([agentId, a]) => ({ agentId, data: { ...a } }))),
        getForageSiege: async forageKey => data[forageKey]?.config?.siege || null,
        migrateLegacyPasscode: vi.fn(async (forageKey, agentId, hash) => {
            const agent = data[forageKey].agents[agentId];
            agent.passcode_hash = hash;
            delete agent.passcode;
        }),
        getFailures: async (key, now) => {
            const e = guard.get(key);
            return e && e.until > now ? e.count : 0;
        },
        recordFailure: async (key, now, windowMs) => {
            const e = guard.get(key);
            guard.set(key, !e || e.until <= now ? { count: 1, until: now + windowMs } : { ...e, count: e.count + 1 });
        },
        clearFailures: async key => { guard.delete(key); },
    };
}

function seed() {
    return {
        Asufor_a: {
            config: { siege: 'Village A' },
            agents: {
                A1: { agent: 'Awa', agent_tel: '771111111', zone: 'Nord', passcode_hash: HASH_123456 },
                A2: { agent: 'Moussa', agent_tel: '221772222222', zone: 'Sud', passcode_hash: hashAgentPasscode('222222') },
                LEG: { agent: 'Ancien', agent_tel: '773333333', zone: 'Est', passcode: '333333' },
                NOCODE: { agent: 'Sans code', agent_tel: '774444444', zone: 'Ouest' },
            },
        },
        Asufor_b: {
            config: { siege: 'Village B' },
            agents: {
                B1: { agent: 'Fatou', agent_tel: '781111111', zone: 'Est', passcode_hash: hashAgentPasscode('111111') },
                // Même téléphone + même code que A1, sur un autre forage.
                B2: { agent: 'Awa bis', agent_tel: '771111111', zone: 'Nord', passcode_hash: hashAgentPasscode('999999') },
            },
        },
    };
}

async function expectReason(promise, reason, code) {
    await expect(promise).rejects.toMatchObject({ reason, ...(code ? { code } : {}) });
}

describe('agentLogin (Cloud Function)', () => {
    let store;
    let createCustomToken;
    let login;
    let now;

    beforeEach(() => {
        store = createMemoryStore(seed());
        createCustomToken = vi.fn(async (uid, claims) => `token-for:${uid}:${JSON.stringify(claims)}`);
        now = 1_000_000;
        login = createAgentLogin({ store, createCustomToken, now: () => now });
    });

    it('hache le code exactement comme ADMIN-FORAGE (passcode_hash)', () => {
        expect(hashAgentPasscode('123456')).toBe(HASH_123456);
        expect(hashAgentPasscode(' 123456 ')).toBe(HASH_123456);
    });

    it('login valide : Custom Token avec claims { role, forageKey, agentId } et profil', async () => {
        const res = await login({ phone: '77 111 11 11', code: '123456' });
        expect(createCustomToken).toHaveBeenCalledWith('agent:Asufor_a:A1', {
            role: 'agent', forageKey: 'Asufor_a', agentId: 'A1',
        });
        expect(res).toMatchObject({
            forageKey: 'Asufor_a', agentId: 'A1',
            profile: { agent: 'Awa', zone: 'Nord', siege: 'Village A' },
        });
        expect(res.token).toContain('agent:Asufor_a:A1');
        // Jamais de hash ni de code dans la réponse.
        expect(JSON.stringify(res)).not.toContain(HASH_123456);
    });

    it("accepte l'indicatif 221 côté saisie ou côté base", async () => {
        await expect(login({ phone: '+221 77 111 11 11', code: '123456' })).resolves.toMatchObject({ agentId: 'A1' });
        await expect(login({ phone: '772222222', code: '222222' })).resolves.toMatchObject({ agentId: 'A2' });
    });

    it('code invalide → INVALID_CODE, sans jeton', async () => {
        await expectReason(login({ phone: '771111111', code: '000000', forageKey: 'Asufor_a' }), REASONS.INVALID_CODE, 'unauthenticated');
        expect(createCustomToken).not.toHaveBeenCalled();
    });

    it('mauvais téléphone → AGENT_NOT_FOUND', async () => {
        await expectReason(login({ phone: '700000000', code: '123456' }), REASONS.AGENT_NOT_FOUND, 'not-found');
    });

    it("mauvais forage : l'agent n'est pas trouvé sur un forage qui n'est pas le sien", async () => {
        await expectReason(login({ phone: '781111111', code: '111111', forageKey: 'Asufor_a' }), REASONS.AGENT_NOT_FOUND);
        await expectReason(login({ phone: '781111111', code: '111111', forageKey: 'Asufor_inexistant' }), REASONS.AGENT_NOT_FOUND);
        await expect(login({ phone: '781111111', code: '111111', forageKey: 'Asufor_b' }))
            .resolves.toMatchObject({ forageKey: 'Asufor_b', agentId: 'B1' });
    });

    it('multi-forage : le code départage deux agents de même téléphone', async () => {
        await expect(login({ phone: '771111111', code: '999999' })).resolves.toMatchObject({ forageKey: 'Asufor_b', agentId: 'B2' });
    });

    it('même téléphone + même code sur deux forages → AMBIGUOUS_FORAGE, puis choix explicite', async () => {
        store.data.Asufor_b.agents.B2.passcode_hash = HASH_123456;
        const err = await login({ phone: '771111111', code: '123456' }).catch(e => e);
        expect(err.reason).toBe(REASONS.AMBIGUOUS_FORAGE);
        expect(err.details.forages).toEqual([
            { forageKey: 'Asufor_a', siege: 'Village A' },
            { forageKey: 'Asufor_b', siege: 'Village B' },
        ]);
        await expect(login({ phone: '771111111', code: '123456', forageKey: 'Asufor_b' }))
            .resolves.toMatchObject({ agentId: 'B2' });
    });

    it('formats invalides → INVALID_FORMAT (sans interroger la base)', async () => {
        await expectReason(login({ phone: '77', code: '123456' }), REASONS.INVALID_FORMAT, 'invalid-argument');
        await expectReason(login({ phone: '771111111', code: '12345' }), REASONS.INVALID_FORMAT);
        await expectReason(login({ phone: '771111111', code: 'abcdef' }), REASONS.INVALID_FORMAT);
        await expectReason(login({ phone: '771111111', code: '123456', forageKey: 'a/b' }), REASONS.INVALID_FORMAT);
        await expectReason(login(null), REASONS.INVALID_FORMAT);
        expect(store.findAgentsByPhone).not.toHaveBeenCalled();
    });

    it('passcode legacy en clair : accepté côté serveur puis converti en passcode_hash', async () => {
        await expect(login({ phone: '773333333', code: '333333' })).resolves.toMatchObject({ agentId: 'LEG' });
        expect(store.migrateLegacyPasscode).toHaveBeenCalledWith('Asufor_a', 'LEG', hashAgentPasscode('333333'));
        expect(store.data.Asufor_a.agents.LEG).toEqual(expect.not.objectContaining({ passcode: expect.anything() }));
        await expectReason(login({ phone: '773333333', code: '000000' }), REASONS.INVALID_CODE);
    });

    it('agent sans code configuré → NO_PASSCODE', async () => {
        await expectReason(login({ phone: '774444444', code: '123456' }), REASONS.NO_PASSCODE, 'failed-precondition');
    });

    it('anti force brute : blocage après 5 échecs sur un numéro, levé après 15 min', async () => {
        for (let i = 0; i < LOGIN_LIMITS.maxFailuresPerPhone; i++) {
            await expectReason(login({ phone: '771111111', code: '000000' }), REASONS.INVALID_CODE);
        }
        await expectReason(login({ phone: '771111111', code: '123456' }), REASONS.TOO_MANY_ATTEMPTS, 'resource-exhausted');
        now += LOGIN_LIMITS.windowMs + 1;
        await expect(login({ phone: '771111111', code: '123456' })).resolves.toMatchObject({ agentId: 'A1' });
    });

    it('anti force brute : limite par adresse IP', async () => {
        const limited = createAgentLogin({ store, createCustomToken, now: () => now, limits: { ...LOGIN_LIMITS, maxFailuresPerIp: 2 } });
        await expectReason(limited({ phone: '700000001', code: '123456' }, { ip: '1.2.3.4' }), REASONS.AGENT_NOT_FOUND);
        await expectReason(limited({ phone: '700000002', code: '123456' }, { ip: '1.2.3.4' }), REASONS.AGENT_NOT_FOUND);
        await expectReason(limited({ phone: '771111111', code: '123456' }, { ip: '1.2.3.4' }), REASONS.TOO_MANY_ATTEMPTS);
        await expect(limited({ phone: '771111111', code: '123456' }, { ip: '5.6.7.8' })).resolves.toMatchObject({ agentId: 'A1' });
    });

    it('normalizePhone retire espaces, + et indicatif 221', () => {
        expect(normalizePhone('+221 77 111 11 11')).toBe('771111111');
        expect(normalizePhone('00221771111111')).toBe('771111111');
        expect(normalizePhone('77-111-11-11')).toBe('771111111');
    });
});
