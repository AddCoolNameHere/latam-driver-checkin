# Brief de Redesign — nivelar as páginas internas ao padrão do dashboard

> **Pra quem executa (Claude Code):** este documento é a sua fonte de verdade. Leia inteiro
> antes de começar. O objetivo é deixar **todas as páginas internas** com o mesmo acabamento
> profissional do `dashboard_teste.html` (que já está pronto), **sem emoji**, usando os mesmos
> tokens, tipografia, ícones e componentes. Trabalhe **uma página por vez** e valide cada uma.

---

## 0. Regras de ouro (não-negociáveis)

1. **Não tocar na lógica.** Não renomear IDs, não mexer em `fetch`/Apps Script, não alterar
   funções de dados. Só apresentação (CSS, markup visual, troca de ícone). Os JS inline devem
   continuar passando no `node --check`.
2. **Zero emoji na UI.** Todo emoji vira **ícone SVG line** (registry na §6) ou some, se for
   decorativo. Status/semáforos (🟢🟡🔴) viram bolinha/pill colorida por token.
3. **Cor só por token.** Nunca hex hardcoded. Use as variáveis `--c-*` do `theme_teste.css`.
   Se precisar de um tom novo, adiciona como token, não como hex solto.
4. **Dark mode tem que funcionar** em toda página. Teste com o toggle (logado como `fuss`).
   Cuidado com `color:#fff` sobre fundo `var(--c-text)` (vira branco-no-branco no dark — use
   `var(--c-surface)` como cor de texto, que é sempre o oposto do fundo).
5. **i18n preservado.** Toda string nova/trocada precisa existir nos 3 idiomas (`pt`/`es`/`en`)
   nos dicionários da página. Não remova chaves existentes.
6. **Sem build step.** É HTML/CSS/JS direto. Não introduza bundler, framework, npm.
7. **Validar sempre** (§9) antes de considerar a página pronta.
8. **Preservar configs sensíveis:** `scriptUrl` do Apps Script, `spreadsheetId`, hashes do
   `auth_teste.js`, emails. Não alterar.

---

## 1. Contexto

- Ferramenta interna da equipe Street View LATAM (Aceolution). GitHub Pages, estático, sem build.
- Backend = Google Apps Script (CORS workaround "fire-and-forget" em POSTs).
- **Esta pasta (`dashboard_teste/`) é o sandbox do redesign.** Os arquivos têm sufixo `_teste`.
  Produção (`../../*.html`) **não se mexe** aqui — isso é validação visual primeiro.
- Idioma do projeto: PT-BR informal. Mantenha os comentários no mesmo tom dos arquivos.
- Leia também o `CLAUDE.md` na raiz do repo (convenções gerais).

---

## 2. North star — o que "pronto" parece

A referência canônica de acabamento é o **`dashboard_teste.html` + `sv-skin_teste.css` +
`sv-shell_teste.js`** (já finalizados). Antes de redesenhar qualquer página, **abra esses três
e absorva o padrão**:

- **Sidebar navy persistente** (`sv-shell_teste.js`): navegação agrupada, **gated por permissão**
  (`all`/`admin`/`super`), com recolher/expandir (desktop) e drawer (mobile). É injetada — a
  página só precisa **incluir o script**.
- **Skin** (`sv-skin_teste.css`): cards com raio 16px + sombra suave, fonte **Plus Jakarta Sans**,
  ícones SVG, KPIs com tile de ícone, tabela com header maiúsculo, pills arredondadas.
- **Tokens** (`theme_teste.css`): paleta clara/escura, marca Aceolution navy `#2C5282`.

Tudo que você fizer nas internas deve **parecer parte do mesmo produto** que o dashboard.

---

## 3. A causa do "meio-termo" que estamos consertando

Hoje o skin redesenha o **dashboard a fundo**, mas as outras páginas só herdam **sidebar +
topbar**; o **corpo** delas continua no estilo antigo (componentes próprios, cores hardcoded,
emoji, layout centralizado com `max-width:auto`). Resultado: sidebar linda + corpo sem o mesmo
acabamento = "pela metade". **A missão é nivelar o corpo de cada página ao padrão da §2/§4.**

---

## 4. Sistema de design (valores concretos)

