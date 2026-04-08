# Projeto: MCP remoto para Strateegia

Quero construir um servidor MCP (Model Context Protocol) remoto que exponha a API do Strateegia para clientes MCP como Claude.ai, Claude Desktop, Cursor e ChatGPT. Este é um experimento pessoal. As decisões de arquitetura abaixo já foram tomadas, não precisa revisitar.

## Stack definido

- **Linguagem:** TypeScript
- **Runtime/hospedagem:** Cloudflare Workers
- **Template de partida:** `cloudflare/ai/demos/remote-mcp-authless` (via `npm create cloudflare@latest`)
- **Bibliotecas principais:**
  - `@modelcontextprotocol/sdk` (SDK TypeScript oficial do MCP)
  - `agents` (Agents SDK da Cloudflare, fornece a classe `McpAgent`)
  - `hono` (opcional, para middleware HTTP)
  - `zod` (schemas de validação das tools)
- **CLI:** Wrangler
- **Transporte MCP:** Streamable HTTP (endpoint único `/mcp`), stateless

## Modelo de autenticação

O usuário pega uma API key de longa duração (PAT) na página de configuração do usuário no Strateegia. Ele cola essa chave na configuração do cliente MCP dele, como header:

```
Authorization: Bearer <api_key_strateegia>
```

O Worker:
1. Extrai o header `Authorization` de cada requisição MCP
2. Rejeita com 401 se não estiver presente
3. **Não valida o token localmente, não armazena nada, não mantém sessão**
4. Repassa o mesmo header Bearer nas chamadas `fetch()` para a API do Strateegia
5. Se a API do Strateegia retornar 401/403, propaga o erro para o cliente MCP

Arquitetura stateless. Zero credencial armazenada. A segurança é herdada da própria API Strateegia: se a chave é revogada lá, para de funcionar aqui automaticamente.

## Escopo da v1: domínio Projects completo (com todos os tipos de ponto úteis)

A base URL da API Strateegia para este domínio é:
```
https://api.strateegia.digital/projects
```

Documentação Swagger de referência:
```
https://api.strateegia.digital/projects/swagger-ui/index.html
```

Hierarquia de recursos do Strateegia: `Lab → Project → Map → Point → Content`. Os tipos de Point cobertos nesta v1 são: **Divergence, Convergence, Essay, Monitor**. O tipo Notice (anúncios com email) fica fora da v1.

Comportamento e finalidade de cada tipo de ponto:
- **Divergence:** coleta ideias e respostas, tem perguntas, comentários, concordâncias
- **Convergence:** tomada de decisão, tem critérios, votação, opções
- **Essay:** conteúdo longo (texto rico), usado para avaliação
- **Monitor:** acompanhamento de progresso, com métricas qualitativas ou quantitativas

## As 10 tools da v1

Implementar exatamente estas 10 tools, com descrições densas mas curtas (o modelo lê isso e consome contexto) e schemas Zod mínimos (só campos necessários):

| Tool | Método | Endpoint |
|---|---|---|
| `list_projects` | GET | `/v1/project?page=0&size=20&sort=created_at,desc` |
| `get_project` | GET | `/v1/project/{id}` |
| `create_project` | POST | `/v1/project` (body: `title`, `lab_owner_id`, `color`) |
| `list_maps_in_project` | GET | `/v1/project/{id}/map` |
| `get_map` | GET | `/v1/map/{id}` |
| `create_divergence_point` | POST | `/v1/map/{mapId}/divergence-point` |
| `create_convergence_point` | POST | `/v1/map/{mapId}/convergence-point` |
| `create_essay_point` | POST | `/v1/map/{mapId}/essay-point` |
| `create_monitor_point` | POST | `/v1/map/{mapId}/monitor-point` |
| `add_comment_to_question` | POST | `/v1/divergence-point/{dpId}/question/{qId}/comment` |

