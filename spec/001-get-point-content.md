# 001 — `get_point_content`: ler a participação

**Status:** Done (em produção desde 14/10/2026, versão `b43618f7`)
**Prioridade:** Alta (Tier 1)
**Tools novas:** `get_point_content`

## Problema

O MCP escreve bem e quase não lê. Dá para criar pontos de todos os tipos, mas não há
como ver **o que os participantes produziram** — respostas de debate, dissertações,
votos, comentários de checkpoint. A única forma hoje é `get_map` com `detail: "full"`,
que devolve o mapa inteiro (430 KB no mapa de KPIs do BNB) e pode estourar o limite de
resposta do cliente.

Sem isto, o ciclo fica incompleto: criar → participar → **(cego)** → analisar.

## Tool proposta

```
get_point_content(point_id, point_type?, page?, size?)
```

Irmã do `get_point`: enquanto aquele devolve a **configuração** de um ponto, esta devolve
a **participação** nele. Mesmo princípio de agregação — esconde o despacho por tipo e
normaliza formatos incompatíveis.

- `point_type` opcional: quando omitido, reaproveita a sondagem de rotas do `get_point`
  (tipo errado responde 403, o certo responde 200).
- `page` / `size`: paginação, com default conservador (sugestão: `size: 20`).

## Por que isto precisa ser uma agregadora

Cada tipo de ponto devolve a participação num formato diferente. **Verificado ao vivo:**

| Tipo | Endpoint | Formato devolvido |
|---|---|---|
| Divergência | `GET /v1/divergence-point/{id}/question/{qid}/comment` | Spring Page |
| Dissertação | `GET /v1/essay-point/{id}/responses` | lista pura (sem paginação) |
| Checkpoint | `GET /v1/checkpoint/{id}/comment` | Spring Page |
| Monitor | `GET /v1/monitor-point/{id}/comments` | lista pura (já usada pelo `get_point`) |
| Convergência | *(não há endpoint de resultado agregado)* | ver observação abaixo |

Além disso, **debate exige N+1 chamadas**: o endpoint de comentários pede um `questionId`,
então é preciso primeiro buscar `GET /v1/divergence-point/{id}/question` e depois iterar.
Esse é justamente o trabalho que a tool deve absorver.

## Fatos verificados na API

**Envelope Spring Page** (a achatar):
```
content, pageable, last, total_pages, total_elements, size, number, sort, first,
number_of_elements, empty
```

**Formato de um comentário de debate:**
```
id, divergence_point_id, question_id, text, parent_id, created_at, created_by,
author{id, name, username, avatar_url}, reply_count, agreed, agreements,
updated_by, updated_at, edited_at
```

**Lista de perguntas** de um ponto de debate vem embrulhada:
`GET /v1/divergence-point/{id}/question` → `{questions: [{id, question, active, edited}]}`

**Dissertação:** `GET /v1/essay-point/{id}/responses` → lista pura;
`GET /v1/essay-point/{id}/responses/count` → `{total}`.

## Formato de saída proposto

Um envelope único, igual para todos os tipos:

```jsonc
{
  "point_id": "...",
  "point_type": "DIVERGENCE",
  "items": [ /* normalizado: autor, texto, data, respostas */ ],
  "page": 0,
  "size": 20,
  "total": 7,
  "has_more": false
}
```

Para debate, `items` agrupado por pergunta (`{question_id, question, comments: [...]}`),
já que os comentários só fazem sentido no contexto da pergunta.

Sugestão de enxugamento: descartar `avatar_url` do autor (URLs longas, sem valor para o
LLM) e os campos de auditoria (`updated_by`, `edited_at`) salvo se pedidos.

## Riscos e questões em aberto

- **Convergência não tem endpoint de resultados agregados.** `GET /v1/convergence-point/{id}/answer/me`
  devolve apenas a resposta do próprio usuário (retornou 404 quando o usuário não votou).
  Os votos agregados parecem vir do `answers` no conteúdo do mapa e do `answer_count` no
  ponto. **A confirmar** antes de implementar esse ramo — pode ser preciso extrair do
  `get_map` ou aceitar cobertura parcial para enquetes.
- **N+1 em debates com muitas perguntas**: um ponto com 10 perguntas gera 11 chamadas.
  Aceitável (respostas pequenas), mas vale limitar ou permitir filtrar por `question_id`.
- Nenhum dos formatos foi exercitado com volume alto de dados — o maior conjunto
  encontrado nos mapas de teste tinha 7 comentários.

## Critérios de aceitação

- [x] Retorna participação para DIVERGENCE, ESSAY, MONITOR e CHECKPOINT
- [x] Auto-detecção de tipo funciona; `point_type` explícito pula a sondagem
- [x] Envelope Spring Page achatado em `{items, page, total, has_more}`
- [x] Debate agrupado por pergunta, com as perguntas resolvidas internamente
- [x] Resposta de um ponto com participação real cabe em ordens de grandeza abaixo do `get_map full`
- [x] Comportamento definido (e documentado) para convergência

## Implementação (14/10/2026)

Motivada pelo chat da jornada (STRAT-3161): pedido "faz um resumo das respostas da questão 1", o chat não tinha como ler as respostas e respondeu que não conseguia acessá-las.

**Tool:** `get_point_content(point_id, point_type?, question_id?, page = 0, size = 10, include_evaluation_feedback = false)`, em `src/tools/point-content.ts`, anotada como `READ_ONLY`.

**Verificado ao vivo** (API de produção, só leituras, com amostras com participação real):

| Tipo | Amostra | Resultado |
|---|---|---|
| Debate | 10 perguntas, 433 comentários | agrupado por pergunta; com `question_id`, só aquela (52 comentários) |
| Decisão | 1 pergunta, 64 participantes | votos agregados 32, 24 e 13 por opção, em 616 bytes |
| Dissertação | 43 respostas | paginada localmente; o endpoint ignora `page`/`size` e devolve tudo |
| Monitoramento | 7 medições | lista completa |
| Checkpoint | 4 comentários | página Spring achatada |

O `get_map` com `detail: "full"` do mapa do debate tem 6 MB; a pergunta filtrada, 3 KB.

**Decisões:**

- **Convergência resolvida sem `get_map`:** cada opção traz `count_vote` e o ponto traz `answer_count`, então os votos agregados vêm do próprio `GET /v1/convergence-point/{id}`. Votos individuais não são expostos pela API, e a descrição da tool diz isso.
- **`size` padrão 10, não 20:** com 20, o debate sem filtro dava 55 KB e a página de dissertação 100 KB, o que esgota numa chamada o orçamento de 30 mil tokens por sala do chat da jornada. Com 10: debate sem filtro ~28 KB, uma pergunta ~3 KB, dissertação ~33 KB.
- **Feedback de avaliação opcional:** o texto da avaliação por IA de cada dissertação tem quase o tamanho da própria resposta (mediana de 1.779 contra 1.527 caracteres). Por padrão vem só a nota; o texto vem com `include_evaluation_feedback: true`.
- **Respostas a comentários** são contadas (`reply_count`), não incluídas.
- **Autor** reduzido ao nome, com `is_assistant: true` quando o comentário foi gerado por um assistente de IA.
- **Erros:** pergunta que não é do ponto devolve a lista das perguntas válidas, para o modelo se corrigir; tipo explícito errado e id inexistente seguem o padrão do `get_point`.

