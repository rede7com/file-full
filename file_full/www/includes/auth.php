<?php
/**
 * Autenticação, sessão e controle de papéis (admin / viewer)
 */

// Limite de tentativas de login: bloqueia depois de 5 falhas em 15 minutos,
// pra dificultar força bruta contra o app exposto direto na porta 8099 do
// host (sem a proteção do Ingress do HA). Guardado em /data (mesmo lugar de
// usuários/configurações), sobrevive a reinícios do add-on.
//
// A chave é "usuário + IP", nunca só o IP: atrás do Ingress do HA TODAS as
// requisições chegam com o REMOTE_ADDR do proxy do Supervisor — contar só por
// IP fazia 5 erros de digitação de uma pessoa trancarem o login de todo mundo
// (e, do outro lado, permitia varrer vários usuários gastando uma cota só).
// Com a chave composta, o bloqueio atinge exatamente quem está errando.
define('LOGIN_ATTEMPTS_FILE', DATA_DIR . '/login_attempts.json');
define('LOGIN_MAX_ATTEMPTS', 5);
define('LOGIN_WINDOW_SECONDS', 900);

function login_throttle_key(string $username): string {
    return strtolower(trim($username)) . '@' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
}

function load_login_attempts(): array {
    if (!file_exists(LOGIN_ATTEMPTS_FILE)) return [];
    $data = json_decode((string) @file_get_contents(LOGIN_ATTEMPTS_FILE), true);
    return is_array($data) ? $data : [];
}

/**
 * Grava o mapa de tentativas descartando, na mesma passada, toda chave cuja
 * janela já venceu. Sem essa limpeza o arquivo só crescia — cada usuário/IP
 * que um dia errou a senha ficava lá pra sempre, dentro de /data, que entra
 * no backup do HA. LOCK_EX evita que duas tentativas simultâneas se
 * sobrescrevam.
 */
function save_login_attempts(array $data): void {
    $cutoff = time() - LOGIN_WINDOW_SECONDS;
    $clean = [];
    foreach ($data as $key => $timestamps) {
        $recent = array_values(array_filter((array) $timestamps, fn($ts) => $ts > $cutoff));
        if ($recent) $clean[$key] = $recent;
    }
    @file_put_contents(LOGIN_ATTEMPTS_FILE, json_encode($clean), LOCK_EX);
}

/** true se este usuário, vindo deste IP, já bateu no limite na janela recente */
function is_login_throttled(string $username): bool {
    $data = load_login_attempts();
    $recent = array_filter($data[login_throttle_key($username)] ?? [], fn($ts) => $ts > time() - LOGIN_WINDOW_SECONDS);
    return count($recent) >= LOGIN_MAX_ATTEMPTS;
}

function register_failed_login(string $username): void {
    $data = load_login_attempts();
    $key = login_throttle_key($username);
    $recent = array_filter($data[$key] ?? [], fn($ts) => $ts > time() - LOGIN_WINDOW_SECONDS);
    $recent[] = time();
    $data[$key] = array_values($recent);
    save_login_attempts($data);
}

function clear_login_attempts(string $username): void {
    $data = load_login_attempts();
    unset($data[login_throttle_key($username)]);
    save_login_attempts($data);
}

function load_users(): array {
    if (!file_exists(USERS_FILE)) {
        return [];
    }
    $json = file_get_contents(USERS_FILE);
    $data = json_decode($json, true);
    return is_array($data) ? $data : [];
}

function save_users(array $users): bool {
    return file_put_contents(USERS_FILE, json_encode($users, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) !== false;
}

function find_user(string $username): ?array {
    foreach (load_users() as $u) {
        if (strcasecmp($u['username'], $username) === 0) {
            return $u;
        }
    }
    return null;
}

function has_any_user(): bool {
    return count(load_users()) > 0;
}

function create_user(string $username, string $password, string $role = 'viewer'): bool {
    $users = load_users();
    foreach ($users as $u) {
        if (strcasecmp($u['username'], $username) === 0) {
            return false; // já existe
        }
    }
    $users[] = [
        'username' => $username,
        'password_hash' => password_hash($password, PASSWORD_DEFAULT),
        'role' => $role, // 'admin' ou 'viewer'
        'created_at' => date('c'),
    ];
    return save_users($users);
}

function delete_user(string $username): bool {
    $users = load_users();
    $filtered = array_values(array_filter($users, fn($u) => strcasecmp($u['username'], $username) !== 0));
    if (count($filtered) === count($users)) return false;
    return save_users($filtered);
}

function attempt_login(string $username, string $password): bool {
    if (is_login_throttled($username)) {
        return false;
    }
    $user = find_user($username);
    if (!$user || !password_verify($password, $user['password_hash'])) {
        register_failed_login($username);
        audit_log('login_failed', ['username' => $username], false);
        return false;
    }
    clear_login_attempts($username);

    // Troca o id da sessão ao autenticar (session fixation): sem isso, quem
    // conseguisse fixar um id de sessão na vítima antes do login — trivial na
    // rede local, já que a porta 8099 fala HTTP puro — continuava dono da
    // mesma sessão depois que ela virasse uma sessão autenticada.
    session_regenerate_id(true);

    $_SESSION['user'] = [
        'username' => $user['username'],
        'role' => $user['role'],
    ];
    audit_log('login', ['username' => $user['username'], 'role' => $user['role']]);
    return true;
}

function current_user(): ?array {
    return $_SESSION['user'] ?? null;
}

function is_logged_in(): bool {
    return isset($_SESSION['user']);
}

function is_admin(): bool {
    return is_logged_in() && ($_SESSION['user']['role'] ?? '') === 'admin';
}

function require_login(): void {
    if (!is_logged_in()) {
        header('Location: login.php');
        exit;
    }
}

function require_admin_json(): void {
    if (!is_admin()) {
        http_response_code(403);
        echo json_encode(['error' => 'Acesso restrito a administradores']);
        exit;
    }
}

function require_login_json(): void {
    if (!is_logged_in()) {
        http_response_code(401);
        echo json_encode(['error' => 'Não autenticado']);
        exit;
    }
}
