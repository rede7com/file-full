#!/usr/bin/with-contenv bashio
# ==============================================================================
# Faz bind-mount de /addons/file_full/www (a pasta real do add-on no host,
# acessível graças a "map: - addons:rw") por cima do /var/www/html da imagem.
#
# Por quê: permite que uma atualização (troca de arquivos em www/) passe a
# valer na próxima requisição, sem precisar de Rebuild — só o Dockerfile e
# rootfs/ continuam exigindo rebuild manual (isso é inerente ao Docker, não
# tem como contornar).
#
# Se por qualquer motivo a pasta ao vivo não existir (map ausente, add-on
# renomeado etc.), mantém o conteúdo que já veio copiado na imagem no build
# (COPY www/ no Dockerfile) como fallback — o add-on não quebra por causa disso.
# ==============================================================================

LIVE_SOURCE="/addons/file_full/www"
WEBROOT="/var/www/html"

if [ -d "${LIVE_SOURCE}" ]; then
    if mountpoint -q "${WEBROOT}"; then
        bashio::log.info "Código-fonte ao vivo já montado em ${WEBROOT}"
    else
        mount --bind "${LIVE_SOURCE}" "${WEBROOT}"
        if [ $? -eq 0 ]; then
            bashio::log.info "Código-fonte montado ao vivo a partir de ${LIVE_SOURCE} — atualizações de www/ valem sem rebuild."
        else
            bashio::log.warning "Falha ao montar código-fonte ao vivo. Usando conteúdo estático da imagem (só atualiza com Rebuild)."
        fi
    fi
else
    bashio::log.warning "${LIVE_SOURCE} não encontrado (confira 'map: - addons:rw' no config.yaml). Usando conteúdo estático da imagem."
fi

exit 0
