// Shared theme preference; the content still works with scripts/storage disabled.
(function () {
  var root = document.documentElement;
  var button = document.getElementById('theme');
  try {
    var saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
  } catch (e) {}
  if (!button) return;
  button.hidden = false;
  button.onclick = function () {
    var dark = root.hasAttribute('data-theme')
      ? root.getAttribute('data-theme') === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    var next = dark ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) {}
  };
})();
