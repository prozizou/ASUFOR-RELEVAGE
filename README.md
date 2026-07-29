# ASUFOR Relevage

PWA (Progressive Web App) de relevé de compteurs d'eau pour les agents de terrain des sites ASUFOR (multi-sites : Diandioly, Ogo, ...). Conçue pour fonctionner **hors ligne** dans des zones à connectivité instable, avec synchronisation automatique vers Firebase au retour du réseau.

## Structure des données Firebase

Les données sont organisées par site sous `Asufor/{forageKey}/` (ex. `Asufor/Asufor_diandioly/`, `Asufor/Asufor_ogo/`) :

- `agents/{agentId}` — agents de terrain (nom, téléphone, zone, code d'accès `passcode`).
- `compteurs/{compteurId}` — index de compteurs à relever pour ce site (`agent_id`, `name`, `last_index`, `new_index`, `statut`, ...).
- `config`, `backup/{cycle}`, `team` — configuration du site, sauvegardes de cycle et équipe (non utilisés par cette app de terrain).

Un même agent n'appartient qu'à un seul site. À la connexion, l'app recherche automatiquement dans quel site (`forageKey`) le code à 6 chiffres saisi correspond à un agent (voir `findAgentByPasscode` dans `JS/auth.js`), puis utilise ce `forageKey` pour toutes les lectures/écritures de compteurs (`JS/state.js#compteurPath`).

## Fonctionnalités

- Connexion agent par code (6 chiffres) — le site est déterminé automatiquement, avec repli hors ligne sur les données locales.
- Liste des clients filtrable (Tous / En attente / Relevés / Anomalies) et recherche.
- Saisie de l'index via pavé numérique custom, avec validation (nouvel index > ancien index).
- Capture photo du compteur avec lecture automatique de l'index par OCR (Tesseract.js), modifiable avant validation.
- Signalement d'anomalie avec photo dédiée.
- File d'attente d'écritures hors ligne (IndexedDB) + synchronisation automatique (retour réseau, toutes les 60s) avec résolution de conflit par horodatage (`last_modified`).
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
  config.js          Constantes (prix, seuils, version, config Firebase)
  state.js           État global partagé entre modules
  utils.js           Helpers métier centralisés (isDone, computeConso, computeApaid, hasAnomaly)
  auth.js            Connexion / déconnexion agent
  clients.js         Chargement, filtrage, rendu de la liste de clients
  actions.js         Saisie/validation/édition des relevés, signalement
  media.js           Caméra, capture photo, OCR, upload Cloudinary
  sync.js            Synchronisation des écritures en attente
  offlineDb.js        Accès IndexedDB (file d'attente hors ligne)
  reports.js         Rapport de tournée
  pwa.js             Bannière d'installation PWA
scripts/
  sync-version.js    Script de synchronisation de version (voir ci-dessous)
tests/
  utils.test.js      Tests unitaires des helpers métier
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

Les identifiants applicatifs (clé API Firebase publique, cloud name Cloudinary, upload preset) se trouvent dans `JS/config.js` et `JS/media.js`. Ce ne sont **pas des secrets serveur** (la clé API Firebase Web est publique par design), mais la sécurité réelle des données repose sur :

- Les **règles de sécurité Firebase Realtime Database** côté serveur (à configurer dans la console Firebase pour restreindre l'accès à `Asufor/{forageKey}/agents` et `Asufor/{forageKey}/compteurs`, ainsi que la lecture "shallow" de `Asufor` utilisée pour résoudre le site de l'agent).
- Le **mode de l'upload preset Cloudinary** (`Forage`) : privilégier un preset *signé* plutôt que *unsigned*.

⚠️ Voir l'analyse de sécurité du projet pour le détail des recommandations (authentification agent, règles Firebase, upload signé).

## Tests

```bash
npm test
```

Les tests couvrent actuellement les helpers métier de `JS/utils.js` (statut « terminé », détection d'anomalie, calcul de consommation et de montant à payer).

## Déploiement

Application statique : héberger `index.html`, `style.css`, `manifest.json`, `sw.js`, `offline.html`, `JS/` et `icons/` sur n'importe quel hébergeur de fichiers statiques (GitHub Pages, Firebase Hosting, Netlify, etc.). Aucune étape de build n'est requise pour l'exécution — seul l'outillage de développement (`npm install`) nécessite Node.js.

## Notes sur l'outillage

- `eslint.config.js` (flat config ESLint 9) couvre `JS/`, `sw.js`, `scripts/` et `tests/` avec les globals navigateur/service worker/Node adaptés.
- Une vulnérabilité connue (`brace-expansion`, dépendance transitive d'ESLint) n'a pas de correctif non-breaking disponible au moment de la rédaction ; elle n'affecte que l'outillage de développement, pas le code applicatif livré aux utilisateurs.
