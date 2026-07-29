// js/media.js
import { db } from './main.js';
import { state, compteurPath } from './state.js';
import { showToast } from './ui.js';
import { addPendingWrite } from './offlineDb.js';

export async function loadTesseractIfNeeded() {
    if (state.tesseractLoaded) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        script.onload = () => { state.tesseractLoaded = true; resolve(); };
        script.onerror = () => reject(new Error('Erreur OCR'));
        document.head.appendChild(script);
    });
}

export async function takePhoto(key, mode = 'index') {
    state.currentPhotoKey = key;
    state.currentPhotoMode = mode; // 'index' ou 'signalement'

    if (mode === 'index') {
        try { await loadTesseractIfNeeded(); } catch (err) { showToast('❌ Lecture automatique indisponible'); return; }
    }

    document.getElementById('camera-modal').classList.remove('hidden');
    document.getElementById('camera-live-view').classList.remove('hidden');
    document.getElementById('camera-preview-view').classList.add('hidden');
    document.getElementById('ocr-input').value = '';
    document.getElementById('ocr-status').textContent = '🔍 Lecture en cours...';

    // Afficher ou masquer le bloc OCR selon le mode
    const ocrBox = document.querySelector('.ocr-box');
    if (ocrBox) ocrBox.style.display = mode === 'signalement' ? 'none' : '';

    // Adapter le label du bouton de confirmation
    const btnConfirm = document.getElementById('btn-confirm-photo');
    if (btnConfirm) {
        btnConfirm.innerHTML = mode === 'signalement' ? '📤 Envoyer le signalement' : '✅ Valider l\'index';
    }

    try {
        const video = document.getElementById('camera-video');
        state.cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
        });
        video.srcObject = state.cameraStream;
        await video.play();
    } catch (err) {
        showToast('❌ Accès caméra refusé');
        stopCamera();
    }
}

export function stopCamera() {
    if (state.cameraStream) {
        state.cameraStream.getTracks().forEach(track => track.stop());
        state.cameraStream = null;
    }
    releasePhotoObjectUrl();
    document.getElementById('camera-modal').classList.add('hidden');
}

export function releasePhotoObjectUrl() {
    if (state.currentPhotoObjectUrl) {
        URL.revokeObjectURL(state.currentPhotoObjectUrl);
        state.currentPhotoObjectUrl = null;
    }
}

export function retakePhoto() {
    if (state.currentPhotoKey) takePhoto(state.currentPhotoKey, state.currentPhotoMode);
}

export async function captureImage() {
    const video = document.getElementById('camera-video');
    const cropCanvas = cropToMeterFrame(video);

    const blob = await new Promise(resolve => cropCanvas.toBlob(resolve, 'image/jpeg', 0.90));
    state.currentPhotoBlob = blob;

    // Étape de PRÉVISUALISATION : on affiche l'image figée pour que l'agent vérifie
    releasePhotoObjectUrl();
    state.currentPhotoObjectUrl = URL.createObjectURL(blob);
    document.getElementById('preview-img').src = state.currentPhotoObjectUrl;
    
    document.getElementById('camera-live-view').classList.add('hidden');
    document.getElementById('camera-preview-view').classList.remove('hidden');
    
    // CORRECTION : On coupe juste le capteur vidéo pour économiser la batterie, 
    // MAIS on ne ferme pas la fenêtre (on ne fait plus appel à stopCamera() ici).
    if (state.cameraStream) {
        state.cameraStream.getTracks().forEach(track => track.stop());
        state.cameraStream = null;
    }
    
    if (state.currentPhotoMode !== 'signalement') {
        analyzeImageForOCR(cropCanvas);
    } else {
        document.getElementById('ocr-status').textContent = '';
    }
}

// Ne garde que la zone du cadran (cadre-guide affiché à l'écran), pas toute la scène.
const METER_FRAME_OUTPUT_SIZE = 640;

