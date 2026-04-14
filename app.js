// app.js - ASUFOR Diandioly v9.5 (IA OCR Améliorée et Recadrée)
// ==================== CONSTANTS & CONFIG ====================
const PRICE_PER_M3 = 250;
const HIGH_CONSO_THRESHOLD = 30;
const VERY_HIGH_CONSO_THRESHOLD = 60;
const PAGE_SIZE = 20;

// ==================== FIREBASE INIT ====================
firebase.initializeApp({
    apiKey: "AIzaSyAKC7lrKSCFwfuoXASvX-yYIGneLXInvDk",
    authDomain: "asufor-67a06.firebaseapp.com",
    databaseURL: "https://asufor-67a06-default-rtdb.firebaseio.com",
    projectId: "asufor-67a06",
    storageBucket: "asufor-67a06.firebasestorage.app",
    appId: "1:621722220561:android:40acdd4d6bf3340f3059b0"
});
const db = firebase.database();

// ==================== INDEXEDDB ====================
const DB_NAME = 'AsuforOfflineDB';
const STORE_NAME = 'pendingWrites';
let dbPromise;

function openOfflineDB() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = (ev) => {
                const db = ev.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                }
            };
        });
    }
    return dbPromise;
}

async function addPendingWrite(operation) {
    const db = await openOfflineDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.add({ ...operation, timestamp: Date.now() });
    return tx.complete;
}