### 4.1 Tokens (já existem no `theme_teste.css` — use, não recrie)
```
Marca:    --c-primary #2C5282 · --c-primary-dark #1A365D · --c-accent #4A9FE0
Superfície: --c-bg · --c-surface (cards) · --c-bg-tint (pills/hover)
Bordas:   --c-border · --c-border-strong
Texto:    --c-text · --c-text-muted · --c-text-dim
Estados:  --c-success · --c-warn · --c-danger
Dark:     trocados automaticamente em [data-theme="dark"] (acentos no nível ~-500)
```

### 4.2 Tipografia
- Fonte: **"Plus Jakarta Sans"** (já carregada pelo shell; se a página não tiver, adicione o
  `<link>` do Google Fonts — veja `sv-shell_teste.js`), com fallback system-ui.
- Escala (espelhe o `sv-skin`):
  - Título de página: **25px / 800**, `letter-spacing:-.6px`, cor `--c-text`.
  - Subtítulo de página: 13.5px, `--c-text-muted`.
  - Título de seção/card: **16px / 800**, `-.3px`.
  - Label/eyebrow: 11px / 700, UPPERCASE, `+.4px`, `--c-text-muted`.
  - Corpo: 13–13.5px. Número grande (KPI): **26px / 800**, `font-variant-numeric: tabular-nums`.

### 4.3 Forma / espaçamento
- Raio: **cards 16px**, controles/botões 10–12px, **pills/chips 999px**, mapas 13px.
- Sombra: `var(--sv-shadow)` (padrão) e `var(--sv-shadow-lg)` (elevado/hover).
- Card: `background:var(--c-surface); border:1px solid var(--sv-line); border-radius:16px;
  box-shadow:var(--sv-shadow); padding:16–18px;`
- Gap entre cards/seções: 14–18px.

### 4.4 Componentes canônicos (copie o visual do `sv-skin_teste.css`)
- **Page head** (substitui header/brand próprio da página):
  ```html
  <div class="sv-pagehead"><h1>Título da página</h1><p>Subtítulo curto e útil</p></div>
  ```
  (classe `.sv-pagehead` já existe no `sv-skin`. A marca agora é a sidebar — **não** repita
  logo/banner de marca no corpo.)
- **KPI card**: tile de ícone (42px, raio 12, fundo tint suave) + label (uppercase) + valor
  (26/800) + sub. Veja `.scorecard`/`.sv-kpi-ico` no `sv-skin`. **Sem barra `::before` colorida**
  e **sem cor hardcoded** — use as tones (`tone-blue/green/amber/red/indigo`).
- **Section card**: header com título 16/800 + sub 12.5 + conteúdo. Veja `.map-section`,
  `.table-section`.
- **Tabela**: `th` maiúsculo 10.5px/700 `--c-text-muted` fundo `--sv-line-2`; `td` padding 12/14
  com borda inferior `--sv-line-2`; hover de linha `--sv-primary-soft`. Veja `.driver-table`.
- **Pill/badge de status**: `border-radius:999px; font-weight:700;` cor por estado/token.
- **Botões**: primário = `background:var(--c-primary); color:#fff; border-radius:10px;`;
  secundário/ghost = borda `--sv-line`, hover borda `--c-accent`.
- **Filtros (chips)**: `border-radius:999px; border:1px solid var(--sv-line);` ativo =
  `background:var(--c-text); color:var(--c-surface);` (o `--c-surface` garante contraste no dark).

### 4.5 Layout / container
- O dashboard usa **offset da sidebar via `body.sv-shell` (252px)** + respiro interno; **não**
  usa `max-width:Xpx; margin:0 auto` brigando com a sidebar.
- Nas internas que usam `.algumacoisa-wrap { max-width: 1400px; margin: 0 auto }`: troque por um
  container alinhado à esquerda com padding (ex: `padding: 22px 28px 48px;`) e deixe o
  `body.sv-shell` cuidar do offset. Se quiser limitar largura em telas muito largas, use
  `max-width` **sem** `margin:0 auto` (alinhado à esquerda) ou um teto generoso (1440–1600).

---

## 5. Plugar o shell (por página)

