// js/auth.js
import { state } from './state.js';
import { showToast, escapeHtml, updateOnlineStatus, openModal, closeModal } from './ui.js';
import { loadClientsData, detachListener } from './clients.js';
import { syncPendingWrites } from './sync.js';
import { createPwaBanner } from './pwa.js';
import { APP_VERSION, firebaseConfig } from './config.js';

const FORAGES_ROOT = 'Asufor';

// Récupère la liste des sites (forageKey) sans télécharger leurs données
// (compteurs/backup), via un appel REST "shallow" à la Realtime Database.
async function fetchForageKeys() {
    try {
        const token = await firebase.auth().currentUser.getIdToken();
        const url = `${firebaseConfig.databaseURL}/${FORAGES_ROOT}.json?shallow=true&auth=${token}`;
        const res = await fetch(url);
        const json = await res.json();
        return Object.keys(json || {});
    } catch (e) {
        console.warn('Repli sur lecture complète des sites:', e);
        const snapshot = await firebase.database().ref(FORAGES_ROOT).once('value');
        return snapshot.exists() ? Object.keys(snapshot.val()) : [];
    }
}

function normalizePhone(value) {
    return String(value || '').replace(/\D/g, '').replace(/^221/, '');
}

// Cherche, sur tous les sites en parallèle, l'agent dont le code ET le
// numéro de téléphone correspondent. Le numéro sert à lever l'ambiguïté
// quand deux agents (souvent de sites différents) partagent le même code.
async function findAgentByPasscode(code, phone) {
    const forageKeys = await fetchForageKeys();
    const db = firebase.database();

    const results = await Promise.all(forageKeys.map(async (forageKey) => {
        try {
            const snapshot = await db.ref(`${FORAGES_ROOT}/${forageKey}/agents`)
                .orderByChild('passcode')
                .equalTo(code)
                .once('value');
            if (!snapshot.exists()) return null;

            let match = null;
            snapshot.forEach(child => {
                const agentData = child.val();
                if (normalizePhone(agentData.agent_tel) === phone) {
                    match = { forageKey, agentId: child.key, agentData };
                }
            });
            return match;
        } catch (e) {
            console.warn(`Erreur recherche agent sur le site ${forageKey}:`, e);
            return null;
        }
    }));

    return results.find(Boolean) || null;
}

export async function login() {
    const codeInput = document.getElementById('agent-code');
    const phoneInput = document.getElementById('agent-phone');
    const errorDiv = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');
    const code = codeInput.value.trim();
    const phone = normalizePhone(phoneInput.value);

    if (errorDiv) {
        errorDiv.textContent = '';
        errorDiv.style.color = '#EF4444';
        errorDiv.style.marginTop = '12px';
        errorDiv.style.fontWeight = 'bold';
        errorDiv.style.fontSize = '0.9rem';
    }

    if (phone.length < 9) {
        errorDiv.textContent = '⚠️ Numéro de téléphone invalide';
        return;
    }

    if (code.length !== 6) {
        errorDiv.textContent = '⚠️ Le code doit contenir 6 chiffres';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'CONNEXION...';

    try {
        if (navigator.onLine) {
            // ✅ CORRECTION : Connexion anonyme Firebase AVANT toute requête
            // Sans ça, auth == null et Firebase refuse l'accès (permission_denied)
            await firebase.auth().signInAnonymously();

            const match = await findAgentByPasscode(code, phone);

            if (match) {
                const { agentId, agentData } = match;

                localStorage.setItem('asufor_id', agentId);
                localStorage.setItem('agent_name', agentData.agent || 'Agent');
                localStorage.setItem('agent_zone', agentData.zone || 'Zone');
                localStorage.setItem('agent_siege', agentData.siege || '');
                localStorage.setItem('agent_passcode', code);
                localStorage.setItem('agent_phone', phone);
                localStorage.setItem('asufor_forage_key', match.forageKey);

                state.currentAgentId = agentId;
                state.currentForageKey = match.forageKey;
                enterApp(agentData.agent, agentData.zone);
                return;
            }

            // Code et/ou téléphone inconnus en ligne
            errorDiv.textContent = '❌ Code agent ou numéro de téléphone invalide';
            return;
        }

        // ---- Mode hors ligne : vérification locale ----
        const storedPass = localStorage.getItem('agent_passcode');
        const storedPhone = localStorage.getItem('agent_phone');
        const storedForageKey = localStorage.getItem('asufor_forage_key');
        if (storedPass === code && storedPhone === phone && storedForageKey) {
            state.currentAgentId = localStorage.getItem('asufor_id');
            state.currentForageKey = storedForageKey;
            enterApp(localStorage.getItem('agent_name'), localStorage.getItem('agent_zone'));
            showToast('📴 Mode hors ligne - Données locales utilisées', 3000);
            return;
        }

        errorDiv.textContent = '❌ Code agent ou numéro de téléphone invalide';

    } catch (err) {
        console.error('Erreur login:', err);

        // Fallback hors ligne si Firebase échoue mais le code/téléphone est connu localement
        const storedPass = localStorage.getItem('agent_passcode');
        const storedPhone = localStorage.getItem('agent_phone');
        const storedForageKey = localStorage.getItem('asufor_forage_key');
        if (storedPass === code && storedPhone === phone && storedForageKey) {
            try {
                state.currentAgentId = localStorage.getItem('asufor_id');
                state.currentForageKey = storedForageKey;
                enterApp(localStorage.getItem('agent_name'), localStorage.getItem('agent_zone'));
                showToast('📴 Mode hors ligne', 3000);
            } catch (e) {
                errorDiv.textContent = "⚠️ Erreur de chargement de l'interface : " + e.message;
            }
        } else {
            errorDiv.textContent = '📡 Erreur Firebase : ' + err.message;
        }
    } finally {
        btn.disabled = false;
        btn.textContent = 'ACCÉDER À LA TOURNÉE';
    }
}

export function enterApp(name, zone) {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('main-section').classList.remove('hidden');
    document.getElementById('agent-name').textContent = name || 'Agent';
    document.getElementById('agent-zone').textContent = zone || 'Zone';
    document.getElementById('avatar').textContent = (name || 'A').charAt(0).toUpperCase();

    updateOnlineStatus();
    loadClientsData(state.currentAgentId);

    if (navigator.onLine) {
        syncPendingWrites();
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
        warningMessage += `\n\n⚠️ ${pendingCount} élément(s) pas encore envoyé(s).`;
    }

    openModal(`
        <div class="modal-content" style="text-align:center;">
            <div style="font-size: 3rem; margin-bottom: 10px;">🚪</div>
            <h3 class="modal-title">Déconnexion</h3>
            <p style="color:var(--text-secondary); margin-bottom: 20px; white-space: pre-line;">
                ${escapeHtml(warningMessage)}
            </p>
            <div class="modal-actions">
                <button class="btn-modal secondary" onclick="closeModal()">Annuler</button>
                <button class="btn-modal primary" style="background:var(--danger); color:white;" onclick="executeLogout()">
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

    // ✅ CORRECTION : Déconnexion Firebase Auth à la sortie
    firebase.auth().signOut().catch(err => console.warn('Erreur signOut:', err));

    location.reload();
}
