import { state } from './state.js';
import { openModal, closeModal, showToast } from './ui.js';
import { APP_VERSION } from './config.js';
import { isDone, computeConso, computeApaid } from './utils.js';
import { icon } from './icons.js';
import { getPendingWrites } from './offlineDb.js';

export async function showReport() {
    if (!state.currentAgentId || !state.clientsCache.length) {
        showToast('Aucune donnée disponible');
        return;
    }

    let total = state.clientsCache.length;
    let done = 0, volume = 0, recette = 0, anomalies = 0, photos = 0;

    for (const { data } of state.clientsCache) {
        if (isDone(data)) {
            done++;
            const conso = Math.max(0, computeConso(data));
            volume += conso;
            recette += computeApaid(conso);
        }
        if (data.audio_url || data.note) anomalies++;
        if (data.photo_url) photos++;
    }

    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const restants = total - done;

    // État de synchronisation : ce qui est encore en attente d'envoi localement.
    let pendingCount = 0;
    try { pendingCount = (await getPendingWrites()).length; } catch (_) { /* ignore */ }
    const syncLine = navigator.onLine
        ? (pendingCount > 0
            ? `<div class="rep-row"><span>${icon('clock')} Synchronisation</span><b style="color:var(--accent);">${pendingCount} en attente</b></div>`
            : `<div class="rep-row"><span>${icon('check-circle')} Synchronisation</span><b style="color:var(--success);">À jour</b></div>`)
        : `<div class="rep-row"><span>${icon('signal-off')} Synchronisation</span><b style="color:var(--danger);">Hors ligne${pendingCount > 0 ? ' — ' + pendingCount + ' en attente' : ''}</b></div>`;

    openModal(`
        <div class="modal-content">
            <h3 class="modal-title">${icon('list')} Rapport de tournée</h3>
            <div style="margin: 16px 0;">
                <div class="rep-row"><span>${icon('check-circle')} Progression</span><b>${pct}% (${done}/${total})</b></div>
                <div class="rep-row"><span>${icon('clock')} Restants</span><b>${restants}</b></div>
                <div class="rep-row"><span>${icon('droplet')} Volume total</span><b>${volume.toFixed(1)} m³</b></div>
                <div class="rep-row"><span>${icon('coin')} Recette totale</span><b style="color:var(--success);">${recette.toLocaleString('fr-FR')} F</b></div>
                <div class="rep-row"><span>${icon('camera')} Photos prises</span><b>${photos}</b></div>
                <div class="rep-row"><span>${icon('alert-triangle')} Anomalies</span><b>${anomalies}</b></div>
                ${syncLine}
            </div>
            <div class="modal-actions">
                <button class="btn-modal secondary" onclick="closeModal()">Fermer</button>
                <button class="btn-modal primary" onclick="shareReport()">${icon('share')} Partager</button>
            </div>
        </div>
    `);
}

export async function shareReport() {
    if (!state.clientsCache.length) return;
    
    let total = state.clientsCache.length;
    let done = 0, volume = 0, recette = 0;
    
    for (const { data } of state.clientsCache) {
        if (isDone(data)) {
            done++;
            const conso = Math.max(0, computeConso(data));
            volume += conso;
            recette += computeApaid(conso);
        }
    }

    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const date = new Date().toLocaleDateString('fr-FR');
    const agent = localStorage.getItem('agent_name') || 'Agent';
    const siege = localStorage.getItem('agent_siege');
    const siteLabel = siege ? `ASUFOR ${siege}` : 'ASUFOR';

    const reportText = `RAPPORT ${siteLabel.toUpperCase()}\nDate : ${date}\nAgent : ${agent}\nZone : ${localStorage.getItem('agent_zone') || 'N/A'}\n\nProgression : ${done}/${total} clients (${pct}%)\nVolume total : ${volume.toFixed(1)} m³\nRecette : ${recette.toLocaleString('fr-FR')} FCFA\n\nGénéré par ${siteLabel} v${APP_VERSION}`;

    if (navigator.share) {
        try {
            await navigator.share({ title: `Rapport ${siteLabel}`, text: reportText });
        } catch (err) {
            if (err.name !== 'AbortError') console.error('Erreur partage:', err);
        }
    } else {
        try {
            await navigator.clipboard.writeText(reportText);
            showToast('Rapport copié dans le presse-papier.');
        } catch (err) {
            showToast('Impossible de copier le rapport');
        }
    }
}
