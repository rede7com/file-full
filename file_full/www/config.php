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
//
// 'secure' é decidido em tempo de execução: marcado só quando a requisição
// chega de fato por HTTPS. O caso comum (Ingress do HA falando HTTP com o
// container, ou acesso direto à porta 8099 na rede local) continua sem a
// flag — marcá-la ali quebraria o login. Se um dia o app for servido por TLS
// direto, a flag passa a valer sozinha, sem precisar mexer aqui.
$__isHttps = (!empty($_SERVER['HTTPS']) && strtolower($_SERVER['HTTPS']) !== 'off')
    || (int) ($_SERVER['SERVER_PORT'] ?? 0) === 443;

session_set_cookie_params([
    'httponly' => true,
    'samesite' => 'Lax',
    'secure' => $__isHttps,
]);
session_start();

// Token CSRF da sessão atual: todo POST em api.php exige esse valor no header
// X-CSRF-Token (ver api.php e assets/js/app.js). Gerado uma vez por sessão e
// reaproveitado — não precisa girar a cada requisição.
if (empty($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
}
define('CSRF_TOKEN', $_SESSION['csrf']);

// Nonce da Content-Security-Policy: gerado a cada requisição e usado tanto no
// header quanto no atributo nonce= do único <script> inline do index.php. É o
// que permite manter script-src sem 'unsafe-inline' — um script injetado por
// XSS não conhece o nonce deste request e simplesmente não executa.
define('CSP_NONCE', base64_encode(random_bytes(16)));

date_default_timezone_set('America/Sao_Paulo');

// Diretório de dados internos (usuários, permissões, cache de miniaturas)
define('DATA_DIR', '/data');
define('USERS_FILE', DATA_DIR . '/users.json');
define('PERMISSIONS_FILE', DATA_DIR . '/permissions.json');
define('SETTINGS_FILE', DATA_DIR . '/settings.json');
define('THUMB_CACHE_DIR', DATA_DIR . '/thumbs');
define('SHARES_FILE', DATA_DIR . '/shares.json');
define('AUDIT_LOG_FILE', DATA_DIR . '/audit.log');

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

// Tempo máximo (segundos) que uma busca recursiva pode rodar antes de parar
// e devolver o que já achou até ali — sem isso, uma árvore de pastas gigante
// prende a requisição até bater o limite de 200 resultados (recursive_search)
// ou varrer tudo, o que puder demorar bem mais do que o usuário está disposto
// a esperar numa busca "ao digitar".
define('SEARCH_TIME_LIMIT_SECONDS', 5);

// ---------------------------------------------------------------------------
// Lixeira: excluir passa a mover pra cá em vez de apagar de vez. Fica DENTRO
// de cada volume de topo (/mnt/file_full/<disco>/.file_full_trash), nunca numa
// pasta única — assim "excluir" continua sendo um rename() instantâneo dentro
// do mesmo filesystem, em vez de uma cópia entre dispositivos que encheria o
// armazenamento interno do container com arquivos vindos de um HD.
// ---------------------------------------------------------------------------
define('TRASH_DIRNAME', '.file_full_trash');
define('TRASH_RETENTION_DAYS_DEFAULT', 30);

// Teto do cache de miniaturas. Ele mora em /data, que ENTRA no backup do HA —
// sem poda, navegar por uma biblioteca de fotos grande incha todo backup
// gerado dali em diante. Ao passar do teto, as miniaturas mais antigas são
// removidas até o cache voltar a 80% do limite.
define('THUMB_CACHE_MAX_BYTES', 256 * 1024 * 1024); // 256 MB

// Rotação do log de auditoria (uma linha JSON por ação de escrita).
define('AUDIT_LOG_MAX_BYTES', 2 * 1024 * 1024); // 2 MB, mantém 1 arquivo .1

// Validade máxima que um link de compartilhamento pode ter.
define('SHARE_MAX_TTL_SECONDS', 30 * 24 * 3600); // 30 dias
