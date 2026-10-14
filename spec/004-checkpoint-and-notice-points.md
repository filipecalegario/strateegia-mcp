# 004 — Pontos de checkpoint e aviso

**Status:** In review
**Prioridade:** Média (Tier 4)
**Tools novas:** `create_checkpoint_point`, `create_notice_point`

## Problema

O MCP suporta 4 dos 6 tipos de ponto. Checkpoint e aviso (*notice*) não podem ser criados.

Isso gera uma assimetria visível: desde o spec 000 (`get_map` com `detail: "summary"`),
o índice **já lista** pontos `CHECKPOINT` e `NOTICE` quando existem no mapa — mas não há
como criá-los pelo MCP. O usuário vê algo que não consegue produzir.

## Tools propostas

```
create_checkpoint_point(map_id, description, position, opening_date?, meeting_place?, visible?)
create_notice_point(map_id, title, description, position, send_email?, visible?)
```

Seguem o padrão dos `create_*_point` existentes.

## Endpoints

| Endpoint | Uso |
|---|---|
| `POST /v1/map/{mapId}/checkpoint` | criar checkpoint |
| `POST /v1/map/{mapId}/notice-point` | criar ponto de aviso |

## Campos observados (do conteúdo de mapas reais)

**Checkpoint** — entrada com wrapper `{point, comments}`:
```
map_id, opening_date, description, position, meeting_place, visible, active, id,
version, created_at, created_by, updated_at, updated_by, ancestors, status,
closed_at, is_open, is_closed, is_not_open
```
Note que **não tem `name`/`title`** — a identificação vem da `description`. Isso explica
por que o índice do `get_map` mostra `title: null` para checkpoints; comportamento correto,
não bug.

**Notice point** — é o único container **sem wrapper `point`**; a entrada já é o ponto:
```
map_id, description, position, send_email, visible, title, active, id, version,
created_at, created_by, updated_at, updated_by, ancestors
```
Este tem `title`, e tem `send_email`.

## Riscos e questões em aberto

- **Os corpos de criação não foram verificados** — os campos acima vêm da *leitura* de
  pontos existentes, e esta API já mostrou divergir entre escrita e leitura (o caso do
  `essay_name` na criação virando `name` na leitura, ver spec 001 e o histórico do PR #3).
  Conferir `CreateCheckpointRequestDTO` / equivalente na spec OpenAPI antes de implementar.
- **`send_email: true` dispara e-mail real** para os participantes. Mesmo cuidado do
  spec 003: default `false` e descrição explícita.
- Checkpoint tem ciclo de vida (`is_open`, `closed_at`, `PUT /v1/checkpoint/{id}/close`).
  Fechar checkpoint fica fora deste spec; se for útil, entra no spec 005.

## Critérios de aceitação

- [x] Corpos de criação confirmados na spec OpenAPI (não inferidos da leitura)
- [x] Ambos os tipos criáveis e visíveis no `get_map`
- [x] `send_email` default `false`, com aviso na descrição
- [x] Sem capacidade de deleção

## Implementação (14/10/2026)

Tools `create_checkpoint_point` e `create_notice_point` em `src/tools/points.ts`, anotadas como `ADDITIVE`.

**Corpos conferidos na spec OpenAPI** (`CreateCheckpointDTO`, `CreateNoticePointDTO`), com duas diferenças em relação ao previsto acima:

- `opening_date` é **obrigatória** no checkpoint, não opcional. `visible` também é obrigatório nos dois; a tool usa `true` como padrão.
- No aviso, `title` é opcional e `send_email` é obrigatório; a tool usa `false` como padrão.

**Datas em UTC sem fuso.** A API declara `date-time`, mas lê `opening_date` como data local: recusa `2026-10-20T14:00:00-03:00` ("unparsed text found") e aceita `2026-10-20T17:00:00.000Z`, que é o que o front envia com `toISOString()`. A tool aceita ISO 8601 com fuso e converte para UTC (`toApiDateTime` em `strateegia-client.ts`).

**Verificado ao vivo em dev** (jornada de teste "[teste MCP] specs 004 e 005"): encontro criado com `-03:00` e gravado em UTC (`17:00`); aviso criado com `send_email: false`; os dois aparecem no índice do `get_map`. A API não deixa criar encontro com data passada ("Invalid request content").

