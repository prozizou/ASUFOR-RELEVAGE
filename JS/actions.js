// js/actions.js
import { db } from './main.js';
import { state, compteurPath } from './state.js';
import { showToast, openModal, closeModal, escapeHtml } from './ui.js';
import { icon } from './icons.js';
import { addPendingWrite } from './offlineDb.js';
import { syncPendingWrites } from './sync.js';
import { VERY_HIGH_CONSO_THRESHOLD } from './config.js';
import { takePhoto } from './media.js';
import { computeConso, computeApaid, isIndexDoubled } from './utils.js';

export function openKeypad(key, last) {
    openModal(`
        <div class="modal-content keypad-modal">
            <div class="keypad-display">
                <span class="keypad-value" id="key-val">—</span>
                <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:8px;">
                    Dernier index : ${last} m³
                </div>
            </div>
            <div class="keypad-grid">
                ${[1,2,3,4,5,6,7,8,9,'.',0,'⌫'].map(k =>
                    `<button class="keypad-btn" onclick="keypadInput('${k}')">${k}</button>`
                ).join('')}
            </div>
            <div class="modal-actions">
                <button class="btn-modal secondary" onclick="closeModal()">Annuler</button>
                <button class="btn-modal primary" onclick="validateKeypad('${key}', ${last})">Valider</button>
            </div>
        </div>
    `);
}

export function keypadInput(k) {
    const display = document.getElementById('key-val');
    let current = display.textContent === '—' ? '' : display.textContent;

    if (k === '⌫') {
        current = current.slice(0, -1);
    } else if (k === '.' && current.includes('.')) {
        return;
    } else {
        current += k;
    }

    display.textContent = current || '—';
}

export function validateKeypad(key, last) {
    const value = parseFloat(document.getElementById('key-val').textContent);

    if (isNaN(value)) {
        showToast('⚠️ Veuillez saisir un nombre valide');
        return;
    }

    if (value <= last) {
        showToast(`⚠️ L'index doit être supérieur à ${last} m³`);
        return;
    }

    closeModal();

    const indexSpan = document.getElementById(`indexValue_${key}`);
    const btnOk = document.getElementById(`btn_ok_${key}`);
    const indexBox = document.getElementById(`indexBox_${key}`);

    if (indexSpan && btnOk) {
        indexSpan.textContent = value;
        btnOk.disabled = false;
        if (indexBox) indexBox.classList.add('filled');
    }
}

export async function confirmReading(key) {
    const indexSpan = document.getElementById(`indexValue_${key}`);
    const val = parseFloat(indexSpan.textContent);
    
    const item = state.clientsCache.find(c => c.key === key);
    if (!item) return;
    
    const conso = computeConso({ new_index: val, last_index: item.data.last_index });
    const apaid = computeApaid(conso);

    const consoWarning = conso > VERY_HIGH_CONSO_THRESHOLD ?
        `<div class="anomaly-badge" style="margin-top:12px;">${icon('alert-triangle', { size: 13 })} Consommation anormalement élevée</div>` : '';

    const doubleWarning = isIndexDoubled(val, item.data.last_index) ? `
        <div class="anomaly-badge" style="display:flex; margin-bottom:14px;">
            ${icon('alert-triangle', { size: 14 })}
            <span>Ce chiffre (${val} m³) est au moins le double de l'ancien index (${item.data.last_index} m³). Vérifiez bien le compteur avant de valider.</span>
        </div>
    ` : '';

    openModal(`
        <div class="modal-content">
            <h3 class="modal-title">Confirmer le relevé</h3>
            <p class="modal-subtitle" style="margin-bottom:14px;">${escapeHtml(item.data.name)}</p>
            ${doubleWarning}
            <div class="rep-row"><span class="rep-label">Nouvel index</span><b>${val} m³</b></div>
            <div class="rep-row"><span class="rep-label">Consommation</span><b>${conso.toFixed(1)} m³</b></div>
            <div class="rep-row"><span class="rep-label">Montant à payer</span><b style="color:var(--success);">${apaid.toLocaleString('fr-FR')} F</b></div>
            ${consoWarning}
            <div class="modal-actions">
                <button class="btn-modal secondary" onclick="closeModal()">Annuler</button>
                <button class="btn-modal primary" onclick="submitReading('${key}', ${val}, ${apaid})">Confirmer</button>
            </div>
        </div>
    `);
}

