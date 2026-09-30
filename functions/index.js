// functions/index.js
// Cloud Function « agentLogin » : téléphone + code 6 chiffres → Firebase
// Custom Token portant les claims { role: 'agent', forageKey, agentId }.
// Le client (JS/agentAuth.js) l'appelle via le protocole « callable » puis
// fait signInWithCustomToken().
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { createAgentLogin, AgentLoginError } from './src/agentLogin.js';
import { createRtdbStore } from './src/rtdbStore.js';

// FIREBASE_CONFIG (projectId, databaseURL) est fourni par l'environnement
// Cloud Functions ; il faut le reprendre car on passe des options explicites.
const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG || '{}');
const credential = applicationDefault();
const app = initializeApp({
    credential,
    projectId: firebaseConfig.projectId,
    databaseURL: firebaseConfig.databaseURL,
});

const handleAgentLogin = createAgentLogin({
    store: createRtdbStore({
        db: getDatabase(app),
        credential,
        databaseURL: firebaseConfig.databaseURL,
    }),
    createCustomToken: (uid, claims) => getAuth(app).createCustomToken(uid, claims),
});

// URL publique : https://europe-west1-<projet>.cloudfunctions.net/agentLogin
export const agentLogin = onCall(
    {
        region: 'europe-west1',
        cors: true,
        // Passer à true une fois App Check configuré côté PWA.
        enforceAppCheck: false,
        maxInstances: 10,
    },
    async (request) => {
        try {
            return await handleAgentLogin(request.data, { ip: request.rawRequest?.ip });
        } catch (err) {
            if (err instanceof AgentLoginError) {
                throw new HttpsError(err.code, err.message, err.details);
            }
            logger.error('agentLogin: erreur interne', err);
            throw new HttpsError('internal', 'Erreur serveur, réessayez plus tard.');
        }
    }
);
