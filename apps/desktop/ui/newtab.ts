/**
 * @title New tab page
 * @notice Search box, bookmarks, and the active profile's filter count.
 */

const admin = window.ddocAdmin;
if (!admin) throw new Error('Dashboard bridge missing');

/**
 * @notice A bookmark on the new-tab page.
 */
interface Bookmark { title?: string; url: string }
/**
 * @notice Bookmarks returned to the new-tab page.
 */
interface BrowserData { bookmarks: Bookmark[] }
/**
 * @notice A profile name shown under the logo.
 */
interface DashProfile { id: string; name: string }
/**
 * @notice The slice of engine state the new-tab page reads.
 */
interface DashState {
  profiles: DashProfile[];
  settings: { activeProfileId: string };
  report: { counters: { filtered: number } };
}

const form = document.getElementById('f');
const query = document.getElementById('q');
if (form instanceof HTMLFormElement && query instanceof HTMLInputElement) {
  form.onsubmit = (e) => { e.preventDefault(); admin.chrome('navigate', query.value); };
}

admin.call('browserData').then((d: BrowserData) => {
  const marks = document.getElementById('marks');
  if (!marks) return;
  for (const b of d.bookmarks.slice(0, 12)) {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = b.title || b.url;
    a.title = b.url;
    a.onclick = (e) => { e.preventDefault(); admin.chrome('navigate', b.url); };
    marks.appendChild(a);
  }
});

admin.call('state').then((s: DashState) => {
  const who = document.getElementById('who');
  const p = s.profiles.find((x) => x.id === s.settings.activeProfileId);
  if (who && p) who.textContent = `Profile: ${p.name} · ${s.report.counters.filtered} items filtered so far`;
});
