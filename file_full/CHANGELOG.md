# 📋 Histórico de versões

## 2026-1.6.2

- 📝 Adicionado este histórico de versões (changelog) — antes o Home Assistant
  mostrava "No changelog found".
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
