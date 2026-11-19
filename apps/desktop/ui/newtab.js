const A = window.ddocAdmin;
document.getElementById('f').onsubmit = (e) => { e.preventDefault(); A.chrome('navigate', document.getElementById('q').value); };
A.call('browserData').then((d) => {
  const m = document.getElementById('marks');
  for (const b of d.bookmarks.slice(0, 12)) {
    const a = document.createElement('a'); a.href = '#'; a.textContent = b.title || b.url; a.title = b.url;
    a.onclick = (e) => { e.preventDefault(); A.chrome('navigate', b.url); };
    m.appendChild(a);
  }
});
A.call('state').then((s) => { const p = s.profiles.find((x) => x.id === s.settings.activeProfileId); document.getElementById('who').textContent = `Profile: ${p.name} · ${s.report.counters.filtered} items filtered so far`; });
