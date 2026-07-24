/* =====================================================================
   LOGBOOK — конфигурация
   ===================================================================== */
const $ = id => document.getElementById(id);

const CONFIG = {
  // 1) Создайте проект на https://supabase.com (бесплатный тир достаточен для старта)
  // 2) Settings → API → скопируйте Project URL и anon public key сюда
  SUPABASE_URL: 'https://broqhothpbdpqleezxff.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyb3Fob3RocGJkcHFsZWV6eGZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4MzEzNTEsImV4cCI6MjEwMDQwNzM1MX0.zoTmNAeeEpzpTw760Btdyxr3S1kHiI3pBJo-2FzAdr4',

  // 3) Backend-эндпоинты для AI-анализа и перевода — см. README.md,
  //    почему это НЕ должно быть прямым вызовом Anthropic/DeepL из браузера.
  AI_ENDPOINT: '', // напр. 'https://your-backend.example.com/api/ask-ai'
  TRANSLATE_ENDPOINT: '' // напр. 'https://your-backend.example.com/api/translate'
};

const supa = (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY)
  ? supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY)
  : null;

/* =====================================================================
   AUTH — регистрация/вход по email (magic link, без пароля).
   Если Supabase не настроен (локальная разработка без backend),
   авторизация полностью пропускается — сразу открывается список судна.
   ===================================================================== */
let currentProfile = null;

async function initAuth() {
  if (!supa) { showView('view-vessel'); await ensureSeed(); await renderVessel(); return; }

  supa.auth.onAuthStateChange(async (event, session) => {
    if (session) await handleSignedIn(session);
    else showView('view-login');
  });

  const { data: { session } } = await supa.auth.getSession();
  if (session) await handleSignedIn(session);
  else showView('view-login');
}

async function handleSignedIn(session) {
  $('userBadge').textContent = session.user.email;
  $('userBadge').style.display = 'inline';
  $('signOutBtn').style.display = 'inline-block';

  const { data: profile } = await supa.from('profiles').select('*').eq('id', session.user.id).single();
  currentProfile = profile;

  if (!profile || !profile.name) {
    showView('view-setname');
    return;
  }
  await ensureSeed();
  showView('view-vessel');
  await renderVessel();
}

$('sendMagicLinkBtn').addEventListener('click', async () => {
  const email = $('authEmail').value.trim();
  if (!email) { $('authStatus').textContent = 'Введите email.'; return; }
  $('authStatus').textContent = 'Отправляем...';
  const { error } = await supa.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
  $('authStatus').textContent = error ? ('Ошибка: ' + error.message) : 'Ссылка отправлена на ' + email + ' — откройте её на этом телефоне.';
});

$('saveProfileNameBtn').addEventListener('click', async () => {
  const name = $('profileNameInput').value.trim();
  if (!name) return;
  const { data: { session } } = await supa.auth.getSession();
  await supa.from('profiles').update({ name }).eq('id', session.user.id);
  currentProfile = { ...currentProfile, name };
  await ensureSeed();
  showView('view-vessel');
  await renderVessel();
});

$('signOutBtn').addEventListener('click', async () => {
  await supa.auth.signOut();
  currentProfile = null;
  $('userBadge').style.display = 'none';
  $('signOutBtn').style.display = 'none';
  showView('view-login');
});

/* =====================================================================
   IndexedDB — офлайн-хранилище на устройстве
   Работает всегда, даже без Supabase. При наличии сети данные
   синхронизируются в Supabase, при отсутствии — копятся в очереди.
   ===================================================================== */
const DB_NAME = 'logbook-db';
const DB_VERSION = 1;
const STORES = ['equipment', 'documents', 'journal', 'sync_queue'];

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB недоступен в этом браузере')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      STORES.forEach(name => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Не удалось открыть IndexedDB (возможно, приватная вкладка блокирует хранилище)'));
    req.onblocked = () => reject(new Error('IndexedDB заблокирован другой открытой вкладкой'));
  });
}
let dbPromise = openDB().catch(err => {
  console.warn('LOGBOOK: IndexedDB unavailable, falling back to in-memory storage (данные не переживут перезагрузку страницы):', err.message);
  return null; // сигнал использовать in-memory fallback ниже
});

// In-memory fallback, если IndexedDB совсем недоступен (напр. приватная вкладка).
const memoryStore = {};
STORES.forEach(name => { memoryStore[name] = new Map(); });

