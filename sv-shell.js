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
 *  8. Kit de UI (ui.css + ui.js): busca/paleta Ctrl+K, menu do usuário no rodapé
 *     (tema, sair), tooltip no modo recolhido, indicador "mola" no hover (Rare UI).
 * ============================================================ */
(function () {
  // ---- garante skin + kit de UI (a fonte Geist vem do theme.css) ----
  function ensureLink(href) {
    var base = href.split("?")[0];
    if (document.querySelector("link[href^='" + base + "']")) return;
    var l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    document.head.appendChild(l);
  }
  function ensureScript(src) {
    var base = src.split("?")[0];
    if (document.querySelector("script[src^='" + base + "']")) return;
    var s = document.createElement("script");
    s.src = src;
    document.head.appendChild(s);
  }
  ensureLink("/ui.css?v=20261015ui");
  ensureLink("/sv-skin.css?v=20261015ui");
  ensureScript("/ui.js?v=20261015ui");

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
    pin: '<path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
    search: '<circle cx="11" cy="11" r="7.5"/><path d="m20.5 20.5-4.2-4.2"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    upDown: '<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>',
    command: '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
  };
  function svg(name, size) {
    var s = size || 18;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">' + (ICON[name] || "") + "</svg>";
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // Textos do próprio shell (pt/es/en)
  var STR = {
    search: { pt: "Buscar…", es: "Buscar…", en: "Search…" },
    theme:  { pt: "Tema escuro", es: "Tema oscuro", en: "Dark theme" },
    themeL: { pt: "Tema claro", es: "Tema claro", en: "Light theme" },
    logout: { pt: "Sair", es: "Salir", en: "Sign out" },
    cmd:    { pt: "Buscar e atalhos", es: "Buscar y atajos", en: "Search & shortcuts" },
    collapse: { pt: "Recolher menu", es: "Contraer menú", en: "Collapse sidebar" },
    roleSuper: { pt: "Super admin", es: "Super admin", en: "Super admin" },
    roleAdmin: { pt: "Administrador", es: "Administrador", en: "Admin" },
    roleUser:  { pt: "Usuário", es: "Usuario", en: "User" },
  };

  // ---- NAV: FONTE ÚNICA. label = {pt,es,en}. access = nível mínimo (all<admin<super). ----
  var NAV = [
    { label: { pt: "Operação", es: "Operación", en: "Operations" }, items: [
      { label: { pt: "Dashboard",        es: "Dashboard",        en: "Dashboard" },        href: "dashboard.html",      icon: "home",     access: "all" },
      { label: { pt: "Motoristas",       es: "Conductores",      en: "Drivers" },          href: "driver-profile.html", icon: "users",    access: "all" },
      { label: { pt: "Recrutamento",     es: "Reclutamiento",    en: "Recruitment" },      href: "recruitment.html",    icon: "userPlus", access: "all" },
      { label: { pt: "Áreas por país",   es: "Áreas por país",   en: "Country Scopes" },   href: "country_scopes.html", icon: "layers",   access: "admin" },
      { label: { pt: "Mapa de Operações",es: "Mapa de Operaciones",en: "Ops Map" },        href: "ops-map.html",        icon: "pin",      access: "admin" },
      { label: { pt: "PMO Hub",          es: "PMO Hub",          en: "PMO Hub" },          href: "pmo.html",            icon: "notes",    access: "admin" },
    ]},
    { label: { pt: "Financeiro", es: "Financiero", en: "Finance" }, items: [
      { label: { pt: "Relatório financeiro", es: "Informe financiero", en: "Financial Report" }, href: "financial-report.html", icon: "chart", access: "admin" },
      { label: { pt: "Fundos",           es: "Fondos",           en: "Funds" },            href: "ramp.html",                  icon: "wallet", access: "all" },
      { label: { pt: "Folha",            es: "Nómina",           en: "Payroll" },          href: "timesheet.html",             icon: "report", access: "all" },
      { label: { pt: "Divergências AR",  es: "Divergencias AR",  en: "AR Divergences" },   href: "ar-divergencias-admin.html", icon: "alert",  access: "all" },
    ]},
    { label: { pt: "Relatórios", es: "Reportes", en: "Reports" }, items: [
      // Portal do cliente (/cts-data). Site público e separado — abre em outra
      // aba pra não tirar o time de dentro do portal. Ele não tem sidebar.
      { label: { pt: "CTS Data", es: "CTS Data", en: "CTS Data" }, href: "/cts-data/", icon: "chart", access: "all", external: true },
      { label: { pt: "Cenários Argentina",   es: "Escenarios Argentina",   en: "Argentina Scenarios" },    href: "argentina_scenarios_presentation.html", icon: "chart",    access: "admin" },
      { label: { pt: "Otimização Argentina", es: "Optimización Argentina", en: "Argentina Optimization" }, href: "argentina_optimization_report.html",    icon: "fileText", access: "admin" },
    ]},
    { label: { pt: "Sistema", es: "Sistema", en: "System" }, items: [
      { label: { pt: "Usuários", es: "Usuarios", en: "Users" }, href: "admin-users.html", icon: "settings", access: "super" },
      { label: { pt: "Roadmap",  es: "Roadmap",  en: "Roadmap" }, href: "roadmap.html",   icon: "map",      access: "super" },
    ]},
  ];

  // Expõe a NAV como fonte única do catálogo de páginas (ex.: checklist de
  // acesso por página no admin-users.html). Mantém label {pt,es,en} + access.
  try { window.SV_NAV = NAV; } catch (e) {}

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
  // Cargo restrito a páginas (ex: ops-only): array de hrefs (lowercase) ou null = sem restrição.
  // Sobrepõe os tiers — quem é restrito vê SÓ os itens da allowlist.
  function restrictedPagesOf(user) {
    if (!user || typeof userPages !== "function") return null;
    try { return userPages(user.username); } catch (e) { return null; }
  }

  // mapa href→access pra gatear uma sidebar inline já existente (não duplicar)
  var ACCESS_BY_HREF = {};
  NAV.forEach(function (g) { g.items.forEach(function (it) { ACCESS_BY_HREF[slug(it.href)] = it.access; }); });

  // Nome da página atual, normalizado. Tolera as duas formas de URL que o site
  // serve: /dashboard.html e /dashboard (o .html é adicionado pela regra de
  // rewrite do Cloudflare, então o pathname chega sem ele).
  function slug(p) {
    p = String(p || "").toLowerCase().split("?")[0].split("#")[0];
    var parts = p.split("/").filter(Boolean);
    var last = parts.pop() || "index";       // "/cts-data/" → "cts-data", "/" → "index"
    return last.replace(/\.html$/, "");
  }
  function here() { return slug(location.pathname); }

  // Monta SÓ o conteúdo da nav (labels na língua dada, gated, com ativo).
  function renderNav(navEl, user, lang) {
    var userTier = tierOf(user);
    var allow = restrictedPagesOf(user);
    var cur = here();
    var activeSet = false;
    var html = "";
    NAV.forEach(function (g) {
      var visible = g.items.filter(function (it) {
        if (allow) return allow.map(slug).indexOf(slug(it.href)) >= 0;
        return canSee(it.access, userTier);
      });
      if (!visible.length) return;
      html += '<div class="sv-nav-label">' + L(g.label, lang) + "</div>";
      visible.forEach(function (it) {
        var isActive = !activeSet && slug(it.href) === cur;
        if (isActive) activeSet = true;
        var label = L(it.label, lang);
        // Externo abre em outra aba. A seta fica DENTRO do span do label de
        // propósito: a regra do modo recolhido esconde o último <span>, então
        // um span solo aqui inverteria o comportamento (sumiria a seta e
        // apareceria o texto).
        var ext = it.external ? ' target="_blank" rel="noopener"' : "";
        var arrow = it.external ? ' <i class="sv-ext" aria-hidden="true">↗</i>' : "";
        // data-tip (ui.js) só aparece com a sidebar recolhida — substitui o title nativo
        html += '<a class="sv-nav-item' + (isActive ? " active" : "") + '" href="' + it.href + '"' + ext +
          ' data-tip="' + esc(label) + '" data-tip-side="right" data-tip-when="collapsed" aria-label="' + esc(label) + '">' +
          '<span class="sv-ico">' + svg(it.icon) + "</span><span>" + label + arrow + "</span></a>";
      });
    });
    // Indicador de hover com mola (Rare UI · Bounce sidebar): um "pill" que
    // escorrega até o item sob o mouse e volta pro ativo quando sai.
    html += '<span class="sv-nav-glide" aria-hidden="true"></span>';
    navEl.innerHTML = html;
    wireGlide(navEl);
  }

  function wireGlide(navEl) {
    var glide = navEl.querySelector(".sv-nav-glide");
    if (!glide) return;
    function moveTo(item) {
      if (!item) { glide.classList.remove("on"); return; }
      glide.style.transform = "translateY(" + (item.offsetTop) + "px)";
      glide.style.height = item.offsetHeight + "px";
      glide.classList.add("on");
    }
    navEl.addEventListener("mouseover", function (e) {
      var it = e.target.closest ? e.target.closest(".sv-nav-item") : null;
      if (it && !it.classList.contains("active")) moveTo(it);
    });
    navEl.addEventListener("mouseleave", function () { glide.classList.remove("on"); });
  }

  // Nav visível pro usuário atual, já traduzida — consumida pela paleta Ctrl+K (ui.js).
  window.svVisibleNav = function (lang) {
    lang = lang || curLang();
    var user = CURRENT_USER || getUser();
    var userTier = tierOf(user);
    var allow = restrictedPagesOf(user);
    var cur = here();
    var out = [];
    NAV.forEach(function (g) {
      var items = g.items.filter(function (it) {
        if (allow) return allow.map(slug).indexOf(slug(it.href)) >= 0;
        return canSee(it.access, userTier);
      }).map(function (it) {
        return { label: L(it.label, lang), href: it.href, external: !!it.external,
                 active: slug(it.href) === cur, iconHtml: svg(it.icon, 16).replace("<svg ", '<svg class="ui-ico" ') };
      });
      if (items.length) out.push({ label: L(g.label, lang), items: items });
    });
    return out;
  };

  // Sair sem perguntar de novo (o usuário já escolheu "Sair" no menu).
  window.svLogout = function () {
    if (typeof aceLogout === "function") return aceLogout();
    try { if (typeof clearSession === "function") clearSession(); } catch (e) {}
    location.reload();
  };

  // Breadcrumb "Grupo › Página" no header da página (onde o logo antigo ficava escondido).
  function injectCrumb(lang) {
    var cur = here();
    var found = null;
    NAV.forEach(function (g) { g.items.forEach(function (it) { if (!found && slug(it.href) === cur) found = { g: g, it: it }; }); });
    if (!found) return;
    var host = document.querySelector("#app-content > .header") || document.querySelector(".ac-topbar") || document.querySelector(".header");
    if (!host) return;
    var crumb = host.querySelector(".sv-crumb");
    if (!crumb) {
      crumb = document.createElement("nav");
      crumb.className = "sv-crumb";
      crumb.setAttribute("aria-label", "breadcrumb");
      crumb.setAttribute("data-no-icon", "");
      host.insertBefore(crumb, host.firstChild);
    }
    crumb.innerHTML = '<span class="sv-crumb-group">' + esc(L(found.g.label, lang)) + '</span>' +
      '<span class="sv-crumb-sep"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></span>' +
      '<b>' + esc(L(found.it.label, lang)) + '</b>';
  }

  function isDark() { return document.documentElement.getAttribute("data-theme") === "dark"; }
  function initialsOf(user) {
    var n = String((user && (user.fullName || user.username)) || "?").trim();
    return n.split(/\s+/).map(function (w) { return w[0] || ""; }).slice(0, 2).join("").toUpperCase();
  }
  function roleOf(user, lang) {
    var tier = tierOf(user);
    return L(tier >= RANK.super ? STR.roleSuper : (tier >= RANK.admin ? STR.roleAdmin : STR.roleUser), lang);
  }

  // Monta o rodapé (usuário + tema + recolher) na língua dada.
  function renderFoot(foot, user, lang) {
    var mac = /Mac|iPhone|iPad/.test(navigator.platform || "");
    foot.innerHTML =
      '<button type="button" class="sv-user" data-menu-anchor aria-haspopup="menu" data-tip="' + esc(user.fullName || user.username) + '" data-tip-side="right" data-tip-when="collapsed">' +
        '<span class="sv-user-av">' + esc(initialsOf(user)) + '<i class="sv-user-dot"></i></span>' +
        '<span class="sv-user-txt"><b>' + esc(user.fullName || user.username) + '</b><small>' + esc(roleOf(user, lang)) + '</small></span>' +
        '<span class="sv-user-caret">' + svg("upDown", 15) + '</span>' +
      '</button>' +
      '<button type="button" class="sv-collapse-btn" id="sv-collapse" data-tip="' + esc(L(STR.collapse, lang)) + '" data-tip-side="right" aria-label="' + esc(L(STR.collapse, lang)) + '">' +
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 6l-6 6 6 6"/></svg>' +
      '</button>';
    foot.querySelector(".sv-user").addEventListener("click", function (e) {
      if (!window.UI || !window.UI.menu) return;
      var l = curLang();
      var dark = isDark();
      var html =
        '<div class="ui-menu-head"><span class="ui-avatar">' + esc(initialsOf(user)) + '</span>' +
          '<div style="min-width:0"><div style="font-weight:600;font-size:13.5px">' + esc(user.fullName || user.username) + '</div>' +
          '<div style="font-size:12px;color:var(--c-text-muted)">@' + esc(user.username) + ' · ' + esc(roleOf(user, l)) + '</div></div></div>' +
        '<div class="ui-menu-sep"></div>' +
        '<button type="button" class="ui-menu-item" data-act="cmd">' + svg("search", 16).replace("<svg ", '<svg class="ui-ico" ') + L(STR.cmd, l) +
          '<span class="ui-menu-trail"><span class="ui-kbd">' + (mac ? "⌘" : "Ctrl") + '</span><span class="ui-kbd">K</span></span></button>' +
        (typeof toggleTheme === "function"
          ? '<button type="button" class="ui-menu-item" data-act="theme">' + svg(dark ? "sun" : "moon", 16).replace("<svg ", '<svg class="ui-ico" ') + L(dark ? STR.themeL : STR.theme, l) + '</button>'
          : "") +
        '<div class="ui-menu-sep"></div>' +
        '<button type="button" class="ui-menu-item ui-menu-item--danger" data-act="logout">' + svg("logout", 16).replace("<svg ", '<svg class="ui-ico" ') + L(STR.logout, l) + '</button>';
      var anchor = e.currentTarget;
      var m = window.UI.menu.open(anchor, html, { side: document.body.classList.contains("sv-collapsed") && innerWidth > 880 ? "right" : "top" });
      m.setAttribute("data-no-icon", "");
      m.addEventListener("click", function (ev) {
        var b = ev.target.closest(".ui-menu-item");
        if (!b) return;
        var act = b.getAttribute("data-act");
        if (act === "cmd" && window.UI.cmd) setTimeout(window.UI.cmd.open, 80);
        if (act === "theme" && typeof toggleTheme === "function") toggleTheme();
        if (act === "logout") window.svLogout();
      });
    });
  }

  // Re-traduz a sidebar (chamado no clique de [data-lang] e na mutação de <html lang>).
  function applyLang(lang) {
    var nav = document.querySelector(".sv-sidebar .sv-nav");
    if (nav && CURRENT_USER) renderNav(nav, CURRENT_USER, lang);
    var foot = document.querySelector(".sv-sidebar .sv-foot");
    if (foot && CURRENT_USER && foot.querySelector(".sv-user")) { renderFoot(foot, CURRENT_USER, lang); wireControls(document.querySelector(".sv-sidebar")); }
    var sl = document.querySelector(".sv-sidebar .sv-search-label");
    if (sl) sl.textContent = L(STR.search, lang);
    if (CURRENT_USER) injectCrumb(lang);
  }
  window.svShellSetLang = applyLang; // pra páginas que quiserem chamar explicitamente

  function build(user) {
    var mac = /Mac|iPhone|iPad/.test(navigator.platform || "");
    var lang = curLang();
    var html = '<div class="sv-brand">' +
      '<img class="sv-brand-logo" src="https://aceolution.com/img/logo2.png" alt="Aceolution" onerror="this.style.display=\'none\';this.parentNode.classList.add(\'logo-failed\')">' +
      '<img class="sv-brand-globe" src="/aceolution-globe.png?v=2" alt="Aceolution" aria-hidden="true">' +
      '<div class="sv-brand-mark">SV</div>' +
      '<div class="sv-brand-region">Street View · LATAM</div></div>' +
      // Busca → paleta de comandos (Ctrl/⌘+K) do ui.js
      '<button type="button" class="sv-search" data-tip="' + esc(L(STR.search, lang)) + '" data-tip-side="right" data-tip-when="collapsed">' +
        '<span class="sv-ico">' + svg("search", 16) + '</span><span class="sv-search-label">' + esc(L(STR.search, lang)) + '</span>' +
        '<span class="sv-search-kbd"><kbd>' + (mac ? "⌘" : "Ctrl") + '</kbd><kbd>K</kbd></span>' +
      '</button>' +
      '<nav class="sv-nav"></nav>' +
      '<div class="sv-foot"></div>';

    var aside = document.createElement("aside");
    aside.className = "sv-sidebar";
    aside.setAttribute("data-no-icon", "");
    aside.innerHTML = html;
    document.body.appendChild(aside);
    document.body.classList.add("sv-shell");

    renderNav(aside.querySelector(".sv-nav"), user, lang);
    renderFoot(aside.querySelector(".sv-foot"), user, lang);
    aside.querySelector(".sv-search").addEventListener("click", function () {
      if (window.UI && window.UI.cmd) window.UI.cmd.open();
    });
    injectCrumb(lang);

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
    var allow = restrictedPagesOf(user);
    var items = aside.querySelectorAll(".sv-nav-item");
    for (var i = 0; i < items.length; i++) {
      var href = slug(items[i].getAttribute("href") || "");
      var show;
      if (allow) {
        show = allow.map(slug).indexOf(href) >= 0;
      } else {
        var acc = ACCESS_BY_HREF[href];
        show = !(acc && !canSee(acc, userTier));
      }
      items[i].style.display = show ? "" : "none";
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
