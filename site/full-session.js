// Find, filters and jump for the full session. Without JS the whole record is still plain HTML.
(function () {
  var term = document.getElementById('term'), form = document.querySelector('.tools');
  if (!term || !form) return;
  form.addEventListener('submit', function (e) { e.preventDefault(); });
  var lines = [].slice.call(term.querySelectorAll('.t-line,.t-prompt,.ed,.t-slash'));
  var find = document.getElementById('find'), count = document.getElementById('count'), timer;

  function update() {
    ['say', 'tool', 'out'].forEach(function (k) { term.classList.toggle('hide-' + k, !document.getElementById(k).checked); });
    var q = find.value.trim().toLowerCase(), n = 0;
    lines.forEach(function (l) {
      var hit = !q || l.textContent.toLowerCase().indexOf(q) > -1;
      l.classList.toggle('nomatch', !hit);
      if (hit && l.offsetParent !== null) n++;
    });
    count.textContent = q ? n + (n === 1 ? ' line matches “' : ' lines match “') + find.value.trim() + '”.' : n + ' lines shown.';
  }
  ['say', 'tool', 'out'].forEach(function (k) { document.getElementById(k).addEventListener('change', update); });
  find.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(update, 150); });

  var jump = document.getElementById('jump');
  jump.addEventListener('change', function () {
    var h = document.getElementById(jump.value);
    if (!h) return;
    h.setAttribute('tabindex', '-1');
    h.scrollIntoView({ block: 'start' });
    h.focus({ preventScroll: true });
  });

  // Links from the condensed replay land on an exact step; open it if it's a shell call.
  function reveal() {
    var target = location.hash && document.getElementById(location.hash.slice(1));
    if (target && target.tagName === 'DETAILS') target.open = true;
  }
  window.addEventListener('hashchange', reveal);
  reveal();
  update();
})();
