<?php
/**
 * Configurações globais do Gerenciador de Arquivos
 *
 * Ajustado para rodar como add-on do Home Assistant:
 * - BASE_DIR aponta para o HD externo montado pelo add-on (fora do webroot,
 *   então não é acessível por URL direta independente de .htaccess).
 * - DATA_DIR aponta para /data — pasta persistente própria do add-on, que
 *   entra no backup do HA quando este add-on é selecionado no backup
 *   (diferente de /addon_configs, que NÃO entra automaticamente e se perde
 *   numa recuperação). A migração de /addon_configs pra cá, se houver dados
 *   de uma versão anterior, acontece no cont-init 02-persist-data.sh.
 */
// httponly evita acesso ao cookie de sessão via JS (mitiga roubo por XSS);
// samesite=Lax evita que o cookie seja enviado em requisições disparadas por
// outro site (mitiga CSRF básico). Precisa vir antes de session_start().
// Sem 'secure' de propósito: o app roda tanto atrás do Ingress quanto direto
// na porta 8099 do host, ambos tipicamente em HTTP na rede local — marcar
// 'secure' aqui quebraria o login nesse cenário comum.
session_set_cookie_params([
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_start();

// Token CSRF da sessão atual: todo POST em api.php exige esse valor no header
// X-CSRF-Token (ver api.php e assets/js/app.js). Gerado uma vez por sessão e
// reaproveitado — não precisa girar a cada requisição.
if (empty($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
}
define('CSRF_TOKEN', $_SESSION['csrf']);

date_default_timezone_set('America/Sao_Paulo');

// Diretório de dados internos (usuários, permissões, cache de miniaturas)
define('DATA_DIR', '/data');
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
define('BASE_DIR', realpath('/mnt/file_full'));

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

// Paginação da listagem de pastas: evita estatar (tamanho, data, permissões)
// milhares de arquivos de uma vez numa pasta grande — só a página pedida paga
// esse custo (ver o action 'list' em api.php). LIST_MAX_PAGE_SIZE também
// funciona como teto contra um ?limit= absurdo vindo do cliente.
define('LIST_DEFAULT_PAGE_SIZE', 500);
define('LIST_MAX_PAGE_SIZE', 2000);
