/* ============================================================
 * ui.js — comportamentos do kit de UI do portal (par do ui.css).
 * Sem dependências, sem build. Carregado pelo sv-shell.js nas
 * páginas admin; páginas públicas podem incluir direto.
 *
 * Expõe window.UI:
 *   UI.icon(name)                 → <svg> (string) de um ícone lucide
 *   UI.toast(title, opts)         → toast estilo Sonner
 *   UI.cmd.open() / .register()   → paleta de comandos (Ctrl/⌘+K)
 *   UI.menu.open(anchor, html)    → dropdown menu
 *   UI.confirmInline(btn, opts)   → Promise<boolean>, "delete" sem dialog (Rare UI)
 *
 * Automático (sem mexer nas páginas):
 *   - Emoji de "ícone" no começo de botão/título/pill → ícone SVG (lucide)
 *   - 🔴🟡🟢 → bolinha de status · 🇧🇷🇦🇷… → bandeira SVG (Windows não desenha)
 *   - Valores de KPI rolam como odômetro quando mudam (Rare UI · Animated counter)
 *   - [data-tip] → tooltip · relatórios longos ganham barra de leitura
 *
 * Nada aqui mexe em ID, fetch ou lógica das páginas. Pra desligar a troca
 * de emoji num trecho: data-no-icon no elemento.
 * ============================================================ */
