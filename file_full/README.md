# File Manager HD PHP

![icon](icon.png)

Gerenciador de arquivos self-contained pra Home Assistant: monta HDs externos,
dá acesso opcional às pastas do próprio HA (`/config`, `/backup`, `/addons`...),
e funciona como um NAS básico — sem depender de nenhum outro add-on.

Acesso pela sidebar do HA (Ingress), autenticado pela sua própria sessão do HA.

## Recursos

- Navegação de arquivos com upload (até 8GB por arquivo), download, zip/unzip,
  renomear, mover, copiar, exclusão
- Listagem de pastas paginada (lotes de até 500 itens, botão "Carregar mais")
  — pastas com milhares de arquivos abrem rápido em vez de travar montando a
  lista inteira de uma vez
- Editor de texto embutido (edita qualquer arquivo direto pelo navegador)
- Múltiplos discos simultâneos, identificados por label ou por UUID
- Formatação de disco guiada (ext4/exFAT/FAT32), com proteção automática
  contra formatar partições do próprio sistema do HAOS (e swap/zram)
- Monitoramento de saúde S.M.A.R.T. e uso de espaço por disco
- Notificações no próprio painel do HA (disco cheio, falha de SMART)
- Múltiplos usuários de acesso ao app (administrador ou só leitura),
  criados e removidos direto pela aba Configurações → Usuários — separados
  de SMB e Time Machine, que têm login próprio cada um
- Configuração do add-on (discos, SMB, Time Machine, WireGuard, usuários,
  sistema) direto pela própria interface web, sem precisar abrir a aba
  "Configuração" do add-on no HA — salvar já reinicia sozinho
- Acesso também numa aba separada do navegador, fora do painel do HA
  (porta própria, além do Ingress)
- Sobe só com PHP, sem exigir nenhum disco configurado
- Time Machine do macOS via SMB (compartilhamento dedicado, com anúncio
  automático na rede via Bonjour/mDNS)
- Compartilhamento SMB de uso geral (acesso aos mesmos discos do gerenciador
  via rede local, com usuário/senha próprios)
- Atualização automática pelo Supervisor do HA (repositório git) — sem botão
  de atualização manual dentro do app
- Cliente WireGuard embutido: conecta este addon a um servidor VPN existente,
  com escopo restrito (não tuneliza a navegação normal do host)

## Tecnologias utilizadas