export async function submitReading(key, val, apaid) {
    closeModal();
    showToast('⏳ Enregistrement...');
    
    const updateData = {
        new_index: val,
        apaid: apaid,
        statut: true,
        releve_date: Date.now(),
        last_modified: Date.now()
    };
    
    try {
        if (navigator.onLine) {
            await db.ref(compteurPath(key)).update(updateData);
            showToast('✅ Relevé enregistré !', 2000);
        } else {
            await addPendingWrite({ path: compteurPath(key), data: updateData });
            showToast('📴 Sauvegardé localement', 2000);
        }
        
        setTimeout(() => {
            if (navigator.onLine) syncPendingWrites();
        }, 1000);
        
    } catch (err) {
        console.error('Erreur enregistrement:', err);
        await addPendingWrite({ path: compteurPath(key), data: updateData });
        showToast('📴 Sauvegardé localement (erreur réseau)', 3000);
    }
}

export function editReading(key) {
    const item = state.clientsCache.find(c => c.key === key);
    if (!item) return;
    
    const data = item.data;
    
    openModal(`
        <div class="modal-content">
            <h3 class="modal-title">${icon('edit', { size: 16 })} Modifier le relevé</h3>
            <p class="modal-subtitle" style="margin-bottom:16px;">${escapeHtml(data.name)}</p>
            <div class="field-label" style="margin-bottom:6px;">Ancien index</div>
            <input type="number" class="login-input" value="${data.last_index}" disabled
                   style="margin-bottom:14px; width:100%; text-align:left; opacity:0.6;">

            <div class="field-label" style="margin-bottom:6px;">Nouvel index corrigé</div>
            <input type="number" id="edit-new-index" class="login-input" value="${data.new_index}"
                   step="0.1" style="width:100%; text-align:left;">
            <div class="modal-actions">
                <button class="btn-modal secondary" onclick="closeModal()">Annuler</button>
                <button class="btn-modal primary" onclick="submitEditReading('${key}', ${data.last_index})">
                    Enregistrer
                </button>
            </div>
        </div>
    `);
}

export async function submitEditReading(key, oldLastIndex) {
    const newIndexInput = document.getElementById('edit-new-index');
    const newIndex = parseFloat(newIndexInput.value);
    
    if (isNaN(newIndex)) {
        showToast('⚠️ Index invalide');
        return;
    }
    if (newIndex <= oldLastIndex) {
        showToast(`⚠️ L'index doit être > ${oldLastIndex} m³`);
        return;
    }

    if (isIndexDoubled(newIndex, oldLastIndex)) {
        const confirmed = await confirmDialog(
            'Chiffre à vérifier',
            `Ce chiffre (${newIndex} m³) est au moins le double de l'ancien index (${oldLastIndex} m³). Vérifiez bien le compteur. Confirmer quand même ?`,
            'Oui, confirmer',
            'Revoir'
        );
        if (!confirmed) return;
    }

    closeModal();
    showToast('⏳ Mise à jour...');
    
    const apaid = computeApaid(computeConso({ new_index: newIndex, last_index: oldLastIndex }));
    const updateData = {
        new_index: newIndex,
        apaid: apaid,
        releve_date: Date.now(),
        last_modified: Date.now()
    };
    
    try {
        if (navigator.onLine) {
            await db.ref(compteurPath(key)).update(updateData);
            showToast('✅ Modification enregistrée !');
        } else {
            await addPendingWrite({ path: compteurPath(key), data: updateData });
            showToast('📴 Modification sauvegardée localement');
        }
    } catch (err) {
        console.error('Erreur modification:', err);
        await addPendingWrite({ path: compteurPath(key), data: updateData });
        showToast('📴 Sauvegardé localement');
    }
}

export function confirmDialog(title, message, confirmText = 'Oui', cancelText = 'Annuler') {
    return new Promise((resolve) => {
        openModal(`
            <div class="modal-content" style="text-align:center;">
                <h3 class="modal-title">${escapeHtml(title)}</h3>
                <p style="color:var(--text-secondary); margin-bottom:20px;">${escapeHtml(message)}</p>
                <div class="modal-actions">
                    <button class="btn-modal secondary" onclick="window._dialogResolve(false); closeModal();">
                        ${escapeHtml(cancelText)}
                    </button>
                    <button class="btn-modal primary" onclick="window._dialogResolve(true); closeModal();">
                        ${escapeHtml(confirmText)}
                    </button>
                </div>
            </div>
        `);
        
        window._dialogResolve = (value) => {
            resolve(value);
            delete window._dialogResolve;
        };
    });
}

// === SIGNALEMENT D'ANOMALIE (motifs prédéfinis) ===

