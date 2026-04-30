import { state } from './state.js';
import { APP_VERSION } from './config.js';
import { showToast } from './ui.js';

export function isAppInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches || 
           window.navigator.standalone === true ||
           localStorage.getItem('pwa_installed') === 'true';
}

export function createPwaBanner() {
    if (isAppInstalled() || state.pwaBanner) return;

    state.pwaBanner = document.createElement('div');
    state.pwaBanner.id = 'pwa-install-banner';
    state.pwaBanner.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 15px;">
            <div style="display: flex; align-items: center; gap: 10px;">
                <div style="background: #38bdf8; width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px;">💧</div>
                <div>
                    <strong style="display: block; font-size: 14px; color: white;">ASUFOR App v${APP_VERSION}</strong>
                    <span style="font-size: 11px; opacity: 0.7; color: white;">Installer pour accès hors ligne</span>
                </div>
            </div>
            <div style="display: flex; gap: 10px; align-items: center;">
                <button id="pwa-install-btn" style="background: #38bdf8; color: #1a1e21; border: none; padding: 8px 15px; border-radius: 20px; font-weight: bold; cursor: pointer; font-size: 12px;">Installer</button>
                <button id="pwa-close-btn" style="background: transparent; border: none; color: white; opacity: 0.5; font-size: 16px; cursor: pointer;">✕</button>
            </div>
        </div>
    `;

    Object.assign(state.pwaBanner.style, {
        position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%)',
        width: '90%', maxWidth: '400px', background: 'rgba(25, 30, 36, 0.95)',
        backdropFilter: 'blur(10px)', border: '1px solid rgba(255, 255, 255, 0.2)',
        borderRadius: '16px', padding: '15px', zIndex: '9999', display: 'none',
        boxShadow: '0 10px 25px rgba(0,0,0,0.5)', fontFamily: 'system-ui, sans-serif'
    });

    document.body.appendChild(state.pwaBanner);

    document.getElementById('pwa-install-btn').addEventListener('click', async () => {
        if (state.deferredPrompt) {
            state.deferredPrompt.prompt();
            const { outcome } = await state.deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                localStorage.setItem('pwa_installed', 'true');
                state.pwaBanner.style.display = 'none';
                showToast('✅ Application installée !');
            }
            state.deferredPrompt = null;
        } else {
            showToast('📱 Appuyez sur "Partager" puis "Sur l\'écran d\'accueil"', 5000);
        }
    });

    document.getElementById('pwa-close-btn').addEventListener('click', () => {
        state.pwaBanner.style.display = 'none';
        sessionStorage.setItem('pwa_banner_closed', 'true');
    });

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        state.deferredPrompt = e;
        if (!isAppInstalled() && state.pwaBanner && !sessionStorage.getItem('pwa_banner_closed')) {
            state.pwaBanner.style.display = 'block';
        }
    });

    window.addEventListener('appinstalled', () => {
        if (state.pwaBanner) state.pwaBanner.style.display = 'none';
        state.deferredPrompt = null;
        localStorage.setItem('pwa_installed', 'true');
        showToast("✅ Application installée avec succès !");
    });
}
