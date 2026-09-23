// js/clients.js
import { db } from './main.js';
import { state, compteursBasePath } from './state.js';
import { PAGE_SIZE, VERY_HIGH_CONSO_THRESHOLD, HIGH_CONSO_THRESHOLD } from './config.js';
import { escapeHtml } from './ui.js';
import { isDone, hasAnomaly, computeConso, computeApaid } from './utils.js';
import { icon } from './icons.js';

export function loadClientsData(agentId) {
    detachListener();
    renderSkeletons(6);
    loadCachedClients(agentId);
    state.activeQueryRef = db.ref(compteursBasePath()).orderByChild('agent_id').equalTo(agentId);
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

function clientsCacheKey(agentId) {
    return `clients_cache_${state.currentForageKey}_${agentId}`;
}

async function cacheClientsData(agentId, data) {
    try {
        const cacheData = { data: data, timestamp: Date.now(), agentId: agentId };
        localStorage.setItem(clientsCacheKey(agentId), JSON.stringify(cacheData));
    } catch (e) { console.warn('Impossible de mettre en cache les clients:', e); }
}

function loadCachedClients(agentId) {
    try {
        const cached = localStorage.getItem(clientsCacheKey(agentId));
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
        const done = isDone(data);
        const anomaly = hasAnomaly(data);

        if (state.currentFilter === 'done' && !done) return false;
        if (state.currentFilter === 'pending' && done) return false;
        if (state.currentFilter === 'anomaly' && !anomaly) return false;
        
        const searchStr = ((data.name || '') + ' ' + (data.numero_compteur || '')).toLowerCase();
        return !searchTerm || searchStr.includes(searchTerm);
    });
    
    renderNextBatch();
    updateProgressStats();
    setTimeout(() => { setupInfiniteScroll(); }, 100);
}

function updateProgressStats() {
    const total = state.clientsCache.length;
    const done = state.clientsCache.filter(c => isDone(c.data)).length;
    
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

    removeSkeletons();
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
            renderSkeletons(3);
            setTimeout(() => { renderNextBatch(); }, 300);
        }
    }, { rootMargin: '200px' });

    if (sentinel) state.observer.observe(sentinel);
}

function renderSkeletons(count) {
    const container = document.getElementById('list');
    if (!container) return;
    removeSkeletons();
    const wrapper = document.createElement('div');
    wrapper.id = 'list-skeletons';
    for (let i = 0; i < count; i++) {
        wrapper.appendChild(createSkeletonCard());
    }
    container.appendChild(wrapper);
}

function removeSkeletons() {
    document.getElementById('list-skeletons')?.remove();
}

function createSkeletonCard() {
    const card = document.createElement('div');
    card.className = 'card skeleton-card';
    card.innerHTML = `
        <div class="skeleton-line skeleton-title"></div>
        <div class="skeleton-line skeleton-sub"></div>
        <div class="skeleton-block"></div>
    `;
    return card;
}

