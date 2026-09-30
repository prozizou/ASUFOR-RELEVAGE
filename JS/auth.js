// js/auth.js
// Connexion agent : téléphone + code 6 chiffres → Cloud Function agentLogin
// (vérifie agent_tel + passcode_hash côté serveur) → Custom Token portant les
// claims { role: 'agent', forageKey, agentId } → signInWithCustomToken().
// Le client ne lit jamais les fiches agents ni aucun code (clair ou haché).
import { state } from './state.js';
import { showToast, escapeHtml, updateOnlineStatus, openModal, closeModal } from './ui.js';
import { icon } from './icons.js';
import { loadClientsData, detachListener } from './clients.js';
import { syncPendingWrites, refreshSyncIndicator } from './sync.js';
import { createPwaBanner } from './pwa.js';
import { APP_VERSION, AGENT_LOGIN_URL } from './config.js';
import {
    LOGIN_REASONS, AgentAuthError, loginErrorMessage, validateLoginInput, requestAgentToken,
    classifyFirebaseError, createOfflineVerifier, verifyOfflineVerifier,
} from './agentAuth.js';
import { saveSession, loadSession, clearLegacyPasscode, waitForAuthUser, getAgentAuthStatus } from './session.js';

// Identifiants gardés EN MÉMOIRE seulement le temps de choisir un forage
// quand le numéro existe sur plusieurs forages (AMBIGUOUS_FORAGE).
let pendingForageChoice = null;
let reauthShown = false;

function showLoginError(message, tone = 'error') {
    const errorDiv = document.getElementById('login-error');
    if (!errorDiv) return;
    errorDiv.textContent = message || '';
    errorDiv.style.color = tone === 'info' ? 'var(--accent, #F59E0B)' : '#EF4444';
    errorDiv.style.marginTop = '12px';
    errorDiv.style.fontWeight = 'bold';
    errorDiv.style.fontSize = '0.9rem';
}

function setLoginBusy(busy) {
    const btn = document.getElementById('login-btn');
    if (!btn) return;
    btn.disabled = busy;
    btn.textContent = busy ? 'CONNEXION...' : 'ACCÉDER À LA TOURNÉE';
}

// Custom Token → session Firebase Auth (persistée par le SDK, restaurée même
// hors ligne) + session locale (forageKey/agentId, profil, vérificateur hors ligne).
async function signInAgent(result, phone, code) {
    await firebase.auth().signInWithCustomToken(result.token);

    let verifier = null;
    try {
        verifier = await createOfflineVerifier({ phone, code, forageKey: result.forageKey, agentId: result.agentId });
    } catch (e) {
        console.warn('Vérificateur hors ligne indisponible:', e);
    }
    saveSession({ agentId: result.agentId, forageKey: result.forageKey, profile: result.profile, phone, verifier });

    state.currentAgentId = result.agentId;
    state.currentForageKey = result.forageKey;
    enterApp(result.profile?.agent, result.profile?.zone);
}

// Reconnexion sans réseau : uniquement pour l'agent déjà connecté en ligne sur
// cet appareil (vérificateur PBKDF2 local, jamais le code en clair).
async function offlineLogin(phone, code) {
    const session = loadSession();
    const ok = session?.verifier
        && session.phone === phone
        && await verifyOfflineVerifier(session.verifier, { phone, code });
    if (!ok) {
        throw new AgentAuthError(session?.verifier ? LOGIN_REASONS.INVALID_CODE : LOGIN_REASONS.OFFLINE_NO_SESSION);
    }
    state.currentAgentId = session.agentId;
    state.currentForageKey = session.forageKey;
    enterApp(session.name, session.zone);
    showToast('📴 Mode hors ligne - Données locales utilisées', 3000);
}

