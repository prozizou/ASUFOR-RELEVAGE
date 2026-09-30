# ASUFOR Relevage

PWA (Progressive Web App) de relevé de compteurs d'eau pour les agents de terrain des sites ASUFOR (multi-sites : Diandioly, Ogo, ...). Conçue pour fonctionner **hors ligne** dans des zones à connectivité instable, avec synchronisation automatique vers Firebase au retour du réseau.

## Structure des données Firebase

Les données sont organisées par site sous `Asufor/{forageKey}/` (ex. `Asufor/Asufor_diandioly/`, `Asufor/Asufor_ogo/`) :

- `agents/{agentId}` — agents de terrain (nom, téléphone `agent_tel`, zone, code d'accès haché `passcode_hash` = SHA-256 de `asufor_agent_v1:<code>`, écrit par ADMIN-FORAGE).
- `compteurs/{compteurId}` — index de compteurs à relever pour ce site (`agent_id`, `name`, `last_index`, `new_index`, `statut`, ...).
- `config`, `backup/{cycle}`, `team` — configuration du site, sauvegardes de cycle et équipe (non utilisés par cette app de terrain).

## Authentification agent

Le client ne lit **jamais** les fiches agents ni aucun code (clair ou haché) :

1. L'agent saisit téléphone + code 6 chiffres (`JS/auth.js#login`).
2. L'app appelle la fonction Vercel **`/api/agent-login`** (`api/agent-login.js`) : elle cherche l'agent par `agent_tel` sur tous les forages (ou sur le forage choisi), vérifie `passcode_hash` côté serveur, et renvoie un **Firebase Custom Token** portant les claims `{ role: "agent", forageKey, agentId }` (uid `agent:<forageKey>:<agentId>`).
3. Le client fait `signInWithCustomToken()` ; la session Firebase est persistée par le SDK. `forageKey`/`agentId` et le profil sont gardés dans `localStorage` (`JS/session.js`) pour le mode hors ligne.
4. Les règles RTDB (`database.rules.json`) n'accordent à l'agent que : le branding de **son** forage, **sa** fiche (sans `passcode`/`passcode_hash`), la lecture de **sa** tournée (`compteurs` filtrés par `agent_id == auth.token.agentId`) et l'écriture des seuls champs de relevé (`new_index`, `apaid`, `statut`, `releve_date`, `last_modified`, `note`, `photo_url`, `anomaly_date`) de **ses** compteurs. Aucun accès aux autres forages, archives, comptabilité ou administration.

Détails :

- **Multi-forage** : si le même téléphone + code existe sur plusieurs forages, la fonction renvoie `AMBIGUOUS_FORAGE` avec la liste des forages et l'app demande de choisir.
- **Erreurs** traduites en messages clairs (`JS/agentAuth.js#loginErrorMessage`) : code invalide, agent introuvable, aucun code configuré, trop de tentatives, `permission_denied`, hors ligne, session expirée.
- **Anti force brute** : 5 échecs par numéro (30 par IP) bloquent 15 min (nœud RTDB `agent_login_guard`, inaccessible aux clients).
- **Codes legacy** : un agent qui a encore un `passcode` en clair est accepté par la fonction (lecture serveur uniquement), qui le convertit aussitôt en `passcode_hash`.
- **Hors ligne** : aucun code n'est stocké en clair. Après une première connexion en ligne, un vérificateur PBKDF2 salé (téléphone + code) permet de se reconnecter sans réseau ; les relevés vont dans la file IndexedDB et partent au retour du réseau, dès qu'un jeton agent valide est disponible (sinon l'app redemande le code sans toucher à la file).
- **Anciennes sessions** (connexion anonyme + code en clair dans `localStorage`, ≤ 13.9) : échangées automatiquement contre un Custom Token au premier démarrage en ligne, puis le code en clair est supprimé.

## Fonctionnalités

- Connexion agent par numéro de téléphone + code (6 chiffres) via fonction Vercel + Custom Token — le forage est déterminé automatiquement (choix proposé en cas d'ambiguïté), avec reconnexion hors ligne sur l'appareil déjà utilisé.
- Liste des clients filtrable (Tous / En attente / Relevés / Anomalies) et recherche.
- Saisie de l'index via pavé numérique custom, avec validation (nouvel index > ancien index).
- Capture photo du compteur avec lecture automatique de l'index par OCR (Tesseract.js), modifiable avant validation.
- Signalement d'anomalie avec photo dédiée.
- File d'attente d'écritures hors ligne (IndexedDB) + synchronisation automatique (retour réseau, toutes les 60s) avec résolution de conflit par horodatage (`last_modified`). Seules les écritures de l'agent connecté sont rejouées (téléphone partagé) ; une coupure réseau ne consomme pas de tentative.
- Rapport de tournée (progression, volume, recette) partageable.
- Thème clair/sombre, installation en PWA (Add to Home Screen).

## Structure du projet

```
index.html          Point d'entrée, structure de l'UI
style.css            Styles
manifest.json        Manifeste PWA
sw.js                 Service worker (cache offline)
offline.html          Page affichée hors ligne si non mise en cache
JS/
  main.js            Bootstrap de l'app, expose les handlers sur window
  firebase.js        Initialisation Firebase (exporte `db`)
  config.js          Constantes (prix, seuils, version, config Firebase, URL de agentLogin)
  state.js           État global partagé entre modules
  utils.js           Helpers métier centralisés (isDone, computeConso, computeApaid, hasAnomaly)
  icons.js           Bibliothèque d'icônes SVG inline unique (remplace les emoji dans l'UI)
  auth.js            Connexion / déconnexion agent, reprise de session, reconnexion
  agentAuth.js       Appel de agentLogin, messages d'erreur, vérificateur hors ligne
  session.js         Session locale (localStorage) et état Firebase Auth
  clients.js         Chargement, filtrage, rendu de la liste de clients
  actions.js         Saisie/validation/édition des relevés, signalement
  media.js           Caméra, capture photo, OCR, upload Cloudinary
  sync.js            Synchronisation des écritures en attente
  writes.js          Écriture d'un compteur (directe ou mise en file)
  offlineDb.js        Accès IndexedDB (file d'attente hors ligne)
  reports.js         Rapport de tournée
  pwa.js             Bannière d'installation PWA
api/                 Fonction Vercel agent-login (Custom Token agent), logique dans api/_lib/
database.rules.json  Règles RTDB (celles d'ADMIN-FORAGE + accès agent par claims)
firebase.json        Config Firebase CLI (règles, functions, émulateur)
scripts/
  sync-version.js    Script de synchronisation de version (voir ci-dessous)
tests/
  utils.test.js      Tests unitaires des helpers métier
  agentLogin.test.js Logique serveur : login valide/invalide, mauvais téléphone/forage, anti force brute
  agentLoginRoute.test.js Route Vercel : statuts HTTP, CORS
  agentAuth.test.js  Client : erreurs, session, vérificateur hors ligne, firebaseConfig
  sync.test.js       Hors ligne puis resynchronisation (IndexedDB simulée)
  rules/             Règles RTDB sur l'émulateur (npm run test:rules)
icons/                Icônes PWA
```

## Prérequis

- Node.js ≥ 18 (utilisé uniquement pour l'outillage : lint, tests, script de version — l'app elle-même ne nécessite aucun build).

## Installation

```bash
npm install
```

## Scripts npm

| Script | Description |
| --- | --- |
| `npm run lint` | Vérifie le code avec ESLint |
| `npm run format` | Reformate le code avec Prettier |
| `npm run format:check` | Vérifie le formatage sans modifier les fichiers |
| `npm test` | Exécute les tests unitaires (Vitest) |
| `npm run test:rules` | Teste `database.rules.json` sur l'émulateur Realtime Database (Java requis) |
| `npm run sync-version` | Propage la version de `package.json` vers `config.js`, `sw.js` et `index.html` |

## Gestion de version

La version de l'application a une **source unique de vérité : le champ `version` de `package.json`**.

Pour publier une nouvelle version :

```bash
npm version patch   # ou minor / major
```

Cette commande incrémente `package.json`, exécute automatiquement `scripts/sync-version.js` (hook `version`) qui met à jour :

- `JS/config.js` (`APP_VERSION`, affiché dans l'UI et le rapport de tournée)
- `sw.js` (`CACHE_NAME`, force l'invalidation du cache du service worker)
- `index.html` (paramètres `?v=` de `style.css` et `JS/main.js`, cache-busting navigateur)

Le script échoue explicitement (au lieu d'échouer silencieusement) si l'un de ces motifs n'est plus trouvé dans les fichiers cibles, pour éviter toute désynchronisation.

Vous pouvez aussi lancer la synchronisation manuellement après avoir édité `package.json` :

```bash
npm run sync-version
```

## Configuration Firebase / Cloudinary

Les identifiants applicatifs (clé API Firebase publique, cloud name Cloudinary, upload preset) se trouvent dans `JS/config.js` et `JS/media.js`. Ce ne sont **pas des secrets serveur** (la clé API Firebase Web est publique par design) : la sécurité repose sur la fonction `api/agent-login.js` et les règles RTDB.

### appId Web

`JS/config.js` contenait l'appId de l'application **Android** (`1:621722220561:android:…`), invalide pour le SDK Web. Il est retiré : renseigner `FIREBASE_WEB_APP_ID` avec l'appId de l'application **Web** (Console Firebase → Paramètres du projet → Vos applications → Web, format `1:621722220561:web:…`). Un appId mal formé est ignoré (Auth et RTDB fonctionnent sans ; App Check/Analytics l'exigent).

### Mise en service de l'authentification agent

1. **Fonction Vercel** `api/agent-login.js` (déployée avec le site, aucune offre payante Firebase requise). Dans Vercel → Settings → Environment Variables :
   - `FIREBASE_SERVICE_ACCOUNT` : clé de service Firebase (Console Firebase → Paramètres → Comptes de service → Générer une clé), JSON brut ou encodé en base64. **Secret** : ne jamais la mettre dans le dépôt.
   - `FIREBASE_DATABASE_URL` (optionnel) et `ALLOWED_ORIGINS` (uniquement si la PWA n'est pas servie par ce même projet Vercel ; sinon `AGENT_LOGIN_URL` dans `JS/config.js` doit être l'URL absolue de l'API).
2. **Règles RTDB** : `database.rules.json` = règles d'ADMIN-FORAGE + section agents. Les deux dépôts partagent la même base : reporter ces modifications dans `ADMIN-FORAGE/database.rules.json` (source de vérité) avant tout `firebase deploy --only database`, sinon le dernier déploiement écrase l'autre. Ne déployer que les functions depuis ce dépôt tant que ce n'est pas fait.
3. **Index** : `Asufor/{forageKey}/agents` indexé sur `agent_tel` (déjà présent) et `compteurs` sur `agent_id` (ajouté).
4. **Auth** : ajouter le domaine de la PWA dans Authentication → Settings → Authorized domains.
5. Le compte de service de la clé n'a pas besoin d'autre rôle que ceux par défaut d'Admin SDK (signature du Custom Token en local).
6. Toujours recommandé : un upload preset Cloudinary *signé* plutôt que *unsigned*.

## Tests

```bash
npm test
```

Les tests couvrent les helpers métier (`JS/utils.js`), la logique serveur `agentLogin` et sa route HTTP (login valide/invalide, mauvais téléphone, mauvais forage, ambiguïté multi-forage, code legacy, anti force brute), la connexion côté client (messages d'erreur, session, vérificateur hors ligne, `firebaseConfig`) et le scénario hors ligne → resynchronisation.

Les règles RTDB se testent sur l'émulateur :

```bash
npm run test:rules
```

(agent qui lit sa tournée, ne lit ni `passcode_hash` ni les archives/comptabilité, ne lit ni n'écrit un autre forage, ne peut pas écrire le compteur d'un autre agent ; non-régression président/secrétaire). Le fichier est ignoré par `npm test` si `FIREBASE_DATABASE_EMULATOR_HOST` n'est pas défini.

## Déploiement

Application statique : héberger `index.html`, `style.css`, `manifest.json`, `sw.js`, `offline.html`, `JS/` et `icons/` sur n'importe quel hébergeur de fichiers statiques (GitHub Pages, Firebase Hosting, Netlify, etc.). Aucune étape de build n'est requise pour l'exécution — seul l'outillage de développement (`npm install`) nécessite Node.js. La fonction `api/agent-login.js` est déployée par Vercel avec le site.

## Notes sur l'outillage

- `eslint.config.js` (flat config ESLint 9) couvre `JS/`, `sw.js`, `scripts/` et `tests/` avec les globals navigateur/service worker/Node adaptés.
- Une vulnérabilité connue (`brace-expansion`, dépendance transitive d'ESLint) n'a pas de correctif non-breaking disponible au moment de la rédaction ; elle n'affecte que l'outillage de développement, pas le code applicatif livré aux utilisateurs.
