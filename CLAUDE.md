# Instruções pro Claude Code — Projeto LATAM

Este arquivo orienta o Claude Code ao trabalhar neste repositório. Ler antes de qualquer mudança.

## 👤 Sobre o usuário

- **Nome:** Lucas Fuss (Aceolution do Brasil — Street View LATAM team)
- **Idioma:** Brazilian Portuguese (informal, direto, sem firula)
- **Estilo:** pragmático, manda screenshots de bugs, prefere features simples bem-feitas
- **Workflow:** pequenas iterações, valida cada feature antes de partir pra próxima

## 🎯 Filosofia do projeto

Este é uma **ferramenta interna** — não é produto pra cliente externo. As implicações:

- "Teatro de segurança" é aceitável (auth client-side com SHA-256 público no GitHub)
- LGPD: dados de funcionários são tratados como ferramenta gerencial interna
- Não há build step — HTML/JS direto, GitHub Pages serve estático
- Padrão "fire-and-forget" pra POSTs (CORS workaround pra Apps Script)
- Não há testes automatizados — validação é manual + `node --check` na sintaxe

## ⚠️ Antes de QUALQUER mudança

1. **Lê o arquivo completo** antes de editar (não suponha estrutura)
2. **Valida sintaxe** depois de cada mudança em `.html` ou `.gs` com:
   ```bash
   # Pra HTMLs:
   python3 -c "import re; c=open('<arquivo>.html').read(); m=re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', c, re.DOTALL); open('/tmp/c.js','w').write('\n'.join(m))" && node --check /tmp/c.js
   # Pra Apps Script:
   cp apps-script/Code.gs /tmp/c.js && node --check /tmp/c.js
   ```
3. **Confere que configs sensíveis foram preservadas:**
   - `spreadsheetId: '1hwRnvbIKHWMRVY84lT6svbCg5BcMKkIJ7iaKpnNOGjg'`
   - emails: `lucas.fuss@aceolution.com`, `lucas@aceolution.com`, `bia@aceolution.com`
   - hashes em `auth.js` (4 usuários: fuss, pankaj, bia, lucas)
   - Apps Script Web App URL no frontend

## 🔄 Workflow de deploy

**Frontend:**
- Commit/push direto. GitHub Pages atualiza em 1-10 min.
- Lembra de pedir Ctrl+Shift+R no browser (cache).

**Backend (Apps Script):**
- ⚠️ **CRÍTICO:** Ctrl+S não publica. Tem que ir em "Implantar → Gerenciar implantações → ⚙ → Editar → Versão: **Nova versão** → Implantar".
- Sempre confere com `?action=ping` que `version` está correto.
- Bumpa o número da versão (`v5.X`) sempre que fizer mudança no `Code.gs`.

## 📐 Convenções de código

- **HTML:** classes em kebab-case (`detail-card`), IDs em kebab-case (`map-period-label`)
- **JS:** camelCase, `const`/`let` (nunca `var`), template literals pra HTML
- **i18n:** sempre 3 idiomas: `pt`, `es`, `en` (toda string nova precisa nas 3)
- **Logs no console:** prefixo identificável: `[Driver Profile]`, `[Calendar Export]`, `[Driver Profile AI]`, `[Driver Profile MAP]`
- **CSS:** variáveis em `:root` (`--c-primary: #2C5282`), Aceolution blue + accent
- **Cores Aceolution:** primary `#2C5282`, primary-dark `#1A365D`, accent `#4A9FE0`

## 🗂 Estrutura das abas Mastersheet

Tab names podem ser renomeadas. Use `getSheetWithFallback_(ss, primaryName, fallbacks)` no Apps Script.

Já aconteceu: `VID CALENDAR` → `VID Monthly CALENDAR`. Pode acontecer de novo com outras.

## 🐛 Bugs típicos

1. **PDF/dashboard vazio:** geralmente aba renomeada — checa logs do Apps Script.
2. **Profile não mostra base/casa:** geralmente Apps Script não foi reimplantado ("Nova versão").
3. **`Unexpected end of input` no console:** sintaxe quebrada nos HTMLs (validar com `node --check`).
4. **Login não funciona:** `auth.js` não carregou (404, cache, ou erro de JS antes).

## 📝 Quando o usuário pede algo

1. **Pensa primeiro** — antes de codar, identifica tradeoffs e propõe opções se houver decisão arquitetural.
2. **Reaproveita** — se o dashboard já tem uma função similar, copia e adapta em vez de reinventar.
3. **Valida** — `node --check` antes de entregar.
4. **Bumpa versão** — se mexer no Apps Script, sobe o `v5.X` no ping.
5. **Não duplica configs** — `auth.js` é a fonte canonical de USERS, ADMIN_USERNAMES, sha256.

## 🚫 Não fazer

- Não inventar nomes de aba (use `CONFIG.xxxSheet`)
- Não hardcodar API keys (use `PropertiesService`)
- Não comitar com `node --check` falhando
- Não alterar a URL do Web App ou o spreadsheetId sem o usuário pedir
- Não remover logs de debug `[Driver Profile XYZ]` — eles salvam em produção
