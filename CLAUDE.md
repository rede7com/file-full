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
│   │   ├── 00-mount-disk.sh        ← monta disk_labels, expõe /config etc (flags)
│   │   ├── 01-bind-live-source.sh  ← bind-mount de /addons/file_full/www sobre /var/www/html
│   │   ├── 02-persist-data.sh      ← migra /data → /addon_configs/file_full (1x)
│   │   └── 03-setup-timemachine.sh ← smb.conf + avahi, monta o disco do TM sozinho
│   └── services.d/        ← processos de longa duração (s6)
│       ├── webserver/     ← php83 -S (não Apache — ver "Decisões" abaixo)
│       ├── monitor/       ← loop de checagem de espaço/SMART, notifica no HA
│       ├── samba/         ← smbd, só ativo se time_machine_enabled
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

- **`www/` é bind-mount ao vivo de `/addons/file_full/www`** (não `COPY` fixo
  no build), graças a `map: - addons:rw`. Mudança em PHP vale na próxima
  requisição, sem rebuild. Dockerfile/rootfs continuam exigindo rebuild
  manual (isso é inerente ao Docker). Fallback: se a pasta ao vivo não
  existir, cai no conteúdo copiado no build (nunca quebra por isso).

- **Dados persistentes ficam em `/addon_configs/file_full`**, não em `/data`.
  `/data` sobrevive a updates mas **não entra no backup do HA**;
  `/addon_configs/<slug>` entra. Chegamos nisso criando a subpasta na mão
  dentro de `all_addon_configs:rw` (a opção oficial `addon_config` conflita
  com `config:rw`, que já usamos pro `/config` real do HA — HA não permite os
  dois juntos no `map:`).

- **BASE_DIR (arquivos gerenciados) fica fora do DocumentRoot** —
  `/mnt/hd_externo`, não dentro de `www/`. Por isso upload de `.php` não é
  bloqueado: não tem rota HTTP até lá, não é executável mesmo enviado.

- **Formatação de disco protege `hassos-*` e `zram*` por padrão** — nunca
  aparecem na lista, backend rejeita mesmo em requisição direta (não confia
  só na UI escondendo). Ver `parse_block_devices()` em `includes/functions.php`.

- **`host_network: true`** existe só por causa do Time Machine — mDNS/Avahi
  não atravessa a rede isolada do Docker. Efeito colateral: porta 445 (SMB)
  escuta direto na rede do host.

- **Time Machine é autossuficiente**: `time_machine_disk` monta o disco
  sozinho, não depende de também estar em `disk_labels` (já causou confusão
  real — usuário configurou só um dos dois campos).

- **Autoatualização tem dois caminhos**: nativo do HA (Update na Add-on
  Store, já que virou repositório git) e um botão dentro do próprio app
  (`update_source_url`, baixa zip HTTPS + checksum `.sha256` opcional +
  backup automático antes de sobrescrever). O segundo existia antes de migrar
  pro GitHub; mantido por decisão do usuário mesmo sabendo do risco.

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