async function idbGetAll(store) {
  const db = await dbPromise;
  if (!db) return Array.from(memoryStore[store].values());
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(store, id) {
  const db = await dbPromise;
  if (!db) return memoryStore[store].get(id) || null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(store, obj) {
  const db = await dbPromise;
  if (!db) { memoryStore[store].set(obj.id, obj); return; }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(obj);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* =====================================================================
   DATA LAYER — единая точка доступа к данным.
   Логика: пишем всегда локально (мгновенно, работает офлайн).
   Если есть сеть и настроен Supabase — дублируем в облако и подтягиваем
   чужие изменения. Это "offline-first" паттерн.
   ===================================================================== */
const Data = {
  async listEquipment() {
    if (navigator.onLine && supa) {
      try {
        const { data, error } = await supa.from('equipment').select('*');
        if (!error && data) {
          for (const eq of data) await idbPut('equipment', eq);
          return data;
        }
      } catch (e) { /* сеть недоступна — используем локальный кэш */ }
    }
    return idbGetAll('equipment');
  },

  async getEquipment(code) {
    const local = await idbGet('equipment', code);
    if (navigator.onLine && supa) {
      try {
        const { data, error } = await supa.from('equipment').select('*').eq('id', code).single();
        if (!error && data) { await idbPut('equipment', data); return data; }
      } catch (e) {}
    }
    return local;
  },

  async saveEquipment(eq) {
    await idbPut('equipment', eq);
    await this._syncOrQueue('equipment', eq);
  },

  async getDocuments(code, docType) {
    const key = code + ':' + docType;
    const local = (await idbGet('documents', key)) || { id: key, items: [] };
    if (navigator.onLine && supa) {
      try {
        const { data, error } = await supa.from('documents').select('*').eq('equipment_id', code).eq('doc_type', docType).order('uploaded_at', { ascending: false });
        if (!error && data) { const rec = { id: key, items: data }; await idbPut('documents', rec); return rec.items; }
      } catch (e) {}
    }
    return local.items;
  },

  // Загрузка PDF требует сети — файл сразу уходит в Supabase Storage,
  // офлайн-очередь для бинарных файлов в этом каркасе не реализована
  // (см. README.md, раздел "Что ещё не сделано").
  // Гарантирует, что запись оборудования реально существует в Supabase,
  // прежде чем на неё что-то ссылается (документы, журнал). Нужна,
  // потому что оборудование могло быть создано локально/офлайн ещё до
  // подключения Supabase — без этой проверки загрузка документа падала
  // бы с ошибкой внешнего ключа.
  async ensureEquipmentSynced(code) {
    if (!navigator.onLine || !supa) return;
    try {
      const { data } = await supa.from('equipment').select('id').eq('id', code).single();
      if (data) return; // уже есть в облаке
    } catch (e) { /* не найдено — создаём ниже */ }
    const local = await idbGet('equipment', code);
    if (local) {
      try { await supa.from('equipment').upsert(local); } catch (e) { console.warn('ensureEquipmentSynced upsert failed:', e.message); }
    }
  },

  async uploadDocument(code, docType, file, title, uploaderName) {
    await this.ensureEquipmentSynced(code);
    const path = `${code}/${docType}/${Date.now()}_${file.name}`;
    // Safari/WebKit иногда отправляет пустое тело файла через FormData
    // (известный баг fetch+FormData на iOS) — читаем файл в ArrayBuffer
    // вручную и отправляем его напрямую, это обходит проблему.
    const arrayBuffer = await file.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      throw new Error('Файл прочитался пустым (0 байт) — возможно, он ещё не докачан из iCloud. Откройте файл через "Файлы" один раз, чтобы скачать его на устройство, и попробуйте снова.');
    }
    const { error: upErr } = await supa.storage.from('documents').upload(path, arrayBuffer, {
      contentType: file.type || 'application/pdf',
      upsert: false
    });
    if (upErr) throw upErr;
    const { data: pub } = supa.storage.from('documents').getPublicUrl(path);
    const record = {
      equipment_id: code, doc_type: docType, title,
      file_path: path, file_url: pub.publicUrl,
      uploaded_by_name: uploaderName, uploaded_at: new Date().toISOString()
    };
    const { error: insErr } = await supa.from('documents').insert(record);
    if (insErr) throw insErr;
    const key = code + ':' + docType;
    const local = (await idbGet('documents', key)) || { id: key, items: [] };
    local.items.unshift(record);
    await idbPut('documents', local);
  },

  async getJournal(code) {
    const local = await idbGet('journal', code) || { id: code, entries: [] };
    if (navigator.onLine && supa) {
      try {
        const { data, error } = await supa.from('journal_entries').select('*').eq('equipment_id', code).order('created_at', { ascending: false });
        if (!error && data) { const rec = { id: code, entries: data }; await idbPut('journal', rec); return rec; }
      } catch (e) {}
    }
    return local;
  },

  async addJournalEntry(code, entry) {
    const rec = await idbGet('journal', code) || { id: code, entries: [] };
    entry.created_at = new Date().toISOString();
    entry.equipment_id = code;
    rec.entries.unshift(entry);
    await idbPut('journal', rec);
    await this._syncOrQueue('journal_entries', entry);
  },

  // Если сеть есть — пишем сразу в Supabase. Если нет — кладём в очередь
  // на отложенную синхронизацию (worker ниже пробует её опустошить).
  async _syncOrQueue(table, record, extra) {
    if (navigator.onLine && supa) {
      try {
        await supa.from(table).upsert({ ...record, ...extra });
        return;
      } catch (e) { /* упало — уходим в очередь */ }
    }
    const queueItem = { id: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2), table, record: { ...record, ...extra } };
    await idbPut('sync_queue', queueItem);
  },

  async flushQueue() {
    if (!navigator.onLine || !supa) return;
    const queue = await idbGetAll('sync_queue');
    const db = await dbPromise;
    for (const item of queue) {
      try {
        await supa.from(item.table).upsert(item.record);
        const tx = db.transaction('sync_queue', 'readwrite');
        tx.objectStore('sync_queue').delete(item.id);
      } catch (e) { /* оставляем в очереди, попробуем позже */ }
    }
  }
};

window.addEventListener('online', () => { updateNetBadge(); Data.flushQueue(); });
window.addEventListener('offline', updateNetBadge);
function updateNetBadge() {
  const el = document.getElementById('netBadge');
  if (navigator.onLine) { el.textContent = '● online'; el.classList.add('online'); }
  else { el.textContent = '● offline'; el.classList.remove('online'); }
}

/* =====================================================================
   SEED DATA — демонстрационные данные котла UM100/12 (из чертежа 53817R1)
   При первом запуске без Supabase кладём в IndexedDB, чтобы было что
   показать. В проде эти данные грузятся через Supabase Studio / API.
   ===================================================================== */
async function ensureSeed() {
  const list = await idbGetAll('equipment');
  if (list.length) return;
  const eq = { id: '53817R1', name: 'UM 100/12 · GASOLIO · NAVY', category: 'Котёл', builder: 'BONO ENERGIA', capacity: '1000 кг/ч', pressure: '10 бар', fuel: 'Gasolio' };
  await idbPut('equipment', eq);
  // Мануал и схема теперь загружаются как PDF через интерфейс (см. вкладки
  // "Мануал" и "Схема") — готовых документов для сида нет, список пуст,
  // пока кто-то не загрузит первый файл.
}

/* =====================================================================
   UI
   ===================================================================== */
let currentCode = null;
let currentLang = 'ru';

function showView(id) { document.querySelectorAll('.view').forEach(v => v.classList.remove('active')); $(id).classList.add('active'); }

async function renderVessel() {
  const list = await Data.listEquipment();
  $('knownCodes').innerHTML = list.map(e => `<option value="${e.id}">`).join('');
  $('sysGrid').innerHTML = list.map(e => `
    <div class="sys-tile" data-code="${e.id}">
      <div class="name">${e.name}</div>
      <div class="code">${e.id}</div>
    </div>`).join('') + `<div class="sys-tile add" id="addSysTile">+ Добавить систему</div>`;
  document.querySelectorAll('[data-code]').forEach(t => t.addEventListener('click', () => openEquipment(t.dataset.code)));
  $('addSysTile').addEventListener('click', addNewSystem);
  $('syncHint').textContent = supa ? 'Supabase подключён — данные синхронизируются при наличии сети.' : 'Supabase не настроен — работа только в локальном офлайн-режиме (см. README.md).';
}

async function addNewSystem() {
  const name = prompt('Название системы (напр. Главный двигатель, Генератор №1):');
  if (!name) return;
  const code = prompt('Код / инвентарный номер (с QR-этикетки):', name.replace(/\s+/g, '-').toUpperCase());
  if (!code) return;
  const category = prompt('Категория (Котёл / Двигатель / Генератор / Насос / Другое):', 'Другое') || 'Другое';
  const list = await Data.listEquipment();
  if (list.find(e => e.id === code)) { alert('Такой код уже есть.'); return; }
  await Data.saveEquipment({ id: code, name, category });
  await renderVessel();
  openEquipment(code);
}

async function openEquipment(code) {
  code = (code || '').trim();
  if (!code) return;
  const eq = await Data.getEquipment(code);
  if (!eq) { alert('Оборудование с кодом "' + code + '" не найдено.'); return; }
  currentCode = eq.id;
  $('eqCardArea').innerHTML = `
    <div class="eq-title">${eq.name}</div>
    <div class="eq-card">
      <div>Категория: ${eq.category || '—'}</div>
      <div>Производитель: ${eq.builder || '—'}</div>
      <div>Код: ${eq.id}</div>
    </div>`;
  showView('view-dash');
}

$('findBtn').addEventListener('click', () => openEquipment($('codeInput').value));
$('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') openEquipment($('codeInput').value); });
$('backToVessel').addEventListener('click', () => { showView('view-vessel'); renderVessel(); });
$('backToDash').addEventListener('click', () => showView('view-dash'));
document.querySelectorAll('.tile[data-tab]').forEach(t => t.addEventListener('click', () => openSection(t.dataset.tab)));
document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => openSection(b.dataset.tab)));