const ANOMALY_MOTIFS = [
    { id: 'inaccessible', label: 'Compteur inaccessible', icon: 'ban', photoRequired: false },
    { id: 'ferme', label: 'Logement fermé', icon: 'lock', photoRequired: false },
    // Compteur définitivement hors service : ne sera plus relevé (à distinguer
    // de « inaccessible »/« fermé », qui sont des situations temporaires).
    { id: 'horsservice', label: 'Compteur hors service', icon: 'x', photoRequired: true },
    { id: 'casse', label: 'Compteur cassé', icon: 'alert-triangle', photoRequired: true },
    { id: 'fuite', label: 'Fuite visible', icon: 'droplet', photoRequired: true },
    { id: 'illisible', label: 'Index illisible', icon: 'hash', photoRequired: true },
];

let selectedAnomalyMotif = null;

export function reportAnomaly(key) {
    selectedAnomalyMotif = null;
    const item = state.clientsCache.find(c => c.key === key);
    const name = item ? item.data.name : '';
    const compteur = item ? item.data.numero_compteur : '';

    openModal(`
        <div class="modal-content">
            <h3 class="modal-title">${icon('alert-triangle', { size: 16 })} Signaler une anomalie</h3>
            <p class="modal-subtitle">${escapeHtml(name)} · Compteur ${escapeHtml(String(compteur))}</p>
            <div class="motif-grid" id="motif-grid">
                ${ANOMALY_MOTIFS.map(m => `
                    <button type="button" class="motif-btn" data-motif="${m.id}" onclick="selectAnomalyMotif('${m.id}')">
                        ${icon(m.icon, { size: 16 })}<span>${m.label}</span>
                    </button>
                `).join('')}
            </div>
            <div class="field-label" style="margin-bottom:6px;">Commentaire (optionnel)</div>
            <textarea id="anomaly-comment" class="field-textarea" placeholder="Précisez si besoin..."></textarea>
            <div class="modal-actions">
                <button class="btn-modal secondary" onclick="closeModal()">Annuler</button>
                <button class="btn-modal primary" id="btn-anomaly-submit" disabled onclick="submitAnomalyMotif('${key}')">Choisir un motif</button>
            </div>
        </div>
    `);
}

export function selectAnomalyMotif(motifId) {
    selectedAnomalyMotif = ANOMALY_MOTIFS.find(m => m.id === motifId) || null;

    document.querySelectorAll('#motif-grid .motif-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.motif === motifId);
    });

    const submitBtn = document.getElementById('btn-anomaly-submit');
    if (submitBtn && selectedAnomalyMotif) {
        submitBtn.disabled = false;
        submitBtn.textContent = selectedAnomalyMotif.photoRequired ? 'Prendre la photo' : 'Enregistrer';
    }
}

export async function submitAnomalyMotif(key) {
    if (!selectedAnomalyMotif) return;
    const comment = (document.getElementById('anomaly-comment')?.value || '').trim();
    const noteText = comment ? `${selectedAnomalyMotif.label} — ${comment}` : selectedAnomalyMotif.label;
    const photoRequired = selectedAnomalyMotif.photoRequired;
    selectedAnomalyMotif = null;

    closeModal();

    if (photoRequired) {
        // L'anomalie n'est enregistrée qu'une fois la photo prise et confirmée
        // (voir confirmPhotoAndIndex en mode 'signalement').
        state.currentAnomalyNote = noteText;
        takePhoto(key, 'signalement');
    } else {
        await saveAnomalyNote(key, noteText);
    }
}

async function saveAnomalyNote(key, noteText) {
    showToast('⏳ Enregistrement du signalement...');
    const updateData = { note: noteText, anomaly_date: Date.now(), last_modified: Date.now() };
    try {
        if (navigator.onLine) {
            await db.ref(compteurPath(key)).update(updateData);
            showToast('✅ Signalement enregistré', 2000);
        } else {
            await addPendingWrite({ path: compteurPath(key), data: updateData });
            showToast('📴 Signalement sauvegardé localement', 2500);
        }
    } catch (err) {
        console.error('Erreur signalement:', err);
        await addPendingWrite({ path: compteurPath(key), data: updateData });
        showToast('📴 Sauvegardé localement (erreur réseau)', 3000);
    }
}

export async function deleteAnomaly(key) {
    const confirm = await confirmDialog('Supprimer', 'Annuler le signalement et supprimer la photo ?', 'Oui', 'Non');
    if (!confirm) return;
    
    const updateData = { note: null, photo_url: null, anomaly_date: null, last_modified: Date.now() };
    if (navigator.onLine) await db.ref(compteurPath(key)).update(updateData);
    else await addPendingWrite({ path: compteurPath(key), data: updateData });
}
