// @vitest-environment jsdom
// Mode hors ligne puis resynchronisation : file IndexedDB (JS/offlineDb.js),
// écriture différée (JS/writes.js) et rejeu (JS/sync.js).
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fake = vi.hoisted(() => {
    const remote = {};
    const calls = [];
    let failNext = null;
    const db = {
        ref: path => ({
            once: async () => ({ val: () => remote[path] ?? null }),
            update: async (data) => {
                if (failNext) {
                    const err = failNext;
                    failNext = null;
                    throw err;
                }
                calls.push({ path, data });
                remote[path] = { ...(remote[path] || {}), ...data };
            },
        }),
    };
    return {
        db, remote, calls,
        failOnce: (err) => { failNext = err; },
        reset() {
            for (const k of Object.keys(remote)) delete remote[k];
            calls.length = 0;
            failNext = null;
        },
    };
});

vi.mock('../JS/firebase.js', () => ({ db: fake.db }));

const { state } = await import('../JS/state.js');
const { saveCompteurUpdate } = await import('../JS/writes.js');
const { syncPendingWrites, belongsToAgent } = await import('../JS/sync.js');
const { getPendingWrites, clearPendingWrite, addPendingWrite } = await import('../JS/offlineDb.js');

let online = true;
Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });

let claims = null;
globalThis.firebase = {
    auth: () => ({
        currentUser: claims && { isAnonymous: false, getIdTokenResult: async () => ({ claims }) },
    }),
};

const C1 = 'Asufor/Asufor_a/compteurs/c1';
const C2 = 'Asufor/Asufor_a/compteurs/c2';
const reading = (t) => ({ new_index: 120, apaid: 5000, statut: true, releve_date: t, last_modified: t });

beforeEach(async () => {
    for (const level of ['log', 'warn', 'error']) vi.spyOn(console, level).mockImplementation(() => {});
    for (const op of await getPendingWrites()) await clearPendingWrite(op.id);
    fake.reset();
    document.body.innerHTML = '<span id="sync-indicator"></span><div id="sync-detail"></div><div id="toast"></div>';
    state.currentAgentId = 'A1';
    state.currentForageKey = 'Asufor_a';
    claims = { role: 'agent', forageKey: 'Asufor_a', agentId: 'A1' };
    online = true;
});