async function attemptLogin(phone, code, forageKey = null) {
    showLoginError('');
    setLoginBusy(true);
    try {
        if (!navigator.onLine) {
            await offlineLogin(phone, code);
            return;
        }
        const result = await requestAgentToken({ phone, code, forageKey }, { url: AGENT_LOGIN_URL });
        await signInAgent(result, phone, code);
    } catch (err) {
        console.error('Erreur login:', err);
        const reason = classifyFirebaseError(err);

        if (reason === LOGIN_REASONS.AMBIGUOUS_FORAGE && err.details?.forages?.length) {
            showForagePicker(err.details.forages, phone, code);
            return;
        }
        // Réseau instable (navigator.onLine trompeur) : repli sur la session locale.
        if (reason === LOGIN_REASONS.OFFLINE) {
            try {
                await offlineLogin(phone, code);
                return;
            } catch (offlineErr) {
                const offlineReason = classifyFirebaseError(offlineErr);
                showLoginError(loginErrorMessage(
                    offlineReason === LOGIN_REASONS.OFFLINE_NO_SESSION ? LOGIN_REASONS.OFFLINE : offlineReason));
                return;
            }
        }
        showLoginError(loginErrorMessage(reason));
    } finally {
        setLoginBusy(false);
    }
}

export async function login() {
    const { phone, code, error } = validateLoginInput(
        document.getElementById('agent-phone')?.value,
        document.getElementById('agent-code')?.value
    );
    if (error) {
        showLoginError(loginErrorMessage(error));
        return;
    }
    await attemptLogin(phone, code);
}

function showForagePicker(forages, phone, code) {
    pendingForageChoice = { forages, phone, code };
    openModal(`
        <div class="modal-content">
            <h3 class="modal-title">${icon('droplet', { size: 16 })} Choisissez votre forage</h3>
            <p class="modal-subtitle" style="margin-bottom:14px;">${escapeHtml(loginErrorMessage(LOGIN_REASONS.AMBIGUOUS_FORAGE))}</p>
            ${forages.map((f, i) => `
                <button class="btn-modal secondary" style="width:100%; margin-bottom:8px;" onclick="selectLoginForage(${i})">
                    ${escapeHtml(f.siege || f.forageKey)}
                </button>
            `).join('')}
            <div class="modal-actions">
                <button class="btn-modal secondary" onclick="cancelForageChoice()">Annuler</button>
            </div>
        </div>
    `);
}

export async function selectLoginForage(index) {
    const choice = pendingForageChoice;
    pendingForageChoice = null;
    closeModal();
    const forage = choice?.forages?.[index];
    if (!forage) return;
    await attemptLogin(choice.phone, choice.code, forage.forageKey);
}

export function cancelForageChoice() {
    pendingForageChoice = null;
    closeModal();
}

// Session locale présente mais plus de jeton agent valide (ancienne session
// anonyme, jeton révoqué, autre compte) : retour à l'écran de connexion SANS
// effacer la session locale ni la file hors ligne, qui partira après reconnexion.
export function requireReauth(reason = LOGIN_REASONS.SESSION_EXPIRED) {
    if (reauthShown) return;
    reauthShown = true;
    detachListener();
    const session = loadSession();
    document.getElementById('main-section')?.classList.add('hidden');
    document.getElementById('login-section')?.classList.remove('hidden');
    const phoneInput = document.getElementById('agent-phone');
    if (phoneInput && session?.phone) phoneInput.value = session.phone;
    document.getElementById('agent-code')?.focus();
    showLoginError(loginErrorMessage(reason), 'info');
}

// Ancienne version (≤ 13.9) : session anonyme + code en clair dans
// localStorage. On l'échange une seule fois contre un Custom Token, puis le
// code en clair est supprimé.
async function migrateLegacySession(session) {
    if (!session.legacyPasscode || !session.phone) return false;
    try {
        const result = await requestAgentToken(
            { phone: session.phone, code: session.legacyPasscode, forageKey: session.forageKey },
            { url: AGENT_LOGIN_URL });
        await signInAgent(result, session.phone, session.legacyPasscode);
        return true;
    } catch (err) {
        console.warn('Migration de la session agent impossible:', err);
        if (classifyFirebaseError(err) !== LOGIN_REASONS.OFFLINE) clearLegacyPasscode();
        return false;
    }
}