Toda página **admin** (não-driver) precisa, antes do `</body>`:
```html
<script src="sv-shell_teste.js"></script>
```
Isso traz **sidebar + gating + recolher + drawer mobile + toggle de dark** de graça. Requisitos
que já estão atendidos em todas as internas: `auth_teste.js`, `theme_teste.js`, `common_teste.js`,
`theme_teste.css` no `<head>`, e login via `injectLogin({onSuccess: startApp})`.

**Já têm o shell:** dashboard, driver-profile, ramp, recruitment, country_scopes, timesheet.
**Faltam incluir o `sv-shell_teste.js`:** `pmo_teste`, `ar-divergencias-admin_teste`,
`argentina_scenarios_presentation_teste`, `argentina_optimization_report_teste`,
`admin-users_teste`, `roadmap_teste`.

**Header/brand próprio:** se a página tem um header com logo/banner de marca (ex: o
`.report-header` navy do recruitment, ou `.header` com `.brand-wrap`), **remova a marca** e
rebaixe pra um `.sv-pagehead` (título + subtítulo). A sidebar é a marca agora — branding duplicado
fica amador. (O `sv-skin` já esconde `.ac-brand`/`.ac-topbar .brand-wrap`; o que tiver header
custom da página, ajuste à mão.)

**Adicionar nova entrada no menu:** a navegação é fonte única no `NAV` dentro do
`sv-shell_teste.js`. Se uma página precisa aparecer no menu, edite o `NAV` lá (com `access`
correto: `all`/`admin`/`super`) — não crie nav por página.

---

## 6. Ícones — emoji → SVG

**Nunca emoji na UI.** Reutilize o registry de ícones que já existe:
- `sv-shell_teste.js` → `ICON` (home, users, layers, notes, userPlus, calendar, wallet, report,
  alert, chart, fileText, settings, map) + helper `svg(name)`.
- `sv-enhance_teste.js` → `ICON` (users, hotel, leaf, clock, alert, check).

Padrão de um ícone (line, 24×24, `stroke="currentColor"`, herda a cor do contexto):
```html
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><!-- paths --></svg>
```

**Mapa de troca sugerido** (adicione paths novos ao registry quando faltar):
| Emoji | Vira | | Emoji | Vira |
|---|---|---|---|---|
| 📊 | chart / home | | 🚗 | car *(add)* |
| 👤 👥 | user / users | | 💾 | disk *(add)* |
| 🌎 | layers / map | | 📷 | camera *(add)* |
| 📝 | notes | | ⏱ | clock |
| 💰 🧾 | wallet | | 🔧 | wrench *(add)* |
| 📋 📈 | report / chart | | ✅ ✓ | check |
| 📄 | fileText | | ❌ ✗ | x/close *(add)* |
| 🔐 ⚙ | settings | | 🔍 | search *(add)* |
| 🗺 | map | | ⬇ | download *(add)* |

**Semáforos em dados** (🟢🟡🔴 em status de driver/serviço): troque por bolinha
(`<span>` 8–10px, `border-radius:50%`) ou pill colorida por **token** (`--c-success/warn/danger`),
não emoji. Mantenha o significado (verde=ok, âmbar=alerta, vermelho=crítico).

Pra achar emoji numa página: procure por caracteres fora do ASCII nos textos de UI e nos
dicionários i18n (`grep -nP "[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{2190}-\x{21FF}\x{2B00}-\x{2BFF}]"`
no arquivo). Cuidado: **não** remova setas que são conteúdo textual significativo sem substituir.

---

## 7. Dark mode (checklist por página)

- Testar com o toggle (☾, logado como `fuss`).
- Trocar qualquer `background:#fff`/`#fafafa` hardcoded por `var(--c-surface)`/`var(--c-bg)`.
- Texto: `var(--c-text)`/`--c-text-muted`, nunca `#333`/`#000` hardcoded.
- Estado selecionado/ativo: se o fundo é `var(--c-text)` (claro no dark), o texto deve ser
  `var(--c-surface)` (escuro no dark). Se o fundo é cor de marca fixa (azul), `#fff` tá ok.
- Logo da Aceolution já vira branco no dark (regra global no `theme_teste.css` cobre
  `.brand-logo`, `.footer-logo`, `img[src*="logo2"]`). Não precisa fazer nada por página.
- Mapas Leaflet: o `theme_teste.css` já tem filtro de tiles no dark. Mantenha.