describe('mode hors ligne puis resynchronisation', () => {
    it('met les relevés hors ligne en file, puis les envoie au retour du réseau', async () => {
        online = false;
        expect(await saveCompteurUpdate('c1', reading(100))).toBe('queued');
        expect(await saveCompteurUpdate('c2', { note: 'Logement fermé', anomaly_date: 101, last_modified: 101 })).toBe('queued');
        expect(fake.calls).toHaveLength(0);

        const queued = await getPendingWrites();
        expect(queued.map(op => op.path)).toEqual([C1, C2]);
        expect(queued[0]).toMatchObject({ agentId: 'A1', forageKey: 'Asufor_a', attempts: 0 });

        await syncPendingWrites(); // toujours hors ligne : rien ne part
        expect(fake.calls).toHaveLength(0);

        online = true;
        await syncPendingWrites();
        expect(fake.calls.map(c => c.path)).toEqual([C1, C2]);
        expect(fake.remote[C1]).toMatchObject(reading(100));
        expect(await getPendingWrites()).toHaveLength(0);
        expect(document.getElementById('sync-indicator').textContent).toContain('Synchronisé');
    });

    it('écrit directement en ligne, et garde en file si le réseau échoue', async () => {
        expect(await saveCompteurUpdate('c1', reading(100))).toBe('saved');
        expect(await getPendingWrites()).toHaveLength(0);

        fake.failOnce(Object.assign(new Error('network error'), { code: 'NETWORK_ERROR' }));
        expect(await saveCompteurUpdate('c2', reading(200))).toBe('queued-error');
        expect(await getPendingWrites()).toHaveLength(1);
    });

    it('permission_denied à l\'écriture : gardé en file et signalé', async () => {
        const denied = vi.fn();
        window.addEventListener('agent-access-denied', denied, { once: true });
        fake.failOnce(Object.assign(new Error('PERMISSION_DENIED: Permission denied'), { code: 'PERMISSION_DENIED' }));
        expect(await saveCompteurUpdate('c1', reading(100))).toBe('denied');
        expect(await getPendingWrites()).toHaveLength(1);
        expect(denied).toHaveBeenCalled();
    });

    it('sans jeton agent valide : file conservée et reconnexion demandée', async () => {
        online = false;
        await saveCompteurUpdate('c1', reading(100));
        online = true;
        claims = null;
        const reauth = vi.fn();
        window.addEventListener('agent-reauth-required', reauth, { once: true });

        await syncPendingWrites();
        expect(fake.calls).toHaveLength(0);
        expect(await getPendingWrites()).toHaveLength(1);
        expect(reauth).toHaveBeenCalled();

        // Après reconnexion (Custom Token), la même file part.
        claims = { role: 'agent', forageKey: 'Asufor_a', agentId: 'A1' };
        await syncPendingWrites();
        expect(fake.calls.map(c => c.path)).toEqual([C1]);
        expect(await getPendingWrites()).toHaveLength(0);
    });

    it("ne rejoue pas les écritures d'un autre agent ou d'un autre forage", async () => {
        state.currentAgentId = 'A2';
        await addPendingWrite({ path: 'Asufor/Asufor_a/compteurs/c3', data: reading(100) });
        state.currentAgentId = 'A1';
        await addPendingWrite({ path: 'Asufor/Asufor_b/compteurs/k1', data: reading(100) });
        await addPendingWrite({ path: C1, data: reading(100) });

        await syncPendingWrites();
        expect(fake.calls.map(c => c.path)).toEqual([C1]);
        expect((await getPendingWrites()).map(op => op.path)).toEqual(['Asufor/Asufor_a/compteurs/c3', 'Asufor/Asufor_b/compteurs/k1']);
    });

    it('permission_denied au rejeu : tentative comptée, les suivantes partent quand même', async () => {
        await addPendingWrite({ path: C1, data: reading(100) });
        await addPendingWrite({ path: C2, data: reading(101) });
        fake.failOnce(Object.assign(new Error('PERMISSION_DENIED: Permission denied'), { code: 'PERMISSION_DENIED' }));

        await syncPendingWrites();
        expect(fake.calls.map(c => c.path)).toEqual([C2]);
        const [left] = await getPendingWrites();
        expect(left).toMatchObject({ path: C1, attempts: 1 });
    });

    it('coupure réseau au rejeu : pause sans compter de tentative (pas d\'abandon)', async () => {
        await addPendingWrite({ path: C1, data: reading(100) });
        fake.failOnce(Object.assign(new Error('network error'), { code: 'NETWORK_ERROR' }));

        await syncPendingWrites();
        const [left] = await getPendingWrites();
        expect(left).toMatchObject({ path: C1, attempts: 0 });
    });

    it('conflit : une donnée serveur plus récente l\'emporte sur la file locale', async () => {
        fake.remote[C1] = { last_modified: 500 };
        await addPendingWrite({ path: C1, data: reading(100) });

        await syncPendingWrites();
        expect(fake.calls).toHaveLength(0);
        expect(await getPendingWrites()).toHaveLength(0);
    });

    it('synchronisations simultanées : chaque écriture ne part qu\'une fois', async () => {
        await addPendingWrite({ path: C1, data: reading(100) });
        await Promise.all([syncPendingWrites(), syncPendingWrites(), syncPendingWrites()]);
        expect(fake.calls).toHaveLength(1);
    });
});

describe('belongsToAgent', () => {
    it('exige le même agent et un chemin de compteur de son forage', () => {
        expect(belongsToAgent({ agentId: 'A1', path: C1 }, 'A1', 'Asufor_a')).toBe(true);
        expect(belongsToAgent({ agentId: 'A2', path: C1 }, 'A1', 'Asufor_a')).toBe(false);
        expect(belongsToAgent({ agentId: 'A1', path: C1 }, 'A1', 'Asufor_b')).toBe(false);
        expect(belongsToAgent({ agentId: 'A1', path: 'Asufor/Asufor_a/backup/x' }, 'A1', 'Asufor_a')).toBe(false);
        expect(belongsToAgent(null, 'A1', 'Asufor_a')).toBe(false);
    });
});