function openSection(tab) {
  showView('view-sections');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
  $('tab-' + tab).style.display = 'block';
  if (tab === 'manual') renderManualDocs();
  if (tab === 'schema') renderSchemaDocs();
  if (tab === 'journal') renderJournal();
  if (tab === 'ai') { $('aiAnswer').textContent = ''; }
}

/* ---- Manual documents (immutable PDFs — upload only, no edit/delete) ---- */
async function renderManualDocs() {
  const docs = await Data.getDocuments(currentCode, 'manual');
  $('manualDocsList').innerHTML = docs.length ? docs.map(d => `
    <div class="doc-item">
      <div><div class="doc-title">${d.title}</div><div class="doc-meta">${new Date(d.uploaded_at).toLocaleString('ru-RU')} · ${d.uploaded_by_name || ''}</div></div>
      <a href="${d.file_url}" target="_blank" rel="noopener">Открыть PDF →</a>
    </div>`).join('') : '<p class="empty">Мануал ещё не загружен.</p>';
}
$('uploadManualBtn').addEventListener('click', () => uploadDoc('manual', 'manualDocTitle', 'manualDocFile', renderManualDocs));

/* ---- Schema documents (original + corrections, all immutable PDFs) ---- */
async function renderSchemaDocs() {
  const docs = await Data.getDocuments(currentCode, 'schema');
  $('schemaDocsList').innerHTML = docs.length ? docs.map(d => `
    <div class="doc-item">
      <div><div class="doc-title">${d.title}</div><div class="doc-meta">${new Date(d.uploaded_at).toLocaleString('ru-RU')} · ${d.uploaded_by_name || ''}</div></div>
      <a href="${d.file_url}" target="_blank" rel="noopener">Открыть PDF →</a>
    </div>`).join('') : '<p class="empty">Схема ещё не загружена.</p>';
}
$('uploadSchemaBtn').addEventListener('click', () => uploadDoc('schema', 'schemaDocTitle', 'schemaDocFile', renderSchemaDocs));

