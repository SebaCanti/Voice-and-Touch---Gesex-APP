// OCR local de tarja: extrae el N° de pallet (debajo de "NUMERO DE PALLET", encima del código de barras).

let _palletOcrWorker = null;
let _palletOcrBusy = false;

function applyPalletNumber(palletNum) {
  if (!palletNum) return;
  const inputEl = document.getElementById('numeropallet-input');
  if (inputEl) inputEl.value = palletNum;
  if (typeof setField === 'function') setField('numeroPallet', palletNum);

  const insp = window.state && window.state.currentInspection;
  if (insp) {
    insp.numeroPallet = palletNum;
    if (!insp.cajas) insp.cajas = [];
    const cajaNum = window.state.currentBox || 1;
    const idx = insp.cajas.findIndex(c => c.caja === cajaNum);
    if (idx >= 0) {
      insp.cajas[idx].numeroPallet = palletNum;
    } else {
      insp.cajas.push({ caja: cajaNum, frutos: 0, numeroPallet: palletNum });
    }
  }
  if (typeof showSavedFlash === 'function') showSavedFlash('N° Pallet', palletNum);
}

function resetPalletCaptureUI() {
  const pp = document.getElementById('photo-pallet');
  if (pp) {
    const img = pp.querySelector('img');
    if (img) img.remove();
  }
  const guide = document.getElementById('pallet-guide');
  if (guide) guide.style.display = 'flex';
  const statusEl = document.getElementById('ocr-status');
  if (statusEl) {
    statusEl.style.display = 'none';
    statusEl.textContent = '🔍 Leyendo número de pallet…';
  }
  const input = document.getElementById('numeropallet-input');
  if (input) input.value = '';
  if (typeof setField === 'function') setField('numeroPallet', '');
}

function pickPalletNumberFromText(text) {
  if (!text) return '';
  const collapsed = String(text).replace(/(\d)[\s.\-]+(?=\d)/g, '$1');
  const upper = collapsed.toUpperCase();

  const afterHeading = upper.match(/(?:NUMERO|N[UÚ]MERO|NUMBER)\s*(?:DE\s*)?PALLET[^\d]{0,80}(\d{8,13})/);
  if (afterHeading) return afterHeading[1];

  const afterPallet = upper.match(/PALLET[^\d]{0,40}(\d{8,13})/);
  if (afterPallet) return afterPallet[1];

  const sequences = collapsed.match(/\d{7,18}/g) || [];
  const candidates = sequences.filter(s => {
    if (s.length >= 14) return false;
    if (s.startsWith('00')) return false;
    if (s.length < 8 || s.length > 13) return false;
    return true;
  });
  if (!candidates.length) return '';
  const tens = candidates.filter(s => s.length === 10);
  if (tens.length) return tens[tens.length - 1];
  return candidates.sort((a, b) => b.length - a.length)[0];
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo leer la foto'));
    img.src = dataUrl;
  });
}

function canvasToDataUrl(canvas, type, quality) {
  try {
    return canvas.toDataURL(type || 'image/jpeg', quality == null ? 0.9 : quality);
  } catch (e) {
    return canvas.toDataURL('image/png');
  }
}

function enhanceCanvas(srcCanvas) {
  const ctx = srcCanvas.getContext('2d');
  const id = ctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    let y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    y = (y - 128) * 1.85 + 128;
    if (y < 0) y = 0;
    if (y > 255) y = 255;
    const v = y > 155 ? 255 : (y < 85 ? 0 : y);
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(id, 0, 0);
  return srcCanvas;
}

async function preparePalletViews(dataUrl) {
  const img = await loadImageFromDataUrl(dataUrl);
  const maxW = 1600;
  const scale = img.width > maxW ? maxW / img.width : 1;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const full = document.createElement('canvas');
  full.width = w;
  full.height = h;
  full.getContext('2d').drawImage(img, 0, 0, w, h);

  // Zona inferior derecha: ahí va el N° de pallet en la tarja.
  const sx = Math.round(w * 0.36);
  const sy = Math.round(h * 0.38);
  const sw = w - sx;
  const sh = h - sy;
  const crop = document.createElement('canvas');
  crop.width = Math.round(sw * 2);
  crop.height = Math.round(sh * 2);
  const cctx = crop.getContext('2d');
  cctx.imageSmoothingEnabled = true;
  cctx.drawImage(full, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
  enhanceCanvas(crop);

  return {
    fullUrl: canvasToDataUrl(full, 'image/jpeg', 0.88),
    cropUrl: canvasToDataUrl(crop, 'image/png')
  };
}

async function getPalletOcrWorker() {
  if (_palletOcrWorker) return _palletOcrWorker;
  if (typeof Tesseract === 'undefined') {
    throw new Error('OCR no cargó — revisa la conexión');
  }
  _palletOcrWorker = await Tesseract.createWorker('eng', 1);
  await _palletOcrWorker.setParameters({
    tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz /',
    preserve_interword_spaces: '1'
  });
  return _palletOcrWorker;
}

async function ocrImage(dataUrl, psm) {
  const worker = await getPalletOcrWorker();
  await worker.setParameters({ tessedit_pageseg_mode: String(psm) });
  const result = await worker.recognize(dataUrl);
  return (result && result.data && result.data.text) || '';
}

async function tryBarcodePalletNumber(dataUrl) {
  if (typeof BarcodeDetector === 'undefined') return '';
  try {
    const formats = ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'codabar'];
    const detector = new BarcodeDetector({ formats });
    const img = await loadImageFromDataUrl(dataUrl);
    const codes = await detector.detect(img);
    for (const code of codes) {
      const raw = String(code.rawValue || '').replace(/\D/g, '');
      const picked = pickPalletNumberFromText(raw);
      if (picked) return picked;
    }
  } catch (e) {
    /* BarcodeDetector no disponible o formato no soportado */
  }
  return '';
}

async function extractPalletNumber(dataUrl) {
  const statusEl = document.getElementById('ocr-status');
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.textContent = '🔍 Leyendo número de pallet…';
  }
  if (_palletOcrBusy) return;
  _palletOcrBusy = true;

  const guide = document.getElementById('pallet-guide');
  if (guide) guide.style.display = 'none';

  try {
    let found = await tryBarcodePalletNumber(dataUrl);
    if (!found) {
      const views = await preparePalletViews(dataUrl);
      const texts = [];
      if (statusEl) statusEl.textContent = '🔍 Leyendo la tarja…';
      texts.push(await ocrImage(views.cropUrl, '6'));
      found = pickPalletNumberFromText(texts.join('\n'));
      if (!found) {
        texts.push(await ocrImage(views.cropUrl, '11'));
        found = pickPalletNumberFromText(texts.join('\n'));
      }
      if (!found) {
        if (statusEl) statusEl.textContent = '🔍 Buscando en toda la etiqueta…';
        texts.push(await ocrImage(views.fullUrl, '11'));
        found = pickPalletNumberFromText(texts.join('\n'));
      }
    }

    if (found && found.length >= 8) {
      applyPalletNumber(found);
      if (statusEl) statusEl.textContent = '✅ N° Pallet: ' + found;
    } else {
      if (statusEl) statusEl.textContent = '⚠️ No detectado — ingresa el número manualmente';
    }
  } catch (err) {
    console.warn('OCR pallet error:', err);
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.textContent = '⚠️ No se pudo leer — ingresa el número manualmente';
    }
  } finally {
    _palletOcrBusy = false;
  }
}