async function getPendingWrites() {
    const db = await openOfflineDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

async function clearPendingWrite(id) {
    const db = await openOfflineDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    return tx.complete;
}

async function syncPendingWrites() {
    if (!navigator.onLine) return;
    const pending = await getPendingWrites();
    if (pending.length === 0) { updateSyncIndicator(0); return; }
    updateSyncIndicator(pending.length);
    for (const op of pending) {
        try {
            const snapshot = await db.ref(op.path).once('value');
            const currentData = snapshot.val() || {};
            const remoteTimestamp = currentData.last_modified || 0;
            const localTimestamp = op.data.last_modified || Date.now();
            if (remoteTimestamp > localTimestamp) {
                await clearPendingWrite(op.id);
                continue;
            }
            await db.ref(op.path).update(op.data);
            await clearPendingWrite(op.id);
        } catch (err) {
            console.error('Erreur synchro:', err);
        }
    }
    const remaining = await getPendingWrites();
    updateSyncIndicator(remaining.length);
}

function updateSyncIndicator(count) {
    const indicator = document.getElementById('sync-indicator');
    if (indicator) {
        if (count > 0) {
            indicator.textContent = `⏳ ${count}`;
            indicator.classList.remove('hidden');
        } else {
            indicator.classList.add('hidden');
        }
    }
}

// ==================== STATE ====================
let currentAgentId = null;
let activeQueryRef = null;
let activeCallback = null;
let clientsCache = [];
let filteredClientsCache = [];
let currentFilter = 'all';
let displayedCount = 0;
let observer = null;
let isLoadingMore = false;
let currentClientIndex = 0;

let currentPhotoKey = null;
let cameraStream = null;
let currentPhotoBlob = null; 

let mediaRecorder;
let audioChunks = [];
let audioBlob = null;

// ==================== THÈME SOMBRE/CLAIR ====================
function toggleTheme() {
    const isLight = document.body.classList.toggle('light-mode');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
}

function loadTheme() {
    if (localStorage.getItem('theme') === 'light') {
        document.body.classList.add('light-mode');
    }
}

// ==================== LOGIN DYNAMIQUE ====================
function login() {
    const codeInput = document.getElementById('agent-code');
    const errorDiv = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');
    const code = codeInput.value.trim();

    errorDiv.textContent = '';
    if (code.length !== 6) {
        errorDiv.textContent = '⚠️ Le code doit contenir 6 chiffres';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'CONNEXION...';

    db.ref('db_agents').orderByChild('passcode').equalTo(code).once('value')
        .then(snapshot => {
            if (!snapshot.exists()) {
                errorDiv.textContent = '❌ Code agent invalide';
                btn.disabled = false;
                btn.textContent = 'ACCÉDER À LA TOURNÉE';
                return;
            }
            
            let agentData = null;
            let agentRealId = null;
            snapshot.forEach(child => {
                agentRealId = child.key;
                agentData = child.val();
            });

            localStorage.setItem('asufor_id', agentRealId);
            localStorage.setItem('agent_name', agentData.agent || 'Agent');
            localStorage.setItem('agent_zone', agentData.zone || 'Zone');
            localStorage.setItem('agent_passcode', code); 
            
            currentAgentId = agentRealId;
            enterApp(agentData.agent, agentData.zone);
        })
        .catch(err => {
            const storedPass = localStorage.getItem('agent_passcode');
            if (storedPass === code && !navigator.onLine) {
                currentAgentId = localStorage.getItem('asufor_id');
                enterApp(localStorage.getItem('agent_name'), localStorage.getItem('agent_zone'));
                showToast('📴 Mode hors ligne', 3000);
            } else {
                errorDiv.textContent = '📡 Erreur réseau.';
                btn.disabled = false;
                btn.textContent = 'ACCÉDER À LA TOURNÉE';
            }
        });
}

function enterApp(name, zone) {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('main-section').classList.remove('hidden');
    document.getElementById('agent-name').textContent = name || 'Agent';
    document.getElementById('agent-zone').textContent = zone || 'Zone';
    document.getElementById('avatar').textContent = (name || 'A').charAt(0).toUpperCase();
    updateOnlineStatus();
    loadClientsData(currentAgentId);
    syncPendingWrites();
}

// ==================== CLIENT DATA ====================
function loadClientsData(agentId) {
    detachListener();
    activeQueryRef = db.ref('asufor_db_diandioly').orderByChild('agent_id').equalTo(agentId);
    activeCallback = activeQueryRef.on('value', (snapshot) => processSnapshot(snapshot));
}

function detachListener() {
    if (activeQueryRef && activeCallback) {
        activeQueryRef.off('value', activeCallback);
        activeQueryRef = null;
        activeCallback = null;
    }
}

function processSnapshot(snapshot) {
    clientsCache = [];
    snapshot.forEach(childSnap => {
        const data = childSnap.val();
        clientsCache.push({ key: childSnap.key, data: data });
    });
    clientsCache.sort((a, b) => (a.data.name || '').localeCompare(b.data.name || '', 'fr'));
    applyFiltersAndReset();
}

function applyFiltersAndReset() {
    displayedCount = 0;
    const container = document.getElementById('list');
    container.innerHTML = '';
    
    const searchTerm = (document.getElementById('search')?.value || '').toLowerCase().trim();
    filteredClientsCache = clientsCache.filter(item => {
        const { data } = item;
        const isDone = data.statut === true || data.statut === "true";
        const hasAnomaly = !!(data.audio_url || (data.note && data.note.trim()));
        if (currentFilter === 'done' && !isDone) return false;
        if (currentFilter === 'pending' && isDone) return false;
        if (currentFilter === 'anomaly' && !hasAnomaly) return false;
        const searchStr = ((data.name || '') + ' ' + (data.numero_compteur || '')).toLowerCase();
        return !searchTerm || searchStr.includes(searchTerm);
    });
    
    renderNextBatch();
    updateProgressStats();
    updatePositionDisplay();

    setTimeout(() => { setupInfiniteScroll(); }, 100);
}

function updateProgressStats() {
    const total = clientsCache.length;
    const done = clientsCache.filter(c => c.data.statut === true || c.data.statut === "true").length;
    document.getElementById('count-done').textContent = done;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('progress-label').textContent = `${done} / ${total} relevés`;
    document.getElementById('progress-pct').textContent = pct + '%';
}

function renderNextBatch() {
    const container = document.getElementById('list');
    const batch = filteredClientsCache.slice(displayedCount, displayedCount + PAGE_SIZE);
    for (const item of batch) {
        container.appendChild(createCard(item.key, item.data));
    }
    displayedCount += batch.length;
    isLoadingMore = false;
}

function setupInfiniteScroll() {
    if (observer) observer.disconnect();
    
    let sentinel = document.getElementById('scroll-sentinel');
    if (!sentinel) {
        sentinel = document.createElement('div');
        sentinel.id = 'scroll-sentinel';
        sentinel.style.height = '20px';
        sentinel.style.width = '100%';
    }
    document.getElementById('main-section').appendChild(sentinel);

    observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && !isLoadingMore && displayedCount < filteredClientsCache.length) {
            isLoadingMore = true;
            setTimeout(() => { renderNextBatch(); }, 150);
        }
    }, { rootMargin: '200px' });
    
    observer.observe(sentinel);
}

// ==================== UTILS UI ====================
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function showToast(msg, duration = 2500) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), duration);
}

function updateOnlineStatus() {
    const dot = document.getElementById('online-dot');
    dot.classList.toggle('offline', !navigator.onLine);
    if (navigator.onLine) syncPendingWrites();
}

