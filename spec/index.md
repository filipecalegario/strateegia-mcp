# Specs — plano de implementação

Levantamento feito em 2026-07-30 cruzando a spec OpenAPI do Strateegia
(`https://api.strateegia.digital/projects/v3/api-docs`) com as tools já implementadas.

**Cobertura atual: 25 de 271 endpoints (9%).** A maior parte dos 246 restantes é ruído
(toggles granulares, flags de compartilhamento, CRUD de subsistemas). Os specs abaixo
cobrem o que tem valor real.

## Princípio de desenho

As tools **não espelham a API 1:1**. São agregadoras e simplificadoras, no modelo do
`get_point`: escondem o despacho por tipo de ponto, costuram várias chamadas numa só e
normalizam formatos incompatíveis. Uma tool resolve uma intenção do usuário, não um
endpoint.

## Specs

| # | Spec | Tools | Prioridade | Status |
|---|---|---|---|---|
| 001 | [Ler a participação](001-get-point-content.md) | `get_point_content` | Alta | Not started |
| 002 | [Métricas e engajamento](002-get-analytics.md) | `get_analytics` | Alta | Not started |
| 003 | [Membros e convites](003-members-and-invites.md) | `list_members`, `invite_to_project` | Média | Not started |
| 004 | [Checkpoint e aviso](004-checkpoint-and-notice-points.md) | `create_checkpoint_point`, `create_notice_point` | Média | Not started |
| 005 | [Edição genérica](005-update-point.md) | `update_point` | Média | Not started |
| 006 | [Leituras leves](006-lightweight-reads.md) | — (otimiza existentes) | Baixa | Not started |

Status possíveis: `Not started` · `In progress` · `In review` · `Done`

## Ordem sugerida

**001 primeiro.** É o que fecha o ciclo do produto: hoje dá para criar → participar →
**(cego)** → analisar. Sem ler a participação, o MCP escreve num lugar que não consegue
enxergar. Os endpoints são paginados, o que encaixa no trabalho de tamanho de resposta
feito no PR #3.

Depois **002**, que se apoia no mesmo terreno e entrega a camada analítica com endpoints
read-only baratos.

De 003 a 006 a ordem é indiferente — seguir a demanda real.

## Já implementado (20 tools)

Projetos: `list_projects`, `get_project`, `create_project`
Mapas: `create_map`, `list_maps_in_project`, `get_map` *(com níveis de detalhe)*
Pontos: `get_point`, `create_divergence_point`, `create_convergence_point`,
`create_essay_point`, `create_monitor_point`, `update_divergence_point`,
`update_point_position`, `add_monitor_status`
Comentários: `add_comment_to_question`, `add_question_to_divergence_point`,
`reply_to_comment`, `like_comment`, `unlike_comment`
Templates: `list_tool_templates`

## Fora de escopo (decisões tomadas)

- **Deleção** — nenhuma tool apaga pontos, mapas ou projetos. Decisão deliberada: a
  operação é irreversível e os pontos contêm respostas de participantes. A API suporta
  (`DELETE /v1/monitor-point/{id}` etc.), mas não será exposta por ora. A única exceção
  existente é `unlike_comment`, que remove apenas o próprio like.
- **Assistants** (30 endpoints) e **chat-room / journey-chat** (13) — subsistemas
  inteiros, fora do território atual do MCP.
- **Criteria** (11 endpoints) — só relevante para avaliação por rubrica em pontos de
  dissertação; adicionar se houver demanda.

## Aviso sobre os fatos nestes specs

Formatos marcados como *verificados* foram observados em chamadas reais à API durante o
levantamento. Vários endpoints, porém, **nunca foram chamados** — cada spec lista os seus
em "Riscos e questões em aberto". Esta API já demonstrou divergir entre o corpo de
escrita e o de leitura (o caso `essay_name` → `name`), então inferir formato a partir da
documentação ou de endpoints vizinhos não é confiável. Medir antes de implementar.
