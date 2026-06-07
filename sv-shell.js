/* ============================================================
 * sv-shell.js — sidebar enterprise COMUM + gating por permissão + i18n.
 *
 * Inclua <script src="sv-shell.js"></script> antes de </body>.
 * Não toca no JS/IDs da página.
 *
 * O que faz:
 *  1. NAV abaixo é a FONTE ÚNICA de navegação do portal admin (labels pt/es/en).
 *  2. Mostra só o que o usuário logado pode acessar (mesmo modelo da admin.html):
 *       all   → qualquer usuário logado · admin → isAdmin() · super → fuss
 *  3. Login-aware: só monta DEPOIS do login (observa a saída da .ac-login-screen).
 *  4. NÃO inclui os forms de driver (index/assets/cash/ar-divergencias) — públicos, sem sidebar.
 *  5. Liga o toggle de dark mode (setupThemeToggle) pra páginas do shell.
 *  6. i18n: a sidebar TRADUZ junto com a página — detecta a língua por clique em
 *     qualquer botão [data-lang] e por mutação do <html lang>. Sem editar as páginas.
 *  7. Colapsada mostra o globo da Aceolution (favicon): colorido no light, branco no dark.
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
  ensureLink("sv-skin.css?v=4");
  ensureLink("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap");

  // Globo (vetorial) — usado quando a sidebar colapsa. Cor via currentColor (CSS).
  var GLOBE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19"/><path d="M12 2.5a14 14 0 0 1 3.8 9.5 14 14 0 0 1-3.8 9.5 14 14 0 0 1-3.8-9.5 14 14 0 0 1 3.8-9.5Z"/></svg>';

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

  // ---- NAV: FONTE ÚNICA. label = {pt,es,en}. access = nível mínimo (all<admin<super). ----
  var NAV = [
    { label: { pt: "Operação", es: "Operación", en: "Operations" }, items: [
      { label: { pt: "Dashboard",        es: "Dashboard",        en: "Dashboard" },        href: "dashboard.html",      icon: "home",     access: "all" },
      { label: { pt: "Motoristas",       es: "Conductores",      en: "Drivers" },          href: "driver-profile.html", icon: "users",    access: "all" },
      { label: { pt: "Recrutamento",     es: "Reclutamiento",    en: "Recruitment" },      href: "recruitment.html",    icon: "userPlus", access: "all" },
      { label: { pt: "Áreas por país",   es: "Áreas por país",   en: "Country Scopes" },   href: "country_scopes.html", icon: "layers",   access: "admin" },
      { label: { pt: "PMO Hub",          es: "PMO Hub",          en: "PMO Hub" },          href: "pmo.html",            icon: "notes",    access: "admin" },
    ]},
    { label: { pt: "Financeiro", es: "Financiero", en: "Finance" }, items: [
      { label: { pt: "Fundos",           es: "Fondos",           en: "Funds" },            href: "ramp.html",                  icon: "wallet", access: "all" },
      { label: { pt: "Folha",            es: "Nómina",           en: "Payroll" },          href: "timesheet.html",             icon: "report", access: "all" },
      { label: { pt: "Divergências AR",  es: "Divergencias AR",  en: "AR Divergences" },   href: "ar-divergencias-admin.html", icon: "alert",  access: "all" },
    ]},
    { label: { pt: "Relatórios", es: "Reportes", en: "Reports" }, items: [
      { label: { pt: "Cenários Argentina",   es: "Escenarios Argentina",   en: "Argentina Scenarios" },    href: "argentina_scenarios_presentation.html", icon: "chart",    access: "admin" },
      { label: { pt: "Otimização Argentina", es: "Optimización Argentina", en: "Argentina Optimization" }, href: "argentina_optimization_report.html",    icon: "fileText", access: "admin" },
    ]},
    { label: { pt: "Sistema", es: "Sistema", en: "System" }, items: [
      { label: { pt: "Usuários", es: "Usuarios", en: "Users" }, href: "admin-users.html", icon: "settings", access: "super" },
      { label: { pt: "Roadmap",  es: "Roadmap",  en: "Roadmap" }, href: "roadmap.html",   icon: "map",      access: "super" },
    ]},
  ];

  var RANK = { all: 0, admin: 1, super: 2 };
  var CURRENT_USER = null;

  function L(v, lang) { return (v && typeof v === "object") ? (v[lang] || v.pt) : v; }

  // Língua atual: <html lang> → localStorage('latam.lang') → 'pt'.
  function curLang() {
    try {
      var h = (document.documentElement.getAttribute("lang") || "").toLowerCase();
      if (h.indexOf("es") === 0) return "es";
      if (h.indexOf("en") === 0) return "en";
      if (h.indexOf("pt") === 0) return "pt";
      var s = localStorage.getItem("latam.lang");
      if (s === "es" || s === "en" || s === "pt") return s;
    } catch (e) {}
    return "pt";
  }

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

  // Monta SÓ o conteúdo da nav (labels na língua dada, gated, com ativo).
  function renderNav(navEl, user, lang) {
    var userTier = tierOf(user);
    var cur = here();
    var activeSet = false;
    var html = "";
    NAV.forEach(function (g) {
      var visible = g.items.filter(function (it) { return canSee(it.access, userTier); });
      if (!visible.length) return;
      html += '<div class="sv-nav-label">' + L(g.label, lang) + "</div>";
      visible.forEach(function (it) {
        var isActive = !activeSet && it.href.toLowerCase() === cur;
        if (isActive) activeSet = true;
        var label = L(it.label, lang);
        html += '<a class="sv-nav-item' + (isActive ? " active" : "") + '" href="' + it.href + '" title="' + label + '">' +
          '<span class="sv-ico">' + svg(it.icon) + "</span><span>" + label + "</span></a>";
      });
    });
    navEl.innerHTML = html;
  }

  // Re-traduz a sidebar (chamado no clique de [data-lang] e na mutação de <html lang>).
  function applyLang(lang) {
    var nav = document.querySelector(".sv-sidebar .sv-nav");
    if (nav && CURRENT_USER) renderNav(nav, CURRENT_USER, lang);
  }
  window.svShellSetLang = applyLang; // pra páginas que quiserem chamar explicitamente

  function build(user) {
    var html = '<div class="sv-brand">' +
      '<img class="sv-brand-logo" src="https://aceolution.com/img/logo2.png" alt="Aceolution" onerror="this.style.display=\'none\';this.parentNode.classList.add(\'logo-failed\')">' +
      '<span class="sv-brand-globe" aria-hidden="true">' + GLOBE_SVG + '</span>' +
      '<div class="sv-brand-mark">SV</div>' +
      '<div class="sv-brand-region">Street View · LATAM</div></div>' +
      '<nav class="sv-nav"></nav>' +
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

    renderNav(aside.querySelector(".sv-nav"), user, curLang());

    // restaura estado recolhido (desktop), salvo entre páginas/sessões
    try { if (localStorage.getItem("AC_SIDEBAR_COLLAPSED") === "1") document.body.classList.add("sv-collapsed"); } catch (e) {}
    ensureChrome();
    wireControls(aside);
    setupLangHooks();
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
      setTimeout(function () { window.dispatchEvent(new Event("resize")); }, 230);
    });
    var links = aside.querySelectorAll(".sv-nav-item");
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener("click", function () { document.body.classList.remove("sv-nav-open"); });
    }
  }

  // i18n: a sidebar segue a língua da página. Dois detectores, montados uma vez:
  //  (a) clique em qualquer [data-lang] (botões PT/ES/EN das páginas e do topbar);
  //  (b) mutação do atributo lang do <html> (páginas que setam document.documentElement.lang).
  var langHooksDone = false;
  function setupLangHooks() {
    if (langHooksDone) return;
    langHooksDone = true;
    document.addEventListener("click", function (e) {
      var el = e.target && e.target.closest ? e.target.closest("[data-lang]") : null;
      if (!el) return;
      var l = (el.getAttribute("data-lang") || "").toLowerCase();
      if (l === "pt" || l === "es" || l === "en") applyLang(l);
    });
    try {
      new MutationObserver(function () { applyLang(curLang()); })
        .observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    } catch (e) {}
  }

  // Gateia uma sidebar inline já presente (sem reconstruir).
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
    CURRENT_USER = user;
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
