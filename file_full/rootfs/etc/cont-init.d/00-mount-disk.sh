#!/usr/bin/with-contenv bashio
# ==============================================================================
# Monta um ou mais HDs externos por LABEL antes do servidor PHP subir.
# Cada disco é montado em /mnt/hd_externo/<label>, de forma que todos
# aparecem como subpastas dentro da raiz vista pelo gerenciador de arquivos.
#
# Filosofia: nada aqui derruba o container inteiro. Se um disco falhar (ou
# nenhum estiver configurado), o add-on ainda sobe com o que der certo —
# só /config, por exemplo, se for só isso que estiver disponível/ligado. Cada
# problema fica registrado no log, mas não trava o resto.
# ==============================================================================

ROOT_MOUNT="/mnt/hd_externo"
FS_TYPE=$(bashio::config 'fs_type')
MOUNTED_ANY_DISK=0

mkdir -p "${ROOT_MOUNT}"

DISK_COUNT=$(bashio::config 'disk_labels|length')

if [ "${DISK_COUNT}" -eq 0 ]; then
    bashio::log.warning "Nenhum disk_label configurado — seguindo sem HD (só o que estiver ligado em Configuração, tipo /config, vai aparecer)."
else
    for idx in $(seq 0 $((DISK_COUNT - 1))); do
        RAW_ENTRY=$(bashio::config "disk_labels[${idx}]")

        # Formato aceito: "NOME" (por label, como sempre) ou
        # "uuid:XXXX-YYYY[:nome_amigavel]" (por UUID, útil quando dois discos
        # têm o mesmo label — o Linux não garante qual dos dois vence em
        # /dev/disk/by-label/ nesse caso, mas UUID é sempre único por disco).
        if [[ "${RAW_ENTRY}" == uuid:* ]]; then
            REST="${RAW_ENTRY#uuid:}"
            DISK_UUID="${REST%%:*}"
            if [[ "${REST}" == *:* ]]; then
                FRIENDLY_NAME="${REST#*:}"
            else
                FRIENDLY_NAME="${DISK_UUID}"
            fi
            DEVICE="/dev/disk/by-uuid/${DISK_UUID}"
            DISK_LABEL="${FRIENDLY_NAME}"
            IDENT_DESC="UUID ${DISK_UUID}"
        else
            DISK_LABEL="${RAW_ENTRY}"
            DEVICE="/dev/disk/by-label/${DISK_LABEL}"
            IDENT_DESC="label '${DISK_LABEL}'"
        fi

        MOUNT_POINT="${ROOT_MOUNT}/${DISK_LABEL}"

        mkdir -p "${MOUNT_POINT}"

        if mountpoint -q "${MOUNT_POINT}"; then
            bashio::log.info "Disco '${DISK_LABEL}' já montado em ${MOUNT_POINT}"
            MOUNTED_ANY_DISK=1
            continue
        fi

        # Aguarda o dispositivo aparecer (útil logo após o boot do host)
        for i in $(seq 1 15); do
            if [ -e "${DEVICE}" ]; then
                break
            fi
            bashio::log.info "Aguardando disco com ${IDENT_DESC}... (${i}/15)"
            sleep 2
        done

        if [ ! -e "${DEVICE}" ]; then
            bashio::log.error "Disco com ${IDENT_DESC} não encontrado — seguindo sem ele."
            bashio::log.error "Dispositivos disponíveis por label:"
            ls -la /dev/disk/by-label/ 2>/dev/null || bashio::log.error "  (nenhum)"
            bashio::log.error "Dispositivos disponíveis por UUID:"
            ls -la /dev/disk/by-uuid/ 2>/dev/null || bashio::log.error "  (nenhum)"
            bashio::log.error "Dica: rotule a partição no host, ex.: e2label /dev/sdX1 ${DISK_LABEL}"
            continue
        fi

        bashio::log.info "Montando ${DEVICE} em ${MOUNT_POINT} (fs=${FS_TYPE})..."

        if [ "${FS_TYPE}" = "auto" ]; then
            mount "${DEVICE}" "${MOUNT_POINT}"
        else
            mount -t "${FS_TYPE}" -o rw "${DEVICE}" "${MOUNT_POINT}"
        fi

        if [ $? -eq 0 ]; then
            bashio::log.info "Disco '${DISK_LABEL}' montado com sucesso em ${MOUNT_POINT}"
            MOUNTED_ANY_DISK=1
        else
            bashio::log.error "Falha ao montar '${DISK_LABEL}'. Verifique o tipo de sistema de arquivos — seguindo sem ele."
        fi
    done