(function () {
  if (window.UI && window.UI.__ready) return;

  const REDUCED = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();

  // ---------------------------------------------------------------
  // Ícones (lucide, 24x24, stroke 2)
  // ---------------------------------------------------------------
  const P = {
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    card: '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
    clipboard: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01"/>',
    trendUp: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
    trendDown: '<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
    barChart: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    hourglass: '<path d="M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
    home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .71-1.53l7-6a2 2 0 0 1 2.58 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    hotel: '<path d="M10 22v-6.57M12 11h.01M12 7h.01M14 15.43V22M15 16a5 5 0 0 0-6 0M16 11h.01M16 7h.01M8 11h.01M8 7h.01"/><rect x="4" y="2" width="16" height="20" rx="2"/>',
    building: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    cloudRain: '<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M16 14v6M8 14v6M12 16v6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    siren: '<path d="M7 18v-6a5 5 0 1 1 10 0v6"/><path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z"/><path d="M21 12h1M18.5 4.5 18 5M2 12h1M12 2v1M4.93 4.93l.71.71"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
    calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    checkCircle: '<path d="M21.8 10A10 10 0 1 1 17 3.34"/><path d="m9 11 3 3L22 4"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    xCircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
    map: '<path d="M14.11 5.55a2 2 0 0 0 1.78 0l3.66-1.83A1 1 0 0 1 21 4.62v12.76a1 1 0 0 1-.55.9l-4.56 2.27a2 2 0 0 1-1.78 0l-4.22-2.1a2 2 0 0 0-1.78 0l-3.66 1.83A1 1 0 0 1 3 19.38V6.62a1 1 0 0 1 .55-.9l4.56-2.27a2 2 0 0 1 1.78 0z"/><path d="M15 5.76v15M9 3.24v15"/>',
    pin: '<path d="M20 10c0 5-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 15 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    compass: '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.8 5.4a2 2 0 0 1-1.28 1.28l-5.4 1.8 1.8-5.4a2 2 0 0 1 1.28-1.28z"/>',
    save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7M7 3v4a1 1 0 0 0 1 1h7"/>',
    disk: '<path d="M22 12H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M6 16h.01M10 16h.01"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    video: '<path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.42V7.94a.5.5 0 0 0-.76-.43L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    pencil: '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>',
    filePen: '<path d="M12.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v9.5"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M13.38 15.62a1 1 0 0 0-3-3L5.4 17.6a2 2 0 0 0-.5.85l-.84 2.86a.5.5 0 0 0 .62.62l2.87-.84a2 2 0 0 0 .85-.5z"/>',
    trash: '<path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
    minus: '<path d="M5 12h14"/>',
    fileText: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
    fuel: '<path d="M3 22h12M4 9h10M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2 2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/>',
    receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11"/>',
    dollar: '<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 18V6"/>',
    banknote: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
    wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    printer: '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
    bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
    star: '<path d="M11.52 2.3a.53.53 0 0 1 .96 0l2.31 4.68a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.01a.53.53 0 0 1-.77-.56l.88-5.14a2.12 2.12 0 0 0-.61-1.88L2.16 9.8a.53.53 0 0 1 .29-.9l5.17-.76a2.12 2.12 0 0 0 1.6-1.16z"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    sparkles: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>',
    route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
    package: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12M3.29 7 12 12l8.71-5M7.5 4.27l9 5.15"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    unlock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
    bell: '<path d="M10.27 21a2 2 0 0 0 3.46 0M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33"/>',
    eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
    bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    shuffle: '<path d="m18 14 4 4-4 4M18 2l4 4-4 4"/><path d="M2 18h1.97a4 4 0 0 0 3.3-1.7l5.46-8.6a4 4 0 0 1 3.3-1.7H22M2 6h1.97a4 4 0 0 1 3.3 1.7l.71 1.12M22 18h-6.04a4 4 0 0 1-3.3-1.8l-.36-.45"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11"/>',
    arrowLeft: '<path d="m12 19-7-7 7-7M19 12H5"/>',
    arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    arrowUpRight: '<path d="M7 7h10v10M7 17 17 7"/>',
    arrowDownRight: '<path d="m7 7 10 10M17 7v10H7"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
    signal: '<path d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4v16"/>',
    battery: '<rect width="16" height="10" x="2" y="7" rx="2"/><path d="M22 11v2M6 11v2"/>',
    scale: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1ZM2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1ZM7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
    calculator: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M8 6h8M16 14v4M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01"/>',
    ruler: '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2"/>',
    flask: '<path d="M10 2v7.53a2 2 0 0 1-.21.9L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.07-10.12a2 2 0 0 1-.21-.9V2M8.5 2h7M7 16h10"/>',
    command: '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
    panelLeft: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
    chevronsUpDown: '<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    languages: '<path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/>',
    external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    loader: '<path d="M21 12a9 9 0 1 1-6.22-8.56"/>',
  };
  function icon(name, cls) {
    const body = P[name];
    if (!body) return '';
    return `<svg class="ui-ico${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  }

  // ---------------------------------------------------------------
  // i18n mínimo (segue a língua da página)
  // ---------------------------------------------------------------
  function curLang() {
    try {
      const h = (document.documentElement.getAttribute('lang') || '').toLowerCase();
      if (h.startsWith('es')) return 'es';
      if (h.startsWith('en')) return 'en';
      if (h.startsWith('pt')) return 'pt';
      const s = localStorage.getItem('latam.lang');
      if (s === 'es' || s === 'en' || s === 'pt') return s;
    } catch (e) {}
    return 'pt';
  }
  const T = {
    pt: { search: 'Buscar página ou ação…', pages: 'Páginas', actions: 'Ações', empty: 'Nada encontrado.',
          nav: 'navegar', open: 'abrir', close: 'fechar', theme: 'Alternar tema claro/escuro',
          collapse: 'Recolher/expandir menu', logout: 'Sair', lang: 'Idioma', confirm: 'Confirmar', cancel: 'Cancelar',
          sure: 'Tem certeza?' },
    es: { search: 'Buscar página o acción…', pages: 'Páginas', actions: 'Acciones', empty: 'Nada encontrado.',
          nav: 'navegar', open: 'abrir', close: 'cerrar', theme: 'Cambiar tema claro/oscuro',
          collapse: 'Contraer/expandir menú', logout: 'Salir', lang: 'Idioma', confirm: 'Confirmar', cancel: 'Cancelar',
          sure: '¿Seguro?' },
    en: { search: 'Search pages or actions…', pages: 'Pages', actions: 'Actions', empty: 'No results.',
          nav: 'navigate', open: 'open', close: 'close', theme: 'Toggle light/dark theme',
          collapse: 'Collapse/expand sidebar', logout: 'Sign out', lang: 'Language', confirm: 'Confirm', cancel: 'Cancel',
          sure: 'Are you sure?' },
  };
  const t = (k) => (T[curLang()] || T.pt)[k];

  // ---------------------------------------------------------------
  // Emoji → ícone / bolinha / bandeira
  // ---------------------------------------------------------------
  const EMOJI_ICON = {
    '⬇': 'download', '📥': 'download', '⬆': 'upload', '📤': 'upload',
    '⟳': 'refresh', '↻': 'refresh', '🔄': 'refresh', '🔁': 'refresh',
    '⚙': 'settings', '🛠': 'wrench', '🔧': 'wrench', '🧰': 'wrench',
    '💳': 'card', '📋': 'clipboard', '📈': 'trendUp', '📉': 'trendDown', '📊': 'barChart',
    '🕒': 'clock', '⏰': 'clock', '⏱': 'clock', '🕐': 'clock', '🕑': 'clock', '⌛': 'hourglass', '⏳': 'hourglass',
    '🏠': 'home', '🏡': 'home', '🏨': 'hotel', '🏢': 'building', '🏬': 'building', '🏗': 'building',
    '☁': 'cloud', '🌧': 'cloudRain', '🌦': 'cloudRain', '⛈': 'cloudRain', '⛅': 'cloud', '🌤': 'sun', '☀': 'sun', '🌙': 'moon', '☾': 'moon',
    '🚨': 'siren', '⚠': 'alert', '❗': 'alert', '❕': 'alert',
    '📅': 'calendar', '📆': 'calendar', '🗓': 'calendar',
    '✓': 'check', '✔': 'check', '✅': 'checkCircle', '☑': 'checkCircle',
    '✗': 'x', '✕': 'x', '✖': 'x', '❌': 'xCircle', '❎': 'xCircle',
    '🗺': 'map', '📍': 'pin', '📌': 'pin', '🧭': 'compass',
    '💾': 'save', '💽': 'disk', '📷': 'camera', '📸': 'camera', '🎥': 'video', '📹': 'video',
    '✏': 'pencil', '🖊': 'pencil', '🖋': 'pencil', '📝': 'filePen', '🗑': 'trash', '➕': 'plus', '➖': 'minus',
    '📄': 'fileText', '📃': 'fileText', '📑': 'fileText', '🧾': 'receipt', '📁': 'folder', '📂': 'folder', '🗂': 'folder', '🗄': 'archive',
    '👤': 'user', '🧑': 'user', '👥': 'users',
    '🚗': 'car', '🚙': 'car', '🚘': 'car', '⛽': 'fuel',
    '💰': 'dollar', '🪙': 'dollar', '💵': 'banknote', '💸': 'banknote', '👛': 'wallet',
    '🌎': 'globe', '🌍': 'globe', '🌏': 'globe', '🌐': 'globe',
    '📞': 'phone', '☎': 'phone', '📱': 'phone', '✉': 'mail', '📧': 'mail', '📨': 'mail', '📩': 'mail',
    '📎': 'paperclip', '🔗': 'link', '🖨': 'printer', '💡': 'bulb', '🎯': 'target', '🚀': 'rocket',
    '⭐': 'star', '🌟': 'star', '🏆': 'trophy', '🥇': 'trophy', '⚡': 'zap', '✨': 'sparkles', '🛣': 'route',
    'ℹ': 'info', '⛔': 'ban', '🚫': 'ban', '📦': 'package', '🔒': 'lock', '🔐': 'lock', '🔓': 'unlock',
    '🔔': 'bell', '👁': 'eye', '🔍': 'search', '🔎': 'search', '🤖': 'bot', '🧠': 'sparkles',
    '💬': 'message', '🗨': 'message', '📣': 'megaphone', '📢': 'megaphone', '🔀': 'shuffle',
    '🏁': 'flag', '🚩': 'flag', '📶': 'signal', '📡': 'signal', '🔋': 'battery', '⚖': 'scale',
    '🧮': 'calculator', '📐': 'ruler', '📏': 'ruler', '🧪': 'flask',
    '↩': 'undo', '↺': 'undo', '⤓': 'download', '←': 'arrowLeft', '→': 'arrowRight', '↗': 'arrowUpRight', '↘': 'arrowDownRight',
  };
  const EMOJI_DOT = {
    '🔴': 'var(--c-danger)', '🟠': '#EA580C', '🟡': 'var(--c-warn)', '🟢': 'var(--c-success)',
    '🔵': 'var(--c-accent)', '🟣': '#7C3AED', '⚪': 'var(--c-text-dim)', '⚫': 'var(--c-text)', '🟤': '#92400E',
  };
  const ARROWS_TRAIL = new Set(['→', '↗', '↘']);
  const ALL_KEYS = Object.keys(EMOJI_ICON).concat(Object.keys(EMOJI_DOT))
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const RE_LEAD = new RegExp('^(\\s*)(' + ALL_KEYS.join('|') + ')\\uFE0F?\\s*', 'u');
  const RE_TRAIL = /\s*([→↗↘])️?\s*$/u;
  const RE_FLAG = /([\u{1F1E6}-\u{1F1FF}]{2})/u;
  const RE_QUICK = /[←-⯿\u{1F000}-\u{1FAFF}✓-✖ℹ]/u;

  const FLAGS = {
    BR: '<rect width="30" height="20" fill="#009C3B"/><path d="M15 2.6 27.4 10 15 17.4 2.6 10z" fill="#FFDF00"/><circle cx="15" cy="10" r="4.4" fill="#002776"/><path d="M10.8 9.3c2.9-.8 6.1-.5 8.6 1.1" stroke="#fff" stroke-width=".9" fill="none"/>',
    AR: '<rect width="30" height="20" fill="#74ACDF"/><rect y="6.67" width="30" height="6.66" fill="#fff"/><circle cx="15" cy="10" r="1.9" fill="#F6B40E"/>',
    CL: '<rect width="30" height="20" fill="#fff"/><rect y="10" width="30" height="10" fill="#D52B1E"/><rect width="10" height="10" fill="#0039A6"/><path d="m5 2.4.95 2.9H9l-2.47 1.8.94 2.9L5 8.2 2.53 10l.94-2.9L1 5.3h3.05z" fill="#fff"/>',
    CO: '<rect width="30" height="20" fill="#CE1126"/><rect width="30" height="15" fill="#003893"/><rect width="30" height="10" fill="#FCD116"/>',
    MX: '<rect width="30" height="20" fill="#fff"/><rect width="10" height="20" fill="#006847"/><rect x="20" width="10" height="20" fill="#CE1126"/><circle cx="15" cy="10" r="2.3" fill="#8C6B2D" opacity=".8"/>',
    PE: '<rect width="30" height="20" fill="#D91023"/><rect x="10" width="10" height="20" fill="#fff"/>',
    US: '<rect width="30" height="20" fill="#fff"/><path d="M0 0h30v1.54H0zm0 3.08h30v1.54H0zm0 3.08h30v1.54H0zm0 3.08h30v1.54H0zm0 3.08h30v1.54H0zm0 3.08h30v1.54H0zm0 3.07h30V20H0z" fill="#B22234"/><rect width="13" height="10.77" fill="#3C3B6E"/>',
    ES: '<rect width="30" height="20" fill="#AA151B"/><rect y="5" width="30" height="10" fill="#F1BF00"/>',
    IN: '<rect width="30" height="20" fill="#fff"/><rect width="30" height="6.67" fill="#FF9933"/><rect y="13.33" width="30" height="6.67" fill="#138808"/><circle cx="15" cy="10" r="2.2" fill="none" stroke="#000080" stroke-width=".6"/>',
  };
  function flagSvg(pair) {
    const code = Array.from(pair).map((c) => String.fromCharCode(c.codePointAt(0) - 0x1F1E6 + 65)).join('');
    const body = FLAGS[code] || `<rect width="30" height="20" fill="#EBF4FB"/><text x="15" y="13.6" font-size="9" font-weight="700" text-anchor="middle" font-family="sans-serif" fill="#1A365D">${code}</text>`;
    return `<span class="ui-flag" role="img" aria-label="${code}"><svg viewBox="0 0 30 20">${body}</svg></span>`;
  }

  const SKIP_SEL = 'script,style,textarea,option,select,title,svg,canvas,code,pre,noscript,input,[contenteditable],[data-no-icon],.leaflet-marker-pane,.leaflet-marker-icon,.leaflet-tooltip-pane,.ui-odo';
  function htmlToNode(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html.trim();
    return tpl.content.firstChild;
  }
  function iconNodeFor(glyph, isSolo, isTrail, parentEl) {
    if (EMOJI_DOT[glyph]) {
      const s = document.createElement('span');
      s.className = 'ui-dot';
      s.style.setProperty('--dot', EMOJI_DOT[glyph]);
      if (!isSolo) s.style.marginRight = '.45em';
      return s;
    }
    let name = EMOJI_ICON[glyph];
    // ↩ dentro de um link/botão de logout = "sair"
    if (glyph === '↩' && parentEl && parentEl.closest('.logout-link,[onclick*="ogout"],[title="Sair"],[title="Logout"]')) name = 'logout';
    const node = htmlToNode(icon(name));
    if (!node) return null;
    if (!isSolo) node.style[isTrail ? 'marginLeft' : 'marginRight'] = '.4em';
    return node;
  }

  function processText(tn) {
    const parent = tn.parentNode;
    if (!parent || parent.nodeType !== 1) return;
    let data = tn.data;
    if (!data || !RE_QUICK.test(data)) return;
    if (parent.closest(SKIP_SEL)) return;

    // Bandeiras: em qualquer posição do texto
    if (RE_FLAG.test(data)) {
      const parts = data.split(/([\u{1F1E6}-\u{1F1FF}]{2})/u);
      const frag = document.createDocumentFragment();
      parts.forEach((p) => {
        if (!p) return;
        if (/^[\u{1F1E6}-\u{1F1FF}]{2}$/u.test(p)) frag.appendChild(htmlToNode(flagSvg(p)));
        else frag.appendChild(document.createTextNode(p));
      });
      parent.replaceChild(frag, tn);
      return; // os pedaços de texto novos passam de novo pelo observer
    }

    // Glifo no começo
    const m = data.match(RE_LEAD);
    if (m) {
      const glyph = m[2];
      const rest = data.slice(m[0].length);
      const solo = rest.trim() === '' && !tn.previousSibling && !tn.nextSibling;
      // "×" sozinho num botão de fechar também vira X
      const node = iconNodeFor(glyph, solo, false, parent);
      if (node) {
        parent.insertBefore(node, tn);
        tn.data = (m[1] ? '' : '') + rest;
        data = tn.data;
      }
    } else if (data.trim() === '×' && parent.closest('button,a,[role="button"],[class*="close"]')) {
      const node = htmlToNode(icon('x'));
      parent.replaceChild(node, tn);
      return;
    }

    // Seta no fim ("Ver mais →")
    const mt = data.match(RE_TRAIL);
    if (mt && ARROWS_TRAIL.has(mt[1]) && data.trim().length > 1) {
      const node = iconNodeFor(mt[1], false, true, parent);
      if (node) {
        tn.data = data.slice(0, data.length - mt[0].length);
        parent.insertBefore(node, tn.nextSibling);
      }
    }
  }

  function iconize(root) {
    if (!root) return;
    if (root.nodeType === 3) { processText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 11) return;
    if (root.nodeType === 1 && root.closest && root.closest(SKIP_SEL)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.data && RE_QUICK.test(n.data)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
    });
    const list = [];
    while (walker.nextNode()) list.push(walker.currentNode);
    list.forEach(processText);
  }

  // ---------------------------------------------------------------
  // Contador odômetro nos KPIs (Rare UI · Animated counter)
  // Durante a animação o elemento vira colunas de dígitos; no fim volta
  // a ser texto puro (textContent idêntico ao que a página escreveu).
  // ---------------------------------------------------------------
  const ODO_SEL = [
    '.scorecard-value', '.kpi-value', '.stat-value', '.sc-value', '.metric-value',
    '.cm-card-value', '.cm-tile-value', '.dr-mini-card-value', '.panel-card-value',
    '.assets-stat-value', '.compliance-summary-value', '.kpi .value', '[data-odometer]',
  ].join(',');
  const odoLast = new WeakMap();
  const ODO_DUR = 900;
  // Só anima o que é NÚMERO (com moeda/unidade curta): "64", "12 716 km", "$28,063",
  // "R$ 1.234,56", "45%", "+51pp", "40 TKM/dia". Placa "GBI-0E91", modelo de celular etc. ficam quietos.
  const RE_NUMERIC = /^[-+−]?\s*(?:[A-Z]{0,3}\$|€|£)?\s*\d[\d\s.,]*\s*(?:%|[a-zA-Zçãé]{1,5}(?:\/[a-zA-Z]{1,4})?)?$/u;
  function isNumericish(s) { return RE_NUMERIC.test(String(s).trim()); }

  function odometer(el) {
    if (el.__odoBusy) return;
    const text = el.textContent;
    const prev = odoLast.get(el);
    odoLast.set(el, text);
    if (prev === text) return;
    if (REDUCED || text.length > 24 || !isNumericish(text)) return;
    if (el.childElementCount > 0) return;              // valor com HTML rico → não arrisca
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return; // invisível

    const prevDigits = (prev || '').replace(/\D/g, '');
    const digits = text.replace(/\D/g, '');
    el.__odoBusy = true;
    const wrap = document.createElement('span');
    wrap.className = 'ui-odo';
    wrap.setAttribute('aria-label', text);
    const strips = [];
    let di = 0;
    for (const ch of text) {
      if (/\d/.test(ch)) {
        const fromRight = digits.length - 1 - di;
        const pd = prevDigits.length === digits.length ? Number(prevDigits[di]) : 0;
        const col = document.createElement('span');
        col.className = 'ui-odo-col';
        const strip = document.createElement('span');
        strip.className = 'ui-odo-strip';
        strip.innerHTML = '<span>0</span><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span><span>9</span>';
        strip.style.transform = `translateY(${-pd * 1.15}em)`;
        strip.style.transitionDelay = `${Math.min(fromRight, 8) * 45}ms`;
        col.appendChild(strip);
        wrap.appendChild(col);
        strips.push([strip, Number(ch)]);
        di++;
      } else {
        const s = document.createElement('span');
        s.className = 'ui-odo-ch';
        s.textContent = ch;
        wrap.appendChild(s);
      }
    }
    el.textContent = '';
    el.appendChild(wrap);
    void wrap.offsetHeight; // reflow pra transição pegar
    requestAnimationFrame(() => {
      strips.forEach(([strip, d]) => { strip.style.transform = `translateY(${-d * 1.15}em)`; });
    });
    setTimeout(() => {
      if (el.contains(wrap)) el.textContent = text;   // volta a texto puro
      odoLast.set(el, el.textContent);
      el.__odoBusy = false;
    }, ODO_DUR + Math.min(digits.length, 9) * 45 + 60);
  }

  function scanOdo(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches && root.matches(ODO_SEL)) odometer(root);
    else {
      const host = root.closest && root.closest(ODO_SEL);
      if (host) { odometer(host); return; }
      root.querySelectorAll && root.querySelectorAll(ODO_SEL).forEach(odometer);
    }
  }

  // ---------------------------------------------------------------
  // Observer único (batch por frame)
  // ---------------------------------------------------------------
  let queue = new Set();
  let scheduled = false;
  function flush() {
    scheduled = false;
    const items = Array.from(queue);
    queue = new Set();
    items.forEach((n) => {
      if (!n.isConnected) return;
      try { iconize(n); } catch (e) { /* nunca quebra a página */ }
      try { scanOdo(n.nodeType === 3 ? n.parentNode : n); } catch (e) {}
    });
  }
  function enqueue(n) {
    queue.add(n);
    if (!scheduled) { scheduled = true; requestAnimationFrame(flush); }
  }
  function startObserver() {
    iconize(document.body);
    document.querySelectorAll(ODO_SEL).forEach((el) => odoLast.set(el, el.textContent));
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') { enqueue(m.target); continue; }
        if (m.addedNodes.length) {
          m.addedNodes.forEach((n) => { if (n.nodeType === 1 || n.nodeType === 3) enqueue(n); });
          // textContent = '...' troca o filho texto: o alvo é o pai
          if (m.target && m.target.matches && m.target.matches(ODO_SEL)) enqueue(m.target);
        }
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // ---------------------------------------------------------------
  // Toast (Sonner)
  // ---------------------------------------------------------------
  function toast(title, opts) {
    opts = opts || {};
    const type = opts.type || 'success';
    let host = document.querySelector('.ui-toaster');
    if (!host) { host = document.createElement('div'); host.className = 'ui-toaster'; host.setAttribute('role', 'status'); document.body.appendChild(host); }
    const ic = { success: 'checkCircle', error: 'xCircle', warn: 'alert', info: 'info' }[type] || 'info';
    const el = document.createElement('div');
    el.className = `ui-toast ui-toast--${type}`;
    el.innerHTML = `${icon(ic)}<div><div class="ui-toast-title"></div>${opts.description ? '<div class="ui-toast-desc"></div>' : ''}</div>`;
    el.querySelector('.ui-toast-title').textContent = title;
    if (opts.description) el.querySelector('.ui-toast-desc').textContent = opts.description;
    host.appendChild(el);
    const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 220); };
    setTimeout(kill, opts.duration || 4000);
    el.addEventListener('click', kill);
    return el;
  }

  // ---------------------------------------------------------------
  // Tooltip ([data-tip], data-tip-side="right", data-tip-when="collapsed")
  // ---------------------------------------------------------------
  let tipEl = null;
  function showTip(target) {
    const text = target.getAttribute('data-tip');
    if (!text) return;
    if (target.getAttribute('data-tip-when') === 'collapsed' &&
        !(document.body.classList.contains('sv-collapsed') && innerWidth > 880)) return;
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'ui-tip'; document.body.appendChild(tipEl); }
    tipEl.textContent = text;
    const r = target.getBoundingClientRect();
    const side = target.getAttribute('data-tip-side') || 'top';
    tipEl.style.left = '0px'; tipEl.style.top = '0px';
    tipEl.classList.add('show');
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    let x, y;
    if (side === 'right') { x = r.right + 10; y = r.top + r.height / 2 - th / 2; }
    else { x = r.left + r.width / 2 - tw / 2; y = r.top - th - 8; if (y < 6) y = r.bottom + 8; }
    tipEl.style.left = Math.max(6, Math.min(innerWidth - tw - 6, x)) + 'px';
    tipEl.style.top = Math.max(6, y) + 'px';
  }
  function hideTip() { if (tipEl) tipEl.classList.remove('show'); }
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el) showTip(el); else hideTip();
  });
  document.addEventListener('scroll', hideTip, true);

  // ---------------------------------------------------------------
  // Dropdown menu
  // ---------------------------------------------------------------
  let openMenu = null;
  function closeMenu() {
    if (!openMenu) return;
    const m = openMenu; openMenu = null;
    m.classList.remove('open');
    setTimeout(() => m.remove(), 160);
  }
  function menuOpen(anchor, html, opts) {
    opts = opts || {};
    closeMenu();
    const m = document.createElement('div');
    m.className = 'ui-menu';
    m.setAttribute('role', 'menu');
    m.innerHTML = html;
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    const mw = m.offsetWidth, mh = m.offsetHeight;
    let x = opts.align === 'right' ? r.right - mw : r.left;
    let y = opts.side === 'top' ? r.top - mh - 8 : r.bottom + 6;
    if (opts.side === 'right') { x = r.right + 8; y = r.bottom - mh; m.style.transformOrigin = 'bottom left'; }
    m.style.left = Math.max(8, Math.min(innerWidth - mw - 8, x)) + 'px';
    m.style.top = Math.max(8, Math.min(innerHeight - mh - 8, y)) + 'px';
    requestAnimationFrame(() => m.classList.add('open'));
    openMenu = m;
    m.addEventListener('click', (e) => { if (e.target.closest('.ui-menu-item')) closeMenu(); });
    return m;
  }
  document.addEventListener('mousedown', (e) => {
    if (openMenu && !openMenu.contains(e.target) && !(e.target.closest && e.target.closest('[data-menu-anchor]'))) closeMenu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  // ---------------------------------------------------------------
  // Paleta de comandos (Ctrl/⌘ + K)
  // ---------------------------------------------------------------
  const extraCommands = [];
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  function buildCommands() {
    const cmds = [];
    const lang = curLang();
    const nav = (typeof window.svVisibleNav === 'function') ? window.svVisibleNav(lang) : [];
    nav.forEach((g) => g.items.forEach((it) => {
      cmds.push({
        group: t('pages'), label: it.label, sub: g.label, iconHtml: it.iconHtml,
        hint: it.external ? icon('external') : '', active: it.active,
        run: () => { if (it.external) window.open(it.href, '_blank', 'noopener'); else location.href = it.href; },
      });
    }));
    if (typeof window.toggleTheme === 'function') {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      cmds.push({ group: t('actions'), label: t('theme'), iconHtml: icon(dark ? 'sun' : 'moon'), keywords: 'dark light escuro claro oscuro tema theme', run: () => window.toggleTheme() });
    }
    if (document.getElementById('sv-collapse') && innerWidth > 880) {
      cmds.push({ group: t('actions'), label: t('collapse'), iconHtml: icon('panelLeft'), keywords: 'sidebar menu', run: () => document.getElementById('sv-collapse').click() });
    }
    ['pt', 'es', 'en'].forEach((l) => {
      const btn = document.querySelector(`[data-lang="${l}"]`);
      if (btn && l !== lang) {
        const name = { pt: 'Português', es: 'Español', en: 'English' }[l];
        cmds.push({ group: t('actions'), label: `${t('lang')}: ${name}`, iconHtml: icon('languages'), keywords: 'idioma lang language ' + l, run: () => btn.click() });
      }
    });
    extraCommands.forEach((c) => cmds.push(Object.assign({ group: t('actions') }, c, { iconHtml: c.iconHtml || icon(c.icon || 'chevronRight') })));
    if (typeof window.svLogout === 'function') {
      cmds.push({ group: t('actions'), label: t('logout'), iconHtml: icon('logout'), keywords: 'logout sair salir sign out', run: () => window.svLogout() });
    }
    return cmds;
  }

  let cmdOverlay = null;
  function cmdClose() {
    if (!cmdOverlay) return;
    const o = cmdOverlay; cmdOverlay = null;
    o.classList.remove('open');
    setTimeout(() => o.remove(), 150);
  }
  function cmdOpen() {
    if (cmdOverlay) { cmdClose(); return; }
    const all = buildCommands();
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
    const o = document.createElement('div');
    o.className = 'ui-cmd-overlay';
    o.innerHTML = `
      <div class="ui-cmd" role="dialog" aria-modal="true">
        <div class="ui-cmd-search">${icon('search')}<input type="text" autocomplete="off" spellcheck="false" placeholder="${t('search')}"><span class="ui-kbd">Esc</span></div>
        <div class="ui-cmd-list" role="listbox"></div>
        <div class="ui-cmd-foot">
          <span><span class="ui-kbd">↑</span><span class="ui-kbd">↓</span> ${t('nav')}</span>
          <span><span class="ui-kbd">↵</span> ${t('open')}</span>
          <span class="ui-cmd-brand"><span class="ui-kbd">${mac ? '⌘' : 'Ctrl'}</span><span class="ui-kbd">K</span></span>
        </div>
      </div>`;
    o.setAttribute('data-no-icon', '');
    document.body.appendChild(o);
    cmdOverlay = o;
    const input = o.querySelector('input');
    const list = o.querySelector('.ui-cmd-list');
    let shown = [];
    let sel = 0;

    function render() {
      const q = norm(input.value.trim());
      // Relevância: começo do rótulo > rótulo > palavras-chave > grupo/seção
      const score = (c) => {
        if (!q) return 1;
        const lb = norm(c.label);
        if (lb.startsWith(q) || lb.split(/\s+/).some((w) => w.startsWith(q))) return 4;
        if (lb.includes(q)) return 3;
        if (norm(c.keywords).includes(q)) return 2;
        if (norm(`${c.sub || ''} ${c.group}`).includes(q)) return 1;
        return 0;
      };
      const ranked = all.map((c, i) => ({ c, s: score(c), i })).filter((x) => x.s > 0)
        .sort((a, b) => (b.s - a.s) || (a.i - b.i));
      // reagrupa mantendo a ordem do melhor resultado de cada grupo
      const order = [];
      ranked.forEach((x) => { if (!order.includes(x.c.group)) order.push(x.c.group); });
      shown = [];
      order.forEach((g) => ranked.forEach((x) => { if (x.c.group === g) shown.push(x.c); }));
      if (sel >= shown.length) sel = Math.max(0, shown.length - 1);
      if (!shown.length) { list.innerHTML = `<div class="ui-cmd-empty">${t('empty')}</div>`; return; }
      let html = '';
      let lastGroup = null;
      shown.forEach((c, i) => {
        if (c.group !== lastGroup) { html += `<div class="ui-cmd-group">${c.group}</div>`; lastGroup = c.group; }
        const sub = c.sub ? `<span class="ui-cmd-hint">${c.sub}${c.hint ? ' ' + c.hint : ''}</span>` : (c.hint ? `<span class="ui-cmd-hint">${c.hint}</span>` : '');
        html += `<button type="button" class="ui-cmd-item" role="option" data-i="${i}" aria-selected="${i === sel}">${c.iconHtml || ''}<span></span>${sub}</button>`;
      });
      list.innerHTML = html;
      list.querySelectorAll('.ui-cmd-item').forEach((b) => { b.querySelector('span').textContent = shown[Number(b.dataset.i)].label; });
      const cur = list.querySelector('[aria-selected="true"]');
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    }
    function run(i) {
      const c = shown[i];
      if (!c) return;
      cmdClose();
      setTimeout(() => { try { c.run(); } catch (e) { console.warn('[UI cmd]', e); } }, 60);
    }
    input.addEventListener('input', () => { sel = 0; render(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
      else if (e.key === 'Escape') { e.preventDefault(); cmdClose(); }
    });
    list.addEventListener('mousemove', (e) => {
      const b = e.target.closest('.ui-cmd-item');
      if (b && Number(b.dataset.i) !== sel) { sel = Number(b.dataset.i); list.querySelectorAll('.ui-cmd-item').forEach((x) => x.setAttribute('aria-selected', String(Number(x.dataset.i) === sel))); }
    });
    list.addEventListener('click', (e) => { const b = e.target.closest('.ui-cmd-item'); if (b) run(Number(b.dataset.i)); });
    o.addEventListener('mousedown', (e) => { if (e.target === o) cmdClose(); });
    render();
    requestAnimationFrame(() => { o.classList.add('open'); input.focus(); });
  }
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
      // só nas páginas que têm a sidebar (onde existe navegação pra buscar)
      if (typeof window.svVisibleNav !== 'function') return;
      e.preventDefault();
      cmdOpen();
    }
  });

  // ---------------------------------------------------------------
  // Delete inline (Rare UI · Delete button) — confirma no lugar, sem dialog
  // ---------------------------------------------------------------
  function confirmInline(btn, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      if (!btn || !btn.parentNode) { resolve(window.confirm(opts.question || t('sure'))); return; }
      const box = document.createElement('span');
      box.className = 'ui-confirm';
      box.innerHTML = `<button type="button" class="ui-confirm-no"></button><button type="button" class="ui-confirm-yes"></button>`;
      box.querySelector('.ui-confirm-no').textContent = opts.no || t('cancel');
      box.querySelector('.ui-confirm-yes').textContent = opts.yes || t('confirm');
      const prevDisplay = btn.style.display;
      btn.style.display = 'none';
      btn.parentNode.insertBefore(box, btn.nextSibling);
      let done = false;
      const finish = (v) => {
        if (done) return; done = true;
        box.remove(); btn.style.display = prevDisplay;
        document.removeEventListener('mousedown', outside, true);
        clearTimeout(timer);
        resolve(v);
      };
      const outside = (e) => { if (!box.contains(e.target)) finish(false); };
      const timer = setTimeout(() => finish(false), opts.timeout || 5000);
      box.querySelector('.ui-confirm-yes').addEventListener('click', (e) => { e.stopPropagation(); finish(true); });
      box.querySelector('.ui-confirm-no').addEventListener('click', (e) => { e.stopPropagation(); finish(false); });
      setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
      box.querySelector('.ui-confirm-yes').focus();
    });
  }

  // ---------------------------------------------------------------
  // Barra de progresso de leitura nos relatórios longos
  // ---------------------------------------------------------------
  function setupScrollProgress() {
    if (!document.querySelector('.report-page, .slide, [data-scroll-progress]')) return;
    if (document.querySelector('.ui-scroll-progress')) return;
    const bar = document.createElement('div');
    bar.className = 'ui-scroll-progress';
    document.body.appendChild(bar);
    let ticking = false;
    const update = () => {
      ticking = false;
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
    };
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  // ---------------------------------------------------------------
  window.UI = {
    __ready: true,
    icon, toast, iconize, odometer, confirmInline,
    menu: { open: menuOpen, close: closeMenu },
    cmd: { open: cmdOpen, close: cmdClose, register: (c) => extraCommands.push(c) },
    t,
  };

  function boot() {
    try { startObserver(); } catch (e) { console.warn('[UI] observer', e); }
    try { setupScrollProgress(); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
