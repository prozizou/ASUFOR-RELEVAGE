// functions/src/rtdbStore.js
// Adaptateur Realtime Database (Admin SDK) pour createAgentLogin.
// L'Admin SDK contourne les règles : ce code ne tourne que côté serveur.

const FORAGES_ROOT = 'Asufor';
// Compteur d'échecs de connexion (anti force brute). Aucune règle ne l'ouvre
// aux clients : il reste sous le refus par défaut de database.rules.json.
const GUARD_ROOT = 'agent_login_guard';
const FORAGE_KEYS_TTL_MS = 5 * 60 * 1000;

export function createRtdbStore({ db, credential, databaseURL }) {
    let forageKeysCache = { keys: null, at: 0 };

    // Liste « shallow » des forages : ne télécharge pas compteurs/backup.
    async function listForageKeys() {
        if (forageKeysCache.keys && Date.now() - forageKeysCache.at < FORAGE_KEYS_TTL_MS) {
            return forageKeysCache.keys;
        }
        const { access_token: accessToken } = await credential.getAccessToken();
        const res = await fetch(`${databaseURL}/${FORAGES_ROOT}.json?shallow=true`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) throw new Error(`Lecture des forages impossible (HTTP ${res.status})`);
        const keys = Object.keys((await res.json()) || {});
        forageKeysCache = { keys, at: Date.now() };
        return keys;
    }

    async function findAgentsByPhone(forageKey, phones) {
        const found = new Map();
        await Promise.all(phones.map(async (phone) => {
            const snap = await db.ref(`${FORAGES_ROOT}/${forageKey}/agents`)
                .orderByChild('agent_tel').equalTo(phone).once('value');
            snap.forEach(child => { found.set(child.key, child.val()); });
        }));
        return [...found].map(([agentId, data]) => ({ agentId, data }));
    }

    async function getForageSiege(forageKey) {
        const snap = await db.ref(`${FORAGES_ROOT}/${forageKey}/config/siege`).once('value');
        return snap.val();
    }

    function migrateLegacyPasscode(forageKey, agentId, hash) {
        return db.ref(`${FORAGES_ROOT}/${forageKey}/agents/${agentId}`)
            .update({ passcode_hash: hash, passcode: null });
    }

    async function getFailures(key, now) {
        const entry = (await db.ref(`${GUARD_ROOT}/${key}`).once('value')).val();
        return entry && entry.until > now ? entry.count : 0;
    }

    function recordFailure(key, now, windowMs) {
        return db.ref(`${GUARD_ROOT}/${key}`).transaction((entry) => {
            if (!entry || entry.until <= now) return { count: 1, until: now + windowMs };
            return { count: entry.count + 1, until: entry.until };
        });
    }

    function clearFailures(key) {
        return db.ref(`${GUARD_ROOT}/${key}`).remove();
    }

    return {
        listForageKeys, findAgentsByPhone, getForageSiege, migrateLegacyPasscode,
        getFailures, recordFailure, clearFailures,
    };
}
