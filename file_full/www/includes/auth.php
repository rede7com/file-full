<?php
/**
 * Autenticação, sessão e controle de papéis (admin / viewer)
 */

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
    $user = find_user($username);
    if (!$user || !password_verify($password, $user['password_hash'])) {
        return false;
    }
    $_SESSION['user'] = [
        'username' => $user['username'],
        'role' => $user['role'],
    ];
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