function openModal(html) {
    document.getElementById('modal-container').innerHTML = `<div class="modal-overlay" onclick="handleOverlayClick(event)">${html}</div>`;
}
function closeModal() { document.getElementById('modal-container').innerHTML = ''; }
function handleOverlayClick(e) { if (e.target.classList.contains('modal-overlay')) closeModal(); }

// ==================== CARTES & ACTIONS ====================
function createCard(key, data) {
    const isDone = data.statut === true || data.statut === "true";
    const card = document.createElement('div');
    card.className = 'card' + (isDone ? ' done' : '');
    card.id = 'card_' + key;

    const photoStyle = data.photo_url ? 'background: var(--success); border-color: var(--success);' : '';
    const photoIcon = data.photo_url ? '✅' : '📷';
    
    let anomalyHtml = '';
    if (data.audio_url) {
        anomalyHtml = `<div class="anomaly-badge">🎙️ Note vocale enregistrée</div>`;
    } else if (data.note) {
        anomalyHtml = `<div class="anomaly-badge">⚠️ ${escapeHtml(data.note)}</div>`;
    }

    if (isDone) {
        const conso = (Number(data.new_index) || 0) - (Number(data.last_index) || 0);
        card.innerHTML = `
            <div class="client-header">
                <span class="client-name">${escapeHtml(data.name)}</span>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span class="compteur-num">📟 ${escapeHtml(String(data.numero_compteur))}</span>
                    <button class="btn-photo" onclick="takePhoto('${key}')" style="${photoStyle}">${photoIcon}</button>
                </div>
            </div>
            ${anomalyHtml}
            <div class="validated-index">✅ ${data.new_index} m³</div>
            <div class="conso-alert normal">💧 ${conso.toFixed(1)} m³ · 💰 ${Math.round(data.apaid || 0)} F</div>
            <button class="btn-edit" onclick="editReading('${key}')" style="margin-top:10px;">✏️ Modifier</button>
        `;
    } else {
        card.innerHTML = `
            <div class="client-header">
                <span class="client-name">${escapeHtml(data.name)}</span>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span class="compteur-num">🔢 ${escapeHtml(String(data.numero_compteur))}</span>
                    <button class="btn-photo" onclick="takePhoto('${key}')" style="${photoStyle}">${photoIcon}</button>
                </div>
            </div>
            <div class="old-index">Dernier index: ${data.last_index} m³</div>
            ${anomalyHtml}
            <div class="saisie-container">
                <div class="index-box clickable-box" onclick="openKeypad('${key}', ${data.last_index})">
                    <span class="index-value-large" id="indexValue_${key}">---</span>
                </div>
                <div class="action-buttons">
                    <button class="btn-anomaly" onclick="openAudioModal('${key}')" title="Signaler un problème vocalement">🎙️</button>
                    <button id="btn_ok_${key}" class="btn-ok" disabled onclick="confirmReading('${key}')">✅ Valider</button>
                </div>
            </div>
        `;
    }
    return card;
}

// ==================== CAMÉRA HD, RÉVISION & OCR OPTIMISÉ ====================
async function takePhoto(key) {
    if (!navigator.onLine) {
        showToast('❌ Connexion requise pour envoyer la photo');
        return;
    }
    currentPhotoKey = key;
    document.getElementById('camera-modal').classList.remove('hidden');
    document.getElementById('camera-live-view').classList.remove('hidden');
    document.getElementById('camera-preview-view').classList.add('hidden');
    document.getElementById('ocr-input').value = '';
    document.getElementById('ocr-status').innerHTML = '🔍 Analyse de l\'image en cours...';

    try {
        const video = document.getElementById('camera-video');
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
        });
        video.srcObject = cameraStream;
    } catch (err) {
        showToast('❌ Accès caméra refusé');
        stopCamera();
    }
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    document.getElementById('camera-modal').classList.add('hidden');
    currentPhotoKey = null;
    currentPhotoBlob = null;
}

function retakePhoto() {
    document.getElementById('camera-preview-view').classList.add('hidden');
    document.getElementById('camera-live-view').classList.remove('hidden');
    takePhoto(currentPhotoKey);
}

