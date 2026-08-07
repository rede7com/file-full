#!/usr/bin/with-contenv bashio
# ==============================================================================
# Configura o smb.conf pros dois usos possíveis do SMB deste add-on — não são
# mutuamente exclusivos, um container só serve os dois ao mesmo tempo se
# ambos estiverem ligados:
#
#   [Arquivos]    smb_enabled=true    -> acesso "normal" de rede aos mesmos
#                 discos que o gerenciador de arquivos vê (/mnt/file_full,
#                 os discos de disk_labels), pra montar como unidade de rede
#                 no Windows/macOS/Linux sem passar pela interface web.
#   [TimeMachine] time_machine_enabled=true -> compartilhamento dedicado a um
#                 disco inteiro só pra backup do macOS (ver detalhes abaixo).
#
# Se os dois estiverem desligados, nem smb.conf é escrito — o serviço samba
# (services.d/samba/run) fica dormindo nesse caso.
#
# vfs objects = catia fruit streams_xattr + fruit:time machine = yes são as
# extensões da Apple no protocolo SMB2 que fazem o macOS reconhecer o
# compartilhamento do Time Machine como válido pra backup. O anúncio via
# Avahi (mDNS/Bonjour) é o que faz aparecer sozinho em Ajustes > Time Machine,
# sem precisar digitar o endereço manualmente — não se aplica ao [Arquivos],
# que é descoberto do jeito normal (digitando o endereço ou via rede do SO).
#
# force user/group = root em ambos: mesma lógica usada no resto do add-on —
# em vez de tentar casar permissões Unix entre o usuário SMB e o dono real dos
# arquivos no HD (que varia por disco/filesystem), toda escrita via SMB
# acontece como root, sempre com permissão garantida.
# ==============================================================================

ROOT_MOUNT="/mnt/file_full"

SMB_ON=false
TM_ON=false
bashio::config.true 'smb_enabled' && SMB_ON=true
bashio::config.true 'time_machine_enabled' && TM_ON=true

if ! ${SMB_ON} && ! ${TM_ON}; then
    bashio::log.info "SMB desativado (smb_enabled e time_machine_enabled ambos false)."
    exit 0
fi

mkdir -p /etc/samba
cat > /etc/samba/smb.conf << 'EOF'
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
EOF

mkdir -p /etc/avahi/services
rm -f /etc/avahi/services/timemachine.service /etc/avahi/services/smb-shares.service

# --- [Arquivos]: acesso SMB de uso geral, mesmos discos do gerenciador ---
if ${SMB_ON}; then
    SMB_USER=$(bashio::config 'smb_username')
    SMB_PASS=$(bashio::config 'smb_password')

    if [ -z "${SMB_USER}" ] || [ -z "${SMB_PASS}" ]; then
        bashio::log.error "smb_username/smb_password vazios — compartilhamento SMB de uso geral não será iniciado."
    else
        mkdir -p "${ROOT_MOUNT}"
        cat >> /etc/samba/smb.conf << EOF

[Arquivos]
    path = ${ROOT_MOUNT}
    valid users = ${SMB_USER}
    read only = no
    browseable = yes
    force user = root
    force group = root
    vfs objects = catia fruit streams_xattr
EOF
        id -u "${SMB_USER}" >/dev/null 2>&1 || adduser -D -H -s /sbin/nologin "${SMB_USER}"
        ( printf '%s\n%s\n' "${SMB_PASS}" "${SMB_PASS}" ) | smbpasswd -a -s "${SMB_USER}" >/dev/null 2>&1
        smbpasswd -e "${SMB_USER}" >/dev/null 2>&1

        cat > /etc/avahi/services/smb-shares.service << 'AVAHI_EOF'
<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">%h</name>
  <service>
    <type>_smb._tcp</type>
    <port>445</port>
  </service>
</service-group>
AVAHI_EOF

        bashio::log.info "SMB de uso geral configurado: compartilhamento 'Arquivos' (${ROOT_MOUNT}), usuário '${SMB_USER}'."
    fi
fi

