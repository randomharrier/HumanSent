(function () {
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // Tiny retro flourish: “ONLINE” flicker very subtly (tasteful, not annoying)
  const statusEl = document.getElementById('statusValue');
  if (statusEl) {
    let on = true;
    window.setInterval(() => {
      on = !on;
      statusEl.style.opacity = on ? '1' : '0.82';
    }, 2200);
  }
})();


