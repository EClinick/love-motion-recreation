// Progressive enhancement: every prompt and command remains selectable without JS.
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
