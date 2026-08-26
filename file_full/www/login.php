<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/includes/auth.php';

if (is_logged_in()) {
    header('Location: index.php');
    exit;
}

$firstRun = !has_any_user();
$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if ($firstRun) {
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
        if (is_login_throttled()) {
            $error = 'Muitas tentativas de login deste endereço. Aguarde alguns minutos e tente novamente.';
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
<title><?= $firstRun ? 'Configuração inicial' : 'Login' ?> — Gerenciador de Arquivos</title>
<link rel="stylesheet" href="assets/css/style.css">
</head>
<body class="auth-body">
  <div class="auth-card">
    <h1>📁 Gerenciador de Arquivos</h1>
    <?php if ($firstRun): ?>
      <p class="auth-sub">Primeiro acesso: crie o usuário administrador.</p>
    <?php else: ?>
      <p class="auth-sub">Acesso restrito à equipe.</p>
    <?php endif; ?>

    <?php if ($error): ?><div class="alert alert-error"><?= htmlspecialchars($error) ?></div><?php endif; ?>

    <form method="post" class="auth-form">
      <label>Usuário</label>
      <input type="text" name="username" required autofocus>

      <label>Senha</label>
      <input type="password" name="password" required minlength="8">

      <?php if ($firstRun): ?>
        <label>Confirmar senha</label>
        <input type="password" name="confirm" required minlength="8">
      <?php endif; ?>

      <button type="submit"><?= $firstRun ? 'Criar administrador' : 'Entrar' ?></button>
    </form>
  </div>
</body>
</html>
