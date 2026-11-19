document.getElementById('h').textContent = new URLSearchParams(location.search).get('host') || '';
document.getElementById('b').onclick = () => history.back();
