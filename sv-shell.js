/* ============================================================
 * sv-shell.js — sidebar enterprise COMUM + gating por permissão.
 *
 * Inclua <script src="sv-shell.js"></script> antes de </body>.
 * Não toca no JS/IDs da página.
 *
 * O que faz:
 *  1. NAV abaixo é a FONTE ÚNICA de navegação do portal admin.
 *  2. Mostra só o que o usuário logado pode acessar (mesmo modelo da admin.html):
 *       all   → qualquer usuário logado
 *       admin → isAdmin() (em ADMIN_USERNAMES do auth.js)
 *       super → super admin (fuss)
 *  3. Login-aware: só monta DEPOIS do login (observa a saída da .ac-login-screen),
 *     pra nunca renderizar a sidebar por cima da tela de login nem antes de saber
 *     quem é o usuário (senão o gating não funcionaria).
 *  4. NÃO inclui os forms de driver (index/assets/check-in) — esses são páginas
 *     públicas, sem sidebar e sempre light (ver assets-sempre-light).
 *  5. Liga o toggle de dark mode (setupThemeToggle) — centraliza o aprendizado de
 *     dark mode num lugar só pras páginas do shell (toggle só aparece pra admin).
 *  6. Se a página já tiver uma .sv-sidebar inline, só aplica o gating (não duplica).
 * ============================================================ */
