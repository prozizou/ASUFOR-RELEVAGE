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
    document.title = navigator.onLine ? '💧 ASUFOR Diandioly' : '📴 ASUFOR (Hors ligne)';
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

export function toggleTheme() {
    const isLight = document.body.classList.toggle('light-mode');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
}

export function loadTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.body.classList.add('light-mode');
    } else if (!savedTheme) {
        // Par défaut, utiliser la préférence système
        if (window.matchMedia('(prefers-color-scheme: light)').matches) {
            document.body.classList.add('light-mode');
        }
    }
}
