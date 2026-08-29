<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/includes/functions.php';
require_once __DIR__ . '/includes/auth.php';

send_security_headers();

if (is_logged_in()) {
    header('Location: index.php');
    exit;
}

$firstRun = !has_any_user();
$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // CSRF também no login: sem isso, outro site consegue submeter este
    // formulário com credenciais conhecidas e deixar a vítima logada numa
    // conta do atacante (login CSRF), que é como se planta conteúdo numa
    // sessão que a pessoa acha ser a dela.
    $sentToken = $_POST['csrf'] ?? '';
    if (!hash_equals($_SESSION['csrf'] ?? '', $sentToken)) {
        $error = 'Sessão expirada. Recarregue a página e tente novamente.';
    } elseif ($firstRun) {
        $username = trim($_POST['username'] ?? '');
        $password = $_POST['password'] ?? '';
        $confirm = $_POST['confirm'] ?? '';
        if ($username === '' || strlen($password) < 8) {
            $error = 'Usuário obrigatório e senha com no mínimo 8 caracteres.';
        } elseif ($password !== $confirm) {
            $error = 'As senhas não coincidem.';
        } else {
            create_user($username, $password, 'admin');
            attempt_login($username, $password);
            header('Location: index.php');
            exit;
        }
    } else {
        $username = trim($_POST['username'] ?? '');
        $password = $_POST['password'] ?? '';
        if (is_login_throttled($username)) {
            $error = 'Muitas tentativas para este usuário. Aguarde alguns minutos e tente novamente.';
        } elseif (attempt_login($username, $password)) {
            header('Location: index.php');
            exit;
        } else {
            $error = 'Usuário ou senha inválidos.';
        }
    }
}
?>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<title><?= $firstRun ? 'Configuração inicial' : 'Entrar' ?> — Gerenciador de Arquivos</title>
<link rel="stylesheet" href="assets/css/style.css?v=<?php echo filemtime(__DIR__ . '/assets/css/style.css'); ?>">
</head>
<body class="auth-body">
  <div class="auth-card">
    <div class="auth-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="28" height="28"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
    </div>
    <h1>Gerenciador de Arquivos</h1>
    <?php if ($firstRun): ?>
      <p class="auth-sub">Primeiro acesso — crie o usuário administrador.</p>
    <?php else: ?>
      <p class="auth-sub">Acesso restrito.</p>
    <?php endif; ?>

    <?php if ($error): ?><div class="alert alert-error"><?= htmlspecialchars($error) ?></div><?php endif; ?>

    <form method="post" class="auth-form">
      <input type="hidden" name="csrf" value="<?= htmlspecialchars(CSRF_TOKEN) ?>">

      <label for="f-user">Usuário</label>
      <input id="f-user" type="text" name="username" required autofocus autocomplete="username">

      <label for="f-pass">Senha</label>
      <input id="f-pass" type="password" name="password" required minlength="8"
             autocomplete="<?= $firstRun ? 'new-password' : 'current-password' ?>">

      <?php if ($firstRun): ?>
        <label for="f-conf">Confirmar senha</label>
        <input id="f-conf" type="password" name="confirm" required minlength="8" autocomplete="new-password">
      <?php endif; ?>

      <button type="submit"><?= $firstRun ? 'Criar administrador' : 'Entrar' ?></button>
    </form>
  </div>
</body>
</html>
