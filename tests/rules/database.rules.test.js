// Tests des règles Realtime Database (database.rules.json) sur l'émulateur.
// Lancement : npm run test:rules (démarre l'émulateur via firebase-tools).
// Ignorés par `npm test` si FIREBASE_DATABASE_EMULATOR_HOST n'est pas défini.
import { describe, it, beforeAll, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';

const EMULATOR = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const FA = 'Asufor_a';
const FB = 'Asufor_b';

const compteur = (agentId, over = {}) => ({
    name: 'Client', numero_compteur: '1', last_index: 100, new_index: 0,
    statut: false, agent_id: agentId, facteur: 250, ...over,
});

function seed() {
    return {
        users: {
            presA: { role: 'président', forageKey: FA },
            secA: { role: 'secrétaire', forageKey: FA },
            // Fiche « agent » dans users : ne doit PAS ouvrir la lecture du forage.
            agentUserA: { role: 'agent', forageKey: FA },
        },
        agent_login_guard: { somekey: { count: 1, until: 9e12 } },
        Asufor: {
            [FA]: {
                config: { siege: 'Village A', nom: 'Forage A', maintenance_passcode_hash: 'a'.repeat(64) },
                agents: {
                    A1: { agent: 'Awa', agent_tel: '771111111', zone: 'Nord', passcode_hash: 'b'.repeat(64) },
                    A2: { agent: 'Moussa', agent_tel: '772222222', zone: 'Sud', passcode_hash: 'c'.repeat(64) },
                },
                compteurs: {
                    c1: compteur('A1'),
                    c2: compteur('A1', { numero_compteur: '2' }),
                    c3: compteur('A2', { numero_compteur: '3' }),
                },
                backup: { '2026-06': { donnees: { c1: compteur('A1') } } },
                factures: { f1: { facture_id: 'f1' } },
                depenses: { '2026-06': { d1: { libelle: 'x', montant: 1 } } },
                team: { presA: { role: 'président', nom: 'P' } },
            },
            [FB]: {
                config: { siege: 'Village B' },
                agents: { B1: { agent: 'Fatou', agent_tel: '781111111', zone: 'Est', passcode_hash: 'd'.repeat(64) } },
                compteurs: { k1: compteur('B1'), k2: compteur('A1') },
            },
        },
    };
}

const agentClaims = (forageKey, agentId) => ({ role: 'agent', forageKey, agentId });
const reading = (extra = {}) => ({
    new_index: 120, apaid: 5000, statut: true, releve_date: 1, last_modified: 1, ...extra,
});

describe.skipIf(!EMULATOR)('database.rules.json — agents terrain', () => {
    let env;

    beforeAll(async () => {
        const [host, port] = EMULATOR.split(':');
        env = await initializeTestEnvironment({
            projectId: 'demo-asufor',
            database: { host, port: Number(port), rules: readFileSync(process.env.RULES_FILE || 'database.rules.json', 'utf8') },
        });
    });

    afterAll(async () => { await env?.cleanup(); });

    beforeEach(async () => {
        await env.clearDatabase();
        await env.withSecurityRulesDisabled(ctx => ctx.database().ref().set(seed()));
    });

    const agentDb = (forageKey = FA, agentId = 'A1') =>
        env.authenticatedContext(`agent:${forageKey}:${agentId}`, agentClaims(forageKey, agentId)).database();
    const tournee = (db, forageKey, agentId) =>
        db.ref(`Asufor/${forageKey}/compteurs`).orderByChild('agent_id').equalTo(agentId).once('value');

    describe('lecture', () => {
        it("lit sa tournée (requête agent_id == son agentId)", async () => {
            await assertSucceeds(tournee(agentDb(), FA, 'A1'));
        });

        it("ne lit pas la tournée d'un autre agent ni tous les compteurs", async () => {
            const db = agentDb();
            await assertFails(tournee(db, FA, 'A2'));
            await assertFails(db.ref(`Asufor/${FA}/compteurs`).once('value'));
        });

        it('lit un compteur de sa tournée, pas celui d\'un autre agent', async () => {
            const db = agentDb();
            await assertSucceeds(db.ref(`Asufor/${FA}/compteurs/c1`).once('value'));
            await assertFails(db.ref(`Asufor/${FA}/compteurs/c3`).once('value'));
        });

        it('lit sa fiche champ par champ, jamais passcode_hash ni la fiche entière', async () => {
            const db = agentDb();
            await assertSucceeds(db.ref(`Asufor/${FA}/agents/A1/agent`).once('value'));
            await assertSucceeds(db.ref(`Asufor/${FA}/agents/A1/zone`).once('value'));
            await assertFails(db.ref(`Asufor/${FA}/agents/A1/passcode_hash`).once('value'));
            await assertFails(db.ref(`Asufor/${FA}/agents/A1/passcode`).once('value'));
            await assertFails(db.ref(`Asufor/${FA}/agents/A1`).once('value'));
            await assertFails(db.ref(`Asufor/${FA}/agents/A2/agent`).once('value'));
            await assertFails(db.ref(`Asufor/${FA}/agents`).once('value'));
        });

        it('lit le branding de son forage, pas le hash de maintenance', async () => {
            const db = agentDb();
            await assertSucceeds(db.ref(`Asufor/${FA}/config/siege`).once('value'));
            await assertFails(db.ref(`Asufor/${FA}/config/maintenance_passcode_hash`).once('value'));
            await assertFails(db.ref(`Asufor/${FA}/config`).once('value'));
        });

        it("n'accède ni au forage entier, ni aux archives, comptabilité, administration", async () => {
            const db = agentDb();
            for (const path of [
                `Asufor/${FA}`, `Asufor/${FA}/backup`, `Asufor/${FA}/factures`, `Asufor/${FA}/depenses`,
                `Asufor/${FA}/team`, 'Asufor', 'users', 'agent_login_guard',
            ]) {
                await assertFails(db.ref(path).once('value'));
            }
        });

        it("mauvais forage : aucun accès à un autre forage, même avec son agentId", async () => {
            const db = agentDb();
            await assertFails(tournee(db, FB, 'A1'));
            await assertFails(db.ref(`Asufor/${FB}/compteurs/k2`).once('value'));
            await assertFails(db.ref(`Asufor/${FB}/config/siege`).once('value'));
        });

        it("un compte anonyme (ancien login) n'a aucun accès", async () => {
            const anon = env.authenticatedContext('anon-uid', { firebase: { sign_in_provider: 'anonymous' } }).database();
            await assertFails(tournee(anon, FA, 'A1'));
            await assertFails(anon.ref(`Asufor/${FA}/agents`).orderByChild('passcode').equalTo('123456').once('value'));
            await assertFails(env.unauthenticatedContext().database().ref(`Asufor/${FA}/compteurs/c1`).once('value'));
        });

        it("une fiche users/{uid} de rôle agent n'ouvre pas la lecture du forage", async () => {
            const db = env.authenticatedContext('agentUserA').database();
            await assertFails(db.ref(`Asufor/${FA}`).once('value'));
        });
    });

    describe('écriture', () => {
        it('enregistre un relevé sur un de ses compteurs', async () => {
            await assertSucceeds(agentDb().ref(`Asufor/${FA}/compteurs/c1`).update(reading()));
        });

        it('signale puis supprime une anomalie avec photo Cloudinary', async () => {
            const ref = agentDb().ref(`Asufor/${FA}/compteurs/c1`);
            await assertSucceeds(ref.update({
                note: 'Fuite visible', anomaly_date: 1, last_modified: 2,
                photo_url: 'https://res.cloudinary.com/demo/image/upload/x.jpg',
            }));
            await assertSucceeds(ref.update({ note: null, photo_url: null, anomaly_date: null, last_modified: 3 }));
        });

        it("refuse d'écrire le compteur d'un autre agent", async () => {
            await assertFails(agentDb().ref(`Asufor/${FA}/compteurs/c3`).update(reading()));
            await assertFails(agentDb('Asufor_a', 'A2').ref(`Asufor/${FA}/compteurs/c1`).update(reading()));
        });

        it("refuse d'écrire dans un autre forage, même sur un compteur à son agentId", async () => {
            await assertFails(agentDb().ref(`Asufor/${FB}/compteurs/k2`).update(reading()));
        });

        it("refuse de réattribuer, créer ou supprimer un compteur, ou d'en changer l'ancien index", async () => {
            const db = agentDb();
            await assertFails(db.ref(`Asufor/${FA}/compteurs/c1`).update({ agent_id: 'A2' }));
            await assertFails(db.ref(`Asufor/${FA}/compteurs/c3`).update({ agent_id: 'A1' }));
            await assertFails(db.ref(`Asufor/${FA}/compteurs/c1`).update({ last_index: 0 }));
            await assertFails(db.ref(`Asufor/${FA}/compteurs/c1`).update({ name: 'Autre' }));
            await assertFails(db.ref(`Asufor/${FA}/compteurs/new`).set(compteur('A1')));
            await assertFails(db.ref(`Asufor/${FA}/compteurs/c1`).remove());
            await assertFails(db.ref(`Asufor/${FA}/compteurs/c1`).set(compteur('A1', { new_index: 5 })));
        });

        it('refuse des valeurs invalides', async () => {
            const ref = agentDb().ref(`Asufor/${FA}/compteurs/c1`);
            await assertFails(ref.update({ new_index: '120' }));
            await assertFails(ref.update({ new_index: -1 }));
            await assertFails(ref.update({ statut: 'true' }));
            await assertFails(ref.update({ photo_url: 'https://evil.example/x.jpg' }));
        });

        it("n'écrit ni sa fiche agent, ni la config, ni les archives", async () => {
            const db = agentDb();
            await assertFails(db.ref(`Asufor/${FA}/agents/A1/agent`).set('Pirate'));
            await assertFails(db.ref(`Asufor/${FA}/agents/A1/passcode_hash`).set('e'.repeat(64)));
            await assertFails(db.ref(`Asufor/${FA}/config/siege`).set('X'));
            await assertFails(db.ref(`Asufor/${FA}/backup/2026-07`).set({ donnees: {} }));
        });
    });

    describe('non-régression ADMIN-FORAGE', () => {
        it('le président lit toujours tout son forage', async () => {
            await assertSucceeds(env.authenticatedContext('presA').database().ref(`Asufor/${FA}`).once('value'));
        });

        it('le secrétaire met toujours à jour un compteur', async () => {
            const db = env.authenticatedContext('secA').database();
            await assertSucceeds(db.ref(`Asufor/${FA}/compteurs/c3`).update({ last_index: 150 }));
        });
    });
});
