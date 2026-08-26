<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/includes/auth.php';
require_once __DIR__ . '/includes/functions.php';

require_login();
$user = current_user();

// Limites reais do PHP nesse servidor — o JS usa isso para nunca montar
// um lote de upload maior do que o servidor de fato aceita.
$serverLimits = [
    'postMaxBytes' => ini_to_bytes(ini_get('post_max_size')),
    'uploadMaxBytes' => ini_to_bytes(ini_get('upload_max_filesize')),
    'maxFileUploads' => (int) ini_get('max_file_uploads') ?: 20,
];
?>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Gerenciador de Arquivos</title>
<link rel="stylesheet" href="assets/css/style.css?v=<?php echo filemtime(__DIR__ . '/assets/css/style.css'); ?>">
</head>
<body>
  <div id="app" data-can-write="<?= is_admin() ? '1' : '0' ?>">

    <header class="topbar">
      <div class="topbar-left">
        <h1>📁 Gerenciador de Arquivos</h1>
      </div>
      <div class="topbar-search">
        <input type="text" id="searchInput" placeholder="Pesquisar arquivos e pastas...">
      </div>
      <div class="topbar-right">
        <?php
          $__host = preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST'] ?? $_SERVER['SERVER_NAME'] ?? '');
          $__directUrl = 'http://' . $__host . ':8099/';
        ?>
        <span id="wgStatusBadge" class="wg-status-badge" hidden title=""></span>
        <a href="<?= htmlspecialchars($__directUrl) ?>" target="_blank" rel="noopener" class="btn-link" title="Abre fora do painel do Home Assistant">🔗 Aba separada</a>
        <span class="user-badge"><?= htmlspecialchars($user['username']) ?> · <?= $user['role'] === 'admin' ? 'admin' : 'somente leitura' ?></span>
        <a href="logout.php" class="btn-link">Sair</a>
      </div>
    </header>

    <div class="toolbar">
      <nav id="breadcrumb" class="breadcrumb"></nav>
      <div class="toolbar-actions">
        <button id="btnToggleHidden" class="btn">👁️ Mostrar ocultos</button>
        <?php if (is_admin()): ?>
        <button id="btnNewFolder" class="btn">➕ Nova pasta</button>
        <button id="btnNewFile" class="btn">📝 Novo arquivo</button>
        <label class="btn" for="inputUploadFiles">📄 Enviar arquivos
          <input type="file" id="inputUploadFiles" multiple hidden>
        </label>
        <label class="btn" for="inputUploadFolder">📂 Enviar pasta
          <input type="file" id="inputUploadFolder" webkitdirectory directory multiple hidden>
        </label>
        <button id="btnZip" class="btn" disabled>🗜️ Compactar</button>
        <button id="btnCut" class="btn" disabled>✂️ Mover</button>
        <button id="btnCopy" class="btn" disabled>📋 Copiar</button>
        <button id="btnPaste" class="btn" disabled>📥 Colar</button>
        <button id="btnDelete" class="btn btn-danger" disabled>🗑️ Excluir</button>
        <button id="btnSettings" class="btn">⚙️ Configurações</button>
        <button id="btnFolderUsage" class="btn">📊 Uso de espaço</button>
        <?php endif; ?>
      </div>
    </div>

    <div id="dropZone" class="drop-zone">
      <div id="fileGrid" class="file-grid"></div>
      <div id="dropOverlay" class="drop-overlay">Solte aqui para enviar</div>
    </div>

    <div id="uploadPanel" class="upload-panel hidden">
      <div class="upload-panel-header">
        <span id="uploadPanelTitle">Enviando arquivos...</span>
        <button id="uploadPanelClose">×</button>
      </div>
      <div class="upload-progress-bar"><div id="uploadProgressFill" class="upload-progress-fill"></div></div>
      <div id="uploadPanelDetail" class="upload-panel-detail"></div>
    </div>

    <div id="infoPanel" class="info-panel hidden">
      <div class="info-panel-header">
        <span>Informações</span>
        <button id="infoPanelClose">×</button>
      </div>
      <div id="infoPanelBody"></div>
    </div>

    <div id="contextMenu" class="context-menu hidden"></div>

    <div id="modalOverlay" class="modal-overlay hidden">
      <div class="modal-box">
        <div id="modalTitle" class="modal-title"></div>
        <div id="modalBody" class="modal-body"></div>
        <div class="modal-actions">
          <button id="modalCancel" class="btn">Cancelar</button>
          <button id="modalConfirm" class="btn btn-primary">Confirmar</button>
        </div>
      </div>
    </div>

    <div id="toast" class="toast hidden"></div>
  </div>

  <script>
    window.SERVER_LIMITS = <?= json_encode($serverLimits) ?>;
    window.CSRF_TOKEN = <?= json_encode(CSRF_TOKEN) ?>;
  </script>
  <script src="assets/js/app.js?v=<?php echo filemtime(__DIR__ . '/assets/js/app.js'); ?>"></script>
</body>
</html>
