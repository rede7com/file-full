# File Manager HD PHP — contexto do projeto

Add-on do Home Assistant: gerenciador de arquivos PHP self-contained, funciona
como um NAS básico (múltiplos HDs, Time Machine, SMART, notificações), sem
depender de outros add-ons (decisão explícita do usuário — evitar o add-on
Samba NAS depois de um conflito real de "disco em uso").

Repositório: `https://github.com/rede7com/file-full` (instalado no HA via
Add-on Store → Repositories, não como add-on local).

## Estrutura

```
repository.yaml          ← raiz do repo, identifica como repositório de add-ons
file_full/
├── config.yaml          ← manifest do add-on (options, schema, map, permissões)
├── Dockerfile            ← imagem Alpine + PHP + samba/avahi/smartmontools
├── icon.png / logo.png   ← galeria do HA
├── rootfs/etc/
│   ├── cont-init.d/       ← scripts de boot, em ordem numérica
│   │   ├── 00-mount-disk.sh              ← monta disk_labels, expõe /config etc (flags)
│   │   ├── 01-install-persistent-source.sh ← instala www/ em /addon_configs/file_full, bind-mount sobre /var/www/html
│   │   ├── 02-persist-data.sh            ← migra /data → /addon_configs/file_full (1x)
│   │   └── 03-setup-smb.sh               ← smb.conf + avahi p/ [Arquivos] (smb_enabled) e [TimeMachine] (time_machine_enabled)
│   └── services.d/        ← processos de longa duração (s6)
│       ├── webserver/     ← php83 -S (não Apache — ver "Decisões" abaixo)
│       ├── monitor/       ← loop de checagem de espaço/SMART, notifica no HA
│       ├── samba/         ← smbd, ativo se smb_enabled OU time_machine_enabled
│       └── avahi/         ← avahi-daemon, idem
└── www/                   ← app PHP (index/api/login/includes/assets)
```

## Decisões de arquitetura (o porquê importa mais que o quê)

- **Servidor roda como root, não como usuário sem privilégio.** Apache se
  recusa a rodar como root (trava própria do binário — `AH00526`, não é
  configurável). Trocamos pelo servidor embutido do PHP (`php83 -S`), que não
  tem essa trava. Necessário porque o app grava em pastas montadas do host
  (`/config`, discos externos) cujo dono real varia e nem sempre bate com um
  usuário fixo dentro do container. Tentamos `bindfs` antes (traduzir
  permissão sem mudar dono real) — pacote não existe no Alpine 3.19, por isso
  a solução final é "roda como root" em vez disso.

- **`www/` fica instalado em `/addon_configs/file_full/www`** (bind-mount
  sobre `/var/www/html`), não mais um bind direto de `/addons/file_full/www`.
  O bind direto só funcionava em instalação local (`map: addons` não alcança
  o código clonado numa instalação por repositório git, que é o caso hoje).
  `01-install-persistent-source.sh` compara a versão gravada em
  `/opt/addon_version.txt` (extraída do `config.yaml` em build time, ver
  `Dockerfile`) com um marcador em `/addon_configs/file_full/.installed_version`
  — se mudou, reinstala a partir do conteúdo da imagem; se não mudou, preserva
  o que já está lá (permite editar direto por SSH/File Editor sem perder na
  próxima subida). **Cuidado**: sem o `Dockerfile` gerar `/opt/addon_version.txt`
  de verdade, essa comparação quebra silenciosamente (fica sempre "unknown" e
  nunca mais reinstala) — já aconteceu uma vez, ver "Armadilhas" abaixo.

- **Dados persistentes ficam em `/addon_configs/file_full`**, não em `/data`.
  `/data` sobrevive a updates mas **não entra no backup do HA**;
  `/addon_configs/<slug>` entra. Chegamos nisso criando a subpasta na mão
  dentro de `all_addon_configs:rw` (a opção oficial `addon_config` conflita
  com `config:rw`, que já usamos pro `/config` real do HA — HA não permite os
  dois juntos no `map:`).

- **BASE_DIR (arquivos gerenciados) fica fora do DocumentRoot** —
  `/mnt/file_full`, não dentro de `www/`. Por isso upload de `.php` não é
  bloqueado: não tem rota HTTP até lá, não é executável mesmo enviado.
  (Renomeado de `/mnt/hd_externo` pra `/mnt/file_full` — padrão do nome do add-on.)

- **Formatação de disco protege `hassos-*` e `zram*` por padrão** — nunca
  aparecem na lista, backend rejeita mesmo em requisição direta (não confia
  só na UI escondendo). Ver `parse_block_devices()` em `includes/functions.php`.