function createCard(key, data) {
    const done = isDone(data);
    const anomaly = hasAnomaly(data);
    const card = document.createElement('div');
    card.className = 'card' + (done ? ' done' : '');
    card.id = 'card_' + key;

    // Bouton de suppression global (uniquement si anomalie ou photo)
    const deleteBtn = (anomaly || data.photo_url) ?
        `<button class="btn-photo" onclick="deleteAnomaly('${key}')" style="background:var(--danger); border-color:var(--danger); color:#fff; margin-left:8px; width:32px; height:32px; flex-shrink:0;" title="Supprimer le signalement">${icon('trash')}</button>` : '';

    // Motif + commentaire du signalement, affichés dès qu'un motif existe
    // (secondaire mais accessible : sous le badge, jamais escamotés).
    const anomalyDetail = anomaly
        ? `<div class="anomaly-badge" style="margin-bottom:8px;">
               <div>${icon('alert-triangle')} ${escapeHtml(data.anomaly_reason || data.note || 'Anomalie signalée')}</div>
               ${data.anomaly_comment ? `<div style="margin-top:4px; opacity:0.85; font-weight:normal;">${escapeHtml(data.anomaly_comment)}</div>` : ''}
           </div>`
        : '';

    let contentHtml = '';

    if (done) {
        const conso = computeConso(data);
        const apaid = computeApaid(Math.max(0, conso));
        const consoClass = conso > VERY_HIGH_CONSO_THRESHOLD ? 'high' : (conso > HIGH_CONSO_THRESHOLD ? 'medium' : 'normal');

        const photoBadge = data.photo_url ? `<div class="anomaly-badge" style="background:var(--success-bg); color:var(--success); margin-bottom:8px;">${icon('check-circle')} Photo jointe</div>` : '';

        contentHtml = `
            ${anomalyDetail}
            ${photoBadge}
            <div class="validated-index"><span class="field-label">${icon('gauge')} Index</span> ${data.new_index} m³</div>
            <div class="conso-alert ${consoClass}">
                <span class="field-label">${icon('droplet')} Consommation</span> ${conso.toFixed(1)} m³
                &nbsp;·&nbsp;
                <span class="field-label">${icon('coin')} Montant</span> ${apaid.toLocaleString('fr-FR')} F
            </div>
            <button class="btn-edit" onclick="editReading('${key}')" style="margin-top:10px; width:100%;">${icon('edit')} Modifier l'index</button>
        `;
    } else {
        if (anomaly) {
            // Signalement actif : on affiche le bouton pour prendre/reprendre la photo
            const photoStatus = data.photo_url ? icon('check-circle') + ' Photo enregistrée' : icon('camera') + ' Prendre la photo';
            const btnColor = data.photo_url ? 'var(--success)' : 'var(--danger)';

            contentHtml = `
                ${anomalyDetail}
                <button class="btn-ok" onclick="takePhoto('${key}')" style="background:${btnColor}; color:#fff; margin-bottom:12px; width:100%; border:none; padding:12px; border-radius:40px; font-weight:bold; cursor:pointer;">
                    ${photoStatus}
                </button>
                <div class="saisie-container">
                    <div class="index-box clickable-box" onclick="openKeypad('${key}', ${data.last_index})">
                        <span class="index-value-large" id="indexValue_${key}">---</span>
                    </div>
                    <button id="btn_ok_${key}" class="btn-ok" disabled onclick="confirmReading('${key}')">${icon('check')} Valider le relevé</button>
                </div>
            `;
        } else {
            // Pas d'anomalie : saisie simple + bouton de signalement secondaire
            contentHtml = `
                <div class="old-index">${icon('gauge')} Dernier index : ${data.last_index} m³</div>
                <div class="saisie-container">
                    <div class="index-box clickable-box" onclick="openKeypad('${key}', ${data.last_index})">
                        <span class="index-value-large" id="indexValue_${key}">---</span>
                    </div>
                    <div class="action-buttons">
                        <button class="btn-anomaly" onclick="reportWithPhoto('${key}')" title="Signaler une anomalie (compteur cassé, fuite, accès impossible...)">
                            ${icon('alert-triangle')} Signalement
                        </button>
                        <button id="btn_ok_${key}" class="btn-ok" disabled onclick="confirmReading('${key}')">${icon('check')} Valider</button>
                    </div>
                </div>
            `;
        }
    }

    card.innerHTML = `
        <div class="client-header">
            <span class="client-name">${escapeHtml(data.name)}</span>
            <div style="display:flex; align-items:center;">
                <span class="compteur-num">${icon('gauge')} ${escapeHtml(String(data.numero_compteur))}</span>
                ${deleteBtn}
            </div>
        </div>
        ${contentHtml}
    `;
    return card;
}

export function setFilter(filter, button) {
    state.currentFilter = filter;
    document.querySelectorAll('.filter-tab').forEach(tab => tab.classList.remove('active'));
    if (button) button.classList.add('active');
    applyFiltersAndReset();
}

export function applyFilters() { applyFiltersAndReset(); }
