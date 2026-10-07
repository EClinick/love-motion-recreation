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
  button.setAttribute('aria-pressed', root.getAttribute('data-theme') === 'dark' ? 'true' : 'false');
  button.onclick = function () {
    // Off-white is the default for everyone; dark is only ever an explicit choice.
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    button.setAttribute('aria-pressed', next === 'dark' ? 'true' : 'false');
    try { localStorage.setItem('theme', next); } catch (e) {}
  };
})();