async function captureImage() {
    if (!currentPhotoKey) return;
    
    const video = document.getElementById('camera-video');
    
    // 1. Capture de la photo complète pour la sauvegarde HD
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = video.videoWidth;
    fullCanvas.height = video.videoHeight;
    const fullCtx = fullCanvas.getContext('2d');
    fullCtx.drawImage(video, 0, 0, fullCanvas.width, fullCanvas.height);

    // 2. Création d'un "mini-canvas" pour recadrer uniquement le centre (le cadran) pour l'IA
    const ocrCanvas = document.createElement('canvas');
    // On prend environ 50% du centre de l'image (là où se trouve le cercle de ciblage)
    const cropSize = Math.min(video.videoWidth, video.videoHeight) * 0.5; 
    ocrCanvas.width = cropSize;
    ocrCanvas.height = cropSize;
    const ocrCtx = ocrCanvas.getContext('2d');
    
    const startX = (video.videoWidth - cropSize) / 2;
    const startY = (video.videoHeight - cropSize) / 2;
    
    // On dessine uniquement le centre recadré
    ocrCtx.drawImage(video, startX, startY, cropSize, cropSize, 0, 0, cropSize, cropSize);

    // 3. Traitement de l'image (Noir & Blanc et Contraste fort) pour aider l'IA
    let imgData = ocrCtx.getImageData(0, 0, cropSize, cropSize);
    let data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
        // Niveaux de gris
        let brightness = 0.34 * data[i] + 0.5 * data[i+1] + 0.16 * data[i+2];
        // Augmentation du contraste (+50%)
        brightness = (brightness - 128) * 1.5 + 128;
        brightness = Math.max(0, Math.min(255, brightness));
        data[i] = data[i+1] = data[i+2] = brightness;
    }
    ocrCtx.putImageData(imgData, 0, 0);

    // Arrête le flux vidéo
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }

    // Bascule l'UI vers la révision
    document.getElementById('camera-live-view').classList.add('hidden');
    document.getElementById('camera-preview-view').classList.remove('hidden');
    const imgPreview = document.getElementById('preview-img');
    
    // Sauvegarde la photo pleine résolution
    fullCanvas.toBlob((blob) => {
        currentPhotoBlob = blob;
        imgPreview.src = URL.createObjectURL(blob);
    }, 'image/jpeg', 0.95);

    // 4. Lancement de Tesseract OCR sur l'image RECADRÉE et FILTRÉE
    try {
        const result = await Tesseract.recognize(ocrCanvas, 'eng', {
            tessedit_char_whitelist: '0123456789.,' // On force l'IA à ne voir que des chiffres
        });

        // Nettoyage agressif des parasites potentiels restants
        let detectedText = result.data.text.replace(/[^0-9.,]/g, '').replace(',', '.');
        
        if(detectedText.trim() !== '') {
            // Conversion propre (enlève les 0 inutiles au début)
            let finalNumber = parseFloat(detectedText);
            if (!isNaN(finalNumber)) {
                document.getElementById('ocr-input').value = finalNumber;
                document.getElementById('ocr-status').innerHTML = '✅ Chiffres détectés ! Vérifiez avant de valider.';
            } else {
                document.getElementById('ocr-status').innerHTML = '⚠️ Chiffres flous. Veuillez saisir manuellement.';
            }
        } else {
            document.getElementById('ocr-status').innerHTML = '⚠️ L\'IA n\'a pas pu lire. Veuillez saisir manuellement.';
        }
    } catch(err) {
        console.error("Erreur OCR:", err);
        document.getElementById('ocr-status').innerHTML = '❌ Erreur de l\'analyse. Saisissez manuellement.';
    }
}

async function confirmPhotoAndIndex() {
    const key = currentPhotoKey;
    const indexValue = document.getElementById('ocr-input').value.trim();
    
    if (!currentPhotoBlob) return;
    if (indexValue === '' || isNaN(parseFloat(indexValue))) {
        showToast('⚠️ Veuillez saisir un index valide avant d\'envoyer.');
        return;
    }

    // Pré-remplit l'interface principale
    const indexSpan = document.getElementById(`indexValue_${key}`);
    const btnOk = document.getElementById(`btn_ok_${key}`);
    
    if (indexSpan && btnOk) {
        indexSpan.textContent = parseFloat(indexValue);
        btnOk.disabled = false;
    }

    // Envoi de l'image
    showToast('⏳ Envoi de l\'image en cours...', 3000);
    const btnConfirm = document.getElementById('btn-confirm-photo');
    btnConfirm.disabled = true;
    btnConfirm.innerHTML = 'Envoi...';

    const formData = new FormData();
    formData.append('file', currentPhotoBlob);
    formData.append('upload_preset', 'Forage');
    formData.append('folder', 'asufor_compteurs');

    try {
        const res = await fetch('https://api.cloudinary.com/v1_1/dqmixe6oj/image/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.secure_url) {
            await db.ref(`asufor_db_diandioly/${key}`).update({ photo_url: data.secure_url, last_modified: Date.now() });
            
            const btnCam = document.querySelector(`#card_${key} .btn-photo`);
            if (btnCam) { btnCam.innerHTML = '✅'; btnCam.style.background = 'var(--success)'; btnCam.style.borderColor = 'var(--success)'; }
            
            showToast('✅ Photo enregistrée. Vous pouvez Valider le relevé !', 4000);
            stopCamera(); 
        }
    } catch (err) {
        showToast('❌ Échec de l\'envoi de la photo');
        btnConfirm.disabled = false;
        btnConfirm.innerHTML = '✅ Valider l\'index';
    }
}

