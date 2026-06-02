// js/clients.js
import { db } from './main.js';
import { state } from './state.js';
import { PAGE_SIZE, VERY_HIGH_CONSO_THRESHOLD, HIGH_CONSO_THRESHOLD } from './config.js';
import { escapeHtml } from './ui.js';

export function loadClientsData(agentId) {
    detachListener();
    loadCachedClients(agentId);
    state.activeQueryRef = db.ref('asufor_db_diandioly').orderByChild('agent_id').equalTo(agentId);
    state.activeCallback = state.activeQueryRef.on('value', 
        (snapshot) => {
            processSnapshot(snapshot);
            cacheClientsData(agentId, snapshot.val());
        },
        (error) => console.error('Erreur chargement clients:', error)
    );
}

export function detachListener() {
    if (state.activeQueryRef && state.activeCallback) {
        state.activeQueryRef.off('value', state.activeCallback);
        state.activeQueryRef = null;
        state.activeCallback = null;
    }
}

async function cacheClientsData(agentId, data) {
    try {
        const cacheData = { data: data, timestamp: Date.now(), agentId: agentId };
        localStorage.setItem(`clients_cache_${agentId}`, JSON.stringify(cacheData));
    } catch (e) { console.warn('Impossible de mettre en cache les clients:', e); }
}

function loadCachedClients(agentId) {
    try {
        const cached = localStorage.getItem(`clients_cache_${agentId}`);
        if (cached) {
            const cacheData = JSON.parse(cached);
            if (Date.now() - cacheData.timestamp < 24 * 60 * 60 * 1000) {
                const mockSnapshot = {
                    val: () => cacheData.data,
                    forEach: (callback) => {
                        Object.entries(cacheData.data || {}).forEach(([key, value]) => {
                            callback({ key, val: () => value });
                        });
                    }
                };
                processSnapshot(mockSnapshot);
            }
        }
    } catch (e) { console.warn('Erreur lecture cache:', e); }
}

function processSnapshot(snapshot) {
    state.clientsCache = [];
    snapshot.forEach(childSnap => {
        state.clientsCache.push({ key: childSnap.key, data: childSnap.val() });
    });
    state.clientsCache.sort((a, b) => (a.data.name || '').localeCompare(b.data.name || '', 'fr'));
    applyFiltersAndReset();
}

function applyFiltersAndReset() {
    state.displayedCount = 0;
    const container = document.getElementById('list');
    if (!container) return;
    container.innerHTML = '';
    
    const searchTerm = (document.getElementById('search')?.value || '').toLowerCase().trim();
    state.filteredClientsCache = state.clientsCache.filter(item => {
        const { data } = item;
        const isDone = data.statut === true || data.statut === "true";
        const hasAnomaly = !!(data.note && data.note.trim());
        
        if (state.currentFilter === 'done' && !isDone) return false;
        if (state.currentFilter === 'pending' && isDone) return false;
        if (state.currentFilter === 'anomaly' && !hasAnomaly) return false;
        
        const searchStr = ((data.name || '') + ' ' + (data.numero_compteur || '')).toLowerCase();
        return !searchTerm || searchStr.includes(searchTerm);
    });
    
    renderNextBatch();
    updateProgressStats();
    updatePositionDisplay();
    setTimeout(() => { setupInfiniteScroll(); }, 100);
}

function updateProgressStats() {
    const total = state.clientsCache.length;
    const done = state.clientsCache.filter(c => c.data.statut === true || c.data.statut === "true").length;
    
    const countDoneEl = document.getElementById('count-done');
    if (countDoneEl) countDoneEl.textContent = done;
    
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const progressFillEl = document.getElementById('progress-fill');
    if (progressFillEl) progressFillEl.style.width = pct + '%';
    
    const progressLabelEl = document.getElementById('progress-label');
    if (progressLabelEl) progressLabelEl.textContent = `${done} / ${total} relevés`;
    
    const progressPctEl = document.getElementById('progress-pct');
    if (progressPctEl) progressPctEl.textContent = pct + '%';
}

function renderNextBatch() {
    const container = document.getElementById('list');
    if (!container) return;
    
    const batch = state.filteredClientsCache.slice(state.displayedCount, state.displayedCount + PAGE_SIZE);
    for (const item of batch) {
        container.appendChild(createCard(item.key, item.data));
    }
    state.displayedCount += batch.length;
    state.isLoadingMore = false;
}

function setupInfiniteScroll() {
    if (state.observer) state.observer.disconnect();
    let sentinel = document.getElementById('scroll-sentinel');
    if (!sentinel) {
        sentinel = document.createElement('div');
        sentinel.id = 'scroll-sentinel';
        sentinel.style.height = '20px';
        sentinel.style.width = '100%';
        const mainSection = document.getElementById('main-section');
        if (mainSection) mainSection.appendChild(sentinel);
    }

    state.observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && !state.isLoadingMore && state.displayedCount < state.filteredClientsCache.length) {
            state.isLoadingMore = true;
            setTimeout(() => { renderNextBatch(); }, 150);
        }
    }, { rootMargin: '200px' });
    
    if (sentinel) state.observer.observe(sentinel);
}

