#!/usr/bin/with-contenv bashio
# ==============================================================================
# Garante que /addon_configs/file_full existe (pasta persistente que também
# entra no backup do Home Assistant — diferente de /data, que sobrevive a
# updates mas fica de fora do backup).
#
# Migração única: se já existirem dados em /data de uma instalação anterior
# (versões antigas deste add-on usavam /data) e ainda não existir nada no
# novo lugar, copia — assim não é preciso recriar o usuário/senha de novo.
# ==============================================================================

NEW_DATA="/addon_configs/file_full"
OLD_DATA="/data"

mkdir -p "${NEW_DATA}"

if [ ! -f "${NEW_DATA}/users.json" ] && [ -f "${OLD_DATA}/users.json" ]; then
    bashio::log.info "Migrando dados persistentes de ${OLD_DATA} para ${NEW_DATA} (agora incluído no backup do HA)..."
    cp -a "${OLD_DATA}/." "${NEW_DATA}/" 2>/dev/null
    bashio::log.info "Migração concluída."
fi

exit 0