async function uploadDoc(docType, titleFieldId, fileFieldId, refreshFn) {
  const title = $(titleFieldId).value.trim();
  const file = $(fileFieldId).files[0];
  if (!title || !file) { alert('Укажите название и выберите PDF-файл.'); return; }
  if (!navigator.onLine || !supa) { alert('Загрузка документов требует подключения к интернету и настроенного Supabase (см. README.md). Офлайн-очередь для файлов в этом каркасе не реализована.'); return; }
  try {
    await Data.uploadDocument(currentCode, docType, file, title, (currentProfile && currentProfile.name) || 'без имени');
    $(titleFieldId).value = ''; $(fileFieldId).value = '';
    refreshFn();
  } catch (e) { alert('Ошибка загрузки: ' + e.message); }
}

/* ---- Journal ---- */
async function renderJournal() {
  const j = await Data.getJournal(currentCode);
  $('journalSyncNote').textContent = supa ? '⚠ Записи синхронизируются со всеми механиками через Supabase.' : '⚠ Supabase не настроен — записи только в этом браузере.';
  $('entryList').innerHTML = (j.entries || []).length ? j.entries.map(e => `
    <div class="entry"><div class="meta">${new Date(e.created_at).toLocaleString('ru-RU')} · ${e.name || ''}</div>
    <div><b>${e.problem || ''}</b></div><div>${e.action || ''}</div></div>
  `).join('') : '<p class="empty">Записей нет.</p>';
}
$('addEntryBtn').addEventListener('click', () => $('entryForm').style.display = 'flex');
$('cancelEntryBtn').addEventListener('click', () => $('entryForm').style.display = 'none');
$('saveEntryBtn').addEventListener('click', async () => {
  const authorName = (currentProfile && currentProfile.name) || (supa ? 'без имени' : 'локальный пользователь');
  await Data.addJournalEntry(currentCode, { name: authorName, problem: $('f-prob').value, action: $('f-action').value });
  $('f-prob').value = ''; $('f-action').value = '';
  $('entryForm').style.display = 'none';
  renderJournal();
});