---

## 8. Plano página-a-página

> Para **cada** página: (1) leia o arquivo inteiro; (2) inventarie os componentes; (3) inclua o
> `sv-shell` se faltar; (4) rebaixe header próprio pra `.sv-pagehead`; (5) alinhe cada componente
> aos padrões da §4 (cores→token, raio/sombra/tipo, emoji→SVG); (6) ajuste o container (§4.5);
> (7) teste light + dark; (8) valide (§9).

**Ordem sugerida** (do mais simples/contido pro mais complexo, deixando os gigantes por último):
`timesheet → recruitment → country_scopes → pmo → ar-divergencias-admin → admin-users → roadmap
→ ramp → driver-profile → argentina_optimization → argentina_scenarios`.

### timesheet_teste (Payroll · acesso all) — **tem shell**
- Componentes: `.ts-wrap`, `.ts-header` (título+sub), `.kpi-row`/`.kpi-card`, tabelas, gráficos
  (Chart.js).
- Fazer: `.kpi-card` ganha **tile de ícone** no padrão dashboard; **tokenizar** as variantes de
  cor hardcoded (`#10B981`, `#F59E0B`, `#8B5CF6` → `--c-success`/`--c-warn` + um token novo se
  precisar de roxo). `.ts-header` → `.sv-pagehead`. Tabela no padrão `.driver-table`. Cores dos
  gráficos via tokens. Conferir contraste das séries no dark.

### recruitment_teste (acesso all) — **tem shell**
- Componentes: `.report-header` (banner gradiente navy), `.kpi-row`/`.kpi-card`, mapa LATAM
  (Leaflet), pipeline, aging.
- Fazer: **remover o banner navy** (branding duplicado com a sidebar) → vira `.sv-pagehead`
  simples. KPIs no padrão. Cards de pipeline/aging com raio/sombra/token. Conferir o mapa no dark.

### country_scopes_teste (acesso **admin**) — **tem shell**
- Componentes: tabs AR/CO, mapa GeoJSON (Leaflet), status dinâmico dos drivers.
- Fazer: tabs no padrão de chip/segmented control (pill, ativo com `--c-primary`); legendas e
  status por token (sem emoji); cards de status no padrão. Mapa dark já coberto.

### pmo_teste (acesso **admin**) — **FALTA shell**
- Componentes: chips de categoria, cards de comentário por driver.
- Fazer: **incluir `sv-shell`**; chips de categoria com cor por token (tem `#2563EB` hardcoded —
  trocar por `--c-primary`/`--c-accent`); cards de comentário no padrão; emoji→SVG.

### ar-divergencias-admin_teste (acesso **admin**) — **FALTA shell**
- Componentes: tabela de pagamentos contestados + export PDF.
- Fazer: incluir `sv-shell`; tabela no padrão `.driver-table`; botão de export = botão primário
  com ícone `download`; `.sv-pagehead`.

### admin-users_teste (acesso **super**) — **FALTA shell**
- Componentes: tabela de usuários, modal add/edit, badges (Admin/Super/Novo/Alterado), toast.
- Fazer: incluir `sv-shell`; tabela + badges + modal no padrão (raio/sombra/token); botões
  primário/ghost/danger no padrão. **Não** mexer na lógica de geração do `auth.js`.

### roadmap_teste (acesso **super**) — **FALTA shell**
- Componentes: tabs, chips, checklist de fases.
- Fazer: incluir `sv-shell`; tabs/chips no padrão (sem `#fff` em fundo de marca já ok); checklist
  com tipografia/estado por token; emoji→SVG.

### ramp_teste (Funds · acesso all) — **tem shell** — **arquivo grande (~200KB)**
- Componentes: despesas/funds, provavelmente tabelas grandes, filtros, gráficos.
- Fazer: inventariar com calma; aplicar §4 incrementalmente (head → KPIs → filtros → tabelas →
  gráficos). Cuidado com performance/escopo; quebre em commits lógicos.

### driver-profile_teste (Drivers · acesso all) — **tem shell** — **arquivo gigante (~140KB)**
- Componentes: histórico por motorista, gráficos, mapa, insights de IA, ramp.
- Fazer: é a página mais densa — trate por blocos (header → cards de resumo → gráficos → mapa →
  seção AI). Logs `[Driver Profile ...]` **não remover**. Token + SVG + padrões.

