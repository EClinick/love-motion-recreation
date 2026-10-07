// Progressive enhancement. The replay, message list and every command are plain HTML without JS.

// Copy buttons for the reproduction commands.
document.querySelectorAll('[data-copy]').forEach(function (button) {
  var source = document.getElementById(button.dataset.copy);
  if (!source) return;
  button.hidden = false;
  button.addEventListener('click', async function () {
    var feedback = button.closest('.snippet').querySelector('[role="status"]');
    try {
      await navigator.clipboard.writeText(source.textContent);
      feedback.textContent = 'Copied to clipboard.';
    } catch (e) {
      // Clipboard access can be denied on static/non-secure hosting.
      var selection = window.getSelection();
      var range = document.createRange();
      range.selectNodeContents(source);
      selection.removeAllRanges();
      selection.addRange(range);
      feedback.textContent = 'Text selected. Use your device’s copy command.';
    }
  });
});

// Replay navigation: current-message marker, previous/next, and the phone message list.
(function () {
  var term = document.getElementById('term'), rail = document.getElementById('rail');
  if (!term || !rail || !('IntersectionObserver' in window)) return;
  var heads = [].slice.call(term.querySelectorAll('.t-prompt[id^="m"]'));
  var links = [].slice.call(rail.querySelectorAll('a'));
  var where = document.getElementById('where'), dialog = document.getElementById('list'), cur = 0;
  if (!heads.length) return;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function mark(i) {
    cur = i;
    links.forEach(function (a, j) { a.setAttribute('aria-current', j === i ? 'true' : 'false'); });
    where.textContent = (i + 1) + ' of ' + heads.length;
  }
  function go(i) {
    i = Math.max(0, Math.min(heads.length - 1, i));
    heads[i].setAttribute('tabindex', '-1');
    heads[i].scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    heads[i].focus({ preventScroll: true });
    mark(i);
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) mark(heads.indexOf(e.target)); });
  }, { rootMargin: '-15% 0px -70% 0px' });
  heads.forEach(function (h) { io.observe(h); });

  ['where', 'prev', 'next'].forEach(function (id) { document.getElementById(id).hidden = false; });
  document.getElementById('prev').addEventListener('click', function () { go(cur - 1); });
  document.getElementById('next').addEventListener('click', function () { go(cur + 1); });
  if (dialog && dialog.showModal) {
    var list = document.getElementById('list-ol'), all = document.getElementById('all');
    list.innerHTML = rail.innerHTML;
    all.hidden = false;
    all.addEventListener('click', function () { dialog.showModal(); });
    document.getElementById('close').addEventListener('click', function () { dialog.close(); });
    list.addEventListener('click', function (e) { if (e.target.closest('a')) dialog.close(); });
  }
  mark(0);

  // The page's one motion moment: the opening prompt types itself in once.
  if (reduce) return;
  var span = heads[0].querySelector('.t-ptext');
  if (!span || span.getBoundingClientRect().top > window.innerHeight) return;
  var html = span.innerHTML, text = span.textContent, n = 0;
  heads[0].setAttribute('aria-busy', 'true');
  (function step() {
    n = Math.min(text.length, n + 3);
    span.textContent = text.slice(0, n);
    if (n < text.length) requestAnimationFrame(step);
    else { span.innerHTML = html; heads[0].removeAttribute('aria-busy'); }
  })();
})();
