export const PRICE_PER_M3 = 250;
export const HIGH_CONSO_THRESHOLD = 30;
export const VERY_HIGH_CONSO_THRESHOLD = 60;
export const PAGE_SIZE = 20;
export const APP_VERSION = '13.9.0';

// Numéro de projet Firebase (= messagingSenderId).
export const FIREBASE_PROJECT_NUMBER = '621722220561';

// appId de l'application **Web** enregistrée dans Firebase (Console Firebase →
// Paramètres du projet → Vos applications → application Web → appId, de la
// forme « 1:621722220561:web:xxxxxxxx »). L'ancien appId
// « 1:621722220561:android:… » était celui de l'application Android : il n'est
// pas valide pour le SDK Web. Tant que ce champ est vide, l'appId est omis
// (Auth et Realtime Database fonctionnent sans ; App Check/Analytics l'exigent).
export const FIREBASE_WEB_APP_ID = '';

export function isValidWebAppId(appId, projectNumber = FIREBASE_PROJECT_NUMBER) {
    return new RegExp(`^1:${projectNumber}:web:[0-9a-f]+$`).test(String(appId || ''));
}

export const firebaseConfig = {
    apiKey: "AIzaSyAKC7lrKSCFwfuoXASvX-yYIGneLXInvDk",
    authDomain: "asufor-67a06.firebaseapp.com",
    databaseURL: "https://asufor-67a06-default-rtdb.firebaseio.com",
    projectId: "asufor-67a06",
    storageBucket: "asufor-67a06.firebasestorage.app",
    messagingSenderId: FIREBASE_PROJECT_NUMBER,
    ...(isValidWebAppId(FIREBASE_WEB_APP_ID) ? { appId: FIREBASE_WEB_APP_ID } : {}),
};

// Fonction Vercel de connexion agent (api/agent-login.js). Chemin relatif : la PWA et
// l'API sont servies par le même projet Vercel. Si la PWA est ailleurs, mettre l'URL
// absolue du projet Vercel et déclarer l'origine de la PWA dans ALLOWED_ORIGINS.
export const AGENT_LOGIN_URL = '/api/agent-login';
