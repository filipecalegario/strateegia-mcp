# 005 — `update_point`: edição genérica

**Status:** Not started
**Prioridade:** Média (Tier 5)
**Tools novas:** `update_point` (absorve `update_divergence_point`)

## Problema

Dos quatro tipos de ponto criáveis, **só divergência pode ser editado**. Um erro de meta
num monitor, uma data de encerramento errada numa dissertação, o título de uma enquete —
tudo exige recriar o ponto.

No contexto do BNB (121 KPIs cadastrados como monitores), corrigir metas ou descrições sem
recriar não é conveniência: é a diferença entre viável e inviável.

## Tool proposta

```
update_point(point_id, point_type?, { campos a alterar })
```

Mesma filosofia do `get_point`: detecta o tipo (ou aceita `point_type`) e despacha para os
endpoints certos. Passa-se só o que muda.

Isto **generaliza** o `update_divergence_point`, que já faz internamente esse trabalho —
ele traduz `title` / `introduction` / `visible` em três PATCHes separados. A tool nova
estende o mesmo padrão para os demais tipos; o `update_divergence_point` deve ser absorvido
para não haver duas formas de fazer a mesma coisa.

## Endpoints por tipo

| Tipo | Endpoints |
|---|---|
| Monitor | `PATCH /v1/monitor-point/{id}` (updateMonitorPointInfo), `PATCH /v1/monitor-point/{id}/visibility` |
| Convergência | `PATCH /v1/convergence-point/{id}`, `PATCH /v1/convergence-point/{id}/visibility`, `PUT /v1/convergence-point/{id}/close` |
| Dissertação | `PATCH /v1/essay-point/{id}/closing-date`, `PATCH /v1/essay-point/{id}/visibility`, + ~12 toggles de modo |
| Divergência | `/title`, `/introduction`, `/visibility` (já implementados) |

## Decisões de simplificação

- **Não espelhar os toggles de dissertação.** A API tem par `enable`/`disable` para cada
  modo (`incognito-mode`, `individual-mode`, `multiple-response-mode`, `single-shot-mode`,
  `user-evaluation-mode`, `end-time-mode`, `block-answer-deletion-mode`,
  `hide-evaluation-grade-mode`) — 16 endpoints. Expor como booleanos no schema e mapear
  internamente para `enable` ou `disable`. Um campo, não dois endpoints.
- **`visible` unificado** entre todos os tipos, apesar de rotas distintas.
- Como hoje, cada campo vira um PATCH; devolver o ponto atualizado no fim.

## Riscos e questões em aberto

- **`updateMonitorPointInfo` não teve o corpo inspecionado.** Não se sabe se aceita
  atualização parcial ou exige o objeto inteiro (nome, descrição, meta, tipo, fluxo,
  data). Se for total, a tool precisa ler o ponto antes e mesclar — o que muda o desenho.
  **Verificar primeiro.**
- Edições parciais que falham no meio deixam o ponto em estado intermediário (o
  `update_divergence_point` já tem essa característica). Vale relatar quais campos foram
  aplicados quando um falhar.
- Fechar enquete/checkpoint (`close`) é ação semanticamente diferente de editar — decidir
  se entra aqui ou em tool própria.

## Critérios de aceitação

- [ ] Edita monitor, convergência, dissertação e divergência
- [ ] Detecção automática de tipo, com `point_type` como atalho
- [ ] Modos de dissertação expostos como booleanos, não como pares de endpoints
- [ ] Semântica de `updateMonitorPointInfo` (parcial vs total) confirmada
- [ ] `update_divergence_point` absorvido, sem duplicidade
- [ ] Falha parcial relatada com clareza
