// Voice & Touch — Sincronización Firebase + Exportación local / iCloud Drive
// v3 — Fotos en IndexedDB, exportación ZIP para iCloud

import { getPendingSync, getPendingPhotos, markSynced, generateId } from './db.js';

// ── CONFIG FIREBASE (credenciales reales) ──
export const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBoXI_WV0QVAxyRGG2KNxA2OjfAXgGQ_Nc",
  authDomain:        "voiceandtouch-gesex.firebaseapp.com",
  projectId:         "voiceandtouch-gesex",
  storageBucket:     "voiceandtouch-gesex.firebasestorage.app",
  messagingSenderId: "415353292017",
  appId:             "1:415353292017:web:cddbc8844b2158dd53d550",
};

// Firebase Storage desactivado — fotos se exportan localmente
export const USE_STORAGE = false;

// ── ESTADO SYNC ──
let isSyncing = false;
let syncStatusCallback = null;

export function onSyncStatus(cb) { syncStatusCallback = cb; }

function setSyncStatus(status, count) {
  if (syncStatusCallback) syncStatusCallback(status, count);
}

// ── SYNC PRINCIPAL A FIRESTORE ──
export async function syncAll(firestore, storage, userId) {
  if (isSyncing || !navigator.onLine) return;
  isSyncing = true;
  setSyncStatus('syncing');

  try {
    const pending = await getPendingSync();
    for (const insp of pending) {
      try {
        // Guardar en Firestore sin blobs (solo metadatos)
        const inspToSave = { ...insp };
        delete inspToSave.photos; // no subir blobs a Firestore
        await firestore.collection('inspections').doc(insp.id).set({
          ...inspToSave,
          synced: true,
          syncedAt: Date.now()
        });
        await markSynced(insp.id);
      } catch (err) {
        console.warn('Error sync inspection:', insp.id, err);
      }
    }
    setSyncStatus('done', pending.length);
  } catch (err) {
    console.error('Sync error:', err);
    setSyncStatus('error');
  } finally {
    isSyncing = false;
  }
}

// ── CARGAR INSPECCIONES REMOTAS ──
export async function loadAllInspections(firestore) {
  if (!navigator.onLine) return null;
  try {
    const snap = await firestore
      .collection('inspections')
      .orderBy('updatedAt', 'desc')
      .limit(200)
      .get();
    return snap.docs.map(d => d.data());
  } catch (err) {
    console.warn('Error loading remote inspections:', err);
    return null;
  }
}

// ── EXPORTAR CSV ──
export function generateCSV(inspection) {
  const rows = [
    ['Campo', 'Valor'],
    ['Fecha', inspection.fecha || ''],
    ['Ciudad', inspection.ciudad || ''],
    ['Transporte', inspection.transporte || ''],
    ['Contenedor / AWB', inspection.contenedor || ''],
    ['Etiqueta', inspection.etiqueta || ''],
    ['Especie', inspection.especie || ''],
    ['Variedad', inspection.variedad || ''],
    ['Grower', inspection.grower || ''],
    ['Calibre', inspection.calibre || ''],
    ['Categoría', inspection.categoria || ''],
    ['Total cajas', inspection.cajas?.length || 0],
    ['Total frutos', inspection.totalFrutos || 0],
    ['Comentarios', inspection.comentarios || ''],
    [],
    ['DEFECTO', 'CANTIDAD', 'PORCENTAJE'],
  ];
  (inspection.defectos || []).forEach(d => {
    rows.push([d.nombre, d.cantidad, `${d.porcentaje || 0}%`]);
  });
  rows.push([]);
  rows.push(['CAJAS', 'FRUTOS']);
  (inspection.cajas || []).forEach((c, i) => {
    rows.push([`Caja ${i + 1}`, c.frutos || 0]);
  });
  return rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
}

// ── EXPORTAR ZIP (datos + fotos) para iCloud / descarga local ──
// Requiere JSZip en index.html: <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js">
export async function exportZip(inspection, photos) {
  if (typeof JSZip === 'undefined') {
    console.warn('JSZip no disponible, descargando solo CSV');
    downloadCSV(inspection);
    return;
  }

  const zip = new JSZip();
  const folderName = `Inspeccion_${(inspection.etiqueta || 'SinEtiqueta').replace(/\s/g,'_')}_${inspection.fecha || 'fecha'}`;
  const folder = zip.folder(folderName);

  // CSV con todos los datos
  folder.file('datos.csv', generateCSV(inspection));

  // JSON completo (sin blobs)
  const inspJson = { ...inspection };
  delete inspJson.photos;
  folder.file('inspeccion.json', JSON.stringify(inspJson, null, 2));

  // Fotos
  if (photos && photos.length > 0) {
    const fotoFolder = folder.folder('fotos');
    photos.forEach((p, i) => {
      if (p.blob) {
        fotoFolder.file(`foto_${i + 1}_${p.tipo || 'foto'}.jpg`, p.blob);
      } else if (p.dataUrl) {
        // Convertir dataURL a blob
        const byteString = atob(p.dataUrl.split(',')[1]);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let j = 0; j < byteString.length; j++) ia[j] = byteString.charCodeAt(j);
        fotoFolder.file(`foto_${i + 1}_${p.tipo || 'foto'}.jpg`, ab);
      }
    });
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, `${folderName}.zip`, 'application/zip');
  return true;
}

// ── DESCARGAR CSV ──
export function downloadCSV(inspection) {
  const csv = generateCSV(inspection);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const name = `Inspeccion_${(inspection.etiqueta || 'SinEtiqueta').replace(/\s/g,'_')}_${inspection.fecha || 'fecha'}.csv`;
  triggerDownload(blob, name, 'text/csv');
}

function triggerDownload(blob, filename, type) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}

// ── MONITOR CONEXIÓN ──
export function startConnectionMonitor(onOnline, onOffline) {
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}