// ==================== ENREGISTREMENT VOCAL ====================
function openAudioModal(key) {
    audioBlob = null;
    audioChunks = [];
    openModal(`
        <div class="modal-content" style="text-align:center;">
            <h3 class="modal-title">🎙️ Signaler une anomalie</h3>
            <p style="color:var(--text-secondary); margin-bottom:20px; font-size:0.9rem;">Enregistrez un message vocal pour expliquer le problème du compteur.</p>
            <div id="audio-controls">
                <button id="btn-record" onclick="startRecording()" style="background:var(--danger); color:white; width:80px; height:80px; border-radius:50%; border:none; font-size:2.5rem; cursor:pointer; box-shadow:0 0 20px var(--danger-bg);">⏺</button>
                <p id="record-status" style="margin-top:15px; font-weight:bold; color:var(--danger); display:none; animation: pulse 1s infinite;">Enregistrement en cours...</p>
            </div>
            <div id="audio-preview" style="display:none; margin-top:20px;">
                <audio id="audio-playback" controls style="width:100%; border-radius:30px;"></audio>
                <button onclick="resetRecording()" style="background:transparent; border:1px solid var(--text-secondary); color:var(--text-secondary); padding:8px 16px; border-radius:20px; margin-top:15px; cursor:pointer;">↺ Recommencer</button>
            </div>
            <div class="modal-actions" style="margin-top:30px;">
                <button class="btn-modal secondary" onclick="closeAudioModal()">Annuler</button>
                <button id="btn-send-audio" class="btn-modal primary" disabled onclick="sendAudioAnomaly('${key}')">Envoyer</button>
            </div>
        </div>
    `);
}

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000, channelCount: 1 } 
        });
        
        let options = { audioBitsPerSecond: 128000 };
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) options.mimeType = 'audio/webm;codecs=opus';
        else if (MediaRecorder.isTypeSupported('audio/mp4')) options.mimeType = 'audio/mp4'; 
        else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) options.mimeType = 'audio/ogg;codecs=opus';

        mediaRecorder = new MediaRecorder(stream, options);
        mediaRecorder.start();
        
        document.getElementById('btn-record').setAttribute('onclick', 'stopRecording()');
        document.getElementById('btn-record').innerHTML = '⏹';
        document.getElementById('record-status').style.display = 'block';

        mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) audioChunks.push(e.data); };

        mediaRecorder.onstop = () => {
            const mimeType = mediaRecorder.mimeType || 'audio/webm';
            audioBlob = new Blob(audioChunks, { type: mimeType });
            document.getElementById('audio-playback').src = URL.createObjectURL(audioBlob);
            
            document.getElementById('audio-controls').style.display = 'none';
            document.getElementById('audio-preview').style.display = 'block';
            document.getElementById('btn-send-audio').disabled = false;
            
            stream.getTracks().forEach(track => track.stop());
        };
    } catch(err) {
        showToast('❌ Accès micro refusé');
    }
}

function stopRecording() { if(mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); }

function resetRecording() {
    audioChunks = []; audioBlob = null;
    document.getElementById('audio-preview').style.display = 'none';
    document.getElementById('audio-controls').style.display = 'block';
    document.getElementById('btn-record').setAttribute('onclick', 'startRecording()');
    document.getElementById('btn-record').innerHTML = '⏺';
    document.getElementById('record-status').style.display = 'none';
    document.getElementById('btn-send-audio').disabled = true;
}

