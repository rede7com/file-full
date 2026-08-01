<?php
/**
 * Configurações globais do Gerenciador de Arquivos
 *
 * Ajustado para rodar como add-on do Home Assistant:
 * - BASE_DIR aponta para o HD externo montado pelo add-on (fora do webroot,
 *   então não é acessível por URL direta independente de .htaccess).
 * - DATA_DIR aponta para /addon_configs/file_full — pasta persistente que
 *   TAMBÉM entra no backup do Home Assistant (diferente de /data, que
 *   sobrevive a updates mas fica de fora do backup). A migração de /data
 *   pra cá, se houver dados antigos, acontece no cont-init 02-persist-data.sh.
 */
session_start();

date_default_timezone_set('America/Sao_Paulo');

// Diretório de dados internos (usuários, permissões, cache de miniaturas)
define('DATA_DIR', '/addon_configs/file_full');
define('USERS_FILE', DATA_DIR . '/users.json');
define('PERMISSIONS_FILE', DATA_DIR . '/permissions.json');
define('SETTINGS_FILE', DATA_DIR . '/settings.json');
define('THUMB_CACHE_DIR', DATA_DIR . '/thumbs');

if (!is_dir(DATA_DIR)) {
    mkdir(DATA_DIR, 0755, true);
}
if (!is_dir(THUMB_CACHE_DIR)) {
    mkdir(THUMB_CACHE_DIR, 0755, true);
}

// Diretório raiz onde os arquivos gerenciados ficam armazenados: o HD externo
// montado pelo script 00-mount-disk.sh. Cada disco aparece como subpasta aqui.
define('BASE_DIR', realpath('/mnt/hd_externo'));

// Tamanho máximo de upload por arquivo (ajuste conforme php.ini: upload_max_filesize / post_max_size)
define('MAX_UPLOAD_SIZE', 8 * 1024 * 1024 * 1024); // 8 GB

// Tamanho máximo de arquivo que pode ser aberto no editor de texto embutido
define('MAX_EDIT_SIZE', 5 * 1024 * 1024); // 5 MB

// Extensões de script que nunca podem ser enviadas, mesmo que alguém edite a lista
// de extensões extras pela interface. Vazio de propósito: BASE_DIR fica fora do
// DocumentRoot do Apache (é o HD externo), então um .php enviado aqui não é
// executável via HTTP — não existe rota até essa pasta. Se um dia esse diretório
// passar a ser servido diretamente por algum webserver, reavalie isso.
define('ALWAYS_BLOCKED_EXTENSIONS', []);

// Lista padrão de extensões extras bloqueadas (editável depois pela interface, fica em data/settings.json)
define('DEFAULT_EXTRA_BLOCKED_EXTENSIONS', ['exe', 'bat', 'msi', 'com', 'vbs', 'jar', 'sh']);
