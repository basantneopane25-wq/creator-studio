/* Queue (was "Jobs") and Home dashboard. A job moves: draft → sent (pasted into Claude) → done (with credits + result). */
(function (CS) {
  const esc = CS.esc;
  const filter = { status: 'all', type: 'all' };
  const label = t => (CS.FORMATS[t] ? CS.FORMATS[t].label : t);
  const title = j => j.title || label(j.type);

  function jobCard(j, compact) {
    const cr = j.draft && j.draft.creatorId ? CS.find.creator(j.draft.creatorId) : null;
    if (compact) {
      return `<div class="job-mini"><span class="jt"><b>${esc(title(j))}</b></span><span class="tag ${j.status}">${esc(j.status)}</span><span class="muted">${esc(j.createdAt)}</span></div>`;
    }
    const btns = [];
    if (j.run) { // made in the app: its own screen has the controls
      const t = window.CSFactory.totals(j);
      btns.push(`<a class="btn small" href="#/produce/${j.id}">${j.status === 'done' ? 'Open' : 'Continue'} production</a>`, `<button class="btn small danger" data-action="jobDelete" data-id="${j.id}">Delete</button>`);
      return `<div class="item job"><div class="jhead"><div><div class="jtitle">${esc(title(j))}</div>
        <div style="margin-top:4px;"><span class="tag">${esc(label(j.type))}</span><span class="tag sent">made in app</span><span class="tag ${j.status === 'done' ? 'done' : 'draft'}">${j.status === 'done' ? 'finished' : 'in progress'}</span><span class="muted">${esc(j.createdAt)}</span></div></div>
        <div class="muted">$${t.charged.toFixed(2)} spent${t.reserved ? ' · $' + t.reserved.toFixed(2) + ' pending' : ''}</div></div>
        <div class="row" style="margin-top:8px;">${btns.join('')}</div></div>`;
    }
    if (j.status === 'draft') btns.push(`<button class="btn small" data-action="jobCopySent" data-id="${j.id}">Copy &amp; mark sent</button>`);
    else btns.push(`<button class="btn small secondary" data-action="jobCopy" data-id="${j.id}">Copy prompt</button>`);
    btns.push(j.status === 'done'
      ? `<button class="btn small ghost" data-action="jobDone" data-id="${j.id}">Edit result</button>`
      : `<button class="btn small green" data-action="jobDone" data-id="${j.id}">Mark done</button>`);
    if (j.status !== 'draft') btns.push(`<button class="btn small ghost" data-action="jobReopen" data-id="${j.id}">Back to draft</button>`);
    if (j.draft && CS.FORMATS[j.type]) btns.push(`<button class="btn small secondary" data-action="jobEdit" data-id="${j.id}">${j.status === 'done' ? 'Duplicate' : 'Edit'} in Create</button>`);
    btns.push(`<button class="btn small danger" data-action="jobDelete" data-id="${j.id}">Delete</button>`);
    return `<div class="item job">
      <div class="jhead">
        <div><div class="jtitle">${esc(title(j))}</div>
          <div style="margin-top:4px;"><span class="tag">${esc(label(j.type))}</span><span class="tag ${j.status}">${esc(j.status)}</span>${cr ? `<span class="tag">${esc(cr.name)}</span>` : ''}<span class="muted">${esc(j.createdAt)}</span></div></div>
        ${j.status === 'done' ? `<div class="muted">${+j.credits || 0} credits</div>` : ''}
      </div>
      ${j.note ? `<div class="muted" style="margin-top:6px;">Result: ${esc(j.note)}</div>` : ''}
      ${attachHtml(j)}
      <details><summary>Show prompt</summary><pre class="prompt">${esc(j.prompt)}</pre></details>
      <div class="row" style="margin-top:8px;">${btns.join('')}</div>
    </div>`;
  }

  function attachHtml(j) {
    const att = CS.media && CS.media.ready ? CS.media.items.filter(m => m.jobId === j.id) : [];
    if (!att.length) return '';
    return `<div style="margin-top:6px;"><a href="#/files/${encodeURIComponent(att[0].folder)}">📎 ${att.length} file${att.length === 1 ? '' : 's'} saved in ${esc(att[0].folder)}</a></div>`;
  }

  /* ---------- queue view ---------- */
  CS.views.queue = {
    render() {
      const jobs = CS.S.jobs;
      const counts = { all: jobs.length, draft: 0, sent: 0, done: 0 };
      jobs.forEach(j => { if (counts[j.status] != null) counts[j.status]++; });
      const list = jobs.filter(j => (filter.status === 'all' || j.status === filter.status) && (filter.type === 'all' || j.type === filter.type));
      const seg = ['all', 'draft', 'sent', 'done'].map(s => `<button class="${filter.status === s ? 'active' : ''}" data-action="qStatus" data-v="${s}">${s[0].toUpperCase() + s.slice(1)} ${counts[s]}</button>`).join('');
      const types = `<select data-bind="queue.type" style="width:auto;"><option value="all">All formats</option>${Object.keys(CS.FORMATS).map(t => `<option value="${t}" ${filter.type === t ? 'selected' : ''}>${CS.FORMATS[t].label}</option>`).join('')}</select>`;
      return `
        <div class="page-head"><div><h1>Queue</h1><p class="muted">Draft → paste into Claude (Higgsfield connector) → mark done with the credits it used and where the file landed.</p></div><a class="btn" href="#/create">＋ Create</a></div>
        <div class="row" style="margin-bottom:14px;"><div class="seg">${seg}</div>${types}</div>
        ${list.length ? list.map(j => jobCard(j)).join('') : `<div class="empty">${jobs.length ? 'No jobs match this filter.' : 'Nothing queued yet.<br><a class="btn small" href="#/create">Create your first video</a>'}</div>`}`;
    }
  };
  CS.binds.queue = (name, el) => { if (name === 'type') { filter.type = el.value; CS.render(); } };
  CS.actions.qStatus = d => { filter.status = d.v; CS.render(); };

  const setStatus = (id, status) => { const j = CS.find.job(id); if (j) { j.status = status; CS.save(); } };
  CS.actions.jobCopy = d => { const j = CS.find.job(d.id); if (j) CS.copy(j.prompt); };
  CS.actions.jobCopySent = d => { const j = CS.find.job(d.id); if (j) { CS.copy(j.prompt, true); j.status = 'sent'; CS.save(); CS.ui.toast('Copied — marked as sent.'); } };
  CS.actions.jobReopen = d => {
    const j = CS.find.job(d.id); if (!j) return;
    CS.S.settings.creditLog = CS.S.settings.creditLog.filter(l => l.jobId !== j.id); // un-log credits if it was done
    j.credits = 0; j.note = ''; j.status = 'draft'; CS.save();
  };
  CS.actions.jobDelete = d => CS.ui.confirm('Delete this job? Any credits logged for it are removed too. Files already saved from it stay in Files.', () => {
    const gone = CS.find.job(d.id); if (gone && gone.run) CS.produce.cleanup(gone);
    CS.S.jobs = CS.S.jobs.filter(j => j.id !== d.id);
    CS.S.settings.creditLog = CS.S.settings.creditLog.filter(l => l.jobId !== d.id);
    CS.save();
  });
  CS.actions.jobEdit = d => { const j = CS.find.job(d.id); if (j && CS.create.loadJob(j)) CS.ui.toast('Loaded into Create.'); };
  CS.actions.jobDone = d => {
    const j = CS.find.job(d.id); if (!j) return;
    CS.ui.modal({
      title: 'Mark as done',
      body: `<div class="field"><label>Credits this used</label><input type="number" id="jd_credits" min="0" step="any" value="${+j.credits || 0}"></div>
             <div class="field"><label>Where did it land? (Drive link / filename)</label><input type="text" id="jd_note" value="${esc(j.note || '')}"></div>
             <div class="field"><label>Attach the finished file(s) — filed into the creator’s Vids / Pics folder</label><input type="file" id="jd_files" multiple accept="video/*,image/*"></div>`,
      footer: `<button class="btn secondary" data-action="closeModal">Cancel</button><button class="btn green" data-action="jobDoneSave" data-id="${j.id}">Save</button>`
    });
  };
  CS.actions.jobDoneSave = async d => {
    const j = CS.find.job(d.id); if (!j) return;
    const credits = Math.max(0, parseFloat(document.getElementById('jd_credits').value) || 0);
    const note = document.getElementById('jd_note').value.trim();
    const log = CS.S.settings.creditLog.filter(l => l.jobId !== j.id); // replace, never double-count
    log.unshift({ date: CS.today(), amount: credits, note: 'Job: ' + label(j.type) + (note ? ' — ' + note : ''), jobId: j.id });
    CS.S.settings.creditLog = log;
    j.status = 'done'; j.credits = credits; j.note = note;
    const input = document.getElementById('jd_files'), files = input ? Array.from(input.files) : [];
    CS.ui.closeModal(); CS.save();
    if (!files.length) { CS.ui.toast('Marked done.'); return; }
    CS.ui.toast('Saving ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '…');
    let ok = 0, skipped = 0;
    for (const f of files) {
      try { await CS.media.add({ blob: f, name: f.name, creatorId: (j.draft && j.draft.creatorId) || '', source: 'job', jobId: j.id }); ok++; }
      catch (e) { if (e.skip) { skipped++; continue; } CS.ui.toast('Couldn’t save ' + f.name + ' — ' + (e.message || 'storage is full')); break; }
    }
    CS.render();
    if (ok) CS.ui.toast('Done — ' + ok + ' file' + (ok === 1 ? '' : 's') + ' saved' + (skipped ? ` (${skipped} skipped: not a picture or video)` : '') + '.', { label: 'Open Files', fn: () => CS.go('files/' + encodeURIComponent(CS.media.items[0].folder)) });
    else if (skipped) CS.ui.toast('Marked done. Only pictures and videos can be attached.');
  };

  /* ---------- home ---------- */
  CS.views.home = {
    render() {
      const S = CS.S, used = CS.creditsUsed(), allow = S.settings.allowance || 0;
      const pct = allow ? Math.min(100, Math.round(used / allow * 100)) : 0;
      const open = S.jobs.filter(j => j.status !== 'done');
      const steps = [
        ['Make your first creator', S.creators.length > 0, '#/creators'],
        ['Lock their identity (face, body, voice)', S.creators.some(c => c.locked), '#/creators'],
        ['Add an outfit or background', S.wardrobe.length + S.backgrounds.length > 0, '#/library'],
        ['Queue your first video', S.jobs.length > 0, '#/create']
      ];
      const stats = [
        ['Creators', S.creators.length], ['Locked', S.creators.filter(c => c.locked).length], ['Outfits & sets', S.wardrobe.length + S.backgrounds.length + S.accessories.length],
        ['Brands', S.brands.length], ['To send', S.jobs.filter(j => j.status === 'draft').length], ['Awaiting result', S.jobs.filter(j => j.status === 'sent').length]
      ];
      const allDone = steps.every(s => s[1]);
      return `
        <div class="hero">
          <h1>What are we making today?</h1>
          <p class="muted" style="margin:0;">Choose a format to start. Your creators, looks and brands are ready to plug in.</p>
          <div class="fmt-tiles">${Object.keys(CS.FORMATS).map(id => { const f = CS.FORMATS[id]; return `<a class="fmt-tile" href="#/create/${id}"><span class="fmt-icon">${f.icon}</span><b>${f.label}</b><small>${f.tagline}</small></a>`; }).join('')}</div>
        </div>
        <div class="grid" style="margin-bottom:14px;">${stats.map(s => `<div class="item stat"><b>${s[1]}</b><span class="muted">${s[0]}</span></div>`).join('')}</div>
        <div class="create-layout" style="grid-template-columns:minmax(0,1.4fr) minmax(280px,1fr);">
          <div>
            <div class="card"><div class="row between"><h2>In progress</h2><a href="#/queue">Open queue →</a></div>
              ${open.length ? open.slice(0, 6).map(j => jobCard(j, true)).join('') : '<div class="empty">Nothing waiting. Start something in Create.</div>'}
            </div>
          </div>
          <div>
            <div class="card"><h2>Credits this month</h2>
              <div class="meter ${pct >= 100 ? 'over' : pct >= 80 ? 'hot' : ''}"><div style="width:${pct}%"></div></div>
              <div class="muted">${used} of ${allow || '—'} credits · budget $${S.settings.budget || 0}/mo · <a href="#/settings">edit</a></div>
            </div>
            ${allDone ? '' : `<div class="card"><h2>Get set up</h2><ul class="todo">${steps.map(s => `<li class="${s[1] ? 'done' : ''}"><span class="dot">${s[1] ? '✓' : ''}</span><span class="t">${s[0]}</span>${s[1] ? '' : `<a href="${s[2]}">Go →</a>`}</li>`).join('')}</ul></div>`}
            <div class="card"><h2>How it works</h2><p class="muted" style="margin:0;">Creator Studio is your creator database, prompt builder and job tracker. Generation happens when you paste a prompt into a Claude chat with the Higgsfield connector on. Nothing here calls Higgsfield directly, so your account credentials never sit in a local file.</p></div>
          </div>
        </div>`;
    }
  };
})(window.CS);
