// Route Vercel api/agent-login.js : statuts HTTP, enveloppe { result } / { error }, CORS.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const login = vi.hoisted(() => ({ impl: null }));
vi.mock('../api/_lib/agentLogin.js', async (orig) => ({
    ...(await orig()), createAgentLogin: () => (...args) => login.impl(...args),
}));
vi.mock('../api/_lib/rtdbStore.js', () => ({ createRtdbStore: () => ({}) }));
vi.mock('firebase-admin/app', () => ({ cert: () => ({}), getApps: () => [{}], initializeApp: () => ({}) }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({}) }));
vi.mock('firebase-admin/database', () => ({ getDatabase: () => ({}) }));

process.env.FIREBASE_SERVICE_ACCOUNT = Buffer.from(JSON.stringify({ project_id: 'demo' })).toString('base64');
process.env.ALLOWED_ORIGINS = 'https://pwa.example';
const { default: route } = await import('../api/agent-login.js');
const { AgentLoginError, REASONS } = await import('../api/_lib/agentLogin.js');

function call(req) {
    const res = { headers: {}, statusCode: 200, body: null,
        setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; }, end() { return this; } };
    return route({ method: 'POST', headers: {}, body: { data: { phone: '771111111', code: '123456' } }, ...req }, res).then(() => res);
}

let lastArgs;
beforeEach(() => { login.impl = null; lastArgs = null; });
const willResolve = value => { login.impl = async (...a) => { lastArgs = a; return value; }; };
const willThrow = err => { login.impl = async (...a) => { lastArgs = a; throw err; }; };

describe('api/agent-login', () => {
    it('succès : 200 + { result }, IP transmise, jamais de cache', async () => {
        willResolve({ token: 't', forageKey: 'Asufor_a', agentId: 'A1', profile: {} });
        const res = await call({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } });
        expect(res.statusCode).toBe(200);
        expect(res.body.result.token).toBe('t');
        expect(lastArgs).toEqual([{ phone: '771111111', code: '123456' }, { ip: '1.2.3.4' }]);
        expect(res.headers['Cache-Control']).toBe('no-store');
    });

    it.each([
        ['unauthenticated', REASONS.INVALID_CODE, 401, 'UNAUTHENTICATED'],
        ['not-found', REASONS.AGENT_NOT_FOUND, 404, 'NOT_FOUND'],
        ['resource-exhausted', REASONS.TOO_MANY_ATTEMPTS, 429, 'RESOURCE_EXHAUSTED'],
        ['invalid-argument', REASONS.INVALID_FORMAT, 400, 'INVALID_ARGUMENT'],
    ])('erreur %s (%s) → HTTP statut %d', async (code, reason, http, status) => {
        willThrow(new AgentLoginError(code, reason, 'msg', { forages: [1] }));
        const res = await call({});
        expect(res.statusCode).toBe(http);
        expect(res.body.error).toMatchObject({ status, details: { reason, forages: [1] } });
    });

    it('erreur inattendue : 500 sans fuite de détail', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        willThrow(new Error('secret db url'));
        const res = await call({});
        expect(res.statusCode).toBe(500);
        expect(JSON.stringify(res.body)).not.toContain('secret');
    });

    it('refuse GET ; CORS limité aux origines déclarées', async () => {
        expect((await call({ method: 'GET' })).statusCode).toBe(405);
        const ok = await call({ method: 'OPTIONS', headers: { origin: 'https://pwa.example' } });
        expect(ok.statusCode).toBe(204);
        expect(ok.headers['Access-Control-Allow-Origin']).toBe('https://pwa.example');
        const ko = await call({ method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
        expect(ko.headers['Access-Control-Allow-Origin']).toBeUndefined();
    });
});