function closeAudioModal() {
    if(mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    closeModal();
}

async function sendAudioAnomaly(key) {
    if (!audioBlob) return;
    if (!navigator.onLine) { showToast('❌ Connexion requise pour envoyer l\'audio'); return; }

    const btn = document.getElementById('btn-send-audio');
    btn.innerHTML = '⏳ Envoi...'; btn.disabled = true;

    const extension = audioBlob.type.includes('mp4') ? '.m4a' : '.webm';
    const audioFile = new File([audioBlob], `note_${key}${extension}`, { type: audioBlob.type });

    const formData = new FormData();
    formData.append('file', audioFile);
    formData.append('upload_preset', 'Forage');
    formData.append('folder', 'asufor_audio');

    try {
        const res = await fetch('https://api.cloudinary.com/v1_1/dqmixe6oj/video/upload', { method: 'POST', body: formData });
        const data = await res.json();
        
        if (data.secure_url) {
            await db.ref(`asufor_db_diandioly/${key}`).update({ note: "Note vocale", audio_url: data.secure_url, anomaly_date: Date.now(), last_modified: Date.now() });
            closeAudioModal(); showToast('✅ Note vocale envoyée !');
        } else throw new Error('Erreur Cloudinary');
    } catch(err) {
        showToast('❌ Échec de l\'envoi'); btn.innerHTML = 'Envoyer'; btn.disabled = false;
    }
}

// ==================== RELEVÉS MANUELS ====================
function openKeypad(key, last) {
    openModal(`
        <div class="modal-content keypad-modal">
            <div class="keypad-display"><span class="keypad-value" id="key-val">---</span></div>
            <div class="keypad-grid">${[1,2,3,4,5,6,7,8,9,'.',0,'⌫'].map(k => `<button class="keypad-btn" onclick="keypadInput('${k}')">${k}</button>`).join('')}</div>
            <div class="modal-actions">
                <button class="btn-modal secondary" onclick="closeModal()">Annuler</button>
                <button class="btn-modal primary" onclick="validateKeypad('${key}', ${last})">OK</button>
            </div>
        </div>
    `);
}

function keypadInput(k) {
    const d = document.getElementById('key-val');
    let c = d.textContent === '---' ? '' : d.textContent;
    if (k === '⌫') c = c.slice(0, -1); else if (k === '.' && c.includes('.')) return; else c += k;
    d.textContent = c || '---';
}

function validateKeypad(key, last) {
    const v = parseFloat(document.getElementById('key-val').textContent);
    if (isNaN(v) || v <= last) return showToast("Index invalide");
    closeModal();
    document.getElementById(`indexValue_${key}`).textContent = v;
    document.getElementById(`btn_ok_${key}`).disabled = false;
}

function confirmReading(key) {
    const val = parseFloat(document.getElementById(`indexValue_${key}`).textContent);
    const item = clientsCache.find(c => c.key === key);
    const conso = val - Number(item.data.last_index);
    const apaid = Math.round(conso * PRICE_PER_M3);
    
    openModal(`
        <div class="modal-content">
            <h3 class="modal-title">🔍 Confirmer le relevé</h3>
            <p style="text-align:center; color:var(--text-primary); margin-bottom:10px; font-weight:bold;">${escapeHtml(item.data.name)}</p>
            <div style="background:var(--bg-elevated); padding:16px; border-radius:16px;">
                <div class="rep-row"><span>Nouveau Index:</span><b style="color:var(--accent);">${val} m³</b></div>
                <div class="rep-row"><span>Consommation:</span><b>${conso.toFixed(1)} m³</b></div>
                <div class="rep-row"><span>Montant:</span><b style="color:var(--success);">${apaid.toLocaleString('fr-FR')} F</b></div>
            </div>
            <div class="modal-actions">
                <button class="btn-modal secondary" onclick="closeModal()">Annuler</button>
                <button class="btn-modal primary" onclick="submitReading('${key}', ${val}, ${apaid})">Valider</button>
            </div>
        </div>
    `);
}

async function submitReading(key, val, apaid) {
    const upd = { new_index: val, apaid: apaid, statut: true, releve_date: Date.now(), last_modified: Date.now() };
    if (navigator.onLine) await db.ref(`asufor_db_diandioly/${key}`).update(upd);
    else await addPendingWrite({ path: `asufor_db_diandioly/${key}`, data: upd });
    closeModal(); showToast("Enregistré !");
}

function editReading(key) {
    const item = clientsCache.find(c => c.key === key);
    if(!item) return;
    const data = item.data;
    openModal(`
        <div class="modal-content">
            <h3 class="modal-title">✏️ Modifier le relevé</h3>
            <p style="text-align:center; font-weight:bold; color:var(--text-primary);">${escapeHtml(data.name)}</p>
            <div style="margin:16px 0;">
                <label style="color:var(--text-secondary); font-size:0.85rem;">Ancien index</label>
                <input type="number" class="login-input" value="${data.last_index}" disabled style="margin-bottom:12px; width:100%; border-radius:12px; padding:12px;">
                <label style="color:var(--text-secondary); font-size:0.85rem;">Nouvel index corrigé</label>
                <input type="number" id="edit-new-index" class="login-input" value="${data.new_index}" step="0.1" style="width:100%; border-radius:12px; padding:12px;">
            </div>
            <div class="modal-actions">
                <button class="btn-modal secondary" onclick="closeModal()">Annuler</button>
                <button class="btn-modal primary" onclick="submitEditReading('${key}', ${data.last_index})">Enregistrer</button>
            </div>
        </div>
    `);
}

async function submitEditReading(key, oldLastIndex) {
    const newIndex = parseFloat(document.getElementById('edit-new-index').value);
    if (isNaN(newIndex) || newIndex <= oldLastIndex) return showToast('Index invalide');
    const apaid = Math.round((newIndex - oldLastIndex) * PRICE_PER_M3);
    const upd = { new_index: newIndex, apaid: apaid, releve_date: Date.now(), last_modified: Date.now() };
    
    if (navigator.onLine) await db.ref(`asufor_db_diandioly/${key}`).update(upd);
    else await addPendingWrite({ path: `asufor_db_diandioly/${key}`, data: upd });
    
    closeModal(); showToast("Modification enregistrée !");
}

// ==================== NAV ====================
function navigateClient(dir) {
    if (!filteredClientsCache.length) return;
    currentClientIndex = Math.max(0, Math.min(filteredClientsCache.length - 1, currentClientIndex + dir));
    const k = filteredClientsCache[currentClientIndex].key;
    document.getElementById(`card_${k}`).scrollIntoView({ behavior: 'smooth', block: 'center' });
    updatePositionDisplay();
}

function updatePositionDisplay() {
    document.getElementById('client-position').textContent = `${currentClientIndex + 1} / ${filteredClientsCache.length}`;
}

function setFilter(f, b) {
    currentFilter = f;
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    b.classList.add('active');
    applyFiltersAndReset();
}

function applyFilters() { applyFiltersAndReset(); }

// ==================== BEAUX DIALOGUES ====================
function showReport() {
    if (!currentAgentId || !clientsCache.length) return showToast('📭 Aucune donnée');
    let total = clientsCache.length, done = 0, volume = 0, recette = 0;
    for (const { data } of clientsCache) {
        if (data.statut === true || data.statut === "true") {
            done++;
            const conso = (Number(data.new_index) || 0) - (Number(data.last_index) || 0);
            volume += Math.max(0, conso);
            recette += Number(data.apaid) || 0;
        }
    }
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    
    openModal(`
        <div class="modal-content">
            <h3 class="modal-title">📋 RAPPORT DE TOURNÉE</h3>
            <div class="rep-row"><span>📊 Progression</span><b>${pct}% (${done}/${total})</b></div>
            <div class="rep-row"><span>💧 Volume total</span><b>${volume.toFixed(1)} m³</b></div>
            <div class="rep-row"><span>💰 Recette totale</span><b style="color:var(--success);">${recette.toLocaleString('fr-FR')} F</b></div>
            
            <div class="modal-actions" style="margin-top: 24px;">
                <button class="btn-modal secondary" onclick="closeModal()">Fermer</button>
                <button class="btn-modal primary" style="background:var(--blue); color:white;" onclick="shareReport()">📤 Partager</button>
            </div>
        </div>
    `);
}

function shareReport() {
    let total = clientsCache.length, done = 0, volume = 0, recette = 0;
    for (const { data } of clientsCache) {
        if (data.statut === true || data.statut === "true") {
            done++;
            const conso = (Number(data.new_index) || 0) - (Number(data.last_index) || 0);
            volume += Math.max(0, conso); recette += Number(data.apaid) || 0;
        }
    }
    const txt = `📋 RAPPORT DE TOURNÉE\nAgent: ${localStorage.getItem('agent_name')}\nProgression: ${done}/${total}\nVolume: ${volume.toFixed(1)} m³\nRecette: ${recette.toLocaleString('fr-FR')} F`;
    if (navigator.share) {
        navigator.share({ title: 'Rapport ASUFOR', text: txt }).catch(console.error);
    } else {
        navigator.clipboard.writeText(txt);
        showToast("Rapport copié !");
    }
}

function confirmLogout() {
    openModal(`
        <div class="modal-content" style="text-align:center;">
            <div style="font-size: 3rem; margin-bottom: 10px;">🚪</div>
            <h3 class="modal-title">Déconnexion</h3>
            <p style="color:var(--text-secondary); margin-bottom: 20px;">Voulez-vous vraiment quitter votre session ?</p>
            <div class="modal-actions">
                <button class="btn-modal secondary" onclick="closeModal()">Annuler</button>
                <button class="btn-modal primary" style="background:var(--danger); color:white;" onclick="executeLogout()">Quitter</button>
            </div>
        </div>
    `);
}

function executeLogout() {
    localStorage.clear(); 
    location.reload();
}
// ==================== PWA INSTALL & INIT ====================
let deferredPrompt;

function isInStandaloneMode() {
    return (window.matchMedia('(display-mode: standalone)').matches) || (window.navigator.standalone === true);
}

// On capture l'événement d'installation de Chrome/Android
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // Empêche la barre par défaut
    deferredPrompt = e;  // Sauvegarde l'événement pour le bouton
    console.log("Prêt pour l'installation directe");
    
    // Si on n'est pas déjà dans l'app, on affiche notre bouton
    const installBanner = document.getElementById('install-banner');
    if (installBanner && !isInStandaloneMode()) {
        installBanner.classList.remove('hidden');
        installBanner.style.display = 'flex';
    }
});