- **`host_network: true`** existe só por causa do Time Machine — mDNS/Avahi
  não atravessa a rede isolada do Docker. Efeito colateral: porta 445 (SMB)
  escuta direto na rede do host.

- **Time Machine é autossuficiente**: `time_machine_disk` monta o disco
  sozinho, não depende de também estar em `disk_labels` (já causou confusão
  real — usuário configurou só um dos dois campos).

- **SMB deixou de ser exclusivo do Time Machine.** Antes, `smbd`/`avahi-daemon`
  só ligavam com `time_machine_enabled`, e o `smb.conf` só tinha o
  compartilhamento `[TimeMachine]`. Agora `03-setup-smb.sh` também escreve um
  `[Arquivos]` (`smb_enabled`/`smb_username`/`smb_password`) apontando pro
  mesmo `/mnt/file_full` que o gerenciador de arquivos usa — os dois
  compartilhamentos coexistem (usuários SMB diferentes, mesmo `smb.conf`).
  `samba/run` e `avahi/run` ligam se qualquer um dos dois flags estiver ativo.
  O anúncio Avahi do `[Arquivos]` só publica `_smb._tcp` genérico; os registros
  `_adisk._tcp`/`_device-info._tcp` que fazem o Mac reconhecer como destino de
  Time Machine continuam exclusivos do `[TimeMachine]` (senão qualquer SMB
  apareceria como opção de backup no macOS, o que não faz sentido pro
  `[Arquivos]`).

- **Autoatualização é só a nativa do HA agora** (Update na Add-on Store, já
  que o repo virou git). O botão de atualização manual dentro do próprio app
  existia de quando o projeto ainda não estava hospedado no GitHub — foi
  removido por virar caminho redundante.

## Armadilhas já resolvidas (não repetir)

- **`bindfs` não existe no Alpine 3.19** (main nem community) — não tentar de novo.
- **Formatar disco pode falhar com "apparently in use by the system" mesmo
  sem estar montado** — causa real encontrada: outro add-on (Samba NAS) com
  automount tinha o disco preso, invisível pro host e pro nosso container.
  `unmount_device_and_children()` cobre partição filha montada, mas não cobre
  outro container segurando o device — isso só se resolve parando o outro
  add-on.
- **Job lock do Supervisor** ("Another job is running for job group...") — não
  é bug nosso, é trava do próprio Supervisor após uma operação que não
  terminou limpa. Resolve com restart do Supervisor (`ha supervisor restart`)
  ou reboot do host.
- **`.DS_Store` do macOS volta a aparecer** mesmo com `.gitignore` se já foi
  commitado antes — precisa `git rm -r --cached .` uma vez pra aplicar
  retroativamente.
- **`/opt/addon_version.txt` precisa ser gerado no `Dockerfile`** (`COPY
  config.yaml /opt/config.yaml` + `grep`/`sed` extraindo o campo `version:`).
  Sem isso, `01-install-persistent-source.sh` nunca sabe que uma versão nova
  chegou — comparação sempre "unknown" == "unknown", nunca reinstala depois
  da primeira vez. Já aconteceu (uma sessão separada esqueceu esse passo ao
  criar o mecanismo).
- **Só um script por número em `cont-init.d/`** — já rolou de duas versões
  do "monta o www" coexistirem (`01-bind-live-source.sh` +
  `01-install-persistent-source.sh`), rodando os dois sem erro aparente mas
  com lógica sobreposta/confusa. Se for substituir um script de boot, apagar
  o antigo, não deixar os dois.
- **Subir versão no `config.yaml` a cada mudança** — o usuário já pediu isso
  explicitamente; sem isso nem o Update nativo do HA nem o botão de
  atualização interno detectam que há algo novo. Versão atual: ver
  `config.yaml`, campo `version`.

## Testado vs. não testado

Muita coisa foi validada em sandbox isolado (lint PHP/JS/YAML/bash, testparm
pro smb.conf, XML do avahi validado, lógica de proteção de disco com dados
simulados, fluxo completo de update com servidor HTTPS local) — mas **sem
hardware real de Time Machine** (nunca testado com um Mac de verdade
conectando). Se aparecer algo estranho no fluxo do Time Machine, começar
verificando isso primeiro, não assumir que está 100% validado.

## Convenções de estilo do usuário

- Respostas técnicas em português.
- Prefere que eu confirme fatos específicos de pacote/API antes de implementar
  (já fomos pegos uma vez com `bindfs` inexistente) — testar/validar antes de
  entregar, não só descrever.
- Prefere entender o "porquê" de decisões de segurança/arquitetura, não só o
  "o quê" — as explicações de trade-off (ex: `host_network`, rodar como root)
  foram bem recebidas, manter esse padrão.
