// js/media.js
import { db } from './main.js';
import { state } from './state.js';
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

export async function takePhoto(key) {
    state.currentPhotoKey = key;
    try { await loadTesseractIfNeeded(); } catch (err) { showToast('❌ Module OCR indisponible'); return; }
    
    document.getElementById('camera-modal').classList.remove('hidden');
    document.getElementById('camera-live-view').classList.remove('hidden');
    document.getElementById('camera-preview-view').classList.add('hidden');
    document.getElementById('ocr-input').value = '';
    document.getElementById('ocr-status').textContent = '🔍 Analyse...';

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
    document.getElementById('camera-modal').classList.add('hidden');
}

export function retakePhoto() {
    if (state.currentPhotoKey) takePhoto(state.currentPhotoKey);
}

export async function captureImage() {
    const video = document.getElementById('camera-video');
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = video.videoWidth;
    fullCanvas.height = video.videoHeight;
    fullCanvas.getContext('2d').drawImage(video, 0, 0);

    const blob = await new Promise(resolve => fullCanvas.toBlob(resolve, 'image/jpeg', 0.90));
    state.currentPhotoBlob = blob;
    
    // Étape de PRÉVISUALISATION : on affiche l'image figée pour que l'agent vérifie
    document.getElementById('preview-img').src = URL.createObjectURL(blob);
    
    document.getElementById('camera-live-view').classList.add('hidden');
    document.getElementById('camera-preview-view').classList.remove('hidden');
    
    // CORRECTION : On coupe juste le capteur vidéo pour économiser la batterie, 
    // MAIS on ne ferme pas la fenêtre (on ne fait plus appel à stopCamera() ici).
    if (state.cameraStream) {
        state.cameraStream.getTracks().forEach(track => track.stop());
        state.cameraStream = null;
    }
    
    analyzeImageForOCR(fullCanvas);
}

async function analyzeImageForOCR(canvas) {
    try {
        const result = await Tesseract.recognize(canvas, 'eng');
        const digits = result.data.text.replace(/[^0-9]/g, '');
        if (digits.length >= 3) {
            document.getElementById('ocr-input').value = digits;
            document.getElementById('ocr-status').textContent = '✅ Chiffres détectés';
        } else {
            document.getElementById('ocr-status').textContent = '⚠️ Index illisible par l\'IA';
        }
    } catch (e) { document.getElementById('ocr-status').textContent = '⚠️ Erreur d\'analyse'; }
}

export async function confirmPhotoAndIndex() {
    const key = state.currentPhotoKey;
    const val = document.getElementById('ocr-input').value.trim();
    
    const btn = document.getElementById('btn-confirm-photo');
    btn.disabled = true; btn.innerHTML = '⏳ Envoi en cours...';

    const formData = new FormData();
    formData.append('file', state.currentPhotoBlob);
    formData.append('upload_preset', 'Forage');
    formData.append('folder', 'asufor_compteurs'); 

    try {
        // 1. Envoi de l'image sur Cloudinary
        const res = await fetch('https://api.cloudinary.com/v1_1/dqmixe6oj/image/upload', { method: 'POST', body: formData });
        const data = await res.json();
        
        // 2. Sauvegarde de l'URL Cloudinary dans Firebase
        const updateData = { photo_url: data.secure_url, last_modified: Date.now() };
        if (navigator.onLine) await db.ref(`asufor_db_diandioly/${key}`).update(updateData);
        else await addPendingWrite({ path: `asufor_db_diandioly/${key}`, data: updateData });

        showToast('✅ Photo envoyée à l\'administration !');
        document.getElementById('camera-modal').classList.add('hidden');
        
        // 3. Si un index a été détecté, on l'affiche sur la carte
        if (val) {
            const indexSpan = document.getElementById(`indexValue_${key}`);
            const btnOk = document.getElementById(`btn_ok_${key}`);
            if (indexSpan) indexSpan.textContent = val;
            if (btnOk) btnOk.disabled = false;
        }

    } catch (err) { 
        showToast('❌ Erreur d\'envoi de l\'image'); 
    } finally {
        btn.disabled = false; 
        btn.innerHTML = '✅ Valider l\'index';
    }
}