### argentina_optimization_report_teste / argentina_scenarios_presentation_teste (acesso **admin**) — **FALTAM shell**
- Componentes: relatório/apresentação (slides, gráficos densos).
- Fazer: incluir `sv-shell`; **toque mais leve** — são documentos de leitura. Padronize tipografia,
  cards, cores por token e remova emoji, mas preserve a estrutura de "relatório/slides".

### NÃO mexer (páginas de driver — ficam light, sem sidebar):
- `assets_teste` (já corrigido: sem `theme_teste.js`, sempre light), `ar-divergencias_teste`
  (form de driver), e qualquer form público. **Não** incluir `sv-shell` nessas. Se tiverem
  `theme_teste.js`, remover (driver page = sempre light) e manter o `removeAttribute('data-theme')`
  defensivo, igual ao `assets_teste`.
- `roadmap-test_teste` (versão antiga) e `admin_teste` (hub) provavelmente ficam obsoletos com a
  sidebar — **confirmar com o Lucas** antes de redesenhar; pode ser que saiam de cena.

---

## 9. Workflow e validação (por página)

1. **Uma página por iteração.** Leia o arquivo inteiro antes de editar.
2. Aplique as mudanças (markup visual + `<style>` da página + troca de ícones).
3. **Valide a sintaxe JS** (não pode quebrar os scripts inline):
   ```bash
   node -e "const c=require('fs').readFileSync('ARQUIVO.html','utf8');const m=[...c.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join('\n;\n');require('fs').writeFileSync(require('os').tmpdir()+'/c.js',m);"
   node --check "$TMPDIR/c.js"   # ou %TEMP% no Windows
   ```
   (Esta máquina **não tem python** — sempre validar com Node.)
4. **Balanço de chaves do CSS** (pega `{`/`}` desbalanceado):
   ```bash
   node -e "const c=require('fs').readFileSync('ARQUIVO.html','utf8');console.log((c.match(/{/g)||[]).length,(c.match(/}/g)||[]).length)"
   ```
5. **Teste visual:** abra no browser, logue, confira **light e dark**, recolher/expandir e mobile.
6. **Diff de sanidade:** os IDs e funções continuam? Configs intactas? i18n nos 3 idiomas?
7. Só então passe pra próxima página.

---

## 10. Definition of Done

**Por página:**
- [ ] `sv-shell` incluído (se for página admin) e item correto destacado na sidebar.
- [ ] Header/brand próprio removido → `.sv-pagehead`.
- [ ] Zero emoji na UI (chrome e dados) — tudo SVG ou pill/bolinha por token.
- [ ] Cores 100% por token; nenhum hex novo hardcoded.
- [ ] Cards/tabelas/KPIs/botões batendo com os padrões da §4 (mesmo raio/sombra/tipo do dashboard).
- [ ] Light e dark OK (nada de branco-no-branco; logo branco no dark).
- [ ] Container alinhado ao shell (sem `max-width:auto` brigando com a sidebar).
- [ ] `node --check` dos scripts inline passa; chaves do CSS balanceadas.
- [ ] Lógica/IDs/configs/i18n intactos.

**Geral:** navegar entre todas as páginas parece **um produto só**, coeso com o dashboard —
sem nenhuma tela com "cara de versão antiga".

---

## 11. Onde está o quê (referência rápida)

- **Sidebar/nav + permissões + recolher/mobile:** `sv-shell_teste.js` (const `NAV`, `ICON`, `svg()`).
- **Skin/componentes/tokens-de-layout:** `sv-skin_teste.css`.
- **Tokens de cor + dark mode + login/topbar compartilhados:** `theme_teste.css`.
- **Tema (toggle dark, só admin):** `theme_teste.js` (`setupThemeToggle`).
- **Login/topbar/cache:** `common_teste.js` (`injectLogin`, `injectTopbar`, `cachedFetch`).
- **Usuários/permissão:** `auth_teste.js` (`USERS`, `ADMIN_USERNAMES`, `isAdmin`, `loadSession`).
- **Referência de acabamento (copiar daqui):** `dashboard_teste.html`.