function cropToMeterFrame(video) {
    const frame = document.querySelector('.meter-frame');
    const videoRect = video.getBoundingClientRect();
    const frameRect = frame ? frame.getBoundingClientRect() : null;

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = METER_FRAME_OUTPUT_SIZE;
    cropCanvas.height = METER_FRAME_OUTPUT_SIZE;
    const ctx = cropCanvas.getContext('2d');

    if (!frameRect || !videoRect.width || !videoRect.height) {
        // Repli : pas de cadre détecté, on garde l'image complète.
        cropCanvas.width = video.videoWidth;
        cropCanvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        return cropCanvas;
    }

    // #camera-video est en object-fit:cover : la vidéo source est agrandie pour
    // couvrir tout le cadre affiché, puis rognée au centre. On calcule ce facteur
    // pour retrouver, dans la vidéo source, la zone correspondant au cadre-guide.
    const scale = Math.max(videoRect.width / video.videoWidth, videoRect.height / video.videoHeight);
    const renderedWidth = video.videoWidth * scale;
    const renderedHeight = video.videoHeight * scale;
    const overflowX = (renderedWidth - videoRect.width) / 2;
    const overflowY = (renderedHeight - videoRect.height) / 2;

    const sx = (frameRect.left - videoRect.left + overflowX) / scale;
    const sy = (frameRect.top - videoRect.top + overflowY) / scale;
    const sWidth = frameRect.width / scale;
    const sHeight = frameRect.height / scale;

    ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, METER_FRAME_OUTPUT_SIZE, METER_FRAME_OUTPUT_SIZE);
    return cropCanvas;
}

async function analyzeImageForOCR(canvas) {
    try {
        const result = await Tesseract.recognize(canvas, 'eng');
        const digits = result.data.text.replace(/[^0-9]/g, '');
        if (digits.length >= 3) {
            document.getElementById('ocr-input').value = digits;
            document.getElementById('ocr-status').textContent = '✅ Chiffre détecté';
        } else {
            document.getElementById('ocr-status').textContent = '⚠️ Chiffre illisible, corrigez-le vous-même';
        }
    } catch (e) { document.getElementById('ocr-status').textContent = '⚠️ Lecture impossible, entrez le chiffre vous-même'; }
}

export async function confirmPhotoAndIndex() {
    const key = state.currentPhotoKey;
    const mode = state.currentPhotoMode || 'index';
    const val = document.getElementById('ocr-input').value.trim();
    
    const btn = document.getElementById('btn-confirm-photo');
    btn.disabled = true;
    btn.innerHTML = '⏳ Envoi en cours...';

    const formData = new FormData();
    formData.append('file', state.currentPhotoBlob);
    formData.append('upload_preset', 'Forage');
    formData.append('folder', 'asufor_compteurs'); 

    try {
        // 1. Envoi de l'image sur Cloudinary
        const res = await fetch('https://api.cloudinary.com/v1_1/dqmixe6oj/image/upload', { method: 'POST', body: formData });
        const data = await res.json();
        
        // 2. Sauvegarde dans Firebase
        // L'anomalie n'est prise en compte qu'à ce stade (photo confirmée), pas dès le clic sur SIGNALEMENT.
        const updateData = { photo_url: data.secure_url, last_modified: Date.now() };
        if (mode === 'signalement') {
            updateData.note = 'Anomalie signalée';
            updateData.anomaly_date = Date.now();
        }
        if (navigator.onLine) await db.ref(compteurPath(key)).update(updateData);
        else await addPendingWrite({ path: compteurPath(key), data: updateData });

        if (mode === 'signalement') {
            showToast('📤 Signalement envoyé à l\'administration !');
        } else {
            showToast('✅ Photo envoyée à l\'administration !');
        }
        releasePhotoObjectUrl();
        document.getElementById('camera-modal').classList.add('hidden');

        // 3. Si mode index et index détecté, on l'affiche sur la carte
        if (mode === 'index' && val) {
            const indexSpan = document.getElementById(`indexValue_${key}`);
            const btnOk = document.getElementById(`btn_ok_${key}`);
            if (indexSpan) indexSpan.textContent = val;
            if (btnOk) btnOk.disabled = false;
        }

    } catch (err) { 
        showToast('❌ Erreur d\'envoi de l\'image'); 
    } finally {
        btn.disabled = false;
        btn.innerHTML = mode === 'signalement' ? '📤 Envoyer le signalement' : '✅ Valider l\'index';
    }
}