fi

# ------------------------------------------------------------------------------
# Expõe pastas extras do HA dentro da raiz visível pelo gerenciador de
# arquivos, cada uma só se a respectiva flag estiver ligada (todas desligadas
# por padrão). Cada pasta já está disponível dentro do container graças ao
# "map:" no config.yaml; aqui só decidimos se fica visível junto dos HDs.
# ------------------------------------------------------------------------------
expose_optional_mount() {
    local flag_name="$1"
    local source_path="$2"
    local visible_name="$3"
    local warning_msg="$4"
    local target="${ROOT_MOUNT}/${visible_name}"

    if bashio::config.true "${flag_name}"; then
        mkdir -p "${target}"
        if mountpoint -q "${target}"; then
            bashio::log.info "Pasta '${visible_name}' já exposta em ${target}"
        else
            bashio::log.warning "${flag_name} ativado: expondo ${source_path} em ${target}"
            [ -n "${warning_msg}" ] && bashio::log.warning "${warning_msg}"
            mount --bind "${source_path}" "${target}"
            if [ $? -ne 0 ]; then
                bashio::log.error "Falha ao expor ${source_path}. Verifique se '${flag_name}' tem o map: correspondente no config.yaml e refaça o rebuild do add-on."
            fi
        fi
    else
        if mountpoint -q "${target}" 2>/dev/null; then
            bashio::log.info "${flag_name} desativado: removendo exposição de '${visible_name}'"
            umount "${target}"
        fi
    fi
}

expose_optional_mount "expose_ha_config" "/config" "config" \
    "Cuidado: isso dá acesso de escrita a secrets.yaml e outros arquivos sensíveis do HA pelo gerenciador de arquivos!"

expose_optional_mount "expose_addons" "/addons" "addons" \
    "Cuidado: isso permite ler e alterar os arquivos de outros add-ons instalados."

expose_optional_mount "expose_backup" "/backup" "backup" \
    "Cuidado: isso dá acesso de escrita aos seus backups do HA — apagar ou corromper um backup aqui compromete a recuperação em caso de desastre."

expose_optional_mount "expose_addon_configs" "/addon_configs" "addon_configs" \
    "Cuidado: isso expõe as pastas de configuração privadas de outros add-ons instalados (podem conter tokens e senhas de outros serviços)."

# ------------------------------------------------------------------------------
# upload_tmp_dir decidido agora, em tempo de execução: só aponta pro HD se
# algum disco realmente montou. Sem isso, um upload grande cairia no
# armazenamento interno do container (pequeno) sem avisar.
# ------------------------------------------------------------------------------
UPLOAD_TMP_INI="/etc/php83/conf.d/99-upload-tmp-dir.ini"

if [ "${MOUNTED_ANY_DISK}" -eq 1 ]; then
    echo "upload_tmp_dir = ${ROOT_MOUNT}" > "${UPLOAD_TMP_INI}"
    bashio::log.info "upload_tmp_dir apontado para ${ROOT_MOUNT} (disco disponível)"
else
    rm -f "${UPLOAD_TMP_INI}"
    bashio::log.warning "Nenhum disco montado — uploads grandes vão usar o armazenamento interno do container (limitado) até algum disco ficar disponível."
fi

exit 0
