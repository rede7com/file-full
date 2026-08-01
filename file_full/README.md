# File Manager HD PHP

Gerenciador de arquivos self-contained pra Home Assistant: monta HDs externos,
dá acesso opcional às pastas do próprio HA (`/config`, `/backup`, `/addons`...),
e funciona como um NAS básico — sem depender de nenhum outro add-on.

Acesso pela sidebar do HA (Ingress), autenticado pela sua própria sessão do HA.

## Recursos

- Navegação de arquivos com upload (até 8GB por arquivo), download, zip/unzip,
  renomear, mover, copiar, exclusão
- Editor de texto embutido (edita qualquer arquivo direto pelo navegador)
- Múltiplos discos simultâneos, identificados por label ou por UUID
- Formatação de disco guiada (ext4/exFAT/FAT32), com proteção automática
  contra formatar partições do próprio sistema do HAOS (e swap/zram)
- Monitoramento de saúde S.M.A.R.T. e uso de espaço por disco
- Notificações no próprio painel do HA (disco cheio, falha de SMART)
- Dois papéis de usuário: administrador (leitura/escrita) e visualizador
  (só leitura)
- Time Machine do macOS via SMB (compartilhamento dedicado, com anúncio
  automático na rede via Bonjour/mDNS)
- Atualização integrada, sem precisar copiar arquivo manualmente depois da
  primeira instalação

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
| `update_source_url` | URL `https://` de um pacote de atualização (veja "Atualização" abaixo) |
| `time_machine_enabled` | Liga o compartilhamento SMB dedicado ao Time Machine |
| `time_machine_disk` | Disco dedicado ao Time Machine (mesmo formato de `disk_labels`) — fica **inteiro** reservado, não é uma subpasta |
| `time_machine_username` / `time_machine_password` | Credenciais do SMB, **separadas** do login web |
| `time_machine_max_size_gb` | Limite de tamanho do backup (0 = sem limite) |

## 3. Usando

- **Primeiro acesso**: cria o usuário administrador na tela de login.
- **Discos** (💽, aba admin): listar, formatar, checar SMART e uso de espaço.
- **Uso de espaço** (📊): analisa o que está ocupando espaço na pasta atual.
- **Editor** (📝): clique num arquivo → Editar. `Ctrl/Cmd+S` salva sem fechar.
- **Configurações** (⚙️): extensões bloqueadas no upload, teste de notificação,
  status do Time Machine.
- **Atualização** (🔄): confere e aplica atualizações (veja abaixo).

### Configurar o Time Machine no Mac

Com `time_machine_enabled: true` e `time_machine_disk` definidos: Ajustes do
macOS → Time Machine → Selecionar Disco — deve aparecer sozinho em alguns
segundos (via Bonjour). Se não aparecer, conecta manualmente pelo Finder → Ir
→ Conectar ao Servidor → `smb://<ip-do-ha>/TimeMachine`.

## Atualização

Duas formas, conforme como você instalou:

- **Instalado via repositório GitHub** (como este): Settings → Add-ons →
  Add-on Store mostra "Atualização disponível" sozinho quando a versão do
  `config.yaml` sobe — clique em Atualizar, como qualquer outro add-on.
- **Botão "🔄 Atualização" dentro do próprio app**: baixa e aplica um pacote
  de `update_source_url` (checksum `.sha256` opcional, mas conferido se
  existir). Mudanças em `www/` valem na hora, sem rebuild; mudanças no
  `Dockerfile`/`rootfs/` ainda pedem um Rebuild manual depois.

## Notas de segurança

Transparência sobre o que este add-on pede e por quê:

- **`full_access` + `privileged: SYS_ADMIN`**: necessário pra enxergar `/dev`
  e montar discos — sem isso, nem o `mount()` funciona dentro do container.
- **O servidor roda como root** (não como usuário sem privilégio): o Apache
  se recusa a rodar como root por trava própria dele; trocamos pelo servidor
  embutido do PHP, que não tem essa trava — necessário pra gravar em pastas
  montadas do host (`/config`, discos com donos variados) sem depender de
  quem é o dono real dos arquivos.
- **`host_network: true`**: necessário só pro Time Machine (Bonjour/mDNS não
  atravessa a rede isolada do Docker). Efeito colateral: a porta 445 (SMB)
  passa a escutar direto na rede do host.
- **Upload de `.php` não é bloqueado**: os arquivos ficam fora do
  `DocumentRoot` do servidor (no HD externo), então não são executáveis via
  HTTP mesmo enviados — não há rota até lá.
- **Formatação de disco** é protegida contra atingir partições do próprio
  HAOS (`hassos-*`) e swap (`zram*`) — tanto na interface quanto checado de
  novo no backend a cada tentativa, mesmo via requisição direta.
- Se você usa **outro add-on que também monta discos** (ex: Samba NAS) com
  automount ligado, ele pode "segurar" um disco antes que você consiga
  formatá-lo por aqui (erro típico: `apparently in use by the system`) —
  desligue o automount dele ou pare o add-on antes de formatar.

## Dados persistentes

Usuários, senhas e configurações do app ficam em `/addon_configs/file_full`
— essa pasta **entra no backup do Home Assistant** e sobrevive a atualizações
e reinstalações (diferente de `/data`, que é só cache local).
