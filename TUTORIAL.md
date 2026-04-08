# Tutorial: Conectar o Strateegia ao Claude e ChatGPT

Este tutorial ensina como obter sua chave de API do Strateegia e configurar a conexão com assistentes de IA (Claude Desktop, Claude.ai e ChatGPT) para que eles possam criar jornadas, mapas e pontos diretamente na plataforma.

---

## Passo 1: Obter sua chave de API no Strateegia

1. Acesse [app.strateegia.digital](https://app.strateegia.digital) e faça login na sua conta
2. No canto inferior esquerdo, clique no ícone de **engrenagem** (Configurações)
3. Clique em **Chaves de API**
4. Clique no botão **Criar chave**
5. Dê um nome para a chave (ex: "Claude", "MCP", "ChatGPT" — o nome é só para você se organizar)
6. A chave será exibida **uma única vez**. Copie e guarde em lugar seguro (gerenciador de senhas, por exemplo)

> **Importante:** Essa chave dá acesso à sua conta. Não compartilhe com ninguém e não publique em repositórios ou mensagens públicas.

---

## Passo 2: Escolha onde configurar

### Opção A: Claude.ai (navegador web)

A forma mais simples. Funciona direto no browser, sem instalar nada.

1. Acesse [claude.ai](https://claude.ai) e faça login
2. Clique no ícone de **engrenagem** (Settings) no canto inferior esquerdo
3. Vá em **Connectors** (ou "Conectores")
4. Clique em **Add custom connector**
5. Preencha:
   - **Name:** Strateegia
   - **URL:** `https://strateegia-mcp.fcac.workers.dev/mcp`
6. Em **Headers**, adicione:
   - **Key:** `Authorization`
   - **Value:** `Bearer COLE_SUA_CHAVE_AQUI`
7. Clique em **Save**

Pronto! Na próxima conversa, o Claude terá acesso às ferramentas do Strateegia. Você pode pedir coisas como:
- "Liste meus projetos no Strateegia"
- "Crie uma jornada sobre sustentabilidade com 3 pontos de debate"

---

### Opção B: Claude Desktop (aplicativo macOS/Windows)

Requer uma configuração em arquivo JSON.

#### macOS

1. Abra o Terminal e execute:
   ```bash
   open ~/Library/Application\ Support/Claude/
   ```
2. Abra o arquivo `claude_desktop_config.json` com um editor de texto (TextEdit, VS Code, etc.)
   - Se o arquivo não existir, crie um novo com esse nome
3. Cole o conteúdo abaixo, substituindo `COLE_SUA_CHAVE_AQUI` pela sua chave de API:

```json
{
  "mcpServers": {
    "strateegia": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://strateegia-mcp.fcac.workers.dev/mcp",
        "--header",
        "Authorization: Bearer COLE_SUA_CHAVE_AQUI"
      ]
    }
  }
}
```

> **Se já existir** conteúdo no arquivo, adicione o bloco `"strateegia": { ... }` dentro de `"mcpServers"`, separando com vírgula do que já existe.

4. Salve o arquivo e **reinicie o Claude Desktop**
5. Na nova conversa, você verá um ícone de ferramentas indicando que o Strateegia está conectado

#### Windows

1. Abra o Explorador de Arquivos e navegue até:
   ```
   %APPDATA%\Claude\
   ```
   (Cole esse caminho na barra de endereço)
2. Siga os mesmos passos 2-5 do macOS

---

### Opção C: ChatGPT (via plugin MCP ou Actions)

O ChatGPT ainda não tem suporte nativo a MCP, mas você pode conectar usando o **ChatGPT Actions** (disponível no ChatGPT Plus/Team):

1. Acesse [chatgpt.com](https://chatgpt.com) e vá em **Explore GPTs** > **Create a GPT**
2. Na aba **Configure**, vá até a seção **Actions**
3. Clique em **Create new action**
4. Em **Authentication**, selecione:
   - **Type:** API Key
   - **Auth Type:** Bearer
   - **API Key:** cole sua chave de API do Strateegia
5. Em **Schema**, cole a URL do schema OpenAPI:
   ```
   https://strateegia-mcp.fcac.workers.dev/
   ```
   e importe o schema disponível

> **Nota:** A integração com ChatGPT via Actions é mais limitada que com Claude. Nem todas as ferramentas podem funcionar perfeitamente, pois o ChatGPT Actions usa REST tradicional, não o protocolo MCP. Para a melhor experiência, use Claude.ai ou Claude Desktop.

---

## Passo 3: Testar a conexão

Após configurar, envie uma mensagem simples para verificar se está funcionando:

```
Liste meus projetos no Strateegia
```

Se tudo estiver correto, o assistente vai retornar a lista de jornadas da sua conta.

### Exemplos do que você pode pedir

| Comando | O que acontece |
|---|---|
| "Liste meus projetos" | Mostra suas jornadas |
| "Crie uma jornada chamada Inovação" | Cria um novo projeto |
| "Adicione um mapa ao projeto X" | Cria um mapa dentro da jornada |
| "Crie um ponto de debate com as perguntas..." | Cria um ponto de debate com perguntas personalizadas |
| "Crie um ponto de decisão para votar entre..." | Cria um ponto de decisão com opções |

---

## Solução de problemas

### "Erro 401" ou "Invalid API key"
- Verifique se a chave de API está correta e completa
- Confirme que há um espaço entre `Bearer` e a chave: `Bearer abc123...`
- A chave pode ter sido revogada — crie uma nova em Configurações > Chaves de API

### "Erro de conexão" ou "Timeout"
- Verifique sua conexão com a internet
- O servidor MCP pode estar temporariamente indisponível — tente novamente em alguns minutos

### Claude Desktop não mostra as ferramentas
- Confirme que o arquivo `claude_desktop_config.json` está no caminho correto
- Verifique se o JSON está válido (use [jsonlint.com](https://jsonlint.com) para conferir)
- Reinicie o Claude Desktop completamente (fechar e abrir de novo)
- Verifique se o `npx` está disponível no seu terminal (requer [Node.js](https://nodejs.org) instalado)

### "Não consigo criar pontos de debate"
- É necessário ter um mapa dentro do projeto antes de criar pontos
- Peça ao assistente: "Crie um mapa no projeto X e depois adicione um ponto de debate"

---

## Segurança

- Sua chave de API **nunca é armazenada** no servidor MCP. Ela é enviada a cada requisição e usada apenas para autenticar com o Strateegia
- Se você suspeitar que sua chave foi comprometida, vá em **Configurações > Chaves de API** no Strateegia e revogue-a imediatamente
- Crie chaves separadas para cada serviço (uma para Claude, outra para ChatGPT, etc.) para poder revogar individualmente
