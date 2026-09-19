/* Settings: plan + credit budget, credit log, backup / restore. */
(function (CS) {
  const esc = CS.esc;
  const PLANS = ['Not subscribed yet', 'Starter (~200-270 credits/mo)', 'Plus (~1000-1200 credits/mo)', 'Ultra (~3000+ credits/mo)', 'Custom'];

  CS.views.settings = {
    render() {
      const s = CS.S.settings, log = s.creditLog;
      return `
        <div class="page-head"><div><h1>Settings</h1></div></div>
        <div class="card"><h2>Higgsfield plan &amp; credit budget</h2>
          <div class="grid2">
            <div class="field"><label>Plan</label><select id="set_plan">${PLANS.map(p => `<option ${s.plan === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
            <div class="field"><label>Monthly credit allowance</label><input type="number" id="set_allowance" min="0" value="${+s.allowance || 0}"></div>
            <div class="field"><label>Monthly $ budget</label><input type="number" id="set_budget" min="0" value="${+s.budget || 0}"></div>
          </div>
          <button class="btn" data-action="setSave">Save</button></div>
        <div class="card"><h2>Credit usage log</h2>
          <p class="muted">Marking a job done with a credit amount logs it here automatically. You can also add a manual entry.</p>
          <div class="row"><input type="number" id="manual_credit" min="0" placeholder="credits" style="max-width:120px;"><input type="text" id="manual_note" placeholder="note" style="flex:1;min-width:140px;"><button class="btn secondary" data-action="setLog">Log</button></div>
          <div style="margin-top:10px;">${log.length ? `<table><tr><th>Date</th><th>Credits</th><th>Note</th><th></th></tr>${log.slice(0, 50).map((l, i) => `<tr><td>${esc(l.date)}</td><td>${+l.amount || 0}</td><td>${esc(l.note)}</td><td>${l.jobId ? '' : `<button class="btn small ghost" data-action="setLogDel" data-i="${i}">✕</button>`}</td></tr>`).join('')}</table>` : '<div class="empty">No usage logged yet.</div>'}</div>
        </div>
        <div class="card"><h2>Backup</h2>
          <p class="muted">Everything lives in this browser’s local storage only. Export regularly, and before clearing browser data.</p>
          <div class="row">
            <button class="btn secondary" data-action="exportData">Export backup (.json)</button>
            <button class="btn secondary" data-action="importPick">Import backup</button>
            <input type="file" id="importFile" accept=".json" style="display:none;" data-bind="settings.import">
            <button class="btn danger" data-action="resetAll">Erase all data</button>
          </div></div>`;
    }
  };

  CS.actions.setSave = () => {
    const s = CS.S.settings;
    s.plan = document.getElementById('set_plan').value;
    s.allowance = Math.max(0, parseFloat(document.getElementById('set_allowance').value) || 0);
    s.budget = Math.max(0, parseFloat(document.getElementById('set_budget').value) || 0);
    CS.save(); CS.ui.toast('Settings saved.');
  };
  CS.actions.setLog = () => {
    const amt = parseFloat(document.getElementById('manual_credit').value) || 0;
    if (!amt) { CS.ui.toast('Enter a credit amount.'); return; }
    CS.S.settings.creditLog.unshift({ date: CS.today(), amount: amt, note: document.getElementById('manual_note').value.trim() || 'manual entry' });
    CS.save();
  };
  CS.actions.setLogDel = d => { CS.S.settings.creditLog.splice(+d.i, 1); CS.save(); };

  CS.actions.exportData = () => {
    const json = JSON.stringify(CS.S, null, 2), a = document.createElement('a');
    try { a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); }
    catch (e) { a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(json); }
    a.download = 'creator-studio-backup-' + CS.today() + '.json'; a.click();
  };
  CS.actions.importPick = () => document.getElementById('importFile').click();
  CS.binds.settings = (k, el) => {
    if (k !== 'import') return;
    const file = el.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (!data || !Array.isArray(data.creators)) throw new Error('not a Creator Studio backup');
        CS.ui.confirm('Importing replaces everything currently in this browser. Continue?', () => { CS.S = CS.normalize(data); CS.save(); CS.ui.toast('Backup imported.'); }, { yes: 'Import', danger: false, title: 'Import backup' });
      } catch (e) { CS.ui.toast('That file isn’t a valid backup.'); }
    };
    r.readAsText(file);
  };
  CS.actions.resetAll = () => CS.ui.confirm('This erases all creators, library items, jobs and settings in this browser. Export a backup first.', () => { CS.S = CS.blankState(); CS.save(); CS.ui.toast('All data erased.'); }, { yes: 'Erase everything', title: 'Erase all data' });
})(window.CS);
