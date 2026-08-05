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
