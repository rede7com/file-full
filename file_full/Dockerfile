ARG BUILD_FROM
FROM $BUILD_FROM

# PHP (com zip e gd, exigidos pelo app: compactar/descompactar/baixar pastas
# e gerar miniaturas de imagem) + ferramentas de sistema de arquivos pro HD
# externo. Sem Apache de propósito — ver comentário abaixo.
RUN apk add --no-cache \
    php83 \
    php83-json \
    php83-session \
    php83-fileinfo \
    php83-mbstring \
    php83-zip \
    php83-gd \
    php83-curl \
    ntfs-3g \
    exfatprogs \
    e2fsprogs \
    dosfstools \
    smartmontools \
    util-linux \
    eudev \
    curl \
    samba \
    avahi

# Avahi normalmente precisa de dbus pra funcionar, mas isso significaria mais
# um serviço rodando no container — enable-dbus=no deixa ele operar sozinho,
# padrão comum em containers (evita a dependência inteira). Cobrindo os
# formatos possíveis do arquivo padrão do pacote: linha comentada
# (#enable-dbus=yes, o mais comum), já descomentada, ou nem a seção
# [server] existe ainda.
RUN if grep -q '^#\?enable-dbus=' /etc/avahi/avahi-daemon.conf 2>/dev/null; then \
      sed -i 's/^#\?enable-dbus=.*/enable-dbus=no/' /etc/avahi/avahi-daemon.conf; \
    elif grep -q '^\[server\]' /etc/avahi/avahi-daemon.conf 2>/dev/null; then \
      sed -i '/^\[server\]/a enable-dbus=no' /etc/avahi/avahi-daemon.conf; \
    else \
      printf '[server]\nenable-dbus=no\n' >> /etc/avahi/avahi-daemon.conf; \
    fi

# O app permite upload de até 8GB por arquivo. post_max_size fica um pouco
# acima de upload_max_filesize de propósito: o corpo da requisição multipart
# inclui mais que só o arquivo (boundaries, outros campos), então se os dois
# forem iguais um upload no limite exato falha silenciosamente.
# upload_tmp_dir NÃO é fixado aqui (é decidido em tempo de execução, dentro
# de 00-mount-disk.sh) — em build time não dá pra saber se algum disco vai
# montar de verdade; apontar cegamente pro HD e ele não existir faz uploads
# grandes caírem no armazenamento interno do container, que é pequeno.
RUN { \
      echo 'upload_max_filesize = 8G'; \
      echo 'post_max_size = 8200M'; \
      echo 'max_file_uploads = 50'; \
      echo 'memory_limit = 1024M'; \
      echo 'max_execution_time = 3600'; \
      echo 'max_input_time = 3600'; \
    } > /etc/php83/conf.d/99-file-full.ini

COPY rootfs /
COPY www/ /var/www/html/
COPY config.yaml /opt/config.yaml

# 01-install-persistent-source.sh compara essa versão (gravada na imagem, na
# hora do build) com a que já está instalada em /addon_configs/file_full pra
# saber se precisa reinstalar o código depois de um update. Sem isso, ele
# nunca saberia que uma nova versão chegou.
RUN grep '^version:' /opt/config.yaml | sed -E 's/version:[[:space:]]*"?([^"]*)"?/\1/' > /opt/addon_version.txt \
    && cat /opt/addon_version.txt

RUN chmod a+x /etc/cont-init.d/00-mount-disk.sh \
    && chmod a+x /etc/cont-init.d/01-install-persistent-source.sh \
    && chmod a+x /etc/cont-init.d/02-persist-data.sh \
    && chmod a+x /etc/cont-init.d/03-setup-smb.sh \
    && chmod a+x /etc/services.d/webserver/run \
    && chmod a+x /etc/services.d/webserver/finish \
    && chmod a+x /etc/services.d/monitor/run \
    && chmod a+x /etc/services.d/monitor/finish \
    && chmod a+x /etc/services.d/samba/run \
    && chmod a+x /etc/services.d/samba/finish \
    && chmod a+x /etc/services.d/avahi/run \
    && chmod a+x /etc/services.d/avahi/finish
