import { state } from './state.js';
import { showToast, escapeHtml, updateOnlineStatus, openModal, closeModal } from './ui.js';
import { loadClientsData, detachListener } from './clients.js';
import { syncPendingWrites } from './sync.js';
import { createPwaBanner } from './pwa.js';
import { APP_VERSION } from './config.js';

export async function login() {
    const codeInput = document.getElementById('agent-code');
    const errorDiv = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');
    const code = codeInput.value.trim();

    // Force le style de l'erreur pour s'assurer qu'elle soit visible
    if (errorDiv) {
        errorDiv.textContent = '';
        errorDiv.style.color = '#EF4444';
        errorDiv.style.marginTop = '12px';
        errorDiv.style.fontWeight = 'bold';
        errorDiv.style.fontSize = '0.9rem';
    }

    if (code.length !== 6) {
        errorDiv.textContent = '⚠️ Le code doit contenir 6 chiffres';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'CONNEXION...';

    try {
        // Récupération directe pour éviter le bug de dépendance circulaire
        const db = firebase.database();

        if (navigator.onLine) {
            const snapshot = await db.ref('db_agents').orderByChild('passcode').equalTo(code).once('value');

            if (snapshot.exists()) {
                let agentData = null;
                let agentRealId = null;
                snapshot.forEach(child => {
                    agentRealId = child.key;
                    agentData = child.val();
                });

                localStorage.setItem('asufor_id', agentRealId);
                localStorage.setItem('agent_name', agentData.agent || 'Agent');
                localStorage.setItem('agent_zone', agentData.zone || 'Zone');
                localStorage.setItem('agent_passcode', code);

                state.currentAgentId = agentRealId;
                enterApp(agentData.agent, agentData.zone);
                return;
            }
        }

        const storedPass = localStorage.getItem('agent_passcode');
        if (storedPass === code) {
            state.currentAgentId = localStorage.getItem('asufor_id');
            enterApp(localStorage.getItem('agent_name'), localStorage.getItem('agent_zone'));
            showToast('📴 Mode hors ligne - Données locales utilisées', 3000);
            return;
        }

        errorDiv.textContent = '❌ Code agent invalide';

    } catch (err) {
        console.error('Erreur login:', err);
        const storedPass = localStorage.getItem('agent_passcode');
        
        if (storedPass === code) {
            try {
                state.currentAgentId = localStorage.getItem('asufor_id');
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
    console.log(`🚀 ASUFOR Diandioly v${APP_VERSION} démarrée`);
}

export function confirmLogout() {
    const indicator = document.getElementById('sync-indicator');
    const pendingCount = indicator && indicator.textContent ? indicator.textContent.replace(/\D/g, '') : '0';
    
    let warningMessage = 'Voulez-vous vraiment quitter votre session ?';
    if (parseInt(pendingCount) > 0) {
        warningMessage += `\n\n⚠️ ${pendingCount} opération(s) en attente de synchronisation.`;
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
    const theme = localStorage.getItem('theme');
    const pwaInstalled = localStorage.getItem('pwa_installed');
    
    localStorage.clear();
    
    if (theme) localStorage.setItem('theme', theme);
    if (pwaInstalled) localStorage.setItem('pwa_installed', pwaInstalled);
    
    detachListener();
    location.reload();
}