window.addEventListener('appinstalled', () => {
    const installBanner = document.getElementById('install-banner');
    if (installBanner) installBanner.style.display = 'none';
    deferredPrompt = null;
    showToast("✅ Application installée !");
});

// ==================== INIT (DÉMARRAGE) ====================
window.addEventListener('DOMContentLoaded', () => {
    loadTheme(); 

    const installBanner = document.getElementById('install-banner');
    const installBtn = document.getElementById('install-btn');

    // Affichage forcé au démarrage si on est sur navigateur
    if (installBanner && !isInStandaloneMode()) {
        installBanner.classList.remove('hidden');
        installBanner.style.display = 'flex';
    } else if (installBanner) {
        installBanner.style.display = 'none';
    }

    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (deferredPrompt) {
                // --- INSTALLATION DIRECTE (Android/PC) ---
                deferredPrompt.prompt(); // Affiche la fenêtre système immédiatement
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') {
                    if (installBanner) installBanner.style.display = 'none';
                }
                deferredPrompt = null;
            } else {
                // --- CAS PARTICULIER (iPhone ou installation déjà lancée) ---
                // Si deferredPrompt est vide, c'est que le navigateur ne permet pas l'installation par code
                const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
                
                if (isiOS) {
                    openModal(`
                        <div class="modal-content" style="text-align:center;">
                            <div style="font-size: 3rem; margin-bottom: 10px;">🍏</div>
                            <h3 class="modal-title">Installation sur iPhone</h3>
                            <p style="color:var(--text-secondary); margin-bottom:15px; font-size:0.9rem;">Apple impose une installation manuelle :</p>
                            <div style="text-align:left; background:var(--bg-elevated); padding:15px; border-radius:15px; margin-bottom:20px; font-size:0.85rem;">
                                <p>Appuyez sur le bouton Partager <b>⍐</b> (en bas de Safari), puis choisissez <b>"Sur l'écran d'accueil"</b>.</p>
                            </div>
                            <button class="btn-modal primary" onclick="closeModal()">J'ai compris</button>
                        </div>
                    `);
                } else {
                    showToast("Veuillez utiliser le menu de votre navigateur pour installer.");
                }
            }
        });
    }

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(err => console.error('SW Error:', err));
    }
    
    if (localStorage.getItem('asufor_id')) {
        currentAgentId = localStorage.getItem('asufor_id');
        enterApp(localStorage.getItem('agent_name'), localStorage.getItem('agent_zone'));
    }
    
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
});

// EXPORTS (Gardez vos exports habituels ici...)

// EXPORTS
window.login = login;
window.setFilter = setFilter;
window.navigateClient = navigateClient;
window.confirmLogout = confirmLogout;
window.executeLogout = executeLogout;
window.confirmReading = confirmReading;
window.submitReading = submitReading;
window.editReading = editReading;
window.submitEditReading = submitEditReading;
window.openKeypad = openKeypad;
window.keypadInput = keypadInput;
window.validateKeypad = validateKeypad;
window.handleOverlayClick = handleOverlayClick;
window.closeModal = closeModal;
window.takePhoto = takePhoto;
window.stopCamera = stopCamera;
window.captureImage = captureImage;
window.retakePhoto = retakePhoto;
window.confirmPhotoAndIndex = confirmPhotoAndIndex;
window.openAudioModal = openAudioModal;
window.startRecording = startRecording;
window.stopRecording = stopRecording;
window.resetRecording = resetRecording;
window.closeAudioModal = closeAudioModal;
window.sendAudioAnomaly = sendAudioAnomaly;
window.applyFilters = applyFilters;
window.showReport = showReport;
window.shareReport = shareReport;
window.toggleTheme = toggleTheme;