Notas sobre schemas:
- Cores válidas: `PURPLE`, `BLUE`, `TEAL`, `ORANGE`, `MAGENTA`, `PINK`, `YELLOW`
- Tipos de pergunta (usado em divergence): `FREE_TEXT`, `MULTI_SELECT`, `SINGLE_SELECT`, `LIKERT`
- `tool` em divergence point aceita valores como `BRAINSTORMING` (consultar Swagger para a lista completa)
- Para os pontos (divergence, convergence, essay, monitor), todos esperam no mínimo: `title`, `position` (`{row, col}`), e campos específicos de cada tipo
- Para convergence, esperar campos relacionados a critérios e opções de votação
- Para essay, esperar prompt/instrução e configuração de avaliação
- Para monitor, esperar métricas (qualitativas ou quantitativas)
- **Os campos exatos de cada tipo de ponto devem ser confirmados no Swagger antes de implementar.** Se algum campo for ambíguo, use o mais conservador e marca com `// TODO:` no código
- Listagens usam paginação Spring Pageable, resposta tem `content`, `total_pages`, `total_elements`
- Em erros da API, propagar códigos: 401 (token inválido), 403 (sem permissão), 422 (body inválido), 429 (rate limit)

## Deliverables que quero do scaffold

1. **`package.json`** com as dependências certas e scripts `dev` e `deploy`
2. **`wrangler.toml`** (ou `wrangler.jsonc`) configurado, nome do worker: `strateegia-mcp`
3. **`src/index.ts`** como entrypoint do Worker, com:
   - Middleware de auth que extrai e valida presença do header `Authorization`
   - Validação do header `Origin` (a spec do Streamable HTTP exige, para prevenir DNS rebinding)
   - Instanciação do `McpAgent` com o servidor MCP
4. **`src/strateegia-client.ts`** com uma função helper `strateegiaFetch(token, path, init)` que monta a URL base, injeta o Bearer token e trata erros de forma consistente
5. **`src/tools/`** com os arquivos das tools organizados por domínio (ex: `projects.ts`, `maps.ts`, `points.ts`, `comments.ts`), com schemas Zod claros e descrições das tools escritas como se fossem docstrings para outro humano
6. **`README.md`** explicando:
   - Como rodar localmente (`npm install`, `npm run dev`)
   - Como testar com o MCP Inspector
   - Como fazer deploy (`wrangler deploy`)
   - Como configurar no Claude.ai (Settings → Connectors → Add custom connector) colando a URL do worker + o header Authorization
   - Como configurar em clientes que usam `mcp.json` (Cursor, Claude Code)
   - Como configurar em clientes stdio-only via `mcp-remote` como proxy
7. **`.dev.vars.example`** para rodar local (se precisar de alguma variável)
8. **`.gitignore`** adequado

## Restrições importantes

- **Nunca logar o header `Authorization`** nem seu valor em logs de erro, mesmo em dev
- **Nunca armazenar a API key** em KV, Durable Objects, variáveis globais, ou qualquer lugar. O token só existe durante o ciclo de vida de uma requisição
- **Stateless.** Sem `Mcp-Session-Id`, sem Durable Objects, sem persistência
- **Tools pequenas e focadas.** Não mapear 1-para-1 todos os endpoints do Swagger. Cada tool deve corresponder a uma intenção do usuário
- **Descrições de tools densas.** O modelo lê isso como parte do contexto. Explicar o que a tool faz, quando usar, e o que retorna. Evitar boilerplate. Para os 4 tipos de ponto, deixar claro na descrição em que situação usar cada um (coletar ideias → divergence; decidir entre opções → convergence; texto longo avaliável → essay; acompanhar métrica → monitor)
- **Validar Origin** nas requisições entrantes (requisito da spec Streamable HTTP)

## O que fazer

1. Roda o comando `npm create cloudflare@latest -- strateegia-mcp --template=cloudflare/ai/demos/remote-mcp-authless` para criar a base
2. Examina o que o template gerou
3. Rasga os exemplos (calculadora ou o que for) e implementa a arquitetura acima
4. Consulta o Swagger em `https://api.strateegia.digital/projects/swagger-ui/index.html` para confirmar os campos exatos dos 4 tipos de ponto antes de implementar os schemas Zod
5. Me mostra a estrutura de arquivos final
6. Me explica os trechos não óbvios (especialmente o middleware de auth e como o `McpAgent` é ligado ao fetch handler do Worker)
7. Me diz o próximo comando exato que eu preciso rodar para ver funcionando

Não precisa pedir confirmação para cada passo, pode tocar do início ao fim. Se bater em alguma ambiguidade real, faz a escolha mais conservadora e anota em um comentário `// TODO:` no código.