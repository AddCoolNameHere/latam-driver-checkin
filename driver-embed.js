/* ============================================================
 * driver-embed.js — integra as páginas de motorista no app /app/
 * ============================================================
 *
 * As 5 páginas de motorista (checkin/, assets, cash, ar-divergencias,
 * driver-docs) continuam funcionando sozinhas, exatamente como antes.
 * Quando abertas DENTRO do app (iframe com ?app=1), este script:
 *
 *   1. esconde o cabeçalho/título/rodapé da página (o app tem o seu);
 *   2. troca o dropdown "Selecione seu nome" por um cartão com o motorista
 *      logado — e seleciona ele sozinho (inclusive depois do reset/reload
 *      que as páginas fazem após enviar);
 *   3. aplica o idioma escolhido no app;
 *   4. avisa o app quando a página faz um POST (pro resumo da tela inicial
 *      se atualizar sem o motorista precisar recarregar).
 *
 * Fora do app: a página aberta direto (link antigo) REDIRECIONA pro app
 * na aba certa — exceto em iframe, com admin logado ou com ?classic=1.
 * Com ?app=1 mas sem login salvo, não faz nada.
 *
 * Carregar SÍNCRONO no <head> (é pequeno): precisa adicionar a classe
 * no <html> antes do primeiro paint, senão o cabeçalho pisca.
 * A página chama SVEmbed.run({...}) no fim do próprio script.
 *
 * Sessão: localStorage 'svapp.session.v1' = {email, name, country, city},
 * gravada pelo login do app. Idioma: localStorage 'svapp.lang'.
 * ============================================================ */
