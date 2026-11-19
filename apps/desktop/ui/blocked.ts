const host = document.getElementById('h');
if (host) host.textContent = new URLSearchParams(location.search).get('host') || '';
document.getElementById('b')?.addEventListener('click', () => history.back());
