// ==================== IMPORTS ====================
import { APP_VERSION, firebaseConfig } from './config.js';
import { state } from './state.js';
import { loadTheme, toggleTheme, closeModal, handleOverlayClick, showToast } from './ui.js';
import { handleOnline, handleOffline, syncPendingWrites } from './sync.js';
import { login, enterApp, confirmLogout, executeLogout } from './auth.js';
import { takePhoto, stopCamera, captureImage, retakePhoto, confirmPhotoAndIndex } from './media.js';
import { openKeypad, keypadInput, validateKeypad, confirmReading, submitReading, editReading, submitEditReading, reportWithPhoto, deleteAnomaly } from './actions.js';
import { setFilter, navigateClient, applyFilters } from './clients.js';
import { showReport, shareReport } from './reports.js';
import { createPwaBanner } from './pwa.js';

// ==================== FIREBASE INIT ====================
firebase.initializeApp(firebaseConfig);
export const db = firebase.database();

// ==================== INITIALISATION DE L'APP ====================
async function initializeApp() {
    console.log(`🚀 Initialisation ASUFOR Diandioly v${APP_VERSION} (Modulaire)`);
    
    loadTheme();
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    if ('serviceWorker' in navigator) {
        try {
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
    
    const savedAgentId = localStorage.getItem('asufor_id');
    if (savedAgentId) {
        state.currentAgentId = savedAgentId;
        enterApp(
            localStorage.getItem('agent_name') || 'Agent',
            localStorage.getItem('agent_zone') || 'Zone'
        );
    }
    
    setInterval(() => {
        if (navigator.onLine) {
            syncPendingWrites();
        }
    }, 60000);
}

window.addEventListener('DOMContentLoaded', initializeApp);

// ==================== EXPORTS GLOBAUX ====================
window.login = login;
window.confirmLogout = confirmLogout;
window.executeLogout = executeLogout;

window.toggleTheme = toggleTheme;
window.closeModal = closeModal;
window.handleOverlayClick = handleOverlayClick;
window.setFilter = setFilter;
window.navigateClient = navigateClient;
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

window.reportWithPhoto = reportWithPhoto;
window.deleteAnomaly = deleteAnomaly;

window.showReport = showReport;
window.shareReport = shareReport;
