/* Files: browse everything you've made, organised like it is on the phone —
   Creator Studio / <Creator> / Pics + Vids — and connect a real phone folder to copy it into. */
(function (CS) {
  const esc = CS.esc, M = CS.media;
  let tab = 'pic';

  const folderLink = f => '#/files/' + encodeURIComponent(f);
  const count = (folder, kind) => M.inFolder(folder, kind).length;
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  /* ---------- storage / phone-folder card ---------- */
  function storageHtml(st, usage) {
    const unsynced = M.unsyncedCount(), total = M.items.length;
    let body, btns = '';
    if (st === 'checking') body = '<span class="muted">Checking…</span>';
    else if (st === 'unsupported') {
      body = `<b>📱 This browser can’t write into a phone folder</b>
        <p class="muted">iPhone Safari and Firefox don’t allow it. Nothing is lost — your files are kept inside the app. To get them onto your phone, tap <b>Save</b> on any file (choose “Save to Files”), or export a ZIP: it opens as the same <i>${esc(M.ROOT)} / creator / Pics · Vids</i> folders. On Android, open this site in Chrome to copy straight into a folder.</p>`;
    } else if (st === 'none') {
      body = `<b>📁 Not connected to a phone folder yet</b>
        <p class="muted">Choose where to keep it (for example <i>Documents</i>). The app creates <b>${esc(M.ROOT)}</b> there, then a folder per creator with <b>Pics</b> and <b>Vids</b> inside, and copies every new file across automatically.</p>
        <p class="muted">If Chrome says it can’t use a folder, make a new one (e.g. “Studio”) in the picker and choose that.</p>`;
      btns = '<button class="btn" data-action="fConnect">Choose folder</button>';
    } else if (st === 'needs-permission') {
      body = `<b>🔒 Folder connected — needs your OK again</b>
        <p class="muted">Your browser asks for permission again after a restart. Tap below to allow writing to <b>${esc((M.rootInfo && M.rootInfo.parent) || '…')} / ${esc(M.ROOT)}</b>${unsynced ? ` and copy the ${plural(unsynced, 'waiting file')}` : ''}.</p>`;
      btns = '<button class="btn" data-action="fReconnect">Allow &amp; sync</button><button class="btn ghost small" data-action="fDisconnect">Disconnect</button>';
    } else {
      body = `<b>✅ Copying to <span style="color:var(--accent)">${esc((M.rootInfo && M.rootInfo.parent) || '…')} / ${esc(M.ROOT)}</span></b>
        <p class="muted">${unsynced ? `${plural(unsynced, 'file')} not copied yet.` : total ? 'Everything is in your phone folder.' : 'New pictures and videos are copied there as soon as you save them.'}</p>`;
      btns = (unsynced ? '<button class="btn" data-action="fReconnect">Sync now</button>' : '<button class="btn secondary" data-action="fReconnect">Re-check folders</button>') +
        '<button class="btn secondary" data-action="fConnect">Change folder</button><button class="btn ghost small" data-action="fDisconnect">Disconnect</button>';
    }
    return `${body}
      <div class="row" style="margin-top:8px;">${btns}
        <button class="btn secondary" data-action="fZipAll" ${total ? '' : 'disabled'}>Export everything as ZIP</button></div>
      <div class="muted" style="margin-top:10px;">${plural(total, 'file')} in the app${usage && usage.quota ? ` · browser storage: ${M.fmtSize(usage.used)} of ${M.fmtSize(usage.quota)}` : ''}. The Settings backup (.json) does <b>not</b> include these files — the ZIP does.</div>`;
  }

  function refreshStorage() {
    Promise.all([M.status(), M.usage()]).then(r => { const el = document.getElementById('storageCard'); if (el) el.innerHTML = storageHtml(r[0], r[1]); });
  }

  /* ---------- overview ---------- */
  function overview() {
    const folders = M.folders();
    const cards = folders.map(f => {
      const c = CS.find.creator(f.creatorId), pics = count(f.folder, 'pic'), vids = count(f.folder, 'vid'), un = M.inFolder(f.folder).filter(m => !m.synced).length;
      return `<a class="item folder-card" href="${folderLink(f.folder)}">
        <div class="row" style="flex-wrap:nowrap;">${c ? CS.avatar(c, true) : '<span class="avatar lg">📁</span>'}
          <div style="min-width:0;"><h4>${esc(f.name)}</h4>${f.folder !== f.name ? `<div class="muted">📁 ${esc(f.folder)}</div>` : ''}<div class="muted">${plural(pics, 'pic')} · ${plural(vids, 'vid')}</div>
            ${un ? `<span class="tag draft">${un} not on phone</span>` : (pics + vids ? '<span class="tag done">on phone</span>' : '')}</div></div></a>`;
    }).join('');
    return `
      <div class="page-head"><div><h1>Files</h1><p class="muted">Everything you make, sorted the same way as on your phone: <b>${esc(M.ROOT)} / creator / Pics · Vids</b>.</p></div></div>
      <div class="card" id="storageCard">${storageHtml('checking')}</div>
      ${folders.length ? `<div class="grid">${cards}</div>` : `<div class="empty">No creators or files yet.<br><a class="btn small" href="#/creators">Create a creator</a></div>`}`;
  }

  /* ---------- one creator's folder ---------- */
  function folderView(folder) {
    const f = M.folders().find(x => x.folder === folder);
    if (!f) return `<div class="empty">That folder doesn’t exist.<br><a class="btn small" href="#/files">Back to Files</a></div>`;
    const items = M.inFolder(folder, tab), pics = count(folder, 'pic'), vids = count(folder, 'vid');
    const seg = `<button class="${tab === 'pic' ? 'active' : ''}" data-action="fTab" data-v="pic">📷 Pics ${pics}</button><button class="${tab === 'vid' ? 'active' : ''}" data-action="fTab" data-v="vid">🎬 Vids ${vids}</button>`;
    const cards = items.map(m => `
      <div class="media-item">
        ${m.kind === 'vid' ? `<video class="thumb" data-mid="${m.id}" preload="metadata" playsinline muted></video>` : `<img class="thumb" data-mid="${m.id}" alt="" data-action="fView" data-id="${m.id}">`}
        <div class="muted" style="margin:4px 0 2px;word-break:break-all;">${esc(m.createdAt)} · ${M.fmtSize(m.size)}</div>
        <div>${m.synced ? '<span class="tag done">on phone</span>' : '<span class="tag draft">app only</span>'}${m.source === 'generated' ? '<span class="tag">generated</span>' : m.source === 'job' ? '<span class="tag">from queue</span>' : ''}</div>
        <div class="row" style="margin-top:6px;">
          <button class="btn small secondary" data-action="fView" data-id="${m.id}">${m.kind === 'vid' ? 'Play' : 'View'}</button>
          <button class="btn small secondary" data-action="fSave" data-id="${m.id}">Save</button>
          <button class="btn small ghost" data-action="fDelete" data-id="${m.id}" aria-label="Delete">🗑</button></div>
      </div>`).join('');
    return `
      <div class="page-head"><div><a href="#/files">← All files</a><h1 style="margin-top:4px;">${esc(f.name)}</h1>
        <p class="muted">${esc(M.ROOT)} / ${esc(f.folder)} / ${tab === 'vid' ? 'Vids' : 'Pics'}</p></div>
        <div class="row">
          ${f.creatorId ? `<button class="btn" data-action="fMakePic" data-id="${f.creatorId}">📸 Make a pic</button>` : ''}
          <label class="btn secondary" style="cursor:pointer;">＋ Add files<input type="file" multiple accept="image/*,video/*" data-bind="files.add" data-folder="${esc(f.folder)}" style="display:none;"></label>
          <button class="btn secondary" data-action="fZipOne" data-folder="${esc(f.folder)}" ${pics + vids ? '' : 'disabled'}>ZIP</button>
        </div></div>
      <div class="seg" style="margin-bottom:14px;">${seg}</div>
      ${items.length ? `<div class="media-grid">${cards}</div>` : `<div class="empty">No ${tab === 'vid' ? 'videos' : 'pictures'} yet.<br>${tab === 'vid' ? 'Finish a video in the <a href="#/queue">Queue</a> and attach it, or tap “Add files”.' : 'Make one in Create, or tap “Add files”.'}</div>`}`;
  }

  CS.views.files = {
    render(params) {
      if (!M.ready) return '<div class="empty">Loading your files…</div>';
      return params[0] ? folderView(decodeURIComponent(params[0])) : overview();
    },
    after(params) {
      if (!M.ready) return;
      M.hydrate();
      if (!params[0]) refreshStorage();
    }
  };

  /* ---------- actions ---------- */
  CS.actions.fTab = d => { tab = d.v; CS.render(); };
  CS.actions.fMakePic = d => { CS.S.lastFormat = 'photo'; CS.create.withCreator(d.id); };

  CS.actions.fView = async d => {
    const m = M.items.find(x => x.id === d.id); if (!m) return;
    const u = await M.url(m.id); if (!u) { CS.ui.toast('That file is missing from the app.'); return; }
    CS.ui.modal({
      title: m.kind === 'vid' ? 'Video' : 'Picture', wide: true,
      body: (m.kind === 'vid' ? `<video src="${u}" controls playsinline autoplay style="width:100%;max-height:70vh;border-radius:8px;background:#000;"></video>` : `<img src="${u}" alt="" style="width:100%;border-radius:8px;">`) +
        `<div class="muted" style="margin-top:8px;">${esc(m.name)}${m.path ? '<br>On phone: ' + esc(m.path) : ''}${m.prompt ? '<br>Prompt: ' + esc(m.prompt) : ''}</div>`,
      footer: `<button class="btn secondary" data-action="fSave" data-id="${m.id}">Save</button><button class="btn" data-action="closeModal">Close</button>`
    });
  };
  CS.actions.fSave = d => { const m = M.items.find(x => x.id === d.id); if (m) M.saveToDevice([m]); };
  CS.actions.fDelete = d => CS.ui.confirm('Remove this file from the app? A copy already in your phone folder stays where it is.', async () => {
    await M.remove(d.id); CS.render(); CS.ui.toast('Removed from the app.');
  }, { yes: 'Remove', title: 'Remove file' });

  CS.binds.files = async (k, el) => {
    if (k !== 'add') return;
    const files = Array.from(el.files || []), folder = el.dataset.folder;
    const f = M.folders().find(x => x.folder === folder);
    let ok = 0, skipped = 0;
    for (const file of files) {
      try { await M.add({ blob: file, name: file.name, creatorId: f ? f.creatorId : '', source: 'upload' }); ok++; }
      catch (e) { if (e.skip) { skipped++; continue; } CS.ui.toast('Couldn’t save ' + file.name + ' — ' + (e.message || 'storage is full')); break; }
    }
    el.value = ''; CS.render();
    if (ok) CS.ui.toast(plural(ok, 'file') + ' added' + (skipped ? ` (${skipped} skipped — not a picture or video)` : '') + '.');
    else if (skipped) CS.ui.toast('Only pictures and videos can be added.');
  };

  async function syncWithProgress() {
    try {
      const r = await M.syncAll((done, total) => CS.ui.toast(`Copying to your phone… ${done}/${total}`));
      CS.render();
      CS.ui.toast(r.failed ? `Copied ${r.total - r.failed} of ${r.total}. ${r.failed} failed — try again.` : (r.total ? `Copied ${r.total} file${r.total === 1 ? '' : 's'} to your phone.` : 'Folders are set up. New files copy automatically.'));
    } catch (e) { CS.ui.toast(e.message || 'Couldn’t copy to the folder.'); }
  }
  CS.actions.fConnect = async () => {
    try { await M.connect(); }
    catch (e) {
      if (e && e.name === 'AbortError') return; // closed the picker
      CS.ui.toast('That folder can’t be used. Make a new folder in the picker and choose it.'); return;
    }
    await syncWithProgress();
  };
  CS.actions.fReconnect = () => syncWithProgress();
  CS.actions.fDisconnect = () => CS.ui.confirm('Stop copying to the phone folder? Files already there stay, and everything stays in the app.', async () => { await M.disconnect(); CS.render(); }, { yes: 'Disconnect', danger: false, title: 'Disconnect folder' });

  async function zip(folders) {
    CS.ui.toast('Building ZIP…');
    try { await M.exportZip(folders, (d, t) => CS.ui.toast(`Building ZIP… ${d}/${t}`)); CS.ui.toast('ZIP ready.'); }
    catch (e) { CS.ui.toast('Couldn’t build the ZIP: ' + (e.message || 'out of memory — export one creator at a time.')); }
  }
  CS.actions.fZipAll = () => zip(null);
  CS.actions.fZipOne = d => zip([d.folder]);
})(window.CS);
