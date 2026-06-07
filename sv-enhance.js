/* ============================================================
 * sv-enhance.js — aproxima a produção do mockup, SEM tocar na
 * lógica: injeta ícones nos KPIs e um painel "Precisa de atenção"
 * (vivo) ao lado do mapa, alimentado pela própria renderTable.
 * Carregar no fim do <body> do dashboard.
 * ============================================================ */
(function () {
  var ICON = {
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5"/><path d="M16 5.2A3 3 0 0 1 16 11"/><path d="M21 20c0-2.6-1.5-4.2-3.8-4.8"/>',
    hotel: '<path d="M3 20V6M3 13h13a4 4 0 0 1 4 4v3M3 20h18"/><path d="M7 10.5h2.5"/>',
    leaf: '<path d="M4 20c8 1 16-3 16-13 0 0-6-1-10 2S4 13 4 20Z"/><path d="M9 15c2-3 5-5 8-6"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    alert: '<path d="M12 4 2.5 20h19L12 4Z"/><path d="M12 10v4M12 17.5h.01"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  };
  function svg(name, sz) {
    sz = sz || 20;
    return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + (ICON[name] || "") + "</svg>";
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function initials(name) { return String(name || "?").trim().split(/\s+/).map(function (w) { return w[0] || ""; }).slice(0, 2).join("").toUpperCase(); }

  /* ---- ícones nos 5 scorecards ---- */
  function enhanceKpis() {
    var cards = document.querySelectorAll(".scorecards .scorecard");
    if (!cards.length || cards[0].querySelector(".sv-kpi-ico")) return;
    var cfg = [
      { ic: "users", tone: "blue" },
      { ic: "hotel", tone: "indigo" },
      { ic: "leaf", tone: "green" },
      { ic: "clock", tone: "amber" },
      { ic: "alert", tone: "red" },
    ];
    cards.forEach(function (card, i) {
      var c = cfg[i] || cfg[0];
      var body = document.createElement("div");
      body.className = "sv-kpi-body";
      while (card.firstChild) body.appendChild(card.firstChild);
      var ico = document.createElement("div");
      ico.className = "sv-kpi-ico tone-" + c.tone;
      ico.innerHTML = svg(c.ic, 20);
      card.appendChild(ico);
      card.appendChild(body);
    });
  }

  /* ---- painel de exceções ao lado do mapa ---- */
  function buildExceptions() {
    var map = document.querySelector(".map-section");
    if (!map || document.querySelector(".sv-exc")) return;
    var hero = document.createElement("div");
    hero.className = "sv-hero";
    map.parentNode.insertBefore(hero, map);
    hero.appendChild(map);
    var panel = document.createElement("section");
    panel.className = "sv-exc";
    panel.innerHTML =
      '<div class="sv-exc-head"><div><div class="sv-exc-title">Precisa de atenção</div>' +
      '<div class="sv-exc-sub">Ordenado por severidade</div></div>' +
      '<span class="sv-exc-count" id="sv-exc-count">—</span></div>' +
      '<div class="sv-exc-list" id="sv-exc-list"></div>';
    hero.appendChild(panel);
  }

  function renderExceptions(drivers, periodHours) {
    var listEl = document.getElementById("sv-exc-list");
    var countEl = document.getElementById("sv-exc-count");
    if (!listEl) return;
    var color = { danger: "#DC2626", warn: "#D97706", neutral: "#94A3B8" };
    var items = [];
    (drivers || []).forEach(function (d) {
      var html = (typeof getStatusPill === "function") ? getStatusPill(d, periodHours) : "";
      var cls = html.indexOf("status-danger") >= 0 ? "danger"
        : (html.indexOf("status-warn") >= 0 ? "warn"
        : (html.indexOf("status-neutral") >= 0 ? "neutral" : "active"));
      if (cls === "active") return;
      var sev = cls === "danger" ? 0 : (cls === "warn" ? 1 : 2);
      items.push({ d: d, cls: cls, sev: sev, pill: html });
    });
    items.sort(function (a, b) { return a.sev - b.sev; });

    if (countEl) {
      countEl.textContent = items.length ? items.length + " itens" : "ok";
      countEl.style.background = items.length ? "" : "#E7F7EE";
      countEl.style.color = items.length ? "" : "var(--c-success)";
    }
    if (!items.length) {
      listEl.innerHTML = '<div class="sv-exc-empty">' + svg("check", 34) +
        '<div class="sv-exc-empty-t">Tudo certo</div>' +
        '<div class="sv-exc-empty-s">Nenhuma exceção na frota agora</div></div>';
      return;
    }
    listEl.innerHTML = "";
    items.forEach(function (it) {
      var d = it.d;
      var when = (d.hoursAgo === null || d.hoursAgo === undefined) ? "sem check-in"
        : (typeof formatHoursAgo === "function" ? formatHoursAgo(d.hoursAgo) : "");
      var meta = (d.city ? d.city : (d.country || "")) + (when ? " · " + when : "");
      var btn = document.createElement("button");
      btn.className = "sv-exc-row";
      btn.innerHTML =
        '<span class="sv-exc-bar" style="background:' + color[it.cls] + '"></span>' +
        '<span class="sv-exc-av">' + initials(d.name) + "</span>" +
        '<span class="sv-exc-info"><span class="sv-exc-name">' + esc(d.name) + "</span>" +
        '<span class="sv-exc-meta">' + esc(meta) + "</span></span>" + it.pill;
      btn.addEventListener("click", function () { if (typeof openDriverPanel === "function") openDriverPanel(d); });
      listEl.appendChild(btn);
    });
  }

  /* ---- hook na renderTable (recebe a lista filtrada + período) ---- */
  function hookRender() {
    if (typeof window.renderTable !== "function" || window.renderTable.__svWrapped) return;
    var orig = window.renderTable;
    window.renderTable = function (drivers, periodHours) {
      var r = orig.apply(this, arguments);
      try { renderExceptions(drivers, periodHours); } catch (e) {}
      return r;
    };
    window.renderTable.__svWrapped = true;
  }

  function init() {
    enhanceKpis();
    buildExceptions();
    hookRender();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