(function () {
  // ---- garante skin + fonte ----
  function ensureLink(href) {
    var base = href.split("?")[0];
    if (document.querySelector("link[href^='" + base + "']")) return;
    var l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    document.head.appendChild(l);
  }
  ensureLink("sv-skin.css?v=3");
  ensureLink("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap");

  // ---- ícones (line, 24x24) ----
  var ICON = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5"/><path d="M16 5.2A3 3 0 0 1 16 11"/><path d="M21 20c0-2.6-1.5-4.2-3.8-4.8"/>',
    layers: '<path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z"/><path d="M3 12l9 4.5 9-4.5M3 16.5 12 21l9-4.5"/>',
    notes: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    userPlus: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5"/><path d="M18 7v6M21 10h-6"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
    wallet: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1H5.5"/><path d="M3 7.5V17a2 2 0 0 0 2 2h14a1.5 1.5 0 0 0 1.5-1.5V9.5A1.5 1.5 0 0 0 19 8H4.5"/><circle cx="16.5" cy="13.5" r="1.1"/>',
    report: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 13.5v3.5M12 10.5v6.5M16 8v9"/>',
    alert: '<path d="M12 4 2.5 20h19L12 4Z"/><path d="M12 10v4M12 17.5h.01"/>',
    chart: '<path d="M4 4v16h16"/><path d="M7 14l3-3 3 2 4-5"/>',
    fileText: '<path d="M6 3h8l4 4v14H6V3Z"/><path d="M14 3v4h4"/><path d="M9 12.5h6M9 16h5"/>',
    settings: '<circle cx="12" cy="12" r="3.1"/><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18 6l-2 2M8 16l-2 2M18 18l-2-2M8 8 6 6"/>',
    map: '<path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z"/><path d="M9 4v14M15 6v14"/>',
  };
  function svg(name) {
    return '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + (ICON[name] || "") + "</svg>";
  }

  // ---- NAV: FONTE ÚNICA. access = nível mínimo (all < admin < super). ----
  // Mirror da admin.html, SEM os forms de driver (index/assets/ar-divergencias).
  var NAV = [
    { label: "Operação", items: [
      { label: "Dashboard",      href: "dashboard.html",      icon: "home",     access: "all" },
      { label: "Drivers",        href: "driver-profile.html", icon: "users",    access: "all" },
      { label: "Recruitment",    href: "recruitment.html",    icon: "userPlus", access: "all" },
      { label: "Country Scopes", href: "country_scopes.html", icon: "layers",   access: "admin" },
      { label: "PMO Hub",        href: "pmo.html",            icon: "notes",    access: "admin" },
    ]},
    { label: "Financeiro", items: [
      // 'all' espelha a admin.html: a seção Financeiro é visível a todos os logados
      // (as tags "Admin" lá são só decorativas). Pra travar um item, troque pra 'admin'.
      { label: "Funds",           href: "ramp.html",                   icon: "wallet", access: "all" },
      { label: "Payroll",         href: "timesheet.html",              icon: "report", access: "all" },
      { label: "Divergências AR",  href: "ar-divergencias-admin.html", icon: "alert",  access: "all" },
    ]},
    { label: "Relatórios", items: [
      { label: "Cenários Argentina",   href: "argentina_scenarios_presentation.html", icon: "chart",    access: "admin" },
      { label: "Otimização Argentina", href: "argentina_optimization_report.html",    icon: "fileText", access: "admin" },
    ]},
    { label: "Sistema", items: [
      { label: "Usuários", href: "admin-users.html", icon: "settings", access: "super" },
      { label: "Roadmap",  href: "roadmap.html",     icon: "map",      access: "super" },
    ]},
  ];

  var RANK = { all: 0, admin: 1, super: 2 };

  function getUser() {
    try { return (typeof loadSession === "function") ? loadSession() : null; }
    catch (e) { return null; }
  }
  // Tier do usuário: fuss=super, ADMIN_USERNAMES=admin, resto=all. -1 = deslogado.
  function tierOf(user) {
    if (!user) return -1;
    var name = String(user.username || "").toLowerCase();
    if (name === "fuss") return RANK.super;
    if (typeof isAdmin === "function" && isAdmin(name)) return RANK.admin;
    return RANK.all;
  }
  function canSee(access, userTier) {
    var need = (RANK[access] != null) ? RANK[access] : 0;
    return userTier >= need;
  }

  // mapa href→access pra gatear uma sidebar inline já existente (não duplicar)
  var ACCESS_BY_HREF = {};
  NAV.forEach(function (g) { g.items.forEach(function (it) { ACCESS_BY_HREF[it.href.toLowerCase()] = it.access; }); });

  function here() { return (location.pathname.split("/").pop() || "dashboard.html").toLowerCase(); }

  function build(user) {
    var userTier = tierOf(user);
    var cur = here();
    var activeSet = false;
    var html = '<div class="sv-brand">' +
      '<img class="sv-brand-logo" src="https://aceolution.com/img/logo2.png" alt="Aceolution" onerror="this.style.display=\'none\';this.parentNode.classList.add(\'logo-failed\')">' +
      '<div class="sv-brand-mark">SV</div>' +
      '<div class="sv-brand-region">Street View · LATAM</div></div><nav class="sv-nav">';
    NAV.forEach(function (g) {
      var visible = g.items.filter(function (it) { return canSee(it.access, userTier); });
      if (!visible.length) return; // esconde grupo inteiro se nada visível
      html += '<div class="sv-nav-label">' + g.label + "</div>";
      visible.forEach(function (it) {
        var isActive = !activeSet && it.href.toLowerCase() === cur;
        if (isActive) activeSet = true;
        html += '<a class="sv-nav-item' + (isActive ? " active" : "") + '" href="' + it.href + '" title="' + it.label + '">' +
          '<span class="sv-ico">' + svg(it.icon) + "</span><span>" + it.label + "</span></a>";
      });
    });
    html += "</nav>" +
      '<div class="sv-foot">' +
        '<div class="sv-foot-status"><div class="sv-foot-dot"></div>' +
          '<div><div class="sv-foot-l1">Apps Script · live</div><div class="sv-foot-l2">v5.21 · build 2026.06</div></div></div>' +
        '<button type="button" class="sv-collapse-btn" id="sv-collapse" title="Recolher menu" aria-label="Recolher menu">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 6l-6 6 6 6"/></svg>' +
        '</button>' +
      '</div>';

    var aside = document.createElement("aside");
    aside.className = "sv-sidebar";
    aside.innerHTML = html;
    document.body.appendChild(aside);
    document.body.classList.add("sv-shell");
    // restaura estado recolhido (desktop), salvo entre páginas/sessões
    try { if (localStorage.getItem("AC_SIDEBAR_COLLAPSED") === "1") document.body.classList.add("sv-collapsed"); } catch (e) {}
    ensureChrome();
    wireControls(aside);
  }

  // Hamburger (mobile) + backdrop — criados uma vez no body.
  function ensureChrome() {
    if (!document.querySelector(".sv-burger")) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "sv-burger";
      b.setAttribute("aria-label", "Abrir menu");
      b.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3.5 6h17M3.5 12h17M3.5 18h17"/></svg>';
      b.addEventListener("click", function () { document.body.classList.add("sv-nav-open"); });
      document.body.appendChild(b);
    }
    if (!document.querySelector(".sv-backdrop")) {
      var bd = document.createElement("div");
      bd.className = "sv-backdrop";
      bd.addEventListener("click", function () { document.body.classList.remove("sv-nav-open"); });
      document.body.appendChild(bd);
    }
  }

  // Botão recolher (desktop) + fechar o drawer ao navegar (mobile).
  function wireControls(aside) {
    var col = aside.querySelector("#sv-collapse");
    if (col) col.addEventListener("click", function () {
      var on = document.body.classList.toggle("sv-collapsed");
      try { localStorage.setItem("AC_SIDEBAR_COLLAPSED", on ? "1" : "0"); } catch (e) {}
      // após a transição de largura, avisa o Leaflet (e cia) pra recalcular tamanho
      setTimeout(function () { window.dispatchEvent(new Event("resize")); }, 230);
    });
    var links = aside.querySelectorAll(".sv-nav-item");
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener("click", function () { document.body.classList.remove("sv-nav-open"); });
    }
  }

  // Gateia uma sidebar inline já presente (sem reconstruir): esconde itens
  // sem permissão e labels de grupo que ficaram sem nenhum item visível.
  function gateInline(aside, user) {
    var userTier = tierOf(user);
    var items = aside.querySelectorAll(".sv-nav-item");
    for (var i = 0; i < items.length; i++) {
      var href = (items[i].getAttribute("href") || "").toLowerCase();
      var acc = ACCESS_BY_HREF[href];
      items[i].style.display = (acc && !canSee(acc, userTier)) ? "none" : "";
    }
    var nav = aside.querySelector(".sv-nav");
    if (!nav) return;
    var kids = Array.prototype.slice.call(nav.children);
    for (var k = 0; k < kids.length; k++) {
      if (!kids[k].classList.contains("sv-nav-label")) continue;
      var anyVisible = false;
      for (var j = k + 1; j < kids.length; j++) {
        if (kids[j].classList.contains("sv-nav-label")) break;
        if (kids[j].classList.contains("sv-nav-item") && kids[j].style.display !== "none") { anyVisible = true; break; }
      }
      kids[k].style.display = anyVisible ? "" : "none";
    }
  }

  function apply() {
    var user = getUser();
    if (!user) return false; // ainda não logado
    var existing = document.querySelector(".sv-sidebar");
    if (existing) gateInline(existing, user);
    else build(user);
    if (typeof setupThemeToggle === "function") {
      try { setupThemeToggle(user); } catch (e) {}
    }
    return true;
  }

  function start() {
    if (apply()) return;
    // Sem sessão: espera o login terminar (tela .ac-login-screen sai do DOM).
    var obs = new MutationObserver(function () {
      if (getUser() && !document.querySelector(".ac-login-screen")) {
        if (apply()) obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