![PHP](https://img.shields.io/badge/PHP-777BB4?logo=php&logoColor=white)
![WireGuard](https://img.shields.io/badge/WireGuard-88171A?logo=wireguard&logoColor=white)
![Samba](https://img.shields.io/badge/Samba-0078D4?logo=sambafile&logoColor=white)
![Avahi/Bonjour](https://img.shields.io/badge/Avahi%2FBonjour-333333?logo=apple&logoColor=white)
![Alpine Linux](https://img.shields.io/badge/Alpine_Linux-0D597F?logo=alpinelinux&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)

PHP, WireGuard, Samba, Avahi/Bonjour, Alpine Linux e Docker são marcas
registradas de seus respectivos detentores (The PHP Group; WireGuard é marca
registrada de Jason A. Donenfeld; Samba é marca registrada da Samba Team;
Avahi/Bonjour, Apple Inc.; Alpine Linux, Alpine Linux Development Team;
Docker, Docker Inc.). Uso aqui é apenas informativo, sem qualquer afiliação,
patrocínio ou endosso.

## Instalação

1. Settings → Add-ons → Add-on Store → menu "⋮" → Repositories → adicione a
   URL deste repositório.
2. Instale o add-on "File Manager HD PHP" que aparece na loja.
3. Antes de iniciar, configure pelo menos `disk_labels` (veja abaixo).
4. Inicie o add-on.

## 1. Preparar o disco (uma vez, por disco)

O disco precisa ter um label (rótulo) — é por ele que o add-on encontra e
monta o disco de forma estável entre reinicializações (o nome `/dev/sdX` pode
mudar a cada boot, o label não).

**Pela própria interface do add-on** (recomendado): aba "💽 Discos" → escolhe
o dispositivo → Formatar → define o nome. Já monta sozinho, sem precisar
reiniciar nada.

**Manualmente, via SSH no host**, se preferir formatar por fora:
```bash
lsblk -f                        # identificar a partição
sudo mkfs.ext4 -L HD_EXTERNO /dev/sdX1     # ext4
sudo mkfs.exfat -n HD_EXTERNO /dev/sdX1    # exFAT
sudo mkfs.vfat -F 32 -n HD_EXTERNO /dev/sdX1   # FAT32
```

## 2. Configuração

Tudo abaixo pode ser configurado de duas formas: pela aba "Configuração" do
add-on no HA (como sempre), **ou** direto pela própria interface web em
Configurações → cada seção (Discos, SMB, Time Machine, WireGuard, Sistema) —
salvar ali já grava via API do Supervisor e reinicia o add-on sozinho. Exige
`hassio_api: true` no `config.yaml` (já incluído).

| Opção | O que faz |
|---|---|
| `disk_labels` | Lista de discos a montar. Cada item: `"NOME"` (por label) ou `"uuid:XXXX-YYYY[:Nome Amigável]"` (por UUID — use quando dois discos têm o mesmo label; veja o UUID com `blkid` via SSH) |
| `fs_type` | Tipo de sistema de arquivos a assumir na montagem: `auto`, `ext4`, `ntfs-3g` ou `exfat` |
| `expose_ha_config` | Mostra `/config` (configuração real do HA) dentro do gerenciador — **dá acesso de escrita a `secrets.yaml`**, use com cuidado |
| `expose_addons` | Mostra `/addons` (pasta de outros add-ons locais) dentro do gerenciador |
| `expose_backup` | Mostra `/backup` (seus backups do HA) dentro do gerenciador |
| `expose_addon_configs` | Mostra `/addon_configs` (config privada de outros add-ons) dentro do gerenciador |
| `monitor_enabled` | Liga/desliga o monitor de saúde (espaço em disco + SMART) |
| `monitor_interval_minutes` | Intervalo entre checagens do monitor (5–1440 min) |
| `disk_usage_alert_percent` | A partir de qual % de uso o monitor notifica (50–99%) |
| `time_machine_enabled` | Liga o compartilhamento SMB dedicado ao Time Machine |
| `time_machine_disk` | Disco dedicado ao Time Machine (mesmo formato de `disk_labels`) — fica **inteiro** reservado, não é uma subpasta |
| `time_machine_username` / `time_machine_password` | Credenciais do SMB, **separadas** do login web |
| `time_machine_max_size_gb` | Limite de tamanho do backup (0 = sem limite) |
| `smb_enabled` | Liga o compartilhamento SMB de uso geral (acesso normal aos discos, não o dedicado ao Time Machine) |
| `smb_username` / `smb_password` | Credenciais do SMB de uso geral, **separadas** do login web e das do Time Machine |
| `wg_enabled` | Liga o cliente WireGuard (conecta este addon a um servidor VPN existente) |
| `wg_private_key` | Chave privada do cliente (vem do `.conf` gerado pelo servidor VPN) |
| `wg_address` | IP/máscara deste addon dentro da VPN (ex: `10.96.165.4/24`) |
| `wg_dns` | DNS a usar enquanto a VPN está ativa (opcional) |
| `wg_peer_public_key` | Chave pública do servidor VPN |
| `wg_preshared_key` | Chave pré-compartilhada (opcional, se o servidor exigir) |
| `wg_endpoint` | Endereço do servidor VPN, `host:porta` (ex: `144.22.193.41:51820`) |
| `wg_allowed_ips` | Sub-rede roteada pela VPN. **Deixe em branco** — calculado sozinho como o `/24` de `wg_address`; nunca use `0.0.0.0/0` aqui (tunelaria toda a navegação do host) |
| `wg_persistent_keepalive` | Intervalo de keepalive em segundos (0 desliga) |
| `wg2_*` | Segundo cliente WireGuard, independente do primeiro (outro servidor, outra sub-rede) — mesmos campos acima com prefixo `wg2_` (ex: `wg2_enabled`, `wg2_address`...). Sobe como interface `wg1`, sem afetar o primeiro (`wg0`) |

## 3. Usando

- **Primeiro acesso**: cria o usuário administrador na tela de login.
- **Aba separada** (🔗, topo): abre o app fora do painel do HA, numa porta
  própria — não depende de estar dentro do dashboard.
- **Uso de espaço** (📊): analisa o que está ocupando espaço na pasta atual.
- **Editor** (📝): clique num arquivo → Editar. `Ctrl/Cmd+S` salva sem fechar.
- **Configurações** (⚙️): hub com uma seção por assunto —
  - **Geral**: extensões bloqueadas no upload, teste de notificação.
  - **Discos & Montagem**: lista os discos encontrados agora e edita quais
    montar. Botão à parte pra ver uso de espaço e formatar (lista simples
    primeiro — clique num disco pra expandir o uso dele).
  - **SMB**, **Time Machine**, **WireGuard**: liga/desliga e credenciais de
    cada um, sem precisar sair do app.
  - **Usuários**: cria e remove logins do próprio app (administrador ou só
    leitura) — **não tem relação com as credenciais de SMB ou Time Machine**,
    que continuam com login próprio em cada seção.
  - **Sistema**: monitor de SMART/espaço, pastas extras visíveis
    (`/config`, `/addons`, `/backup`, `/addon_configs`).

### Configurar o Time Machine no Mac

Com `time_machine_enabled: true` e `time_machine_disk` definidos: Ajustes do
macOS → Time Machine → Selecionar Disco — deve aparecer sozinho em alguns
segundos (via Bonjour). Se não aparecer, conecta manualmente pelo Finder → Ir
→ Conectar ao Servidor → `smb://<ip-do-ha>/TimeMachine`.

### Acesso SMB de uso geral

Com `smb_enabled: true`, `smb_username` e `smb_password` definidos, os mesmos
discos visíveis no gerenciador (`disk_labels`) ficam acessíveis por SMB em
`smb://<ip-do-ha>/Arquivos` — útil pra montar como unidade de rede no
Windows/macOS/Linux sem passar pela interface web. Credenciais **separadas**
tanto do login web quanto do Time Machine.

### Cliente WireGuard

Com `wg_enabled: true` e os campos `wg_*` preenchidos com os dados do `.conf`
que o servidor VPN te deu, o addon conecta nele como cliente. Por padrão
(`wg_allowed_ips` em branco) só a sub-rede da VPN é roteada pelo túnel — a
navegação normal do host continua fora da VPN. Verifique a conexão via SSH no
host: `ip addr show wg0` deve mostrar o IP configurado em `wg_address`.

**Segundo cliente (opcional):** preencha os campos `wg2_*` do mesmo jeito,
com os dados de outro servidor VPN — sobe como interface separada `wg1`,
independente da primeira. Verifique com `ip addr show wg1`.

## Atualização

Instalado via repositório GitHub (como este): Settings → Add-ons → Add-on
Store mostra "Atualização disponível" sozinho quando a versão do
`config.yaml` sobe — clique em Atualizar, como qualquer outro add-on. Não há
mais um botão de atualização manual dentro do app.

## Notas de segurança

Transparência sobre o que este add-on pede e por quê:

- **`full_access` + `privileged: SYS_ADMIN`**: necessário pra enxergar `/dev`
  e montar discos — sem isso, nem o `mount()` funciona dentro do container.
- **O servidor roda como root** (não como usuário sem privilégio): o Apache
  se recusa a rodar como root por trava própria dele; trocamos pelo servidor
  embutido do PHP, que não tem essa trava — necessário pra gravar em pastas
  montadas do host (`/config`, discos com donos variados) sem depender de
  quem é o dono real dos arquivos.
- **`host_network: true`**: necessário pro Time Machine (Bonjour/mDNS não
  atravessa a rede isolada do Docker). Efeito colateral: a porta 445 (SMB)
  passa a escutar direto na rede do host — o que também é o que permite o
  compartilhamento SMB de uso geral (`smb_enabled`) funcionar sem mapear porta
  separada.
- **Upload de `.php` não é bloqueado**: os arquivos ficam fora do
  `DocumentRoot` do servidor (no HD externo), então não são executáveis via
  HTTP mesmo enviados — não há rota até lá.
- **Formatação de disco** é protegida contra atingir partições do próprio
  HAOS (`hassos-*`) e swap (`zram*`) — tanto na interface quanto checado de
  novo no backend a cada tentativa, mesmo via requisição direta.
- **`smb_enabled` (SMB de uso geral)**: diferente do Time Machine (só um
  disco dedicado), esse compartilhamento expõe **todos os discos visíveis no
  gerenciador** pela rede local. Mais superfície de acesso do que o Time
  Machine sozinho — considere isso ao decidir a senha e quem tem acesso à
  sua rede local.
- Se você usa **outro add-on que também monta discos** (ex: Samba NAS) com
  automount ligado, ele pode "segurar" um disco antes que você consiga
  formatá-lo por aqui (erro típico: `apparently in use by the system`) —
  desligue o automount dele ou pare o add-on antes de formatar.
- **Proteção CSRF**: toda ação de escrita (criar, apagar, mover, formatar
  disco...) exige um token da sessão atual, gerado no login e verificado a
  cada requisição — impede que outro site consiga disparar essas ações usando
  a sessão de quem está logado.
- **Limite de tentativas de login**: 5 tentativas falhas por IP em 15 minutos
  bloqueiam novas tentativas por um tempo — mitiga força bruta, relevante
  porque o app também fica exposto direto na porta 8099 do host, fora da
  proteção do Ingress do HA.
- **Cookie de sessão** marcado `HttpOnly` (inacessível via JavaScript) e
  `SameSite=Lax` (não é enviado em requisições disparadas por outro site).

## Dados persistentes

Usuários, senhas e configurações do app ficam em `/data` — essa pasta é
própria de cada add-on, sobrevive a atualizações/reinstalações, e **entra no
backup do Home Assistant quando este add-on é selecionado** (backup completo
ou parcial marcando o add-on).
