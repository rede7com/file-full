#!/usr/bin/with-contenv bashio
# ==============================================================================
# WireGuard como servidor "road-warrior restrito": cada cliente só enxerga o
# próprio host (AllowedIPs = 10.44.44.1/32), nunca 0.0.0.0/0 — por isso a
# navegação normal do dispositivo do cliente não passa pelo túnel, só o
# tráfego destinado a este host. wg_allowed_ports fecha, via iptables, quais
# portas do host o túnel pode alcançar (padrão: só o 8123 do HA Core).
# ==============================================================================

PERSIST="/addon_configs/file_full/wireguard"
KEYS="${PERSIST}/keys"
CONFS="${PERSIST}/configs"
WG_SUBNET="10.44.44"
ROOT_MOUNT="/mnt/file_full"

mkdir -p "${KEYS}" "${CONFS}"

if ! bashio::config.true 'wg_enabled'; then
    bashio::log.info "WireGuard desativado (wg_enabled=false)."
    rm -f "${ROOT_MOUNT}/VPN"
    exit 0
fi

WG_PORT=$(bashio::config 'wg_port')
WG_HOST=$(bashio::config 'wg_endpoint_host')
WG_DNS=$(bashio::config 'wg_dns')
WG_PORTS=$(bashio::config 'wg_allowed_ports')

if [ -z "${WG_HOST}" ]; then
    bashio::log.error "wg_endpoint_host vazio — informe seu domínio/IP público. WireGuard não será iniciado."
    exit 0
fi

# --- Chave do servidor (gerada uma vez, persiste em addon_configs) ---
if [ ! -f "${KEYS}/server_priv" ]; then
    wg genkey | tee "${KEYS}/server_priv" | wg pubkey > "${KEYS}/server_pub"
    bashio::log.info "Chave do servidor WireGuard gerada."
fi
SERVER_PRIV=$(cat "${KEYS}/server_priv")
SERVER_PUB=$(cat "${KEYS}/server_pub")

# --- Chaves + IP de cada cliente (índice na lista = último octeto, .2 em diante) ---
mkdir -p /etc/wireguard
{
    echo '[Interface]'
    echo "PrivateKey = ${SERVER_PRIV}"
    echo "Address = ${WG_SUBNET}.1/24"
    echo "ListenPort = ${WG_PORT}"
    echo "PostUp = iptables -N FILE_FULL_WG 2>/dev/null || iptables -F FILE_FULL_WG; iptables -C INPUT -i wg0 -j FILE_FULL_WG 2>/dev/null || iptables -I INPUT -i wg0 -j FILE_FULL_WG;$(for p in $(echo "${WG_PORTS}" | tr ',' ' '); do echo -n " iptables -A FILE_FULL_WG -p tcp --dport ${p} -j ACCEPT;"; done) iptables -A FILE_FULL_WG -j DROP"
    echo "PostDown = iptables -D INPUT -i wg0 -j FILE_FULL_WG 2>/dev/null; iptables -F FILE_FULL_WG 2>/dev/null; iptables -X FILE_FULL_WG 2>/dev/null"
} > /etc/wireguard/wg0.conf

IDX=1
for NAME in $(bashio::config 'wg_client_names|join(",")' | tr ',' ' '); do
    NAME=$(echo "${NAME}" | tr -cd 'a-zA-Z0-9_-')
    [ -z "${NAME}" ] && continue
    IDX=$((IDX + 1))
    IP="${WG_SUBNET}.${IDX}"

    if [ ! -f "${KEYS}/${NAME}_priv" ]; then
        wg genkey | tee "${KEYS}/${NAME}_priv" | wg pubkey > "${KEYS}/${NAME}_pub"
        bashio::log.info "Chave do cliente '${NAME}' gerada (${IP})."
    fi
    CLIENT_PRIV=$(cat "${KEYS}/${NAME}_priv")
    CLIENT_PUB=$(cat "${KEYS}/${NAME}_pub")

    {
        echo "### begin ${NAME} ###"
        echo '[Peer]'
        echo "PublicKey = ${CLIENT_PUB}"
        echo "AllowedIPs = ${IP}/32"
        echo "### end ${NAME} ###"
    } >> /etc/wireguard/wg0.conf

    {
        echo '[Interface]'
        echo "PrivateKey = ${CLIENT_PRIV}"
        echo "Address = ${IP}/32"
        [ -n "${WG_DNS}" ] && echo "DNS = ${WG_DNS}"
        echo
        echo '[Peer]'
        echo "PublicKey = ${SERVER_PUB}"
        echo "Endpoint = ${WG_HOST}:${WG_PORT}"
        # Só o próprio host (via túnel) é roteado — resto do tráfego do
        # cliente segue normal, fora da VPN.
        echo "AllowedIPs = ${WG_SUBNET}.1/32"
        echo "PersistentKeepalive = 25"
    } > "${CONFS}/${NAME}.conf"
done

chmod 600 "${KEYS}"/*_priv 2>/dev/null

# --- Expõe as .conf dos clientes dentro do próprio gerenciador de arquivos ---
if bashio::config.true 'wg_expose_configs'; then
    ln -sfn "${CONFS}" "${ROOT_MOUNT}/VPN"
else
    rm -f "${ROOT_MOUNT}/VPN"
fi

bashio::log.info "WireGuard configurado: porta ${WG_PORT}, ${IDX} chave(s) de cliente pronta(s)."
exit 0
