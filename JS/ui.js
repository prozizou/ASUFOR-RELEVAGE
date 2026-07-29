// js/ui.js

export function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[m]));
}

export function showToast(msg, duration = 2500) {
    const t = document.getElementById('toast');
    if (!t) return;
    
    t.textContent = msg;
    t.classList.add('show');
    
    // Clear any existing timeout
    if (window.toastTimeout) {
        clearTimeout(window.toastTimeout);
    }
    
    window.toastTimeout = setTimeout(() => {
        t.classList.remove('show');
    }, duration);
}

export function updateOnlineStatus() {
    const dot = document.getElementById('online-dot');
    if (dot) {
        dot.classList.toggle('offline', !navigator.onLine);
    }
    
    // Mettre à jour le titre de la page
    const siege = localStorage.getItem('agent_siege');
    const label = siege ? `ASUFOR ${siege}` : 'ASUFOR';
    document.title = navigator.onLine ? `💧 ${label}` : '📴 ASUFOR (Hors ligne)';
}

export function openModal(html) {
    const container = document.getElementById('modal-container');
    if (container) {
        container.innerHTML = `<div class="modal-overlay" onclick="handleOverlayClick(event)">${html}</div>`;
    }
}

export function closeModal() {
    const container = document.getElementById('modal-container');
    if (container) {
        container.innerHTML = '';
    }
}

export function handleOverlayClick(e) {
    if (e.target.classList.contains('modal-overlay')) {
        closeModal();
    }
}

