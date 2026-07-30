# 006 — Leituras leves de metadados

**Status:** Not started
**Prioridade:** Baixa (ganho rápido)
**Tools novas:** nenhuma — otimiza tools existentes

## Problema

Duas leituras hoje puxam muito mais dado do que precisam. É a mesma família do problema
atacado no PR #3 (`get_map` com níveis de detalhe), só que em outras tools.

### `list_maps_in_project`

Não existe endpoint dedicado de listagem, então a tool busca **o projeto inteiro**
(`GET /v1/project/{id}`) e extrai o array `maps`. Traz membros, links de conexão e o
resto junto, para descartar quase tudo.

### `get_map` sempre puxa conteúdo

Mesmo com `detail: "summary"`, a chamada de rede continua sendo
`GET /v1/map/{id}/content` — o servidor monta a resposta completa e o corte acontece no
Worker. Para quem só quer o título e a data de um mapa, existe rota mais barata.

## Endpoints disponíveis

| Endpoint | Uso |
|---|---|
| `GET /v1/map/{id}` (`getMapById`) | metadados do mapa, sem conteúdo |
| `GET /v1/project/{id}/optimized` (`getProjectByIdOptimized`) | versão leve do projeto |

## Mudanças propostas

- `list_maps_in_project` passa a usar `/optimized`, se ele de fato trouxer os mapas.
- Avaliar um nível `detail: "meta"` no `get_map` (ou tool separada) apoiado em
  `GET /v1/map/{id}`, para quando só se quer identificar o mapa.

## Riscos e questões em aberto

- **Nenhum dos dois endpoints foi chamado.** Não se sabe o que `/optimized` corta nem se
  ele preserva o array `maps` — se não preservar, a mudança em `list_maps_in_project`
  não se sustenta. **Medir antes de decidir.**
- Ganho provavelmente modesto: o gargalo real medido estava no conteúdo do mapa
  (430 KB), não na leitura do projeto. Tratar como polimento, não como correção.
- Trocar o endpoint de uma tool existente muda o formato de saída — verificar se algum
  campo hoje utilizado desaparece.

## Critérios de aceitação

- [ ] Tamanho de `/optimized` e `GET /v1/map/{id}` medido e comparado ao atual
- [ ] Mudança só aplicada se o ganho for real e nenhum campo em uso for perdido
- [ ] Sem regressão no formato de saída das tools existentes
