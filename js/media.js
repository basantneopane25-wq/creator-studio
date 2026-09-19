/* Media: every photo / video the app holds, plus mirroring it into a real folder on the phone.

   In the app:   IndexedDB keeps the files (works in every browser, far bigger than localStorage).
   On the phone: "Creator Studio / <Creator> / Pics | Vids" is written to a folder the user picks once
                 (File System Access API — Chrome / Edge on Android and desktop).
   Fallback:     browsers that can't write folders (iPhone Safari, Firefox) use Share / Save or a ZIP of the same tree. */
(function (CS) {
  const ROOT = 'Creator Studio';
  const UNSORTED = 'Unsorted';
  const M = CS.media = { items: [], ready: false, ROOT, UNSORTED };

  /* ---------- IndexedDB ---------- */
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      if (!window.indexedDB) { rej(new Error('IndexedDB unavailable')); return; }
      const r = indexedDB.open('creatorStudioMedia', 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('meta', { keyPath: 'id' }); d.createObjectStore('blobs'); d.createObjectStore('kv'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  // run fn(stores) inside one transaction and resolve with its return value once it commits
  function run(names, mode, fn) {
    return db().then(d => new Promise((res, rej) => {
      const t = d.transaction(names, mode), stores = {};
      [].concat(names).forEach(n => { stores[n] = t.objectStore(n); });
      let out;
      try { out = fn(stores); } catch (e) { t.abort(); rej(e); return; }
      t.oncomplete = () => res(out && typeof out === 'object' && 'result' in out ? out.result : out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('aborted'));
    }));
  }

  M.init = async () => {
    try { M.items = await run('meta', 'readonly', s => s.meta.getAll()); } catch (e) { console.error(e); M.items = []; }
    M.items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    M.ready = true;
    try { M.rootInfo = await run('kv', 'readonly', s => s.kv.get('rootInfo')); } catch (e) { M.rootInfo = null; }
  };

  const urls = new Map(); // id -> object URL, so thumbnails don't reload on every render
  M.blob = id => run('blobs', 'readonly', s => s.blobs.get(id));
  M.url = async id => {
    if (urls.has(id)) return urls.get(id);
    const b = await M.blob(id); if (!b) return null;
    const u = URL.createObjectURL(b); urls.set(id, u); return u;
  };
  // fill <img>/<video> elements marked data-mid with their blob URL after a render
  M.hydrate = (scope) => {
    (scope || document).querySelectorAll('[data-mid]').forEach(el => {
      if (el.dataset.done) return; el.dataset.done = '1';
      M.url(el.dataset.mid).then(u => { if (u) el.src = el.tagName === 'VIDEO' ? u + '#t=0.1' : u; }); // #t shows a still frame as the thumbnail
    });
  };

  /* ---------- names & folders ---------- */
  const clean = s => String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  M.slug = s => clean(s).replace(/\s/g, '-').slice(0, 40) || 'creator';

  // The folder a creator's files live in. Fixed the first time it's needed, so renaming a creator never orphans files.
  M.folderFor = creatorId => {
    const c = CS.find.creator(creatorId);
    if (!c) return UNSORTED;
    if (!c.folder) {
      let base = clean(c.name).slice(0, 60) || 'Creator', name = base, n = 2;
      const taken = f => CS.S.creators.some(o => o !== c && o.folder === f) || f === UNSORTED;
      while (taken(name)) name = base + ' ' + n++;
      c.folder = name; CS.persist();
    }
    return c.folder;
  };
  M.folders = () => { // every folder that has files or a creator, creators first
    const set = new Map();
    CS.S.creators.forEach(c => set.set(M.folderFor(c.id), { folder: c.folder, creatorId: c.id, name: c.name }));
    M.items.forEach(m => { if (!set.has(m.folder)) set.set(m.folder, { folder: m.folder, creatorId: '', name: m.folder }); });
    return Array.from(set.values());
  };
  M.inFolder = (folder, kind) => M.items.filter(m => m.folder === folder && (!kind || m.kind === kind));

  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

  const EXT_KIND = { jpg: 'pic', jpeg: 'pic', png: 'pic', webp: 'pic', gif: 'pic', heic: 'pic', heif: 'pic', avif: 'pic', mp4: 'vid', mov: 'vid', m4v: 'vid', webm: 'vid', mkv: 'vid', avi: 'vid', '3gp': 'vid' };
  // 'pic' | 'vid' | null — some phones give an empty mime type (e.g. HEIC), so fall back to the extension
  M.kindOf = (blob, name) => {
    const t = blob.type || '';
    if (t.indexOf('image/') === 0) return 'pic';
    if (t.indexOf('video/') === 0) return 'vid';
    return EXT_KIND[String(name || blob.name || '').split('.').pop().toLowerCase()] || null;
  };

  /* ---------- add / remove ---------- */
  // opts: { blob, name?, kind?, creatorId?, source, jobId?, prompt? } -> the saved record
  M.add = async o => {
    const blob = o.blob, mime = blob.type || o.mime || '';
    const kind = o.kind || M.kindOf(blob, o.name);
    if (!kind) { const err = new Error('only pictures and videos can be saved'); err.skip = true; throw err; }
    const folder = M.folderFor(o.creatorId);
    const ext = EXT[mime] || (o.name && o.name.indexOf('.') > 0 ? o.name.split('.').pop().toLowerCase() : (kind === 'vid' ? 'mp4' : 'jpg'));
    const base = M.slug(o.creatorId ? (CS.find.creator(o.creatorId) || {}).name : folder);
    const rec = {
      id: CS.nid('m'), folder, creatorId: o.creatorId || '', kind, mime, size: blob.size,
      name: `${base}_${stamp()}_${Math.random().toString(36).slice(2, 5)}.${ext}`,
      original: o.name || '', createdAt: CS.now(), source: o.source || 'upload', jobId: o.jobId || '', prompt: o.prompt || '',
      synced: false, path: ''
    };
    await run(['meta', 'blobs'], 'readwrite', s => { s.meta.put(rec); s.blobs.put(blob, rec.id); });
    CS.persist(); // the id counter moved
    M.items.unshift(rec);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); // ask the browser not to evict it
    await M.syncOne(rec, blob).catch(() => {});
    return rec;
  };

  M.remove = async id => {
    await run(['meta', 'blobs'], 'readwrite', s => { s.meta.delete(id); s.blobs.delete(id); });
    M.items = M.items.filter(m => m.id !== id);
    if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
  };

  const saveMeta = rec => run('meta', 'readwrite', s => { s.meta.put(rec); });

  /* ---------- phone folder (File System Access) ---------- */
  M.fsSupported = () => typeof window.showDirectoryPicker === 'function';

  M.connect = async () => {
    // Ask for a location once; we then create "Creator Studio" inside it.
    const parent = await window.showDirectoryPicker({ mode: 'readwrite', id: 'creator-studio', startIn: 'documents' });
    const root = await parent.getDirectoryHandle(ROOT, { create: true });
    await run('kv', 'readwrite', s => { s.kv.put(root, 'root'); s.kv.put({ parent: parent.name, at: CS.now() }, 'rootInfo'); });
    M.rootInfo = { parent: parent.name, at: CS.now() };
    return root;
  };

  M.disconnect = async () => { await run('kv', 'readwrite', s => { s.kv.delete('root'); s.kv.delete('rootInfo'); }); M.rootInfo = null; };

  // returns the root directory handle if we may write to it. interactive=true (from a tap) may show the permission prompt.
  M.root = async interactive => {
    let h; try { h = await run('kv', 'readonly', s => s.kv.get('root')); } catch (e) { return null; }
    if (!h) return null;
    try {
      let p = await h.queryPermission({ mode: 'readwrite' });
      if (p !== 'granted' && interactive) p = await h.requestPermission({ mode: 'readwrite' });
      return p === 'granted' ? h : null;
    } catch (e) { return null; }
  };

  M.status = async () => {
    if (!M.fsSupported()) return 'unsupported';
    let h; try { h = await run('kv', 'readonly', s => s.kv.get('root')); } catch (e) { return 'none'; }
    if (!h) return 'none';
    try { return (await h.queryPermission({ mode: 'readwrite' })) === 'granted' ? 'ready' : 'needs-permission'; } catch (e) { return 'needs-permission'; }
  };

  // Make <root>/<folder>/Pics and /Vids exist (also for creators with no files yet).
  M.ensureFolders = async (creator, interactive) => {
    const root = await M.root(interactive); if (!root) return false;
    const dir = await root.getDirectoryHandle(M.folderFor(creator.id), { create: true });
    await dir.getDirectoryHandle('Pics', { create: true });
    await dir.getDirectoryHandle('Vids', { create: true });
    return true;
  };

  async function uniqueName(dir, name) {
    const dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
    let n = 1, cur = name;
    for (;;) {
      try { await dir.getFileHandle(cur); cur = `${stem}-${++n}${ext}`; } catch (e) { return cur; } // not found -> free
    }
  }

  M.syncOne = async (rec, blob, interactive) => {
    if (rec.synced) return true;
    const root = await M.root(interactive); if (!root) return false;
    const c = await root.getDirectoryHandle(rec.folder, { create: true });
    const sub = await c.getDirectoryHandle(rec.kind === 'vid' ? 'Vids' : 'Pics', { create: true });
    const name = await uniqueName(sub, rec.name);
    const fh = await sub.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(blob || await M.blob(rec.id)); await w.close();
    rec.synced = true; rec.path = `${ROOT}/${rec.folder}/${rec.kind === 'vid' ? 'Vids' : 'Pics'}/${name}`;
    await saveMeta(rec);
    return true;
  };

  // Write everything that isn't in the folder yet. Must be called from a tap so the permission prompt can appear.
  M.syncAll = async (onProgress) => {
    const root = await M.root(true);
    if (!root) throw new Error('Folder access wasn’t granted.');
    for (const c of CS.S.creators) await M.ensureFolders(c, false).catch(() => {});
    const todo = M.items.filter(m => !m.synced);
    let done = 0, failed = 0;
    for (const rec of todo) {
      try { await M.syncOne(rec, null, false); } catch (e) { failed++; console.error(e); }
      if (onProgress) onProgress(++done, todo.length);
    }
    return { total: todo.length, failed };
  };
  M.unsyncedCount = () => M.items.filter(m => !m.synced).length;

  /* ---------- export / share (works everywhere) ---------- */
  M.downloadBlob = (blob, name) => {
    const a = document.createElement('a'), u = URL.createObjectURL(blob);
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 60000);
  };

  // Save one or more items: the share sheet where the browser has one ("Save to Files" on iPhone), otherwise a download.
  M.saveToDevice = async recs => {
    const files = [];
    for (const r of recs) { const b = await M.blob(r.id); if (b) files.push(new File([b], r.name, { type: r.mime })); }
    if (!files.length) return;
    if (navigator.canShare && navigator.canShare({ files })) {
      try { await navigator.share({ files }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    files.forEach(f => M.downloadBlob(f, f.name));
  };

  // folders: array of folder names, or null for everything. Builds  Creator Studio/<Creator>/Pics|Vids/…
  M.exportZip = async (folders, onProgress) => {
    const want = folders || M.folders().map(f => f.folder);
    const entries = [{ path: ROOT + '/', blob: null }];
    for (const f of want) {
      entries.push({ path: `${ROOT}/${f}/`, blob: null }, { path: `${ROOT}/${f}/Pics/`, blob: null }, { path: `${ROOT}/${f}/Vids/`, blob: null });
      for (const r of M.inFolder(f)) {
        const b = await M.blob(r.id);
        if (b) entries.push({ path: `${ROOT}/${f}/${r.kind === 'vid' ? 'Vids' : 'Pics'}/${r.name}`, blob: b });
      }
    }
    const zip = await CSZip.build(entries, onProgress);
    const name = (folders && folders.length === 1 ? M.slug(folders[0]) : 'Creator-Studio') + '-' + CS.today() + '.zip';
    if (navigator.canShare) {
      const file = new File([zip], name, { type: 'application/zip' });
      if (navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    }
    M.downloadBlob(zip, name);
  };

  M.usage = async () => {
    try { const e = await navigator.storage.estimate(); return { used: e.usage || 0, quota: e.quota || 0 }; } catch (e) { return null; }
  };
  M.fmtSize = n => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');
})(window.CS);
