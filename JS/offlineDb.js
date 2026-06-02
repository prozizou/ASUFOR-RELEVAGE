import { state } from './state.js';

const DB_NAME = 'AsuforOfflineDB';
const DB_VERSION = 2;
const STORE_NAME = 'pendingWrites';
const SYNC_STORE = 'syncMetadata';
let dbPromise;

export function openOfflineDB() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = (ev) => {
                const db = ev.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains(SYNC_STORE)) {
                    db.createObjectStore(SYNC_STORE, { keyPath: 'key' });
                }
            };
        });
    }
    return dbPromise;
}

export async function addPendingWrite(operation) {
    const db = await openOfflineDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const opWithMeta = {
        ...operation,
        timestamp: Date.now(),
        attempts: 0,
        agentId: state.currentAgentId
    };
    store.add(opWithMeta);
    return tx.complete;
}

export async function getPendingWrites() {
    const db = await openOfflineDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

export async function clearPendingWrite(id) {
    const db = await openOfflineDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    return tx.complete;
}

export async function updatePendingWriteAttempt(id, attempts) {
    const db = await openOfflineDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getRequest = store.get(id);
    
    return new Promise((resolve, reject) => {
        getRequest.onsuccess = () => {
            const data = getRequest.result;
            if (data) {
                data.attempts = attempts;
                data.lastAttempt = Date.now();
                store.put(data);
            }
            resolve();
        };
        getRequest.onerror = () => reject(getRequest.error);
    });
}

export async function getSyncMetadata(key) {
    const db = await openOfflineDB();
    const tx = db.transaction(SYNC_STORE, 'readonly');
    const store = tx.objectStore(SYNC_STORE);
    return new Promise((resolve) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result?.value || null);
        request.onerror = () => resolve(null);
    });
}

export async function setSyncMetadata(key, value) {
    const db = await openOfflineDB();
    const tx = db.transaction(SYNC_STORE, 'readwrite');
    const store = tx.objectStore(SYNC_STORE);
    store.put({ key, value });
    return tx.complete;
}
