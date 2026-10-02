// Voice & Touch — Base de datos local (IndexedDB)
// Almacena inspecciones y fotos offline

const DB_NAME = 'VoiceAndTouchDB';
const DB_VERSION = 1;

let db = null;

export async function openDB() {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = e => {
      const d = e.target.result;

      // Inspecciones
      if (!d.objectStoreNames.contains('inspections')) {
        const store = d.createObjectStore('inspections', { keyPath: 'id' });
        store.createIndex('userId', 'userId', { unique: false });
        store.createIndex('synced', 'synced', { unique: false });
        store.createIndex('fecha', 'fecha', { unique: false });
      }

      // Fotos (blobs guardados localmente)
      if (!d.objectStoreNames.contains('photos')) {
        const ps = d.createObjectStore('photos', { keyPath: 'id' });
        ps.createIndex('inspectionId', 'inspectionId', { unique: false });
        ps.createIndex('synced', 'synced', { unique: false });
      }

      // Cola de sync pendiente
      if (!d.objectStoreNames.contains('syncQueue')) {
        d.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
      }
    };

    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = e => reject(e.target.error);
  });
}

// ── INSPECCIONES ──

export async function saveInspection(inspection) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('inspections', 'readwrite');
    inspection.updatedAt = Date.now();
    inspection.synced = false;
    tx.objectStore('inspections').put(inspection);
    tx.oncomplete = () => resolve(inspection);
    tx.onerror = e => reject(e.target.error);
  });
}

export async function getInspection(id) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const req = d.transaction('inspections').objectStore('inspections').get(id);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

export async function getAllInspections() {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const req = d.transaction('inspections').objectStore('inspections').getAll();
    req.onsuccess = e => resolve(e.target.result.sort((a,b) => b.updatedAt - a.updatedAt));
    req.onerror = e => reject(e.target.error);
  });
}

export async function getPendingSync() {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const req = d.transaction('inspections').objectStore('inspections').index('synced').getAll(false);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

export async function markSynced(id) {
  const d = await openDB();
  const insp = await getInspection(id);
  if (insp) {
    insp.synced = true;
    return saveInspection({ ...insp, synced: true });
  }
}

// ── FOTOS ──

export async function savePhoto(photo) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('photos', 'readwrite');
    photo.savedAt = Date.now();
    photo.synced = false;
    tx.objectStore('photos').put(photo);
    tx.oncomplete = () => resolve(photo);
    tx.onerror = e => reject(e.target.error);
  });
}

export async function getPhotosByInspection(inspectionId) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const req = d.transaction('photos').objectStore('photos').index('inspectionId').getAll(inspectionId);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

export async function getPendingPhotos() {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const req = d.transaction('photos').objectStore('photos').index('synced').getAll(false);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

// ── UTILIDADES ──

export function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
