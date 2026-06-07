/* ============================================================
 * theme_teste.js — aplica tema salvo + toggle flutuante (admins)
 * (reconstruído para o redesign; mantém a API esperada pelo portal:
 *  setupThemeToggle(user), removeThemeToggle(), toggleTheme(), applyTheme())
 * ============================================================ */
(function () {
  var KEY = "ac-theme";
  function getSaved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function apply(t) {
    if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
  }
  // aplica o quanto antes (evita flash)
  apply(getSaved());

  window.applyTheme = function (t) { apply(t); try { localStorage.setItem(KEY, t); } catch (e) {} updateBtn(); };
  window.toggleTheme = function () {
    var dark = document.documentElement.getAttribute("data-theme") === "dark";
    window.applyTheme(dark ? "light" : "dark");
  };
  window.removeThemeToggle = function () { var b = document.querySelector(".theme-toggle-btn"); if (b) b.remove(); };

  function updateBtn() {
    var b = document.querySelector(".theme-toggle-btn");
    if (b) b.textContent = document.documentElement.getAttribute("data-theme") === "dark" ? "☀" : "🌙";
  }

  window.setupThemeToggle = function (user) {
    apply(getSaved());
    try {
      var admins = (typeof ADMIN_USERNAMES !== "undefined" && ADMIN_USERNAMES) ? ADMIN_USERNAMES : [];
      var uname = (user && (user.username || "")).toLowerCase();
      var isAdmin = admins.map(function (s) { return String(s).toLowerCase(); }).indexOf(uname) >= 0;
      if (!isAdmin) return;
      if (document.querySelector(".theme-toggle-btn")) { updateBtn(); return; }
      var btn = document.createElement("button");
      btn.className = "theme-toggle-btn";
      btn.type = "button";
      btn.title = "Tema claro / escuro";
      btn.addEventListener("click", window.toggleTheme);
      document.body.appendChild(btn);
      updateBtn();
    } catch (e) {}
  };
})();