// Au démarrage : reprend la session locale si elle existe.
export async function resumeSession() {
    const session = loadSession();
    if (!session) return;
    state.currentAgentId = session.agentId;
    state.currentForageKey = session.forageKey;

    await waitForAuthUser(firebase.auth());
    const status = await getAgentAuthStatus(firebase.auth(), session);

    if (status === 'ok' || (status === 'unverified' && !navigator.onLine)) {
        clearLegacyPasscode();
        enterApp(session.name, session.zone);
        return;
    }
    if (!navigator.onLine) {
        // Hors ligne sans jeton : la tournée reste utilisable depuis le cache,
        // les relevés vont dans la file ; reconnexion demandée au retour du réseau.
        enterApp(session.name, session.zone);
        showToast('📴 Mode hors ligne - reconnexion nécessaire au retour du réseau', 4000);
        return;
    }
    if (await migrateLegacySession(session)) return;
    requireReauth(LOGIN_REASONS.SESSION_EXPIRED);
}

window.addEventListener('agent-reauth-required', async () => {
    if (!navigator.onLine || !state.currentAgentId || reauthShown) return;
    const session = loadSession();
    if (session && await migrateLegacySession(session)) return;
    requireReauth(LOGIN_REASONS.SESSION_EXPIRED);
});

window.addEventListener('agent-access-denied', async () => {
    const status = await getAgentAuthStatus(firebase.auth(), {
        agentId: state.currentAgentId,
        forageKey: state.currentForageKey,
    });
    if (status === 'missing' || status === 'mismatch') {
        requireReauth(LOGIN_REASONS.SESSION_EXPIRED);
    } else {
        showToast(loginErrorMessage(LOGIN_REASONS.PERMISSION_DENIED), 4000);
    }
});

export function enterApp(name, zone) {
    reauthShown = false;
    closeModal();
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('main-section').classList.remove('hidden');
    document.getElementById('agent-name').textContent = name || 'Agent';
    document.getElementById('agent-zone').textContent = zone || 'Zone';
    document.getElementById('avatar').textContent = (name || 'A').charAt(0).toUpperCase();

    updateOnlineStatus();
    loadClientsData(state.currentAgentId);

    if (navigator.onLine) {
        syncPendingWrites();
    } else {
        // Hors ligne : syncPendingWrites() ne s'exécute pas, on affiche quand
        // même l'état réel de la file d'attente locale.
        refreshSyncIndicator();
    }

    createPwaBanner();
    const siege = localStorage.getItem('agent_siege');
    console.log(`🚀 ASUFOR ${siege || 'Relevage'} v${APP_VERSION} démarrée`);
}

export function confirmLogout() {
    const indicator = document.getElementById('sync-indicator');
    const pendingCount = indicator && indicator.textContent
        ? indicator.textContent.replace(/\D/g, '')
        : '0';

    let warningMessage = 'Voulez-vous vraiment quitter votre session ?';
    if (parseInt(pendingCount) > 0) {
        warningMessage += `\n\n${pendingCount} élément(s) pas encore envoyé(s).`;
    }

    openModal(`
        <div class="modal-content" style="text-align:center;">
            <h3 class="modal-title" style="justify-content:center;">${icon('log-out', { size: 17 })} Déconnexion</h3>
            <p style="color:var(--text-secondary); margin: 10px 0 4px; white-space: pre-line;">
                ${escapeHtml(warningMessage)}
            </p>
            <div class="modal-actions">
                <button class="btn-modal secondary" onclick="closeModal()">Annuler</button>
                <button class="btn-modal neutral-dark" onclick="executeLogout()">
                    Quitter
                </button>
            </div>
        </div>
    `);
}

export function executeLogout() {
    const pwaInstalled = localStorage.getItem('pwa_installed');

    localStorage.clear();

    if (pwaInstalled) localStorage.setItem('pwa_installed', pwaInstalled);

    detachListener();

    firebase.auth().signOut()
        .catch(err => console.warn('Erreur signOut:', err))
        .finally(() => location.reload());
}
