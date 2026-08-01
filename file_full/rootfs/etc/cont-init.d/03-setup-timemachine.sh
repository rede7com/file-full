#!/usr/bin/with-contenv bashio
# ==============================================================================
# Configura um compartilhamento SMB mínimo, específico pro Time Machine do
# macOS (não é um servidor SMB genérico — só esse disco, só esse propósito).
#
# time_machine_disk identifica o disco pelo label (mesmo formato aceito em
# disk_labels, incluindo "uuid:XXXX-YYYY[:nome]") — mas NÃO precisa também
# estar em disk_labels: este script monta o disco sozinho se ainda não
# estiver montado, é autossuficiente. O disco INTEIRO vira o destino do Time
# Machine, não uma subpasta dentro de um disco de uso geral — de propósito,
# pra não misturar backup do Mac com arquivos comuns.
#
# vfs objects = catia fruit streams_xattr + fruit:time machine = yes são as
# extensões da Apple no protocolo SMB2 que fazem o macOS reconhecer o
# compartilhamento como válido pra backup. O anúncio via Avahi (mDNS/Bonjour)
# é o que faz aparecer sozinho em Ajustes > Time Machine, sem precisar
# digitar o endereço manualmente.
#
# force user/group = root: mesma lógica usada no resto do add-on — em vez de
# tentar casar permissões Unix entre o usuário SMB e o dono real dos arquivos
# no HD (que varia por disco/filesystem), toda escrita via SMB acontece como
# root, sempre com permissão garantida.
# ==============================================================================

if ! bashio::config.true 'time_machine_enabled'; then
    bashio::log.info "Time Machine desativado (time_machine_enabled=false)."
    exit 0
fi

TM_RAW=$(bashio::config 'time_machine_disk')
TM_USER=$(bashio::config 'time_machine_username')
TM_PASS=$(bashio::config 'time_machine_password')
TM_MAXSIZE=$(bashio::config 'time_machine_max_size_gb')

if [ -z "${TM_RAW}" ]; then
    bashio::log.error "time_machine_disk está vazio — informe o nome (label) do disco dedicado na Configuração do add-on."
    exit 0
fi
if [ -z "${TM_USER}" ] || [ -z "${TM_PASS}" ]; then
    bashio::log.error "time_machine_username/time_machine_password vazios — Time Machine não será iniciado."
    exit 0
fi

# Mesmo parsing usado em disk_labels: "NOME" ou "uuid:XXXX-YYYY[:nome_amigavel]"
if [[ "${TM_RAW}" == uuid:* ]]; then
    REST="${TM_RAW#uuid:}"
    TM_UUID="${REST%%:*}"
    if [[ "${REST}" == *:* ]]; then
        TM_DISK="${REST#*:}"
    else
        TM_DISK="${TM_UUID}"
    fi
    TM_DEVICE="/dev/disk/by-uuid/${TM_UUID}"
else
    TM_DISK="${TM_RAW}"
    TM_DEVICE="/dev/disk/by-label/${TM_DISK}"
fi

TM_PATH="/mnt/hd_externo/${TM_DISK}"
mkdir -p "${TM_PATH}"

# Autossuficiente: monta o disco na hora se ainda não estiver (não depende
# de também estar listado em disk_labels — evita o erro clássico de
# configurar um só dos dois campos e o Time Machine não subir).
if ! mountpoint -q "${TM_PATH}" 2>/dev/null; then
    if [ ! -e "${TM_DEVICE}" ]; then
        bashio::log.error "Disco '${TM_DISK}' não encontrado (${TM_DEVICE}). Confira o nome/UUID em time_machine_disk e se o disco está conectado. Time Machine não será iniciado nesta subida."
        exit 0
    fi
    mount "${TM_DEVICE}" "${TM_PATH}" 2>&1
    if [ $? -ne 0 ]; then
        bashio::log.error "Falha ao montar '${TM_DISK}'. Time Machine não será iniciado nesta subida."
        exit 0
    fi
    bashio::log.info "Disco '${TM_DISK}' montado em ${TM_PATH} para o Time Machine."
fi

# Aviso (não bloqueia) se o disco já tiver outra coisa dentro além de um
# backup de Time Machine pré-existente — sinal de que pode ser um disco de
# uso geral, não um dedicado, exatamente o que se quer evitar aqui.
EXISTING_ITEMS=$(find "${TM_PATH}" -mindepth 1 -maxdepth 1 ! -name 'Backups.backupdb' ! -name '*.sparsebundle' 2>/dev/null | head -1)
if [ -n "${EXISTING_ITEMS}" ]; then
    bashio::log.warning "'${TM_DISK}' já tem outros arquivos além de um backup do Time Machine — confira se não é um disco de uso geral por engano. Prosseguindo mesmo assim."
fi

# --- smb.conf ---
MAXSIZE_LINE=""
if [ "${TM_MAXSIZE}" -gt 0 ] 2>/dev/null; then
    MAXSIZE_LINE="    fruit:time machine max size = ${TM_MAXSIZE}G"
fi

mkdir -p /etc/samba
cat > /etc/samba/smb.conf << EOF
[global]
    server min protocol = SMB2
    server max protocol = SMB3
    workgroup = WORKGROUP
    security = user
    map to guest = never
    server string = File Manager HD PHP
    log level = 1
    load printers = no
    printcap name = /dev/null
    disable spoolss = yes
    multicast dns register = no
    fruit:aapl = yes
    fruit:nfs_aces = no

[TimeMachine]
    path = ${TM_PATH}
    valid users = ${TM_USER}
    read only = no
    browseable = yes
    force user = root
    force group = root
    vfs objects = catia fruit streams_xattr
    fruit:time machine = yes
${MAXSIZE_LINE}
EOF

# --- usuário do SMB (separado do login web, exclusivo pra isso) ---
id -u "${TM_USER}" >/dev/null 2>&1 || adduser -D -H -s /sbin/nologin "${TM_USER}"
( printf '%s\n%s\n' "${TM_PASS}" "${TM_PASS}" ) | smbpasswd -a -s "${TM_USER}" >/dev/null 2>&1
smbpasswd -e "${TM_USER}" >/dev/null 2>&1

# --- anúncio via Avahi (mDNS/Bonjour), pro Mac achar sozinho ---
mkdir -p /etc/avahi/services
cat > /etc/avahi/services/timemachine.service << EOF
<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">%h</name>
  <service>
    <type>_smb._tcp</type>
    <port>445</port>
  </service>
  <service>
    <type>_device-info._tcp</type>
    <port>0</port>
    <txt-record>model=TimeCapsule8,119</txt-record>
  </service>
  <service>
    <type>_adisk._tcp</type>
    <port>9</port>
    <txt-record>dk0=adVN=TimeMachine,adVF=0x82</txt-record>
    <txt-record>sys=waMa=0,adVF=0x100</txt-record>
  </service>
</service-group>
EOF

bashio::log.info "Time Machine configurado: disco dedicado '${TM_DISK}', usuário SMB '${TM_USER}'."
bashio::log.info "No Mac: Ajustes > Time Machine > Selecionar Disco — deve aparecer sozinho em alguns segundos."

exit 0
