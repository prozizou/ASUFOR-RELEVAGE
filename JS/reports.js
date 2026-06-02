import { state } from './state.js';
import { openModal, closeModal, showToast } from './ui.js';
import { APP_VERSION } from './config.js';

export function showReport() {
    if (!state.currentAgentId || !state.clientsCache.length) {
        showToast('📭 Aucune donnée disponible');
        return;
    }
    
    let total = state.clientsCache.length;
    let done = 0, volume = 0, recette = 0, anomalies = 0, photos = 0;
    
    for (const { data } of state.clientsCache) {
        if (data.statut === true || data.statut === "true") {
            done++;
            const conso = (Number(data.new_index) || 0) - (Number(data.last_index) || 0);
            volume += Math.max(0, conso);
            recette += Number(data.apaid) || 0;
        }
        if (data.audio_url || data.note) anomalies++;
        if (data.photo_url) photos++;
    }
    
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    
    openModal(`
        <div class="modal-content">
            <h3 class="modal-title">📋 RAPPORT DE TOURNÉE</h3>
            <div style="margin: 16px 0;">
                <div class="rep-row"><span>📊 Progression</span><b>${pct}% (${done}/${total})</b></div>
                <div class="rep-row"><span>💧 Volume total</span><b>${volume.toFixed(1)} m³</b></div>
                <div class="rep-row"><span>💰 Recette totale</span><b style="color:var(--success);">${recette.toLocaleString('fr-FR')} F</b></div>
                <div class="rep-row"><span>📷 Photos prises</span><b>${photos}</b></div>
                <div class="rep-row"><span>⚠️ Anomalies</span><b>${anomalies}</b></div>
            </div>
            <div class="modal-actions">
                <button class="btn-modal secondary" onclick="closeModal()">Fermer</button>
                <button class="btn-modal primary" style="background:var(--blue); color:white;" onclick="shareReport()">📤 Partager</button>
            </div>
        </div>
    `);
}

export async function shareReport() {
    if (!state.clientsCache.length) return;
    
    let total = state.clientsCache.length;
    let done = 0, volume = 0, recette = 0;
    
    for (const { data } of state.clientsCache) {
        if (data.statut === true || data.statut === "true") {
            done++;
            const conso = (Number(data.new_index) || 0) - (Number(data.last_index) || 0);
            volume += Math.max(0, conso);
            recette += Number(data.apaid) || 0;
        }
    }
    
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const date = new Date().toLocaleDateString('fr-FR');
    const agent = localStorage.getItem('agent_name') || 'Agent';
    
    const reportText = `📋 RAPPORT ASUFOR DIANDIOLY\n📅 ${date}\n👤 Agent: ${agent}\n📍 Zone: ${localStorage.getItem('agent_zone') || 'N/A'}\n\n📊 Progression: ${done}/${total} clients (${pct}%)\n💧 Volume total: ${volume.toFixed(1)} m³\n💰 Recette: ${recette.toLocaleString('fr-FR')} FCFA\n\n🤖 Généré par ASUFOR Diandioly v${APP_VERSION}`;

    if (navigator.share) {
        try {
            await navigator.share({ title: 'Rapport ASUFOR Diandioly', text: reportText });
        } catch (err) {
            if (err.name !== 'AbortError') console.error('Erreur partage:', err);
        }
    } else {
        try {
            await navigator.clipboard.writeText(reportText);
            showToast('📋 Rapport copié dans le presse-papier !');
        } catch (err) {
            showToast('❌ Impossible de copier le rapport');
        }
    }
}