(function () {
  'use strict';

  const SESSION_KEY = 'svapp.session.v1';
  const LANG_KEY = 'svapp.lang';

  const noop = { active: false, run: function () {}, setLang: function () {} };

  let qs;
  try { qs = new URLSearchParams(location.search); } catch (e) { window.SVEmbed = noop; return; }

  // ---- Links antigos → app (desde o lançamento do app, 2026-11-06) ----
  // Aberta direto (favorito, atalho na tela do celular, link velho no WhatsApp),
  // a página de motorista manda pro app já na aba certa. NÃO redireciona:
  //   • dentro de iframe (o próprio app, o "dashboard teste" do admin);
  //   • com admin logado (o hub admin.html linka essas páginas);
  //   • com ?classic=1 (escape pra suporte/debug: abre a página antiga).
  function appTabForPath(p) {
    if (/\/checkin\/?(index\.html)?$/.test(p)) return 'checkin';
    if (/\/assets\.html$/.test(p)) return 'assets';
    if (/\/cash\.html$/.test(p)) return 'cash';
    if (/\/ar-divergencias\.html$/.test(p)) return 'ardiv';
    if (/\/disk-swap\.html$/.test(p)) return 'swap';
    if (/\/driver-docs\.html$/.test(p)) return 'docs';
    return '';
  }
  function adminLoggedIn() {
    try {
      const s = JSON.parse(localStorage.getItem('aceolution_latam_session') || 'null');   // auth.js SESSION_KEY
      return !!(s && s.username && s.expiresAt && Date.now() < s.expiresAt);
    } catch (e) { return false; }
  }
  if (qs.get('app') !== '1' && !qs.has('classic')) {
    let topLevel = false;
    try { topLevel = window.top === window; } catch (e) { topLevel = false; }
    const tab = topLevel && !adminLoggedIn() ? appTabForPath(location.pathname) : '';
    if (tab) {
      const me = document.currentScript && document.currentScript.src;
      const appUrl = new URL('app/', me || (location.origin + '/')).href;
      // Esconde a página antiga pra não piscar enquanto o navegador troca de URL.
      document.documentElement.style.visibility = 'hidden';
      console.log('[Driver App] página antiga → app (#' + tab + ')');
      location.replace(appUrl + '#' + tab);
      window.SVEmbed = noop;
      return;
    }
  }

  if (qs.get('app') !== '1') { window.SVEmbed = noop; return; }

  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { session = null; }
  if (!session || !session.email) {
    console.warn('[Driver App] ?app=1 sem sessão salva — página segue no modo normal');
    window.SVEmbed = noop;
    return;
  }

  const root = document.documentElement;
  root.classList.add('sv-app');
  // Página de motorista é sempre light (ar-divergencias carrega theme.js).
  root.removeAttribute('data-theme');

  const STR = {
    pt: { as: 'Enviando como', notFound: 'Não achamos seu nome nesta lista. Escolha manualmente:' },
    es: { as: 'Enviando como', notFound: 'No encontramos tu nombre en esta lista. Elegilo manualmente:' },
    en: { as: 'Submitting as', notFound: "We couldn't find your name in this list. Pick it manually:" },
  };

  function getLang() {
    let l = '';
    try { l = localStorage.getItem(LANG_KEY) || ''; } catch (e) {}
    return ['pt', 'es', 'en'].includes(l) ? l : 'pt';
  }

  // ---- CSS: some com o cromo da página + estilo do cartão do motorista ----
  const css = [
    'html.sv-app body > header, html.sv-app body > footer, html.sv-app .nav-back,',
    'html.sv-app body > h1, html.sv-app body > .subtitle { display: none !important; }',
    'html.sv-app .sv-hidden { display: none !important; }',
    'html.sv-app body { padding-top: 14px !important; }',
    '.sv-who { display: flex; align-items: center; gap: 12px; padding: 12px 14px;',
    '  border: 1px solid var(--c-border, #E2E8F0); border-radius: 12px;',
    '  background: var(--c-bg-tint, #EBF4FB); margin-top: 6px; }',
    '.sv-who-av { width: 40px; height: 40px; border-radius: 50%; flex: none;',
    '  display: grid; place-items: center; color: #fff; font-weight: 700; font-size: 14px;',
    '  background: linear-gradient(135deg, #4A9FE0, #2C5282); letter-spacing: .02em; }',
    '.sv-who-txt { min-width: 0; }',
    '.sv-who-sub { font-size: 12px; color: var(--c-text-muted, #64748B); }',
    '.sv-who-name { font-size: 15px; font-weight: 650; color: var(--c-text, #1A202C);',
    '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.sv-who-ok { margin-left: auto; flex: none; width: 22px; height: 22px; border-radius: 50%;',
    '  background: #16A34A; color: #fff; display: grid; place-items: center; font-size: 13px; }',
    '.sv-who-note { font-size: 13px; color: var(--c-warn, #CA8A04); margin: 6px 0; }',
  ].join('\n');
  const style = document.createElement('style');
  style.id = 'sv-embed-css';
  style.textContent = css;
  (document.head || root).appendChild(style);

  // ---- App velho aberto no celular → recarrega a casca (2026-11-12) ----
  // O app instalado pode ficar dias vivo em segundo plano com o JS antigo. As
  // páginas embutidas carregam este arquivo de novo (o ?v= muda a cada versão),
  // então é daqui que dá pra puxar a casca. Pra forçar uma atualização geral:
  // sobe APP_BUILD_MIN aqui E window.SVApp.build no app/index.html, e troca o
  // ?v= do driver-embed.js nas 5 páginas de motorista.
  // Só recarrega com o app na tela Início e visível — nunca no meio de um formulário.
  const APP_BUILD_MIN = '2026-11-12b';   // 12b: troca de disco
  const RELOAD_KEY = 'svapp.shellReloadAt';
  function shellOutdated() {
    try {
      const app = window.parent !== window && window.parent.SVApp;
      return !!app && !(String(app.build || '') >= APP_BUILD_MIN);
    } catch (e) { return false; }
  }
  /** true = resolvido (recarregou ou não precisa/não deve); false = tenta de novo depois. */
  function reloadShellIfSafe() {
    try {
      if (!shellOutdated()) return true;
      const last = Number(localStorage.getItem(RELOAD_KEY) || 0);
      if (Date.now() - last < 5 * 60 * 1000) return true;   // já recarregou há pouco: sem loop se um cache servir a velha
      const p = window.parent;
      if (p.document.visibilityState !== 'visible') return false;
      if (p.location.hash && p.location.hash !== '#') return false;   // fora da tela Início
      localStorage.setItem(RELOAD_KEY, String(Date.now()));
      console.log('[Driver App] app desatualizado (build < ' + APP_BUILD_MIN + ') — recarregando');
      p.location.reload();
      return true;
    } catch (e) { return true; }
  }
  if (shellOutdated() && !reloadShellIfSafe()) {
    const shellTimer = setInterval(function () { if (reloadShellIfSafe()) clearInterval(shellTimer); }, 4000);
  }

  // ---- Avisa o app (janela pai, mesma origem) ----
  function notify(evt) {
    try {
      if (window.parent && window.parent !== window && window.parent.SVApp) {
        window.parent.SVApp.onEmbedEvent(currentPage, evt);
      }
    } catch (e) { /* app fora do ar / outra origem — ignora */ }
  }
  let currentPage = '';

  // ---- POSTs: embrulha o fetch pra contar ao app quando algo foi enviado ----
  // Instalado aqui no <head>, antes dos scripts da página.
  const origFetch = window.fetch ? window.fetch.bind(window) : null;
  if (origFetch) {
    window.fetch = function (input, init) {
      const p = origFetch(input, init);
      try {
        if (init && String(init.method || '').toUpperCase() === 'POST') {
          let type = '', email = '';
          try {
            const b = JSON.parse(init.body) || {};
            type = b.type || '';
            email = b.driverEmail || b.email || '';   // o app ignora envio de outro motorista
          } catch (e) {}
          p.then(function (res) {
            if (res.type === 'opaque') { notify({ kind: 'post', type: type, email: email, ok: true }); return; }
            res.clone().json()
              .then(function (j) { notify({ kind: 'post', type: type, email: email, ok: !!(j && j.success !== false) }); })
              .catch(function () { notify({ kind: 'post', type: type, email: email, ok: res.ok }); });
          }).catch(function () { notify({ kind: 'post', type: type, email: email, ok: false }); });
        }
      } catch (e) {}
      return p;
    };
  }

  // ---- Idioma: clica no botão da própria página (cada uma tem o seu) ----
  function setLang(l) {
    if (!['pt', 'es', 'en'].includes(l)) return;
    const btn = document.querySelector(
      '.lang-switch button[data-lang="' + l + '"], .lang-toggle button[data-lang="' + l + '"]'
    );
    if (btn) btn.click();
    if (chip) {
      const sub = chip.querySelector('.sv-who-sub');
      if (sub) sub.textContent = (STR[l] || STR.pt).as;
    }
    if (note) note.textContent = (STR[l] || STR.pt).notFound;
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    const a = parts[0][0] || '';
    const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (a + b).toUpperCase();
  }

  /** E-mail dentro do value do <option>: pode ser o e-mail puro ou um JSON do motorista. */
  function emailOf(value) {
    if (!value) return '';
    const v = String(value);
    if (v.charAt(0) === '{') {
      try { return String(JSON.parse(v).email || '').trim().toLowerCase(); } catch (e) { return ''; }
    }
    return v.trim().toLowerCase();
  }

  let chip = null;
  let note = null;

  function buildChip(sel) {
    if (chip && chip.isConnected) return;
    const l = getLang();
    chip = document.createElement('div');
    chip.className = 'sv-who';
    chip.innerHTML =
      '<div class="sv-who-av"></div>' +
      '<div class="sv-who-txt"><div class="sv-who-sub"></div><div class="sv-who-name"></div></div>' +
      '<div class="sv-who-ok" aria-hidden="true">✓</div>';
    chip.querySelector('.sv-who-av').textContent = initials(session.name);
    chip.querySelector('.sv-who-sub').textContent = (STR[l] || STR.pt).as;
    chip.querySelector('.sv-who-name').textContent = session.name || session.email;
    sel.insertAdjacentElement('afterend', chip);

    // Some com o dropdown, o label de cima e a dica de baixo.
    sel.classList.add('sv-hidden');
    const prev = sel.previousElementSibling;
    if (prev && prev.tagName === 'LABEL') prev.classList.add('sv-hidden');
    const next = chip.nextElementSibling;
    if (next && next.classList.contains('field-hint')) next.classList.add('sv-hidden');
  }

  /** Motorista não está na lista desta página: devolve o dropdown pro motorista escolher. */
  function showFallback(sel) {
    if (chip) chip.remove();
    chip = null;
    sel.classList.remove('sv-hidden');
    const prev = sel.previousElementSibling;
    if (prev && prev.tagName === 'LABEL') prev.classList.remove('sv-hidden');
    note = document.createElement('div');
    note.className = 'sv-who-note';
    note.textContent = (STR[getLang()] || STR.pt).notFound;
    sel.insertAdjacentElement('beforebegin', note);
    console.warn('[Driver App] ' + session.email + ' não está na lista de ' + currentPage);
  }

  /**
   * cfg:
   *   page     — nome curto ('checkin', 'assets', ...) pros logs/eventos
   *   select   — seletor do dropdown de motorista (default '#driver-select')
   *   hide     — seletores extras pra esconder no app
   *   prepare  — fn(session) chamada a cada ciclo antes de procurar a opção
   *              (ex: driver-docs precisa escolher o país primeiro). Idempotente.
   *   after    — fn(session) logo depois de selecionar o motorista
   *              (ex: clicar em "Continuar").
   */
  function run(cfg) {
    cfg = cfg || {};
    currentPage = cfg.page || location.pathname;
    const selector = cfg.select || '#driver-select';
    const target = String(session.email).trim().toLowerCase();

    if (cfg.hide && cfg.hide.length) {
      const extra = document.createElement('style');
      extra.textContent = cfg.hide.map(function (s) { return 'html.sv-app ' + s; }).join(',\n') +
        ' { display: none !important; }';
      document.head.appendChild(extra);
    }

    setLang(getLang());

    let fallback = false;
    let missTicks = 0;

    function tick() {
      if (fallback) return;
      const sel = document.querySelector(selector);
      if (!sel) return;
      if (cfg.prepare) { try { cfg.prepare(session); } catch (e) { console.warn('[Driver App] prepare:', e); } }

      if (sel.value && emailOf(sel.value) === target) { buildChip(sel); missTicks = 0; return; }

      // Só conta como "lista carregada" opção que tem e-mail: placeholders tipo
      // <option>Carregando motoristas...</option> (cash.html) têm value = texto.
      let found = null;
      let loaded = 0;
      for (let i = 0; i < sel.options.length; i++) {
        const em = emailOf(sel.options[i].value);
        if (!em || em.indexOf('@') < 0) continue;
        loaded++;
        if (em === target) { found = sel.options[i]; break; }
      }

      if (!found) {
        // Só desiste depois que a lista já carregou de verdade.
        if (loaded > 0 && ++missTicks >= 8) { fallback = true; showFallback(sel); }
        return;
      }

      missTicks = 0;
      sel.value = found.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      buildChip(sel);
      console.log('[Driver App] ' + currentPage + ': motorista selecionado (' + target + ')');
      if (cfg.after) {
        setTimeout(function () {
          try { cfg.after(session); } catch (e) { console.warn('[Driver App] after:', e); }
        }, 60);
      }
    }

    // Polling leve: as listas chegam assíncronas e as páginas zeram o
    // dropdown depois de enviar — o ciclo re-seleciona sozinho.
    tick();
    setInterval(tick, 350);

    // Link pra outra página de motorista (ex: "← Voltar ao check-in") vira troca de aba no app.
    document.addEventListener('click', function (e) {
      const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      let tab = '';
      try {
        const p = new URL(a.href, location.href).pathname;
        if (/\/checkin\/?(index\.html)?$/.test(p)) tab = 'checkin';
        else if (/\/assets(\.html|\/)?$/.test(p)) tab = 'assets';
        else if (/\/cash\.html$/.test(p)) tab = 'cash';
        else if (/\/driver-docs\.html$/.test(p)) tab = 'docs';
        else if (/\/ar-divergencias\.html$/.test(p)) tab = 'ardiv';
        else if (/\/disk-swap\.html$/.test(p)) tab = 'swap';
      } catch (err) { return; }
      if (!tab) return;
      try {
        if (window.parent && window.parent.SVApp) { e.preventDefault(); window.parent.SVApp.openTab(tab); }
      } catch (err) {}
    }, true);

    notify({ kind: 'ready' });
  }

  window.SVEmbed = { active: true, session: session, run: run, setLang: setLang };
})();
