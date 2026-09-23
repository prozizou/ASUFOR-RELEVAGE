// js/clients.js
import { db } from './main.js';
import { state, compteursBasePath } from './state.js';
import { PAGE_SIZE, VERY_HIGH_CONSO_THRESHOLD, HIGH_CONSO_THRESHOLD } from './config.js';
import { escapeHtml } from './ui.js';
import { icon } from './icons.js';
import { isDone, hasAnomaly, computeConso, computeApaid } from './utils.js';

const FILTERS = [
    { id: 'all', label: 'Tous', icon: 'list' },
    { id: 'pending', label: 'En attente', icon: 'clock' },
    { id: 'done', label: 'Relevés', icon: 'check-circle' },
    { id: 'anomaly', label: 'Anomalies', icon: 'alert-triangle' },
];

export function renderFilterTabs() {
    const container = document.getElementById('filter-tabs');
    if (!container) return;
    container.innerHTML = FILTERS.map(f => `
        <button class="filter-tab${f.id === state.currentFilter ? ' active' : ''}" data-filter="${f.id}" onclick="setFilter('${f.id}',this)">
            ${icon(f.icon, { size: 14 })}<span>${f.label}</span>
        </button>
    `).join('');
}

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
    if (countDoneEl) countDoneEl.textContent = `${done}/${total}`;

    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const progressFillEl = document.getElementById('progress-fill');
    if (progressFillEl) progressFillEl.style.width = pct + '%';

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

function fmtM3(n) {
    return n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function createCard(key, data) {
    const done = isDone(data);
    const anomaly = hasAnomaly(data);
    const card = document.createElement('div');
    card.className = 'card' + (done ? ' done' : '');
    card.id = 'card_' + key;

    // Bouton de suppression global (uniquement si anomalie ou photo)
    const deleteBtn = (anomaly || data.photo_url) ?
        `<button class="btn-photo danger" onclick="deleteAnomaly('${key}')" title="Supprimer le signalement">${icon('trash', { size: 14 })}</button>` : '';

    let contentHtml = '';

    if (done) {
        const conso = computeConso(data);
        const apaid = computeApaid(Math.max(0, conso));
        const consoClass = conso > VERY_HIGH_CONSO_THRESHOLD ? 'high' : (conso > HIGH_CONSO_THRESHOLD ? 'medium' : 'normal');

        const anomalyBadge = anomaly ? `<div class="anomaly-badge">${icon('alert-triangle', { size: 12 })} Anomalie signalée</div>` : '';
        const photoBadge = data.photo_url ? `<div class="anomaly-badge photo-badge">${icon('camera', { size: 12 })} Photo jointe</div>` : '';

        contentHtml = `
            ${anomalyBadge}
            ${photoBadge}
            <div class="data-row conso-alert ${consoClass}">
                <span class="data-item"><span class="data-label">Index</span> <span class="data-value">${Number(data.new_index).toLocaleString('fr-FR')}</span></span>
                <span class="data-sep">·</span>
                <span class="data-item">${icon('droplet', { size: 13 })}<span class="data-label">Conso.</span> <span class="data-value">${fmtM3(conso)} m³</span></span>
                <span class="data-sep">·</span>
                <span class="data-item"><span class="data-value amount">${apaid.toLocaleString('fr-FR')} F</span></span>
            </div>
            <button class="btn-edit" onclick="editReading('${key}')">${icon('edit', { size: 13 })} Modifier</button>
        `;
    } else {
        if (anomaly) {
            // Signalement actif : on affiche le bouton pour prendre/reprendre la photo
            const photoStatus = data.photo_url ? 'Photo enregistrée' : 'Prendre la photo';
            const photoIcon = data.photo_url ? icon('check-circle', { size: 15 }) : icon('camera', { size: 15 });
            const btnClass = data.photo_url ? 'photo-taken' : '';

            contentHtml = `
                <div class="anomaly-badge">${icon('alert-triangle', { size: 12 })} ${escapeHtml(data.note)}</div>
                <button class="btn-ok ${btnClass}" onclick="takePhoto('${key}')" style="margin-bottom:10px; width:100%;${data.photo_url ? ' background:var(--success-bg); color:var(--success);' : ' background:var(--danger); color:#fff;'}">
                    ${photoIcon} ${photoStatus}
                </button>
                <div class="field-label">Nouvel index</div>
                <div class="index-box" id="indexBox_${key}" onclick="openKeypad('${key}', ${data.last_index})">
                    <span class="index-value-large" id="indexValue_${key}">—</span>
                    <span class="index-unit">m³</span>
                </div>
                <button id="btn_ok_${key}" class="btn-ok" disabled onclick="confirmReading('${key}')" style="width:100%; margin-top:8px;">${icon('check', { size: 15 })} Valider le relevé</button>
            `;
        } else {
            // Pas d'anomalie : saisie directe + anomalie en action secondaire
            contentHtml = `
                <div class="old-index">Dernier index : <b>${Number(data.last_index).toLocaleString('fr-FR')} m³</b></div>
                <div class="saisie-container">
                    <div class="field-label">Nouvel index</div>
                    <div class="index-box" id="indexBox_${key}" onclick="openKeypad('${key}', ${data.last_index})">
                        <span class="index-value-large" id="indexValue_${key}">—</span>
                        <span class="index-unit">m³</span>
                    </div>
                    <div class="action-buttons">
                        <button class="btn-anomaly" onclick="reportAnomaly('${key}')">
                            ${icon('alert-triangle', { size: 14 })} Anomalie
                        </button>
                        <button id="btn_ok_${key}" class="btn-ok" disabled onclick="confirmReading('${key}')">${icon('check', { size: 15 })} Valider</button>
                    </div>
                </div>
            `;
        }
    }

    card.innerHTML = `
        <div class="client-header">
            <span class="client-name">${escapeHtml(data.name)}</span>
            <div class="client-header-right">
                <span class="compteur-num">${icon('hash', { size: 11 })} ${escapeHtml(String(data.numero_compteur))}</span>
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
