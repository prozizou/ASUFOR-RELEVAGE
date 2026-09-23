// js/history.js — Historique des modifications d'un relevé.
//
// Chaque action métier (relevé initial, correction, signalement, suppression
// de signalement) ajoute une entrée sous `.../compteurs/{id}/history/{clé}`,
// dans le MÊME objet `update()` que l'écriture elle-même (Firebase Realtime
// Database accepte des chemins imbriqués "a/b/c" en clé dans un update()
// unique). Ça garde l'historique cohérent avec le reste : une seule écriture
// atomique, qui transite par la même file d'attente hors ligne que tout le
// reste de l'app (voir offlineDb.js / sync.js) — aucun code de synchro
// supplémentaire à écrire ou maintenir.
import { state } from './state.js';
import { icon } from './icons.js';

function genEntryKey() {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Ajoute une entrée d'historique à un objet de mise à jour Firebase (muté
 * puis retourné). `action` est un identifiant court ('reading', 'edit',
 * 'anomaly', 'anomaly_cleared') ; `details` porte les valeurs utiles à
 * l'affichage (index, motif, commentaire...).
 */
export function withHistory(updateData, action, details = {}) {
    const entryKey = genEntryKey();
    updateData[`history/${entryKey}`] = {
        action,
        at: Date.now(),
        agent_id: state.currentAgentId,
        agent_name: localStorage.getItem('agent_name') || 'Agent',
        ...details
    };
    return updateData;
}

const ACTION_LABELS = {
    reading: (e) => `Relevé initial : ${e.new_index} m³`,
    edit: (e) => `Corrigé : ${e.old_index != null ? e.old_index + ' → ' : ''}${e.new_index} m³`,
    anomaly: (e) => `Anomalie signalée : ${e.reason || 'motif non précisé'}`,
    anomaly_cleared: () => 'Signalement supprimé'
};

const ACTION_ICONS = {
    reading: 'check-circle',
    edit: 'edit',
    anomaly: 'alert-triangle',
    anomaly_cleared: 'trash'
};

function formatDate(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });
}

/**
 * Construit le HTML d'un historique compact (les plus récents d'abord),
 * ou une chaîne vide si aucune entrée. `limit` borne le nombre affiché
 * (l'historique complet reste dans Firebase, seul l'affichage est tronqué).
 */
export function renderHistory(historyObj, limit = 5) {
    if (!historyObj) return '';
    const entries = Object.values(historyObj).sort((a, b) => (b.at || 0) - (a.at || 0));
    if (!entries.length) return '';

    const rows = entries.slice(0, limit).map(e => {
        const label = (ACTION_LABELS[e.action] || (() => e.action))(e);
        const iconName = ACTION_ICONS[e.action] || 'clock';
        const comment = e.comment ? `<div style="opacity:0.75; margin-top:2px;">${escapeForHistory(e.comment)}</div>` : '';
        return `
            <div style="display:flex; gap:8px; padding:8px 0; border-bottom:1px dashed var(--border);">
                <span style="flex:none; color:var(--text-secondary);">${icon(iconName)}</span>
                <div style="flex:1; min-width:0;">
                    <div style="font-size:0.85rem;">${escapeForHistory(label)}</div>
                    <div style="font-size:0.72rem; color:var(--text-secondary); margin-top:2px;">
                        ${escapeForHistory(e.agent_name || 'Agent')} · ${formatDate(e.at)}
                    </div>
                    ${comment}
                </div>
            </div>`;
    }).join('');

    return `
        <div style="margin-top:16px;">
            <label style="color:var(--text-secondary); font-size:0.85rem; display:block; margin-bottom:6px;">
                ${icon('clock')} Historique${entries.length > limit ? ` (${limit} plus récents sur ${entries.length})` : ''}
            </label>
            <div style="background:var(--bg-elevated); border-radius:12px; padding:4px 12px;">${rows}</div>
        </div>`;
}

// Échappement minimal local (évite une dépendance circulaire avec ui.js pour
// un simple utilitaire texte ; même logique que escapeHtml).
function escapeForHistory(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
}
