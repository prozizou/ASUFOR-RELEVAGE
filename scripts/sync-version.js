#!/usr/bin/env node
// Propage la version unique de package.json vers config.js, sw.js et index.html.
// Source de vérité : package.json "version". Évite la désynchronisation manuelle
// (ex: config.js en v12, sw.js en v13, index.html en v9.6 observée avant ce script).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
const version = pkg.version;

if (!version) {
    throw new Error('Aucune version trouvée dans package.json');
}

function replaceOrThrow(filePath, pattern, replacement, label) {
    const content = readFileSync(filePath, 'utf8');
    if (!pattern.test(content)) {
        throw new Error(`Motif "${label}" introuvable dans ${filePath} — la synchronisation de version a échoué.`);
    }
    const updated = content.replace(pattern, replacement);
    writeFileSync(filePath, updated);
    console.log(`✅ ${label} -> ${version} (${filePath})`);
}

// JS/config.js : export const APP_VERSION = '...';
replaceOrThrow(
    join(rootDir, 'JS/config.js'),
    /export const APP_VERSION = '[^']*';/,
    `export const APP_VERSION = '${version}';`,
    'APP_VERSION'
);

// sw.js : const CACHE_NAME = 'asufor-v...';
replaceOrThrow(
    join(rootDir, 'sw.js'),
    /const CACHE_NAME = 'asufor-v[^']*';/,
    `const CACHE_NAME = 'asufor-v${version}';`,
    'CACHE_NAME'
);

// index.html : style.css?v=... et JS/main.js?v=...
{
    const filePath = join(rootDir, 'index.html');
    let content = readFileSync(filePath, 'utf8');

    const cssPattern = /style\.css\?v=[^"']*/;
    const jsPattern = /JS\/main\.js\?v=[^"']*/;

    if (!cssPattern.test(content) || !jsPattern.test(content)) {
        throw new Error(`Motifs de version introuvables dans ${filePath} — la synchronisation a échoué.`);
    }

    content = content.replace(cssPattern, `style.css?v=${version}`).replace(jsPattern, `JS/main.js?v=${version}`);

    writeFileSync(filePath, content);
    console.log(`✅ index.html (style.css + JS/main.js) -> ${version}`);
}

console.log(`\n🎉 Version synchronisée sur ${version}`);