/* ---- AI analysis ---- */
$('aiAskBtn').addEventListener('click', async () => {
  const question = $('aiQuestion').value.trim();
  if (!question) return;
  if (!CONFIG.AI_ENDPOINT) { $('aiAnswer').textContent = 'AI_ENDPOINT не настроен — см. README.md, раздел про AI-анализ.'; return; }
  $('aiAnswer').textContent = 'Запрос...';
  try {
    const manualDocs = await Data.getDocuments(currentCode, 'manual');
    const schemaDocs = await Data.getDocuments(currentCode, 'schema');
    const journal = await Data.getJournal(currentCode);
    const resp = await fetch(CONFIG.AI_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ equipment_id: currentCode, question, context: { manualDocs, schemaDocs, journal: journal.entries } })
    });
    const result = await resp.json();
    $('aiAnswer').textContent = result.answer || 'Нет ответа.';
  } catch (e) { $('aiAnswer').textContent = 'Ошибка: ' + e.message; }
});

/* ---- QR scanning (jsQR — работает в Safari/iOS в отличие от BarcodeDetector) ---- */
let scanStream = null, scanRAF = null;
$('scanBtn').addEventListener('click', async () => {
  try {
    $('scanArea').style.display = 'block';
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = $('scanVideo'); video.srcObject = scanStream; await video.play();
    const canvas = $('scanCanvas'); const ctx = canvas.getContext('2d');
    const tick = () => {
      if (!scanStream) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imgData.data, imgData.width, imgData.height);
        if (code && code.data) { stopScan(); $('codeInput').value = code.data; openEquipment(code.data); return; }
      }
      scanRAF = requestAnimationFrame(tick);
    };
    tick();
  } catch (e) { alert('Нет доступа к камере: ' + e.message); $('scanArea').style.display = 'none'; }
});
function stopScan() {
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
  if (scanRAF) cancelAnimationFrame(scanRAF);
  $('scanArea').style.display = 'none';
}
$('stopScanBtn').addEventListener('click', stopScan);

/* =====================================================================
   INIT
   ===================================================================== */
window.addEventListener('error', (e) => {
  console.error('LOGBOOK resource/script error:', e.message || e, e.filename || '');
}, true);

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + ' не ответил за ' + (ms / 1000) + ' сек.')), ms))
  ]);
}

(async () => {
  try {
    updateNetBadge();
    await withTimeout(initAuth(), 5000, 'Инициализация');
    Data.flushQueue();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  } catch (err) {
    // Не даём приложению тихо зависнуть на "Инициализация..." —
    // показываем причину прямо на экране, чтобы было что прислать при отладке.
    console.error('LOGBOOK init error:', err);
    const hint = document.getElementById('syncHint');
    if (hint) {
      hint.style.color = '#ff8a75';
      hint.textContent = 'Ошибка запуска: ' + (err && err.message ? err.message : String(err)) +
        ' — попробуйте открыть в обычной вкладке (не приватной) и обновить страницу.';
    }
    showView('view-vessel');
    try { await ensureSeed(); await renderVessel(); } catch (e2) { console.error('LOGBOOK fallback render failed:', e2); }
  }
})();
