# Relatório financeiro LATAM

A página `financial-report.html`, na raiz do portal, usa o login e o tema compartilhados. O atalho aparece no Hub e no menu Financeiro para administradores. Permissões adicionais continuam sendo gerenciadas por `admin-users.html`.

## Fontes

- `financial-data.json`: fechamento financeiro agregado da P&L de janeiro a setembro de 2026, usado no MBR de setembro. Todos os valores financeiros são em **USD**, conforme confirmação do Lucas. Não contém nomes de funcionários nem transações individuais.
- Mastersheet online, TKM e quilômetros rodados: `financial-operations.js` consulta `getMonthlyReportData`. Só aceita esses indicadores quando a resposta confirma o mês/ano e `ctsSource: mirror`. TKM representa a soma registrada na CTS; a fonte consultada não comprova aprovação ou faturamento. Esse contexto corresponde ao **mês final do filtro**, mesmo em uma seleção acumulada.
- Mastersheet online, idle: `financial-idle.js` consulta a aba nativa `RAW CTS DATA` por Google Visualization (GViz), com agregação na origem e filtro de registros com email de motorista. A resposta contém contagens por país, data e status, sem nomes, emails ou VIDs. Uma consulta auxiliar em CSV retorna somente datas para conferir a cobertura de linhas ocultas. A regra é a do `IdleDayCount` da mastersheet, detalhada abaixo.
- `financial-idle-data.json`: cópia agregada canônica de `RAW CTS DATA`, com origem e cobertura por mês. O contrato usa `definitionVersion: 2`, `unit: "status-records"` e `source: "mastersheet-idle-day-count"`. A cópia local foi modificada em 20/10/2026 e contém registros até 11/10/2026. Se a consulta online não cobrir integralmente um mês, o relatório usa a cópia canônica disponível para esse mês; na atualização de 20/10/2026, janeiro–agosto dependem da cópia local por causa de linhas ocultas, enquanto setembro é verificado online. A interface identifica a fonte e a cobertura; uma resposta vazia ou incompleta não substitui silenciosamente o histórico.
- Atualizar TKM ou idle não altera o fechamento financeiro. O horário de consulta não é a data da atualização original da CTS. O cache de TKM dura cinco minutos e o de idle, dez; um cache anterior reutilizado após falha fica identificado como desatualizado.

## Uso

Filtre país e período. YTD seleciona janeiro até o mês final do filtro; o fechamento fornecido cobre janeiro a setembro de 2026. O gráfico mantém o histórico disponível e permite selecionar um mês clicando na barra.

O relatório tem oito abas:

- **Abertura:** resultado do período, acumulado e ponte entre o último mês selecionado e o anterior.
- Na abertura de setembro e do YTD até setembro de 2026, LATAM e Colômbia incluem contexto informado pela gestão: suspensão colombiana após incidente de segurança, com retomada posterior. Datas e impacto financeiro específico ainda precisam ser confirmados. Essa nota pertence ao fechamento fornecido e não é aplicada a dados importados.
- **Receitas:** Income, Billables, Management Fees e receita total, por país e mês.
- **Custos:** todas as categorias de despesas na mesma matriz por país, conciliação com o resultado e variações mensais, incluindo categorias do cartão.
- **Mensal:** evolução histórica e matriz país × mês, alternando receita, despesas, resultado e margem, com coluna acumulada.
- **Países:** desempenho antes e depois dos rateios regionais e contribuição para a variação do resultado.
- **Idle:** contagem nativa de registros Tech, Mech e Weather, com alternância entre o total das três causas e cada causa, no acumulado ou no período selecionado. Mostra também registros elegíveis e exclusões por fins de semana e feriados.
- **Cenários:** simulação com premissas editáveis de receita, despesas e horizonte.
- **Fontes:** origem dos números, definições, conciliação e importação/exportação do fechamento.

Em **Personalizar**, ajuste título, referência de margem, unidade e comentário executivo. Preferências e dados importados ficam no navegador, separados por usuário. Exporte as configurações para transferi-las a outro computador. A moeda do relatório é sempre **USD**; não há conversão cambial. O símbolo `$` das fontes foi confirmado pelo Lucas como dólar americano.

**Apresentar** recolhe a navegação do portal, mantém o logo Aceolution e oferece navegação sequencial pelas abas. O botão **Filtros** permite trocar país e período durante a apresentação. **Exportar PDF** abre a impressão do navegador, com todas as seções. **Exportar CSV**, na aba Países, exporta os registros mensais filtrados com a precisão original.

## Atualização do financeiro

Para reproduzir a extração desta planilha, com Python e `openpyxl` instalados:

```powershell
python "Financial Reports/extract-financial-data.py"
```

O extrator documenta a estrutura específica do arquivo recebido, incluindo posições de linhas e janeiro–setembro. Para uma planilha com novo layout ou mais meses, adapte e confira esse mapeamento antes de gerar uma nova versão.

Outra opção é exportar o JSON na aba **Fontes e critérios**, editar os registros e importar o arquivo. O importador exige os seis países em cada mês, meses contíguos, valores numéricos, categorias únicas e reconciliação da receita e dos custos. Resultado, margens e totais são recalculados. Para períodos sem detalhamento de cartão, remova `cardCategoryRecords`; a interface informa a indisponibilidade.

