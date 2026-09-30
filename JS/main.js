// ==================== IMPORTS ====================
import './firebase.js';
import { APP_VERSION } from './config.js';
import { closeModal, handleOverlayClick, showToast } from './ui.js';
import { handleOnline, handleOffline, syncPendingWrites } from './sync.js';
import { login, resumeSession, selectLoginForage, cancelForageChoice, confirmLogout, executeLogout } from './auth.js';
import { takePhoto, stopCamera, captureImage, retakePhoto, confirmPhotoAndIndex } from './media.js';
import { openKeypad, keypadInput, validateKeypad, confirmReading, submitReading, editReading, submitEditReading, reportAnomaly, selectAnomalyMotif, submitAnomalyMotif, deleteAnomaly } from './actions.js';
import { setFilter, applyFilters, renderFilterTabs } from './clients.js';
import { showReport, shareReport } from './reports.js';
import { createPwaBanner } from './pwa.js';

// ==================== FIREBASE INIT ====================
// Voir firebase.js (importé en premier pour initialiser l'app avant les autres modules).

// ==================== INITIALISATION DE L'APP ====================
async function initializeApp() {
    console.log(`🚀 Initialisation ASUFOR Relevage v${APP_VERSION} (Modulaire)`);

    renderFilterTabs();

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if ('serviceWorker' in navigator) {
        try {
            // ✅ './sw.js' est résolu relativement à index.html (racine du projet)
            // sw.js doit donc être à la racine — c'est bien le cas dans ce ZIP corrigé
            const registration = await navigator.serviceWorker.register('./sw.js');
            console.log('✅ Service Worker enregistré', registration.scope);

            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        showToast('🔄 Nouvelle version disponible. Redémarrez l\'application.', 5000);
                    }
                });
            });
        } catch (err) {
            console.error('❌ Erreur Service Worker:', err);
        }
    }

    // Session agent existante : jeton Firebase (Custom Token) restauré par le
    // SDK, sinon mode hors ligne ou demande de reconnexion.
    await resumeSession();

    setInterval(() => {
        if (navigator.onLine) {
            syncPendingWrites();
        }
    }, 60000);
}

window.addEventListener('DOMContentLoaded', initializeApp);

// ==================== EXPORTS GLOBAUX ====================
window.login = login;
window.selectLoginForage = selectLoginForage;
window.cancelForageChoice = cancelForageChoice;
window.confirmLogout = confirmLogout;
window.executeLogout = executeLogout;

window.closeModal = closeModal;
window.handleOverlayClick = handleOverlayClick;
window.setFilter = setFilter;
window.applyFilters = applyFilters;

window.openKeypad = openKeypad;
window.keypadInput = keypadInput;
window.validateKeypad = validateKeypad;
window.confirmReading = confirmReading;
window.submitReading = submitReading;
window.editReading = editReading;
window.submitEditReading = submitEditReading;

window.takePhoto = takePhoto;
window.stopCamera = stopCamera;
window.captureImage = captureImage;
window.retakePhoto = retakePhoto;
window.confirmPhotoAndIndex = confirmPhotoAndIndex;

window.reportAnomaly = reportAnomaly;
window.selectAnomalyMotif = selectAnomalyMotif;
window.submitAnomalyMotif = submitAnomalyMotif;
window.deleteAnomaly = deleteAnomaly;

window.showReport = showReport;
window.shareReport = shareReport;
