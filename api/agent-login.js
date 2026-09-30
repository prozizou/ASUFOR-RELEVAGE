// api/agent-login.js — fonction Vercel : téléphone + code 6 chiffres → Firebase Custom Token
// (claims { role: 'agent', forageKey, agentId }). Le client (JS/agentAuth.js) l'appelle en POST
// { data: { phone, code, forageKey? } } et reçoit { result } ou { error: { status, message, details } }.
//
// Variables d'environnement Vercel :
//   FIREBASE_SERVICE_ACCOUNT  JSON de la clé de service Firebase (brut ou encodé en base64)
//   FIREBASE_DATABASE_URL     (optionnel) défaut : https://<project_id>-default-rtdb.firebaseio.com
//   ALLOWED_ORIGINS           (optionnel) origines autorisées, séparées par des virgules,
//                             si la PWA n'est pas servie par ce même projet Vercel
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { createAgentLogin, AgentLoginError } from './_lib/agentLogin.js';
import { createRtdbStore } from './_lib/rtdbStore.js';

const HTTP_STATUS = {
    'invalid-argument': 400, 'failed-precondition': 400, unauthenticated: 401,
    'not-found': 404, 'resource-exhausted': 429,
};
const GRPC_STATUS = {
    'invalid-argument': 'INVALID_ARGUMENT', 'failed-precondition': 'FAILED_PRECONDITION',
    unauthenticated: 'UNAUTHENTICATED', 'not-found': 'NOT_FOUND', 'resource-exhausted': 'RESOURCE_EXHAUSTED',
};

function loadServiceAccount() {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    return JSON.parse(text);
}

let handler;
function getHandler() {
    if (handler) return handler;
    const serviceAccount = loadServiceAccount();
    const credential = cert(serviceAccount);
    const databaseURL = process.env.FIREBASE_DATABASE_URL
        || `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`;
    const app = getApps()[0] || initializeApp({ credential, databaseURL });
    handler = createAgentLogin({
        store: createRtdbStore({ db: getDatabase(app), credential, databaseURL }),
        createCustomToken: (uid, claims) => getAuth(app).createCustomToken(uid, claims),
    });
    return handler;
}

function applyCors(req, res) {
    const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const origin = req.headers.origin;
    if (origin && allowed.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
}

export default async function agentLoginRoute(req, res) {
    applyCors(req, res);
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: { status: 'INVALID_ARGUMENT', message: 'POST requis.' } });

    try {
        const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || undefined;
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
        const result = await getHandler()(body?.data, { ip });
        return res.status(200).json({ result });
    } catch (err) {
        if (err instanceof AgentLoginError) {
            return res.status(HTTP_STATUS[err.code] || 400).json({
                error: { status: GRPC_STATUS[err.code] || 'INVALID_ARGUMENT', message: err.message, details: err.details },
            });
        }
        console.error('agent-login: erreur interne', err);
        return res.status(500).json({ error: { status: 'INTERNAL', message: 'Erreur serveur, réessayez plus tard.' } });
    }
}
