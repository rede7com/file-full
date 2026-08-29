# 📋 Histórico de versões

## 2026-1.7.0

Versão grande: segurança, aparência e recursos novos.

### 🔒 Segurança

- 🛡️ **Corrigido XSS armazenado por nome de arquivo.** Um arquivo com HTML no
  nome (criável por upload, por SMB ou por qualquer processo com acesso ao
  disco) executava script com a sessão do administrador aberta. Todo dado
  vindo do disco agora é escapado ou inserido como texto puro.
- 🧱 **Content-Security-Policy** com nonce por requisição, mais
  `Referrer-Policy`, `X-Content-Type-Options`, `X-Frame-Options` e
  `Permissions-Policy` — script injetado não executa nem se escapar de algum
  ponto do escapamento.
- 🚪 **Corrigida escrita fora da área do gerenciador.** Um symlink apontando
  pra fora (criável por SMB/SSH no mesmo disco) permitia que um upload
  gravasse em qualquer lugar do host. O caminho agora é validado pelo
  diretório pai já resolvido, e não só pela normalização de `../`.
- 📄 **Corrigida injeção de cabeçalho no download.** Nome de arquivo com aspas
  ou quebra de linha permitia inserir cabeçalhos HTTP arbitrários na
  resposta; agora vai sempre codificado (RFC 5987).
- 🔑 **Troca do id de sessão no login** (session fixation) e **CSRF também no
  formulário de login**.
- ⏱️ **Limite de tentativas agora é por usuário + IP.** Atrás do Ingress todas
  as requisições chegam com o IP do proxy, então 5 erros de digitação de uma
  pessoa trancavam o login de todo mundo. O arquivo de tentativas também
  passou a se limpar sozinho em vez de crescer para sempre.
- 📦 **Validação de ZIP refeita.** A checagem antiga barrava nomes legítimos
  (`foto..jpg`) e deixava passar caminho absoluto (`/etc/passwd`).
- 🧹 **Cache de miniaturas com teto** (256 MB). Ele mora em `/data`, que entra
  no backup do HA — sem poda, uma biblioteca de fotos inchava todo backup
  gerado dali em diante.
- 🔗 Cópia de pastas não segue mais symlink pra fora; cookie de sessão ganha a
  flag `secure` quando servido por HTTPS.

### 🐛 Correções

- 📤 **Upload voltou a funcionar.** Desde a 1.5.4 ele não enviava o token CSRF
  e era recusado com 403.
- 💽 **Download de pasta não enche mais o container.** O ZIP era montado em
  `/tmp` (armazenamento interno, pequeno); agora é montado no próprio disco
  de origem e some mesmo se o download for cancelado no meio.
- 🚀 **Servidor com múltiplos workers.** O PHP embutido é single-threaded: um
  upload grande ou uma análise de espaço congelava o app inteiro para todos.
- 🖼️ Miniatura sem a extensão `gd` devolve 415 em vez de erro 500 com rastro
  de pilha.
- 🔐 Discos montados não podem mais ser excluídos nem renomeados por engano.

### ✨ Novidades

- 🗑️ **Lixeira.** Excluir move para `.file_full_trash` dentro do próprio disco,
  com restauração em um clique e expurgo automático (padrão: 30 dias).
  Antes, excluir era imediato, irreversível e sem rastro.
- 👁️ **Visualizador embutido** para imagem, vídeo, áudio, PDF e Markdown, com
  navegação por ← →. Antes, qualquer clique duplo forçava download.
- 📝 **Log de auditoria.** Toda ação de escrita fica registrada com quem fez e
  quando, visível em Configurações → Auditoria.
- 🔗 **Links de compartilhamento temporários** para arquivos, com validade
  escolhida e revogação a qualquer momento.
- ⌨️ **Atalhos de teclado**: `Delete`, `F2`, `Ctrl+A`, `Ctrl+C/X/V`, `Esc`,
  `/` para buscar.
- ↕️ **Ordenação** por nome, tamanho ou data, valendo para a listagem inteira.

### 🎨 Aparência

- 🌙 **Tema escuro**, seguindo o sistema ou fixado no botão do cabeçalho — o
  app não abre mais um retângulo branco dentro do painel escuro do HA.
- 🎯 **Ícones SVG** no lugar dos emojis, que renderizavam diferente em cada
  sistema e não acompanhavam o tema.
- 📋 **Visualização em lista** com colunas de tamanho e data, além da grade.
- 🧭 Toolbar reorganizada em menus (dez botões enfileirados viravam uma parede
  em tela estreita), barra de status com contagem e seleção, e esqueletos de
  carregamento no lugar da tela em branco entre pastas.

## 2026-1.6.2

- 🐛 Pequenas correções de bugs e 🚀 melhorias gerais.

## 2026-1.6.1

- 🗂️ O campo **"Nome da máquina na rede"** agora aparece direto em
  **Configurações → SMB** do próprio app (antes só dava pra mexer pela aba
  Configuração do add-on no Home Assistant).

## 2026-1.6.0

- 🏷️ **Nome do compartilhamento configurável** (`smb_server_name`). O SMB e o
  anúncio Bonjour não usam mais o hostname interno feio do container
  (ex.: `08a40d41-file-full`) — agora você define um nome digno que vale no
  Windows (Rede), no Finder do Mac e no endereço `<nome>.local`. Também nomeia
  o anúncio do Time Machine e do SSH.

## 2026-1.5.9

- 🖥️ Prompt do SSH fixo em `file-full`, em vez do hostname gerado pro container.

## 2026-1.5.8

- 🧹 Removido o monitor automático de disco/SMART — não entregava valor prático.

## 2026-1.5.7

- 🔑 SSH root real e opcional dentro do container, **somente por chave pública**
  (nunca senha). Dá shell em tudo que o add-on enxerga: HDs externos, `/config`,
  `/share`, `/backup`.

## 2026-1.5.6

- ⏱️ Busca recursiva com limite de tempo — não trava mais em árvores de pastas
  gigantes.

## 2026-1.5.5

- 📄 Paginação na listagem de pastas — diretórios com muitos itens carregam
  rápido.

## 2026-1.5.4

- 🔒 Reforço de segurança: proteção CSRF, limite de tentativas de login e
  flags de cookie mais restritas.

## 2026-1.5.x (anteriores)

- 🧩 Hub de **Configurações** dentro do app (discos, SMB, Time Machine,
  WireGuard, usuários).
- 🌐 Suporte a um **2º cliente WireGuard** (`wg2_*`) independente do primeiro,
  com badge de status das VPNs no cabeçalho.
- 💽 Montagem de discos "lazy" e por UUID (além de por label).
- 👥 Múltiplos usuários no login web.
- 🐛 Corrigido o `SIGPIPE` que derrubava o container ao configurar o Time
  Machine com um disco não-vazio.
- 🚀 Diversas melhorias de estabilidade e desempenho.

## 2026-1.1.0

- 🎉 Primeira versão: gerenciador de arquivos PHP com acesso a `/config` e HDs
  externos, compartilhamento SMB e Time Machine do macOS.
