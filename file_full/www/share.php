<?php
/**
 * Página pública de um link de compartilhamento temporário.
 *
 * Não exige login — é justamente o ponto do link. O que protege é o token
 * (24 bytes aleatórios), a validade curta e o fato de apontar para um único
 * arquivo, escolhido por um admin. Ver create_share()/find_share().
 *
 * Importante: atrás do Ingress do Home Assistant qualquer URL do add-on exige
 * a sessão do HA, então um link só é realmente "público" quando o destinatário
 * acessa pela porta 8099 do host (a mesma URL do botão "Aba separada").
 */
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/includes/functions.php';

send_security_headers();

$token = $_GET['t'] ?? '';
$share = find_share($token);
$file = $share ? safe_path($share['path']) : null;
$valid = $share !== null && $file !== null && is_file($file);
?>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<title><?= $valid ? htmlspecialchars(basename($file)) : 'Link indisponível' ?></title>
<link rel="stylesheet" href="assets/css/style.css?v=<?php echo filemtime(__DIR__ . '/assets/css/style.css'); ?>">
</head>
<body class="auth-body">
  <div class="auth-card">
    <?php if (!$valid): ?>
      <div class="auth-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="28" height="28"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
      </div>
      <h1>Link indisponível</h1>
      <p class="auth-sub">Este link de compartilhamento expirou, foi revogado ou nunca existiu.</p>
    <?php else: ?>
      <div class="auth-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="28" height="28"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/></svg>
      </div>
      <h1><?= htmlspecialchars(basename($file)) ?></h1>
      <p class="auth-sub">
        <?= htmlspecialchars(human_filesize((int) filesize($file))) ?> ·
        expira em <?= htmlspecialchars(date('d/m/Y H:i', $share['expires_at'])) ?>
      </p>

      <?php $kind = preview_kind(basename($file)); $src = 'download.php?inline=1&share=' . rawurlencode($token); ?>
      <?php if ($kind === 'image'): ?>
        <img class="share-preview" src="<?= htmlspecialchars($src) ?>" alt="">
      <?php elseif ($kind === 'video'): ?>
        <video class="share-preview" src="<?= htmlspecialchars($src) ?>" controls playsinline></video>
      <?php elseif ($kind === 'audio'): ?>
        <audio class="share-preview" src="<?= htmlspecialchars($src) ?>" controls></audio>
      <?php endif; ?>

      <a class="share-download" href="download.php?share=<?= htmlspecialchars(rawurlencode($token)) ?>">Baixar arquivo</a>
    <?php endif; ?>
  </div>
</body>
</html>
