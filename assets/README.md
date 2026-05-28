# Assets estáticos do dashboard

## `faccoes_rj.geojson` — Mapa Histórico dos Grupos Armados do Rio de Janeiro

3829 polígonos cobrindo a Região Metropolitana do Rio de Janeiro, classificados por controle territorial de facção (CV, TCP, ADA, Milícia) ou "Domínio Indefinido".

**Fonte:** [Instituto Fogo Cruzado](https://fogocruzado.org.br) + [GENI/UFF](https://geni.uff.br) — projeto colaborativo desde 2018 (parceria entre o Grupo de Estudos dos Novos Ilegalismos da UFF e o Instituto Fogo Cruzado).

**Período coberto neste snapshot:** 2021-2023.

**Metodologia:** denúncias anônimas do Disque-Denúncia → geocoded → classificadas por ML → validadas com pesquisa de imprensa e literatura especializada → projetadas em shapefile na escala censitária.

**Cores por facção (do legend original):**
| Facção | Cor |
|---|---|
| ADA (Amigos dos Amigos) | `#DDB310` |
| CV (Comando Vermelho) | `#B61D14` |
| Domínio Indefinido | `#E6A176` |
| Milícia | `#4053D3` |
| TCP (Terceiro Comando Puro) | `#00B25D` |

**Repo original:** https://github.com/fogocruzadoapp/mapafc (R htmlwidget, ~16MB por ano). Este GeoJSON foi extraído do `Mapview_RM_com2023/Mapa_Grupos_Armados_2021-2023.html`, convertido pra GeoJSON, dedup de coordenadas adjacentes e coordenadas com 5 casas decimais (~1m precisão).

**Atualização:** snapshot manual. Quando o Fogo Cruzado/GENI lançar uma nova janela (ex: 2022-2024), re-extrair com o mesmo script (ver memória `crime-overlay-dashboard`).

**Atribuição obrigatória no UI:** sim — popup do mapa mostra "Fogo Cruzado / GENI-UFF".
