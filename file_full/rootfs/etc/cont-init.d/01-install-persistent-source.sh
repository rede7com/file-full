#!/usr/bin/with-contenv bashio
# ==============================================================================
# O código do app (www/) fica instalado em /addon_configs/file_full/www —
# pasta persistente independente de como o add-on foi instalado (local ou
# repositório git). O truque antigo (bind-mount direto de /addons/file_full)
# só funcionava pra instalação local; numa instalação por repositório o
# Supervisor clona o código num lugar interno diferente, fora de /addons, e
# aquele truque parava de fazer efeito silenciosamente.
#
# Comparando a versão gravada na imagem (/opt/addon_version.txt, extraída do
# config.yaml no build) com a versão já instalada em /addon_configs (guardada
# num arquivo marcador): se mudou, re-semeia a partir do conteúdo da imagem
# antes de montar — é o que faz uma atualização via git+Rebuild realmente
# valer. Se não mudou, mantém o que já está lá — permite editar arquivos
# direto em /addon_configs/file_full/www (SSH, File Editor) sem que a próxima
# subida do container desfaça a edição.
# ==============================================================================

PERSIST_WWW="/addon_configs/file_full/www"
WEBROOT="/var/www/html"
MARKER="/addon_configs/file_full/.installed_version"
IMAGE_VERSION=$(cat /opt/addon_version.txt 2>/dev/null || echo "unknown")
INSTALLED_VERSION=$(cat "${MARKER}" 2>/dev/null || echo "")

mkdir -p "$(dirname "${PERSIST_WWW}")"

if [ "${INSTALLED_VERSION}" != "${IMAGE_VERSION}" ]; then
    bashio::log.info "Instalando código em ${PERSIST_WWW} (versão '${INSTALLED_VERSION:-nenhuma}' -> '${IMAGE_VERSION}')..."
    rm -rf "${PERSIST_WWW}"
    mkdir -p "${PERSIST_WWW}"
    cp -a "${WEBROOT}/." "${PERSIST_WWW}/"
    echo "${IMAGE_VERSION}" > "${MARKER}"
    bashio::log.info "Código instalado."
else
    bashio::log.info "Código em ${PERSIST_WWW} já está na versão '${IMAGE_VERSION}' — mantendo como está (edições manuais, se houver, preservadas)."
fi

if mountpoint -q "${WEBROOT}"; then
    bashio::log.info "Webroot já montado em ${WEBROOT}"
else
    mount --bind "${PERSIST_WWW}" "${WEBROOT}"
    if [ $? -eq 0 ]; then
        bashio::log.info "Webroot montado a partir de ${PERSIST_WWW}."
    else
        bashio::log.warning "Falha ao montar ${PERSIST_WWW} sobre ${WEBROOT}. Usando conteúdo estático da imagem."
    fi
fi

exit 0