function createCard(key, data) {
    const isDone = data.statut === true || data.statut === "true";
    const hasAnomaly = !!(data.note && data.note.trim());
    const card = document.createElement('div');
    card.className = 'card' + (isDone ? ' done' : '');
    card.id = 'card_' + key;

    // Bouton de suppression global (uniquement si anomalie ou photo)
    const deleteBtn = (hasAnomaly || data.photo_url) ? 
        `<button class="btn-photo" onclick="deleteAnomaly('${key}')" style="background:var(--danger); border-color:var(--danger); margin-left:8px; width:32px; height:32px; flex-shrink:0;">🗑️</button>` : '';

    let contentHtml = '';

    if (isDone) {
        const conso = (Number(data.new_index) || 0) - (Number(data.last_index) || 0);
        const consoClass = conso > VERY_HIGH_CONSO_THRESHOLD ? 'high' : (conso > HIGH_CONSO_THRESHOLD ? 'medium' : 'normal');

        const anomalyBadge = hasAnomaly ? `<div class="anomaly-badge" style="margin-bottom:8px;">⚠️ Anomalie signalée</div>` : '';
        const photoBadge = data.photo_url ? `<div class="anomaly-badge" style="background:var(--success-bg); color:var(--success); margin-bottom:8px;">✅ Photo jointe</div>` : '';

        contentHtml = `
            ${anomalyBadge}
            ${photoBadge}
            <div class="validated-index">✅ ${data.new_index} m³</div>
            <div class="conso-alert ${consoClass}">💧 ${conso.toFixed(1)} m³ · 💰 ${Math.round(data.apaid || 0).toLocaleString('fr-FR')} F</div>
            <button class="btn-edit" onclick="editReading('${key}')" style="margin-top:10px; width:100%;">✏️ Modifier l'index</button>
        `;
    } else {
        if (hasAnomaly) {
            // Signalement actif : on affiche le bouton pour prendre/reprendre la photo
            const photoStatus = data.photo_url ? '✅ Photo enregistrée' : '📸 PRENDRE LA PHOTO';
            const btnColor = data.photo_url ? 'var(--success)' : 'var(--danger)';

            contentHtml = `
                <div class="anomaly-badge" style="margin-bottom:8px;">⚠️ Anomalie signalée</div>
                <button class="btn-ok" onclick="takePhoto('${key}')" style="background:${btnColor}; color:#fff; margin-bottom:12px; width:100%; border:none; padding:12px; border-radius:40px; font-weight:bold; cursor:pointer;">
                    ${photoStatus}
                </button>
                <div class="saisie-container">
                    <div class="index-box clickable-box" onclick="openKeypad('${key}', ${data.last_index})">
                        <span class="index-value-large" id="indexValue_${key}">---</span>
                    </div>
                    <button id="btn_ok_${key}" class="btn-ok" disabled onclick="confirmReading('${key}')">✅ Valider le relevé</button>
                </div>
            `;
        } else {
            // Pas d'anomalie : saisie simple + gros bouton de signalement
            contentHtml = `
                <div class="old-index">Dernier index: ${data.last_index} m³</div>
                <div class="saisie-container">
                    <div class="index-box clickable-box" onclick="openKeypad('${key}', ${data.last_index})">
                        <span class="index-value-large" id="indexValue_${key}">---</span>
                    </div>
                    <div class="action-buttons">
                        <button class="btn-anomaly" onclick="reportWithPhoto('${key}')" style="background:var(--danger-bg); color:var(--danger); border:1px solid var(--danger);">
                            🚨 SIGNALEMENT
                        </button>
                        <button id="btn_ok_${key}" class="btn-ok" disabled onclick="confirmReading('${key}')">✅ VALIDER</button>
                    </div>
                </div>
            `;
        }
    }

    card.innerHTML = `
        <div class="client-header">
            <span class="client-name">${escapeHtml(data.name)}</span>
            <div style="display:flex; align-items:center;">
                <span class="compteur-num">📟 ${escapeHtml(String(data.numero_compteur))}</span>
                ${deleteBtn}
            </div>
        </div>
        ${contentHtml}
    `;
    return card;
}

export function navigateClient(dir) {
    if (!state.filteredClientsCache.length) return;
    
    state.currentClientIndex = Math.max(0, Math.min(
        state.filteredClientsCache.length - 1,
        state.currentClientIndex + dir
    ));
    
    const key = state.filteredClientsCache[state.currentClientIndex].key;
    const card = document.getElementById(`card_${key}`);
    
    if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.style.transition = 'box-shadow 0.3s';
        card.style.boxShadow = '0 0 20px var(--accent-glow)';
        setTimeout(() => { card.style.boxShadow = ''; }, 1000);
    }
    updatePositionDisplay();
}

function updatePositionDisplay() {
    const position = document.getElementById('client-position');
    if (position) position.textContent = `${state.currentClientIndex + 1} / ${state.filteredClientsCache.length}`;
}

export function setFilter(filter, button) {
    state.currentFilter = filter;
    document.querySelectorAll('.filter-tab').forEach(tab => tab.classList.remove('active'));
    if (button) button.classList.add('active');
    applyFiltersAndReset();
}

export function applyFilters() { applyFiltersAndReset(); }
