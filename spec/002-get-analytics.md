# 002 — `get_analytics`: métricas e engajamento

**Status:** Not started
**Prioridade:** Alta (Tier 2)
**Tools novas:** `get_analytics`

## Problema

A API expõe sete endpoints de estatística e engajamento que o MCP ignora por completo.
São todos read-only, compactos e de altíssimo sinal — exatamente o tipo de dado que um
LLM analisa bem. Hoje, para responder "como foi a participação nesta jornada?", só resta
puxar o mapa inteiro e contar na mão.

Isto transforma o MCP de *criador* de jornada em *analista* de jornada.

## Tool proposta

```
get_analytics(project_id?, map_id?, include?)
```

Uma única tool que costura vários endpoints num relatório, em vez de sete tools espelhando
a API. Aceita `project_id` **ou** `map_id` e busca o que fizer sentido para o escopo.

`include` (opcional) permite pedir só uma parte, ex.: `["statistics", "word_cloud"]`.

## Endpoints agregados (todos verificados ao vivo)

| Endpoint | Escopo | Tamanho medido |
|---|---|---|
| `GET /v1/project/{id}/statistics` | projeto | 417 B |
| `GET /v1/map/{id}/statistics` | mapa | 380 B |
| `GET /v1/map/{id}/word-cloud` | mapa | **43.424 B** ⚠️ |
| `GET /v1/project/{id}/user-engagement` | projeto | 2.332 B (12 itens) |
| `GET /v1/project/{id}/map-engagement` | projeto | *(não medido)* |
| `GET /v1/project/{id}/divergence-point-engagement` | projeto | *(não medido)* |
| `GET /v1/project/{projectId}/influential-users` | projeto | *(não medido)* |

**Formato de `statistics`** (idêntico para projeto e mapa):
```
id, title, created_at, people_active_count, divergence_points_count, question_count,
total_comments_count, parent_comments_count, reply_comments_count,
replied_parent_comments_count
```

## Decisões de simplificação

- **Cortar a nuvem de palavras.** 43 KB é grande demais e a cauda longa não tem valor
  analítico. Devolver apenas o top-N (sugestão: 50) por frequência, com um campo indicando
  quantas palavras foram omitidas — nunca truncar em silêncio.
- **Um relatório, não sete respostas.** Combinar tudo num objeto com seções nomeadas
  (`statistics`, `engagement`, `top_words`, `influential_users`).
- **Escopo implícito:** se vier `map_id`, buscar só o que é de mapa; se vier `project_id`,
  o que é de projeto. Se vierem os dois, montar o relatório completo.
- Tolerar falha parcial: se um endpoint responder erro, seguir com os demais e registrar
  a ausência na resposta, em vez de derrubar o relatório inteiro.

## Riscos e questões em aberto

- Três dos sete endpoints **não foram medidos nem tiveram o formato inspecionado**
  (`map-engagement`, `divergence-point-engagement`, `influential-users`). Verificar antes
  de fixar o formato de saída.
- Os mapas de teste têm pouca participação; as métricas foram observadas com números
  baixos. Não se sabe como `user-engagement` cresce numa turma grande — pode precisar de
  corte de top-N como a nuvem de palavras.
- `GET /v1/project/summary/report` e `GET /v1/essay-point/export` existem e podem cobrir
  necessidades de exportação, mas não foram investigados. Ficam fora deste spec.

## Critérios de aceitação

- [ ] Uma chamada devolve estatísticas + engajamento num relatório único
- [ ] Nuvem de palavras limitada ao top-N, com contagem de omitidos declarada
- [ ] Falha de um endpoint não derruba o relatório
- [ ] Funciona com `project_id` sozinho, `map_id` sozinho e os dois juntos
- [ ] Formato dos três endpoints não inspecionados confirmado antes do merge
