# 003 — Membros e convites

**Status:** Not started
**Prioridade:** Média (Tier 3)
**Tools novas:** `list_members`, `invite_to_project`

## Problema

Dá para montar uma jornada inteira pelo MCP, mas não dá para **colocar pessoas nela**.
Para um professor preparando uma turma, ou um facilitador abrindo uma jornada corporativa,
convidar participantes é parte do fluxo — hoje é preciso sair do Claude e ir à interface web.

Também não há como responder "quem está nesta jornada?".

## Tools propostas

```
list_members(project_id)
invite_to_project(project_id, emails[], role?)
```

### `list_members`

Envolve `GET /v1/project/{id}/users/internal` (verificado: lista de 12 itens, 2.973 B).
Enxugar para o que importa — nome, username, papel, situação — descartando avatares e
campos de auditoria.

### `invite_to_project`

Agregadora de verdade: na API, convidar por e-mail envolve mais de um passo.

| Endpoint | Papel |
|---|---|
| `GET /v1/project/{id}/invite` | ler o convite existente |
| `POST /v1/project/{id}/invite` | criar convite |
| `POST /v1/project/{id}/invite/email` | disparar e-mails |
| `PATCH /v1/project/{id}/invite` | atualizar convite |

A tool deve resolver internamente: garantir que existe convite (criar se não houver) e
então enviar os e-mails, devolvendo o link de convite junto. O usuário passa uma lista de
e-mails e pronto.

## Fora de escopo neste spec

- `PATCH /v1/project/{id}/user/{userId}` (mudar papel) e
  `DELETE /v1/project/{id}/user/{userId}` (remover membro) — **remoção fica de fora**,
  coerente com a decisão de não expor deleção no MCP.
- `connection-link`, `tags`, `NDA`, `approve/disapprove` — fluxos administrativos menos
  usados; adicionar só se houver demanda.

## Riscos e questões em aberto

- **Nenhum destes endpoints foi exercitado ao vivo.** Só `users/internal` foi chamado
  (200, 12 itens); o formato de item não foi inspecionado em detalhe.
- **Envio de e-mail é ação externa e irreversível.** Um convite disparado por engano chega
  a pessoas reais. A tool precisa: descrição inequívoca de que envia e-mails de verdade,
  e possivelmente um parâmetro explícito de confirmação. Vale considerar expor primeiro
  só a criação do link (sem disparo) e deixar o envio para uma segunda etapa.
- Papéis aceitos (`role`) não foram levantados — confirmar valores válidos na spec OpenAPI.

## Critérios de aceitação

- [ ] `list_members` devolve quem está na jornada, enxuto
- [ ] `invite_to_project` cria o convite se necessário e devolve o link
- [ ] Envio de e-mail é explícito na descrição da tool e não acontece por acidente
- [ ] Valores válidos de `role` confirmados
- [ ] Nenhuma capacidade de remover membros
