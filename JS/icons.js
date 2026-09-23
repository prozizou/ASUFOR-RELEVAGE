// js/icons.js — Bibliothèque d'icônes SVG unique de l'application.
//
// Remplace les emojis par un jeu d'icônes cohérent, rendu identique sur tous
// les appareils (Android/iPhone/tablette/PC), sans requête réseau (fonctionne
// hors ligne comme le reste de l'app). Chaque icône hérite de la couleur du
// texte via `currentColor`.
//
// Usage : `icon('check-circle')` retourne une chaîne SVG à insérer dans un
// template littéral, ex. `` `${icon('droplet')} ${conso} m³` ``.

const PATHS = {
    'droplet':        '<path d="M12 2.5S5.5 9.5 5.5 14a6.5 6.5 0 0 0 13 0C18.5 9.5 12 2.5 12 2.5zm0 15a3.5 3.5 0 0 1-3.5-3.5 1 1 0 0 1 2 0A1.5 1.5 0 0 0 12 15.5a1 1 0 0 1 0 2z"/>',
    'list':           '<path d="M4 6h2v2H4zm0 5h2v2H4zm0 5h2v2H4zM8 6h12v2H8zm0 5h12v2H8zm0 5h12v2H8z"/>',
    'clock':          '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 10.41 3.29 3.3-1.42 1.41L11 13.24V7h2z"/>',
    'check':          '<path d="M9 16.17 4.83 12 3.41 13.41 9 19 21 7l-1.41-1.42z"/>',
    'check-circle':   '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8z"/>',
    'alert-triangle': '<path d="M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z"/>',
    'alert-circle':   '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2zm0-4h-2V7h2z"/>',
    'search':         '<path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 5L20.49 19zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/>',
    'gauge':          '<path d="M12 4a8 8 0 0 0-6.34 12.88h12.68A8 8 0 0 0 12 4zm0 3a1 1 0 0 1 1 1v.5a1 1 0 0 1-2 0V8a1 1 0 0 1 1-1zM6.5 12a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm11 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm-3.09-3.09-1.8 1.8a1.5 1.5 0 1 0 1.06 1.06l1.8-1.8a.5.5 0 0 0-.7-.7z"/>',
    'coin':           '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15.93V19h-2v-1.07a3.5 3.5 0 0 1-2.83-2.57l1.9-.55A1.5 1.5 0 0 0 11.5 16h1a1 1 0 0 0 0-2h-1a3 3 0 0 1 0-6V7h2v1.07a3.5 3.5 0 0 1 2.45 2.02l-1.83.72A1.5 1.5 0 0 0 12.5 10h-1a1 1 0 0 0 0 2h1a3 3 0 0 1 .5 5.93z"/>',
    'camera':         '<path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2 7.17 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3.17L15 2zm3 15a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"/>',
    'edit':           '<path d="M3 17.25V21h3.75l11.06-11.06-3.75-3.75zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z"/>',
    'refresh':        '<path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10H17.6A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z"/>',
    'trash':          '<path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/>',
    'share':          '<path d="M18 16.08a2.9 2.9 0 0 0-1.94.75l-7.05-4.11c.05-.23.09-.47.09-.72s-.04-.49-.09-.72l6.97-4.06c.56.51 1.29.83 2.02.83a2.99 2.99 0 1 0-3-3c0 .25.04.49.09.72L8.11 9.83A2.99 2.99 0 1 0 6 14.99c.73 0 1.46-.32 2.02-.83l7.05 4.12c-.05.21-.07.43-.07.65a2.92 2.92 0 1 0 2.92-2.85z"/>',
    'close':          '<path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>',
    'signal-off':     '<path d="M2.28 3 1 4.27 6 9.27V17a2 2 0 0 0 2 2h7.73l3 3L21 20.72zM12 4a8 8 0 0 1 8 8 8 8 0 0 1-1.06 3.98l-1.47-1.47A6 6 0 0 0 12 6c-.6 0-1.18.09-1.73.25L8.8 4.78A8 8 0 0 1 12 4z"/>',
    'inbox':          '<path d="M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 12h-4a2 2 0 0 1-4 0H5V6h14z"/>',
    'smartphone':     '<path d="M16 2H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-4 19a1.25 1.25 0 1 1 0-2.5A1.25 1.25 0 0 1 12 21zm4-4H8V4h8z"/>',
    'send':           '<path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/>',
    'door-exit':      '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4v2H5v14h4zm7.59-4.59L14.17 14H21v-2h-6.83l2.42-2.41L15.17 8 10 13l5.17 5z"/>',
    'backspace':      '<path d="M22 3H7c-.69 0-1.23.35-1.59.88L0 12l5.41 8.11c.36.53.9.89 1.59.89h15a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-4.59 12.59L16 17l-3-3-3 3-1.41-1.41L11.59 12 8.59 9 10 7.59l3 3 3-3L17.41 9 14.41 12z"/>'
};

/**
 * Retourne le SVG (chaîne) pour l'icône nommée. `opts.size` (défaut 1em, donc
 * proportionnel au texte) et `opts.cls` (classe CSS additionnelle).
 */
export function icon(name, opts = {}) {
    const d = PATHS[name];
    if (!d) return '';
    const size = opts.size || '1em';
    const cls = opts.cls ? ' ' + opts.cls : '';
    return `<svg class="ic${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true" focusable="false">${d}</svg>`;
}

/**
 * Hydrate les éléments statiques marqués `data-ic="nom"` : préfixe leur
 * contenu texte par l'icône SVG correspondante. Évite de dupliquer l'appel
 * `icon()` dans chaque bouton du HTML — un seul passage au chargement.
 */
export function hydrateIcons(root = document) {
    root.querySelectorAll('[data-ic]').forEach((el) => {
        if (el.dataset.icDone) return;
        const svg = icon(el.getAttribute('data-ic'));
        if (!svg) return;
        el.innerHTML = svg + ' ' + el.innerHTML;
        el.dataset.icDone = '1';
    });
}
