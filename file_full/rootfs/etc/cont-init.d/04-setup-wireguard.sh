#!/usr/bin/with-contenv bashio
# ==============================================================================
# Cliente WireGuard: conecta este addon a um servidor VPN existente (ex:
# vpn2). Os campos abaixo vêm direto do .conf que o servidor te deu.
#
# wg_allowed_ips por padrão fica em branco -> calculado automaticamente como
# a sub-rede /24 de wg_address (ex: Address=10.96.165.4/24 -> AllowedIPs
# 10.96.165.0/24). NUNCA use 0.0.0.0/0 aqui: isso tunelaria TODO o tráfego
# do host pela VPN, derrubando a navegação normal do HA. Só preencha
# wg_allowed_ips manualmente se souber exatamente o que está fazendo.
# ==============================================================================

if ! bashio::config.true 'wg_enabled'; then
    bashio::log.info "WireGuard (cliente) desativado (wg_enabled=false)."
    exit 0
fi

WG_PRIV=$(bashio::config 'wg_private_key')
WG_ADDR=$(bashio::config 'wg_address')
WG_DNS=$(bashio::config 'wg_dns')
WG_PEER_PUB=$(bashio::config 'wg_peer_public_key')
WG_PSK=$(bashio::config 'wg_preshared_key')
WG_ENDPOINT=$(bashio::config 'wg_endpoint')
WG_ALLOWED=$(bashio::config 'wg_allowed_ips')
WG_KEEPALIVE=$(bashio::config 'wg_persistent_keepalive')

for VAR_NAME in WG_PRIV WG_ADDR WG_PEER_PUB WG_ENDPOINT; do
    if [ -z "$(eval echo \$${VAR_NAME})" ]; then
        bashio::log.error "Campo obrigatório do WireGuard vazio (${VAR_NAME}). VPN não será iniciada."
        exit 0
    fi
done

# Bloqueia 0.0.0.0/0 por segurança — se vier assim, ignora e calcula o /24.
if [ -z "${WG_ALLOWED}" ] || [ "${WG_ALLOWED}" = "0.0.0.0/0" ]; then
    NET=$(echo "${WG_ADDR}" | cut -d'/' -f1 | cut -d'.' -f1-3)
    WG_ALLOWED="${NET}.0/24"
    bashio::log.warning "wg_allowed_ips vazio ou 0.0.0.0/0 — usando ${WG_ALLOWED} (evita tunelar toda a navegação do HA)."
fi

mkdir -p /etc/wireguard
{
    echo '[Interface]'
    echo "PrivateKey = ${WG_PRIV}"
    echo "Address = ${WG_ADDR}"
    [ -n "${WG_DNS}" ] && echo "DNS = ${WG_DNS}"
    echo
    echo '[Peer]'
    echo "PublicKey = ${WG_PEER_PUB}"
    [ -n "${WG_PSK}" ] && echo "PresharedKey = ${WG_PSK}"
    echo "Endpoint = ${WG_ENDPOINT}"
    echo "AllowedIPs = ${WG_ALLOWED}"
    [ "${WG_KEEPALIVE}" -gt 0 ] 2>/dev/null && echo "PersistentKeepalive = ${WG_KEEPALIVE}"
} > /etc/wireguard/wg0.conf
chmod 600 /etc/wireguard/wg0.conf

bashio::log.info "WireGuard (cliente) configurado -> ${WG_ENDPOINT}, AllowedIPs ${WG_ALLOWED}."
exit 0