# --- [TimeMachine]: disco inteiro dedicado a backup do macOS ---
if ${TM_ON}; then
    TM_RAW=$(bashio::config 'time_machine_disk')
    TM_USER=$(bashio::config 'time_machine_username')
    TM_PASS=$(bashio::config 'time_machine_password')
    TM_MAXSIZE=$(bashio::config 'time_machine_max_size_gb')

    if [ -z "${TM_RAW}" ]; then
        bashio::log.error "time_machine_disk está vazio — informe o nome (label) do disco dedicado na Configuração do add-on."
    elif [ -z "${TM_USER}" ] || [ -z "${TM_PASS}" ]; then
        bashio::log.error "time_machine_username/time_machine_password vazios — Time Machine não será iniciado."
    else
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

        TM_PATH="${ROOT_MOUNT}/${TM_DISK}"
        mkdir -p "${TM_PATH}"

        # Autossuficiente: monta o disco na hora se ainda não estiver (não
        # depende de também estar listado em disk_labels — evita o erro
        # clássico de configurar um só dos dois campos e o Time Machine não
        # subir).
        TM_READY=true
        if ! mountpoint -q "${TM_PATH}" 2>/dev/null; then
            if [ ! -e "${TM_DEVICE}" ]; then
                bashio::log.error "Disco '${TM_DISK}' não encontrado (${TM_DEVICE}). Confira o nome/UUID em time_machine_disk e se o disco está conectado. Time Machine não será iniciado nesta subida."
                TM_READY=false
            else
                mount "${TM_DEVICE}" "${TM_PATH}" 2>&1
                if [ $? -ne 0 ]; then
                    bashio::log.error "Falha ao montar '${TM_DISK}'. Time Machine não será iniciado nesta subida."
                    TM_READY=false
                else
                    bashio::log.info "Disco '${TM_DISK}' montado em ${TM_PATH} para o Time Machine."
                fi
            fi
        fi

        if ${TM_READY}; then
            # Aviso (não bloqueia) se o disco já tiver outra coisa dentro além
            # de um backup de Time Machine pré-existente — sinal de que pode
            # ser um disco de uso geral, não um dedicado, exatamente o que se
            # quer evitar aqui.
            EXISTING_ITEMS=$(find "${TM_PATH}" -mindepth 1 -maxdepth 1 ! -name 'Backups.backupdb' ! -name '*.sparsebundle' -print -quit 2>/dev/null)
            if [ -n "${EXISTING_ITEMS}" ]; then
                bashio::log.warning "'${TM_DISK}' já tem outros arquivos além de um backup do Time Machine — confira se não é um disco de uso geral por engano. Prosseguindo mesmo assim."
            fi

            MAXSIZE_LINE=""
            if [ "${TM_MAXSIZE}" -gt 0 ] 2>/dev/null; then
                MAXSIZE_LINE="    fruit:time machine max size = ${TM_MAXSIZE}G"
            fi

            cat >> /etc/samba/smb.conf << EOF

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

            id -u "${TM_USER}" >/dev/null 2>&1 || adduser -D -H -s /sbin/nologin "${TM_USER}"
            ( printf '%s\n%s\n' "${TM_PASS}" "${TM_PASS}" ) | smbpasswd -a -s "${TM_USER}" >/dev/null 2>&1
            smbpasswd -e "${TM_USER}" >/dev/null 2>&1

            cat > /etc/avahi/services/timemachine.service << 'AVAHI_EOF'
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
AVAHI_EOF

            # Evita duplicar o registro _smb._tcp se o [Arquivos] já publicou
            # um (mesmo tipo de serviço, mesma porta) — o do TimeMachine já
            # cobre isso sozinho, com os registros extras que o Mac espera.
            rm -f /etc/avahi/services/smb-shares.service

            bashio::log.info "Time Machine configurado: disco dedicado '${TM_DISK}', usuário SMB '${TM_USER}'."
            bashio::log.info "No Mac: Ajustes > Time Machine > Selecionar Disco — deve aparecer sozinho em alguns segundos."
        fi
    fi
fi

exit 0
