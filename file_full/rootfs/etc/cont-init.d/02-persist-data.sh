#!/usr/bin/with-contenv bashio
# ==============================================================================
# Garante que /data existe (pasta persistente própria do add-on — sobrevive
# a updates e ENTRA no backup do HA quando este add-on é selecionado no
# backup). /addon_configs/file_full foi tentado antes com base na suposição
# de que entraria no backup automaticamente, mas na prática NÃO entra e os
# dados se perdem numa recuperação — por isso a volta pra /data.
#
# Migração única: se já existirem dados em /addon_configs/file_full de uma
# instalação anterior (versão que usou aquele caminho por engano) e ainda
# não existir nada no novo lugar, copia — assim não é preciso recriar o
# usuário/senha de novo.
# ==============================================================================

NEW_DATA="/data"
OLD_DATA="/addon_configs/file_full"

mkdir -p "${NEW_DATA}"

if [ ! -f "${NEW_DATA}/users.json" ] && [ -f "${OLD_DATA}/users.json" ]; then
    bashio::log.info "Migrando dados persistentes de ${OLD_DATA} para ${NEW_DATA} (agora incluído no backup do HA)..."
    cp -a "${OLD_DATA}/." "${NEW_DATA}/" 2>/dev/null
    bashio::log.info "Migração concluída."
fi

exit 0