Ao criar um fechamento diferente, atualize também `meta.sourceFile`, ano, proveniência e notas de conciliação. Preserve `meta.currency: "USD"`, conforme o padrão confirmado para os relatórios financeiros. As notas do arquivo original se referem especificamente ao fechamento recebido.

## Idle: definição e atualização

A unidade é **registro CTS**, como na fórmula `COUNTIFS` do `Idle Day Count` em `TKM Monthly Drivers Report!AB21:AD21`. O relatório conta linhas de `RAW CTS DATA` com status exatamente `↓Tech.`, `↓Mech.` ou `↓Weather`, no país e mês selecionados e com identificação de motorista compatível com a fonte. O total é `idleDays = techDays + mechDays + weatherDays`. Esses nomes de campos foram preservados por compatibilidade, mas os valores são contagens de registros, não dias distintos de motorista ou veículo.

Não há deduplicação por motorista/data. Um registro elegível de parada continua sendo contado mesmo quando outra linha do mesmo motorista/data tem mapeamento. TKM positivo ou horas em outra linha não vetam a ocorrência. Status `↑Tech.`, `↑Mech.` e `↑Weather` correspondem a mapeamento parcial e não entram no idle completo. A regra não calcula frações de dia nem horas paradas.

Primeiro são excluídos sábados e domingos pela data do registro; depois, os status de feriado `↑Holiday` e `↓Holiday`. Não há calendário externo de feriados nacionais: a identificação de feriado segue o status registrado na mastersheet. A fórmula nativa não aplica um filtro de dia da semana, mas nenhuma ocorrência elegível de janeiro–setembro/2026 cai em sábado ou domingo; assim, a exclusão explícita solicitada preserva os totais nativos desse fechamento.

Os campos de contexto da versão 2 são `observedRecords`, `weekendRecords`, `holidayRecords`, `eligibleRecords`, `mappingRecords`, `otherDownRecords` e `unclassifiedRecords`. A taxa usa `idleDays / eligibleRecords`, após excluir fins de semana e status de feriado. Ela descreve a proporção de registros elegíveis e não a capacidade contratada, o número de pessoas ou o número de veículos.

Zero e ausência de cobertura têm tratamentos distintos. Quando a fonte cobre o escopo e `COUNTIFS` resulta em zero, a interface mostra **0**; isso não significa que o histórico esteja ausente. Na verificação atual, Colômbia/setembro tem **12 registros observados e idle zero**, com escopo verificado. México/março permanece sem cobertura e deve aparecer como **—**, não zero. Meses com apenas parte das fontes disponíveis são identificados como parciais.

O total disponível de janeiro–setembro/2026 é **29 registros**: **5 Tech + 13 Mech + 11 Weather**, todos em setembro. Os zeros de janeiro–agosto significam que não há registros com os três status `↓` elegíveis nessa fonte; não comprovam ausência de atividade nem melhora histórica. Registros `↑` parciais são tratados separadamente. O consolidado preserva a indicação de cobertura ausente de México/março. A versão anterior usava o mirror da CTS e deduplicava motorista/data com veto por mapeamento; seus resultados não são comparáveis à contagem nativa. A atualização `20261020idle2` separa o cache da definição anterior.

A página não converte idle em receita perdida: faltam tarifas e regras de faturamento por causa para sustentar esse cálculo. Atualizar essa contagem não modifica os dados financeiros.

Para consultar a fonte online, use **Atualizar** na aba Idle. Essa consulta é somente de leitura e não exige executar o extrator.

Para renovar o JSON agregado a partir da cópia local da mastersheet, com Python e `openpyxl` instalados:

```powershell
python "Financial Reports/extract-financial-idle.py" --year 2026 --end-month 9
```

O extrator aceita `--input` para informar outro arquivo local da mastersheet; `--year` e `--end-month` definem o período extraído.

Esse extrator gera apenas agregados por país/mês em `financial-idle-data.json`, com definição, origem, cobertura e data de consulta. Não altera a mastersheet nem publica dados pessoais. A fonte canônica é `RAW CTS DATA`; o mirror usado anteriormente não é alternativa para esta definição. Para dados mais recentes, use a atualização online na aba Idle; para preservar o histórico quando a consulta online estiver indisponível ou incompleta, publique também o JSON canônico agregado atualizado.

## Critérios financeiros

- Receita = Income + Billables + Management Fees. A taxa de gestão do fechamento é 7,8% sobre Billables, não sobre toda a receita.
- Resultado = receita − despesas, após rateio.
- Margem = resultado ÷ receita. O percentual do PPT é resultado ÷ despesas, mostrado separadamente.
- Rateio = gestão + postos de trabalho + compras + outros indiretos.
- O cartão inclui despesas faturáveis. Elas não são somadas novamente aos custos.
- O simulador usa a média mensal da seleção × horizonte × variação informada. Sua referência de margem é uma premissa editável, não uma meta oficial inferida da planilha.

Os arquivos `.xlsx` e `.pptx` originais ficam fora do Git. Para publicar o relatório, versione os arquivos do frontend, os dois JSONs agregados, os dois extratores e esta documentação. Não é necessária nova implantação de Apps Script.
