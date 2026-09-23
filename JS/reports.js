import { state } from './state.js';
import { openModal, showToast, escapeHtml } from './ui.js';
import { icon } from './icons.js';
import { APP_VERSION } from './config.js';
import { isDone, hasAnomaly, computeConso, computeApaid } from './utils.js';
import { getSyncMetadata, getPendingWrites } from './offlineDb.js';

function computeTourStats() {
    const total = state.clientsCache.length;
    let done = 0, volume = 0, recette = 0, anomalies = 0;

    for (const { data } of state.clientsCache) {
        if (isDone(data)) {
            done++;
            const conso = Math.max(0, computeConso(data));
            volume += conso;
            recette += computeApaid(conso);
        }
        if (hasAnomaly(data)) anomalies++;
    }

    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, remaining: total - done, volume, recette, anomalies, pct };
}

export async function showReport() {
    if (!state.currentAgentId || !state.clientsCache.length) {
        showToast('📭 Aucune donnée disponible');
        return;
    }

    const { total, done, remaining, volume, recette, anomalies, pct } = computeTourStats();

    const zone = localStorage.getItem('agent_zone') || 'Zone';
    const agent = localStorage.getItem('agent_name') || 'Agent';
    const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

    const [lastSync, pending] = await Promise.all([getSyncMetadata('lastSync'), getPendingWrites()]);
    const pendingCount = pending.length;
    let syncRowClass = 'ok';
    let syncLabel;
    if (pendingCount > 0) {
        syncRowClass = 'pending';
        syncLabel = `${icon('clock', { size: 13 })} <b>${pendingCount}</b> élément(s) en attente d'envoi`;
    } else if (lastSync) {
        const syncTime = new Date(lastSync).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        syncLabel = `${icon('check-circle', { size: 13 })} Synchronisé à ${syncTime}`;
    } else {
        syncLabel = `${icon('wifi-off', { size: 13 })} Aucune synchronisation effectuée`;
    }

    openModal(`
        <div class="modal-content">
            <h3 class="modal-title">${icon('file-text', { size: 17 })} Rapport de tournée</h3>
            <p class="modal-subtitle">${escapeHtml(zone)} · ${escapeHtml(agent)} · ${date}</p>

            <div class="rep-row emphasis">
                <span class="rep-label">${icon('check-circle', { size: 15 })} Progression</span>
                <b>${done}/${total} · ${pct}%</b>
            </div>
            <div class="rep-row">
                <span class="rep-label">${icon('clock', { size: 15 })} Compteurs restants</span>
                <b>${remaining}</b>
            </div>
            <div class="rep-row">
                <span class="rep-label">${icon('droplet', { size: 15 })} Volume consommé</span>
                <b>${volume.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m³</b>
            </div>
            <div class="rep-row">
                <span class="rep-label">${icon('banknote', { size: 15 })} Montant facturé</span>
                <b style="color:var(--success);">${recette.toLocaleString('fr-FR')} F</b>
            </div>
            <div class="rep-row">
                <span class="rep-label">${icon('alert-triangle', { size: 15 })} Anomalies</span>
                <b${anomalies > 0 ? ' style="color:var(--danger);"' : ''}>${anomalies}</b>
            </div>

            <div class="rep-row sync-row ${syncRowClass}">
                <span class="rep-label">${syncLabel}</span>
            </div>

            <div class="modal-actions">
                <button class="btn-modal secondary" onclick="closeModal()">Fermer</button>
                <button class="btn-modal primary" onclick="shareReport()">${icon('share', { size: 15 })} Partager</button>
            </div>
        </div>
    `);
}

export async function shareReport() {
    if (!state.clientsCache.length) return;

    const { total, done, remaining, volume, recette, anomalies, pct } = computeTourStats();

    const date = new Date().toLocaleDateString('fr-FR');
    const agent = localStorage.getItem('agent_name') || 'Agent';
    const siege = localStorage.getItem('agent_siege');
    const siteLabel = siege ? `ASUFOR ${siege}` : 'ASUFOR';

    const reportText = `RAPPORT ${siteLabel.toUpperCase()}\nDate : ${date}\nAgent : ${agent}\nZone : ${localStorage.getItem('agent_zone') || 'N/A'}\n\nProgression : ${done}/${total} clients (${pct}%)\nRestants : ${remaining}\nVolume : ${volume.toFixed(1)} m³\nMontant facturé : ${recette.toLocaleString('fr-FR')} FCFA\nAnomalies : ${anomalies}\n\nGénéré par ${siteLabel} v${APP_VERSION}`;

    if (navigator.share) {
        try {
            await navigator.share({ title: `Rapport ${siteLabel}`, text: reportText });
        } catch (err) {
            if (err.name !== 'AbortError') console.error('Erreur partage:', err);
        }
    } else {
        try {
            await navigator.clipboard.writeText(reportText);
            showToast('Rapport copié dans le presse-papier', 2500);
        } catch (err) {
            showToast('❌ Impossible de copier le rapport');
        }
    }
}
