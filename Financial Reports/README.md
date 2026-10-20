# Relatório financeiro LATAM

A página `financial-report.html`, na raiz do portal, usa o login e o tema compartilhados. O atalho aparece no Hub e no menu Financeiro para administradores. Permissões adicionais continuam sendo gerenciadas por `admin-users.html`.

## Fontes

- `financial-data.json`: fechamento financeiro agregado da P&L de janeiro a setembro de 2026, usado no MBR de setembro. Todos os valores financeiros são em **USD**, conforme confirmação do Lucas. Não contém nomes de funcionários nem transações individuais.
- Mastersheet online, TKM e quilômetros rodados: `financial-operations.js` consulta `getMonthlyReportData`. Só aceita esses indicadores quando a resposta confirma o mês/ano e `ctsSource: mirror`. TKM representa a soma registrada na CTS; a fonte consultada não comprova aprovação ou faturamento. Esse contexto corresponde ao **mês final do filtro**, mesmo em uma seleção acumulada.
- Mastersheet online, idle: `financial-idle.js` consulta `getCtsTimesheet` com início e fim exatos, em janelas trimestrais. Calcula os agregados de Tech, Mech e Weather para o período selecionado ou YTD. Nomes, emails e VIDs usados na leitura não são expostos nem persistidos pelo módulo.
- `financial-idle-data.json`: cópia agregada da consulta online de 20/10/2026, com registros CTS até 17/10/2026 e cobertura financeira selecionada de janeiro a setembro. O extrator também permite gerar uma alternativa a partir da aba `RAW CTS DATA` da cópia da mastersheet. É usada quando a consulta online falha e não há cache anterior disponível. A interface identifica a fonte, a cobertura e a última data com registros disponível.
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
- **Idle:** Tech, Mech e Weather, com alternância entre total sem duplicação e cada causa, no acumulado ou no período selecionado.
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

A unidade é **dia-motorista**, identificado pela combinação de motorista e data. Conta-se um dia inteiro sem mapeamento somente quando há registro com causa explícita Tech, Mech ou Weather. Qualquer mapeamento no dia, identificado pelo status, por horas de mapeamento ou por TKM positivo, retira esse dia da contagem de idle de dia inteiro. Não se estimam horas paradas dentro de um dia com mapeamento.

O total `idleDays` é a **união** dessas três causas: no máximo um dia por motorista/data. Um mesmo dia pode aparecer em mais de uma causa, então a soma Tech + Mech + Weather pode exceder o total. Outras paradas explícitas, como Personal, Holiday e Travelling, ficam em `otherDownDays`; registros sem causa identificável ficam em `unclassifiedDays`.

Ausência de registro não vira dia parado nem zero comprovado. País/mês sem registros tem cobertura ausente; cobertura incompleta é indicada. Esses indicadores descrevem os registros disponíveis e não presumem um calendário de trabalho completo. A página não converte idle em receita perdida: faltam tarifas e regras de faturamento por causa para sustentar esse cálculo.

Para renovar a cópia agregada pela fonte online (somente leitura):

```powershell
python "Financial Reports/extract-financial-idle.py" --online --year 2026 --end-month 9
```

Para gerar a alternativa a partir da cópia local da mastersheet:

```powershell
python "Financial Reports/extract-financial-idle.py"
```

Esse extrator gera apenas agregados por país/mês em `financial-idle-data.json`, com origem e cobertura. Não altera a mastersheet. O arquivo fornecido usa `online-snapshot` e registra data de consulta e corte do CTS. Para dados mais recentes, use a atualização online na aba Idle; para funcionar sem a consulta online, publique também o JSON agregado atualizado.

## Critérios financeiros

- Receita = Income + Billables + Management Fees. A taxa de gestão do fechamento é 7,8% sobre Billables, não sobre toda a receita.
- Resultado = receita − despesas, após rateio.
- Margem = resultado ÷ receita. O percentual do PPT é resultado ÷ despesas, mostrado separadamente.
- Rateio = gestão + postos de trabalho + compras + outros indiretos.
- O cartão inclui despesas faturáveis. Elas não são somadas novamente aos custos.
- O simulador usa a média mensal da seleção × horizonte × variação informada. Sua referência de margem é uma premissa editável, não uma meta oficial inferida da planilha.

Os arquivos `.xlsx` e `.pptx` originais ficam fora do Git. Para publicar o relatório, versione os arquivos do frontend, os dois JSONs agregados, os dois extratores e esta documentação. Não é necessária nova implantação de Apps Script.
