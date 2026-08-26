#!/usr/bin/with-contenv bashio
# ==============================================================================
# SSH real dentro do container: acesso root completo a tudo que o add-on já
# enxerga — os HDs externos (/mnt/file_full), /config (HA de verdade, mesmo
# caminho que expose_ha_config só controla a visibilidade no gerenciador web,
# aqui já vem sempre montado), /share, /backup, /addon_configs.
#
# Só chave pública, nunca senha (PasswordAuthentication no) — o container já
# roda como root com full_access+SYS_ADMIN, então uma senha fraca aqui seria
# o elo mais fraco de tudo. Sem ssh_authorized_key preenchido, sshd nem sobe.
#
# Host keys ficam em /data (persistente, sobrevive a updates/restart do
# add-on) em vez de /etc/ssh — senão trocariam a cada subida do container e
# o cliente reclamaria de "host key changed" toda vez.
# ==============================================================================

if ! bashio::config.true 'ssh_enabled'; then
    bashio::log.info "SSH desativado (ssh_enabled=false)."
    exit 0
fi

AUTHORIZED_KEY=$(bashio::config 'ssh_authorized_key')
if [ -z "${AUTHORIZED_KEY}" ]; then
    bashio::log.error "ssh_authorized_key vazio — SSH não será iniciado (login por senha é proposital desabilitado, root tem acesso total ao container)."
    exit 0
fi

SSH_KEYS_DIR="/data/ssh_host_keys"
mkdir -p "${SSH_KEYS_DIR}"
chmod 700 "${SSH_KEYS_DIR}"

for type in rsa ed25519; do
    key="${SSH_KEYS_DIR}/ssh_host_${type}_key"
    if [ ! -f "${key}" ]; then
        ssh-keygen -t "${type}" -f "${key}" -N "" -q
    fi
done

mkdir -p /root/.ssh
chmod 700 /root/.ssh
printf '%s\n' "${AUTHORIZED_KEY}" > /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

SSH_PORT=$(bashio::config 'ssh_port')

mkdir -p /etc/ssh
cat > /etc/ssh/sshd_config << EOF
Port ${SSH_PORT}
HostKey ${SSH_KEYS_DIR}/ssh_host_rsa_key
HostKey ${SSH_KEYS_DIR}/ssh_host_ed25519_key
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PrintMotd no
Subsystem sftp internal-sftp
EOF

bashio::log.info "SSH configurado na porta ${SSH_PORT} (root, somente chave pública)."
