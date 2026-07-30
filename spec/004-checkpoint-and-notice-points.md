# 004 — Pontos de checkpoint e aviso

**Status:** Not started
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

- [ ] Corpos de criação confirmados na spec OpenAPI (não inferidos da leitura)
- [ ] Ambos os tipos criáveis e visíveis no `get_map`
- [ ] `send_email` default `false`, com aviso na descrição
- [ ] Sem capacidade de deleção
