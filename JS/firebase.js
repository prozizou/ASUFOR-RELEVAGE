// js/firebase.js
// Initialisation Firebase, isolée de main.js : les modules qui ont besoin de
// `db` l'importent d'ici. Importer main.js (chargé en main.js?v=…) depuis un
// autre module l'évaluerait une seconde fois sous une autre URL.
import { firebaseConfig } from './config.js';

if (!firebaseConfig.appId) {
    console.warn('⚠️ FIREBASE_WEB_APP_ID non renseigné (JS/config.js) : appId Web omis.');
}
firebase.initializeApp(firebaseConfig);
export const db = firebase.database();
