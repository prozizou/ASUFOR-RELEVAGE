// js/actions.js
import { db } from './main.js';
import { state, compteurPath } from './state.js';
import { showToast, openModal, closeModal, escapeHtml } from './ui.js';
import { addPendingWrite } from './offlineDb.js';
import { syncPendingWrites } from './sync.js';
import { VERY_HIGH_CONSO_THRESHOLD } from './config.js';
import { takePhoto } from './media.js';
import { computeConso, computeApaid, isIndexDoubled } from './utils.js';
import { icon } from './icons.js';

const ANOMALY_REASONS = [
    'Compteur cassé ou endommagé',
    'Fuite visible',
    'Compteur illisible / index effacé',
    'Accès au compteur impossible',
    'Compteur absent',
    'Autre'
];

export function openKeypad(key, last) {
    openModal(`
        <div class="modal-content keypad-modal">
            <div class="keypad-display">
                <span class="keypad-value" id="key-val">---</span>
                <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:8px;">
                    Dernier index: ${last} m³
                </div>
            </div>
            <div class="keypad-grid">
                ${[1,2,3,4,5,6,7,8,9,'.',0,'⌫'].map(k =>
                    `<button class="keypad-btn" onclick="keypadInput('${k}')">${k === '⌫' ? icon('backspace') : k}</button>`
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
    let current = display.textContent === '---' ? '' : display.textContent;
    
    if (k === '⌫') {
        current = current.slice(0, -1);
    } else if (k === '.' && current.includes('.')) {
        return;
    } else {
        current += k;
    }
    
    display.textContent = current || '---';
}

export function validateKeypad(key, last) {
    const value = parseFloat(document.getElementById('key-val').textContent);
    
    if (isNaN(value)) {
        showToast('Veuillez saisir un nombre valide');
        return;
    }

    if (value <= last) {
        showToast(`L'index doit être supérieur à ${last} m³`);
        return;
    }
    
    closeModal();
    
    const indexSpan = document.getElementById(`indexValue_${key}`);
    const btnOk = document.getElementById(`btn_ok_${key}`);
    
    if (indexSpan && btnOk) {
        indexSpan.textContent = value;
        btnOk.disabled = false;
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
        `<p style="color:var(--danger); margin-top:10px;">${icon('alert-triangle')} Consommation anormalement élevée !</p>` : '';

    const doubleWarning = isIndexDoubled(val, item.data.last_index) ? `
        <div style="background:var(--danger-bg); color:var(--danger); padding:12px 16px; border-radius:14px; margin-bottom:14px; font-weight:bold; text-align:center;">
            ${icon('alert-triangle')} Attention : ce chiffre (${val} m³) est au moins le double de l'ancien index (${item.data.last_index} m³).<br>Vérifiez bien le compteur avant de valider !
        </div>
    ` : '';

    openModal(`
        <div class="modal-content">
            <h3 class="modal-title">${icon('search')} Confirmer le relevé</h3>
            <p style="text-align:center; color:var(--text-primary); margin-bottom:10px; font-weight:bold;">
                ${escapeHtml(item.data.name)}
            </p>
            ${doubleWarning}
            <div style="background:var(--bg-elevated); padding:16px; border-radius:16px;">
                <div class="rep-row"><span>Nouvel index</span><b style="color:var(--accent);">${val} m³</b></div>
                <div class="rep-row"><span>Consommation</span><b>${conso.toFixed(1)} m³</b></div>
                <div class="rep-row"><span>Montant à payer</span><b style="color:var(--success);">${apaid.toLocaleString('fr-FR')} F</b></div>
            </div>
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
    showToast('Enregistrement...');

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
            showToast('Relevé enregistré.', 2000);
        } else {
            await addPendingWrite({ path: compteurPath(key), data: updateData });
            showToast('Sauvegardé localement (hors ligne).', 2000);
        }

        setTimeout(() => {
            if (navigator.onLine) syncPendingWrites();
        }, 1000);

    } catch (err) {
        console.error('Erreur enregistrement:', err);
        await addPendingWrite({ path: compteurPath(key), data: updateData });
        showToast('Sauvegardé localement (erreur réseau).', 3000);
    }
}

export function editReading(key) {
    const item = state.clientsCache.find(c => c.key === key);
    if (!item) return;
    
    const data = item.data;
    
    openModal(`
        <div class="modal-content">
            <h3 class="modal-title">${icon('edit')} Modifier le relevé</h3>
            <p style="text-align:center; font-weight:bold; color:var(--text-primary);">
                ${escapeHtml(data.name)}
            </p>
            <div style="margin:16px 0;">
                <label style="color:var(--text-secondary); font-size:0.85rem;">Ancien index</label>
                <input type="number" class="login-input" value="${data.last_index}" disabled 
                       style="margin-bottom:12px; width:100%; border-radius:12px; padding:12px;">
                
                <label style="color:var(--text-secondary); font-size:0.85rem;">Nouvel index corrigé</label>
                <input type="number" id="edit-new-index" class="login-input" value="${data.new_index}" 
                       step="0.1" style="width:100%; border-radius:12px; padding:12px;">
            </div>
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
        showToast('Index invalide');
        return;
    }
    if (newIndex <= oldLastIndex) {
        showToast(`L'index doit être > ${oldLastIndex} m³`);
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
    showToast('Mise à jour...');

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
            showToast('Modification enregistrée.');
        } else {
            await addPendingWrite({ path: compteurPath(key), data: updateData });
            showToast('Modification sauvegardée localement (hors ligne).');
        }
    } catch (err) {
        console.error('Erreur modification:', err);
        await addPendingWrite({ path: compteurPath(key), data: updateData });
        showToast('Sauvegardé localement.');
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

// === NOUVELLES FONCTIONS DE SIGNALEMENT ===

// Signalement secondaire mais accessible : motif (obligatoire) + commentaire
// (facultatif) sont saisis AVANT la photo — les trois sont enregistrés
// ensemble à la confirmation (voir confirmPhotoAndIndex en mode
// 'signalement'), rien n'est écrit tant que l'agent n'a pas validé.
export function reportWithPhoto(key) {
    const item = state.clientsCache.find(c => c.key === key);
    const clientName = item ? item.data.name : '';

    openModal(`
        <div class="modal-content">
            <h3 class="modal-title">${icon('alert-triangle')} Signaler une anomalie</h3>
            <p style="text-align:center; color:var(--text-primary); margin-bottom:10px; font-weight:bold;">
                ${escapeHtml(clientName)}
            </p>
            <div style="margin:16px 0;">
                <label style="color:var(--text-secondary); font-size:0.85rem;">Motif <span style="color:var(--danger);">*</span></label>
                <select id="anomaly-motif" class="login-input" style="width:100%; border-radius:12px; padding:12px; margin:6px 0 12px; text-align:left;">
                    <option value="">— Choisir un motif —</option>
                    ${ANOMALY_REASONS.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}
                </select>
                <label style="color:var(--text-secondary); font-size:0.85rem;">Commentaire (facultatif)</label>
                <textarea id="anomaly-comment" class="login-input" rows="3"
                    style="width:100%; border-radius:12px; padding:12px; margin-top:6px; text-align:left; font-family:inherit; resize:vertical;"
                    placeholder="Précisez si besoin..."></textarea>
            </div>
            <div class="modal-actions">
                <button class="btn-modal secondary" onclick="closeModal()">Annuler</button>
                <button class="btn-modal primary" onclick="proceedToAnomalyPhoto('${key}')">${icon('camera')} Photo</button>
            </div>
        </div>
    `);
}

export function proceedToAnomalyPhoto(key) {
    const motif = document.getElementById('anomaly-motif').value;
    const comment = document.getElementById('anomaly-comment').value.trim();

    if (!motif) {
        showToast('Choisissez un motif de signalement');
        return;
    }

    state.currentAnomalyMotif = motif;
    state.currentAnomalyComment = comment;
    closeModal();
    takePhoto(key, 'signalement');
}

export async function deleteAnomaly(key) {
    const confirm = await confirmDialog('Supprimer', 'Annuler le signalement et supprimer la photo ?', 'Oui', 'Non');
    if (!confirm) return;
    
    const updateData = { note: null, photo_url: null, anomaly_date: null, anomaly_reason: null, anomaly_comment: null, last_modified: Date.now() };
    if (navigator.onLine) await db.ref(compteurPath(key)).update(updateData);
    else await addPendingWrite({ path: compteurPath(key), data: updateData });
}
