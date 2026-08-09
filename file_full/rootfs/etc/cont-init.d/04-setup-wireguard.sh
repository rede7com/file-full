#!/usr/bin/with-contenv bashio
# ==============================================================================
# Cliente(s) WireGuard: conecta este addon a servidores VPN existentes (ex:
# vpn2). Os campos vêm direto do .conf que o servidor te deu. Suporta até
# dois clientes independentes: o primeiro (wg_*) vira a interface wg0, o
# segundo (wg2_*) vira wg1 — cada um com seu próprio endpoint/sub-rede.
#
# *_allowed_ips por padrão fica em branco -> calculado automaticamente como
# a sub-rede /24 do *_address correspondente (ex: Address=10.96.165.4/24 ->
# AllowedIPs 10.96.165.0/24). NUNCA use 0.0.0.0/0 aqui: isso tunelaria TODO o
# tráfego do host pela VPN, derrubando a navegação normal do HA. Só preencha
# manualmente se souber exatamente o que está fazendo.
# ==============================================================================

setup_wg_client() {
    local prefix="$1"      # "wg" ou "wg2" -> nome das options no config.yaml
    local iface="$2"       # "wg0" ou "wg1" -> interface gerada

    if ! bashio::config.true "${prefix}_enabled"; then
        bashio::log.info "WireGuard ${iface} (${prefix}_enabled=false) desativado."
        return 0
    fi

    local priv addr dns peer_pub psk endpoint allowed keepalive
    priv=$(bashio::config "${prefix}_private_key")
    addr=$(bashio::config "${prefix}_address")
    dns=$(bashio::config "${prefix}_dns")
    peer_pub=$(bashio::config "${prefix}_peer_public_key")
    psk=$(bashio::config "${prefix}_preshared_key")
    endpoint=$(bashio::config "${prefix}_endpoint")
    allowed=$(bashio::config "${prefix}_allowed_ips")
    keepalive=$(bashio::config "${prefix}_persistent_keepalive")

    if [ -z "${priv}" ] || [ -z "${addr}" ] || [ -z "${peer_pub}" ] || [ -z "${endpoint}" ]; then
        bashio::log.error "Campo obrigatório do WireGuard ${iface} vazio (${prefix}_private_key/${prefix}_address/${prefix}_peer_public_key/${prefix}_endpoint). VPN ${iface} não será iniciada."
        return 0
    fi

    # Bloqueia 0.0.0.0/0 por segurança — se vier assim, ignora e calcula o /24.
    if [ -z "${allowed}" ] || [ "${allowed}" = "0.0.0.0/0" ]; then
        local net
        net=$(echo "${addr}" | cut -d'/' -f1 | cut -d'.' -f1-3)
        allowed="${net}.0/24"
        bashio::log.warning "${prefix}_allowed_ips vazio ou 0.0.0.0/0 — usando ${allowed} (evita tunelar toda a navegação do HA)."
    fi

    mkdir -p /etc/wireguard
    {
        echo '[Interface]'
        echo "PrivateKey = ${priv}"
        echo "Address = ${addr}"
        [ -n "${dns}" ] && echo "DNS = ${dns}"
        echo
        echo '[Peer]'
        echo "PublicKey = ${peer_pub}"
        [ -n "${psk}" ] && echo "PresharedKey = ${psk}"
        echo "Endpoint = ${endpoint}"
        echo "AllowedIPs = ${allowed}"
        [ "${keepalive}" -gt 0 ] 2>/dev/null && echo "PersistentKeepalive = ${keepalive}"
    } > "/etc/wireguard/${iface}.conf"
    chmod 600 "/etc/wireguard/${iface}.conf"

    bashio::log.info "WireGuard ${iface} (${prefix}) configurado -> ${endpoint}, AllowedIPs ${allowed}."
}

setup_wg_client "wg" "wg0"
setup_wg_client "wg2" "wg1"

exit 0
