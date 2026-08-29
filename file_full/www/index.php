<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/includes/functions.php';
require_once __DIR__ . '/includes/auth.php';

send_security_headers();
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
<meta name="color-scheme" content="light dark">
<title>Gerenciador de Arquivos</title>
<link rel="stylesheet" href="assets/css/style.css?v=<?php echo filemtime(__DIR__ . '/assets/css/style.css'); ?>">
</head>
<body>
  <!--
    Biblioteca de ícones: um único <svg> com <symbol>s, referenciados por
    <use href="#i-nome">. Substituiu os emojis da versão anterior, que
    renderizavam diferente em cada sistema operacional, não herdavam a cor do
    tema e não escalavam junto com o texto.
  -->
  <svg class="icon-sprite" aria-hidden="true" focusable="false">
    <symbol id="i-folder" viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></symbol>
    <symbol id="i-file" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/></symbol>
    <symbol id="i-image" viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></symbol>
    <symbol id="i-video" viewBox="0 0 24 24"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></symbol>
    <symbol id="i-audio" viewBox="0 0 24 24"><path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z"/></symbol>
    <symbol id="i-pdf" viewBox="0 0 24 24"><path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v1zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm10 5.5h1v-3h-1v3z"/></symbol>
    <symbol id="i-archive" viewBox="0 0 24 24"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6 4h2v2h-2v-2zm-2 2h2v2h-2v-2zm2 2h2v2h-2v-2zm-2 2h2v2h-2v-2z"/></symbol>
    <symbol id="i-code" viewBox="0 0 24 24"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></symbol>
    <symbol id="i-sheet" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 4h-6v3h6v2h-6v3h6v2h-6v3h-2v-3H5v-2h6v-3H5v-2h6V7H5V5h14v2z"/></symbol>
    <symbol id="i-doc" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></symbol>
    <symbol id="i-search" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 10-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1114 9.5 4.5 4.5 0 019.5 14z"/></symbol>
    <symbol id="i-upload" viewBox="0 0 24 24"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/></symbol>
    <symbol id="i-download" viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></symbol>
    <symbol id="i-trash" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></symbol>
    <symbol id="i-plus" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></symbol>
    <symbol id="i-settings" viewBox="0 0 24 24"><path d="M19.14 12.94a7.07 7.07 0 000-1.88l2.03-1.58a.5.5 0 00.12-.62l-1.92-3.32a.5.5 0 00-.6-.22l-2.39.96a7.05 7.05 0 00-1.62-.94l-.36-2.54a.5.5 0 00-.5-.42h-3.84a.5.5 0 00-.49.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 00-.6.22L2.7 8.86a.5.5 0 00.12.62l2.03 1.58a7.07 7.07 0 000 1.88L2.82 14.5a.5.5 0 00-.12.62l1.92 3.32c.13.22.39.3.6.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.49-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .6-.22l1.92-3.32a.5.5 0 00-.12-.62l-2.03-1.58zM12 15.5A3.5 3.5 0 1115.5 12 3.5 3.5 0 0112 15.5z"/></symbol>
    <symbol id="i-copy" viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></symbol>
    <symbol id="i-cut" viewBox="0 0 24 24"><path d="M9.64 7.64a3 3 0 10-2.83 2.35L9 12l-2.19 2.01a3 3 0 102.83 2.35L12 14l7 7h3v-1L9.64 7.64zM6 8a1 1 0 111-1 1 1 0 01-1 1zm0 12a1 1 0 111-1 1 1 0 01-1 1zm13-17l-7 7 2 2 8-8V3h-3z"/></symbol>
    <symbol id="i-paste" viewBox="0 0 24 24"><path d="M19 2h-4.18A3 3 0 009 2H5a2 2 0 00-2 2v16a2 2 0 002 2h14a2 2 0 002-2V4a2 2 0 00-2-2zm-7 0a1 1 0 110 2 1 1 0 010-2zm7 18H5V4h2v3h10V4h2v16z"/></symbol>
    <symbol id="i-edit" viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></symbol>
    <symbol id="i-info" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1010 10A10 10 0 0012 2zm1 15h-2v-6h2zm0-8h-2V7h2z"/></symbol>
    <symbol id="i-eye" viewBox="0 0 24 24"><path d="M12 4.5A11.83 11.83 0 001 12a11.83 11.83 0 0022 0 11.83 11.83 0 00-11-7.5zm0 12.5a5 5 0 115-5 5 5 0 01-5 5zm0-8a3 3 0 103 3 3 3 0 00-3-3z"/></symbol>
    <symbol id="i-restore" viewBox="0 0 24 24"><path d="M13 3a9 9 0 00-9 9H1l3.89 3.89.07.14L9 12H6a7 7 0 117 7 6.94 6.94 0 01-4.9-2l-1.42 1.44A9 9 0 1013 3z"/></symbol>
    <symbol id="i-share" viewBox="0 0 24 24"><path d="M18 16.08a2.9 2.9 0 00-1.96.77L8.91 12.7a3.27 3.27 0 000-1.4l7.05-4.11A3 3 0 1015 5a3 3 0 00.04.49L8 9.6a3 3 0 100 4.8l7.12 4.16a2.8 2.8 0 00-.04.44A2.92 2.92 0 1018 16.08z"/></symbol>
    <symbol id="i-list" viewBox="0 0 24 24"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></symbol>
    <symbol id="i-grid" viewBox="0 0 24 24"><path d="M4 8h4V4H4v4zm6 12h4v-4h-4v4zm-6 0h4v-4H4v4zm0-6h4v-4H4v4zm6 0h4v-4h-4v4zm6-10v4h4V4h-4zm-6 4h4V4h-4v4zm6 6h4v-4h-4v4zm0 6h4v-4h-4v4z"/></symbol>
    <symbol id="i-disk" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1010 10A10 10 0 0012 2zm0 13.5A3.5 3.5 0 1115.5 12 3.5 3.5 0 0112 15.5zm0-4.5a1 1 0 101 1 1 1 0 00-1-1z"/></symbol>
    <symbol id="i-chart" viewBox="0 0 24 24"><path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z"/></symbol>
    <symbol id="i-close" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></symbol>
    <symbol id="i-logout" viewBox="0 0 24 24"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5-5-5zM4 5h8V3H4a2 2 0 00-2 2v14a2 2 0 002 2h8v-2H4V5z"/></symbol>
    <symbol id="i-external" viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></symbol>
    <symbol id="i-lock" viewBox="0 0 24 24"><path d="M18 8h-1V6A5 5 0 007 6v2H6a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V10a2 2 0 00-2-2zm-6 9a2 2 0 112-2 2 2 0 01-2 2zM9 8V6a3 3 0 016 0v2z"/></symbol>
    <symbol id="i-history" viewBox="0 0 24 24"><path d="M13 3a9 9 0 00-9 9H1l4 4 4-4H6a7 7 0 117 7 6.9 6.9 0 01-4.2-1.4l-1.5 1.5A9 9 0 1013 3zm-1 5v5l4.3 2.5.7-1.2-3.5-2.1V8z"/></symbol>
    <symbol id="i-sun" viewBox="0 0 24 24"><path d="M12 7a5 5 0 105 5 5 5 0 00-5-5zm0-5h0v3h0zM11 1h2v3h-2zm0 19h2v3h-2zM3.5 5L5 3.5 7.1 5.6 5.6 7.1zM16.9 18.4l1.5-1.5 2.1 2.1-1.5 1.5zM1 11h3v2H1zm19 0h3v2h-3zM5.6 16.9l1.5 1.5L5 20.5 3.5 19zM18.4 7.1l-1.5-1.5L19 3.5 20.5 5z"/></symbol>
    <symbol id="i-moon" viewBox="0 0 24 24"><path d="M9.37 5.51A7.35 7.35 0 009.1 7.5c0 4.08 3.32 7.4 7.4 7.4.68 0 1.35-.09 1.99-.27A7.01 7.01 0 0112 19c-3.86 0-7-3.14-7-7 0-2.93 1.81-5.45 4.37-6.49z"/></symbol>
    <symbol id="i-sort" viewBox="0 0 24 24"><path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z"/></symbol>
  </svg>

  <div id="app" data-can-write="<?= is_admin() ? '1' : '0' ?>">

    <header class="topbar">
      <div class="topbar-left">
        <svg class="brand-icon" aria-hidden="true"><use href="#i-folder"></use></svg>
        <h1>Gerenciador de Arquivos</h1>
      </div>

      <div class="topbar-search">
        <svg class="search-icon" aria-hidden="true"><use href="#i-search"></use></svg>
        <input type="text" id="searchInput" placeholder="Pesquisar arquivos e pastas..." aria-label="Pesquisar">
      </div>

      <div class="topbar-right">
        <?php
          $__host = preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST'] ?? $_SERVER['SERVER_NAME'] ?? '');
          $__directUrl = 'http://' . $__host . ':8099/';
        ?>
        <span id="wgStatusBadge" class="wg-status-badge" hidden title=""></span>

        <button id="btnTheme" class="icon-btn" title="Alternar tema claro/escuro" aria-label="Alternar tema">
          <svg aria-hidden="true"><use href="#i-moon"></use></svg>
        </button>

        <a href="<?= htmlspecialchars($__directUrl) ?>" target="_blank" rel="noopener" class="icon-btn"
           title="Abrir fora do painel do Home Assistant" aria-label="Abrir em aba separada">
          <svg aria-hidden="true"><use href="#i-external"></use></svg>
        </a>

        <span class="user-badge">
          <?= htmlspecialchars($user['username']) ?>
          <em><?= $user['role'] === 'admin' ? 'admin' : 'somente leitura' ?></em>
        </span>

        <a href="logout.php" class="icon-btn" title="Sair" aria-label="Sair">
          <svg aria-hidden="true"><use href="#i-logout"></use></svg>
        </a>
      </div>
    </header>

    <div class="toolbar">
      <nav id="breadcrumb" class="breadcrumb" aria-label="Caminho"></nav>

      <div class="toolbar-actions">
        <!--
          Os botões ficam agrupados em menus: a versão anterior enfileirava dez
          botões que viravam uma parede em tela estreita. Só as ações do dia a
          dia (enviar, excluir) continuam soltas.
        -->
        <?php if (is_admin()): ?>
        <div class="menu-wrap">
          <button class="btn" id="btnNewMenu" aria-haspopup="true" aria-expanded="false">
            <svg aria-hidden="true"><use href="#i-plus"></use></svg> Novo
          </button>
          <div class="menu" id="menuNew" hidden>
            <button id="btnNewFolder"><svg aria-hidden="true"><use href="#i-folder"></use></svg> Nova pasta</button>
            <button id="btnNewFile"><svg aria-hidden="true"><use href="#i-file"></use></svg> Novo arquivo</button>
          </div>
        </div>

        <label class="btn" for="inputUploadFiles">
          <svg aria-hidden="true"><use href="#i-upload"></use></svg> Enviar
          <input type="file" id="inputUploadFiles" multiple hidden>
        </label>
        <label class="btn btn-icon-only" for="inputUploadFolder" title="Enviar uma pasta inteira">
          <svg aria-hidden="true"><use href="#i-folder"></use></svg>
          <input type="file" id="inputUploadFolder" webkitdirectory directory multiple hidden>
        </label>

        <div class="menu-wrap">
          <button class="btn" id="btnEditMenu" aria-haspopup="true" aria-expanded="false" disabled>
            <svg aria-hidden="true"><use href="#i-edit"></use></svg> Ações
          </button>
          <div class="menu" id="menuEdit" hidden>
            <button id="btnCopy"><svg aria-hidden="true"><use href="#i-copy"></use></svg> Copiar</button>
            <button id="btnCut"><svg aria-hidden="true"><use href="#i-cut"></use></svg> Mover</button>
            <button id="btnZip"><svg aria-hidden="true"><use href="#i-archive"></use></svg> Compactar em ZIP</button>
          </div>
        </div>

        <button id="btnPaste" class="btn" disabled>
          <svg aria-hidden="true"><use href="#i-paste"></use></svg> Colar
        </button>
        <button id="btnDelete" class="btn btn-danger" disabled>
          <svg aria-hidden="true"><use href="#i-trash"></use></svg> Excluir
        </button>
        <?php endif; ?>

        <span class="toolbar-sep"></span>

        <button id="btnSort" class="btn btn-icon-only" title="Ordenar (nome, tamanho, data)" aria-label="Ordenar">
          <svg aria-hidden="true"><use href="#i-sort"></use></svg>
        </button>
        <button id="btnView" class="btn btn-icon-only" title="Alternar entre grade e lista" aria-label="Alternar visualização">
          <svg aria-hidden="true"><use href="#i-list"></use></svg>
        </button>
        <button id="btnToggleHidden" class="btn btn-icon-only" title="Mostrar arquivos ocultos" aria-label="Mostrar ocultos">
          <svg aria-hidden="true"><use href="#i-eye"></use></svg>
        </button>

        <?php if (is_admin()): ?>
        <div class="menu-wrap">
          <button class="btn btn-icon-only" id="btnMoreMenu" aria-haspopup="true" aria-expanded="false" title="Mais">
            <svg aria-hidden="true"><use href="#i-settings"></use></svg>
          </button>
          <div class="menu menu-right" id="menuMore" hidden>
            <button id="btnSettings"><svg aria-hidden="true"><use href="#i-settings"></use></svg> Configurações</button>
            <button id="btnTrash"><svg aria-hidden="true"><use href="#i-trash"></use></svg> Lixeira</button>
            <button id="btnFolderUsage"><svg aria-hidden="true"><use href="#i-chart"></use></svg> Uso de espaço</button>
          </div>
        </div>
        <?php endif; ?>
      </div>
    </div>

    <div id="sortBar" class="sort-bar hidden">
      <button class="sort-opt" data-sort="name">Nome</button>
      <button class="sort-opt" data-sort="size">Tamanho</button>
      <button class="sort-opt" data-sort="modified">Modificado</button>
    </div>

    <div id="dropZone" class="drop-zone">
      <div id="fileGrid" class="file-grid"></div>
      <div id="loadMoreRow" class="load-more-row hidden">
        <button id="btnLoadMore" class="btn">Carregar mais</button>
        <span id="loadMoreInfo" class="editor-hint"></span>
      </div>
      <div id="dropOverlay" class="drop-overlay">
        <svg aria-hidden="true"><use href="#i-upload"></use></svg>
        Solte aqui para enviar
      </div>
    </div>

    <div id="statusBar" class="status-bar"></div>

    <div id="uploadPanel" class="upload-panel hidden">
      <div class="upload-panel-header">
        <span id="uploadPanelTitle">Enviando arquivos...</span>
        <button id="uploadPanelClose" aria-label="Fechar"><svg aria-hidden="true"><use href="#i-close"></use></svg></button>
      </div>
      <div class="upload-progress-bar"><div id="uploadProgressFill" class="upload-progress-fill"></div></div>
      <div id="uploadPanelDetail" class="upload-panel-detail"></div>
    </div>

    <div id="infoPanel" class="info-panel hidden">
      <div class="info-panel-header">
        <span>Informações</span>
        <button id="infoPanelClose" aria-label="Fechar"><svg aria-hidden="true"><use href="#i-close"></use></svg></button>
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

    <!-- Visualizador (imagem, vídeo, áudio, PDF, markdown) -->
    <div id="viewerOverlay" class="viewer-overlay hidden">
      <div class="viewer-head">
        <span id="viewerTitle"></span>
        <div class="viewer-actions">
          <a id="viewerDownload" class="icon-btn" title="Baixar" download>
            <svg aria-hidden="true"><use href="#i-download"></use></svg>
          </a>
          <button id="viewerClose" class="icon-btn" title="Fechar (Esc)">
            <svg aria-hidden="true"><use href="#i-close"></use></svg>
          </button>
        </div>
      </div>
      <button id="viewerPrev" class="viewer-nav viewer-prev" aria-label="Anterior">‹</button>
      <div id="viewerBody" class="viewer-body"></div>
      <button id="viewerNext" class="viewer-nav viewer-next" aria-label="Próximo">›</button>
    </div>

    <div id="toast" class="toast hidden"></div>
  </div>

  <script nonce="<?= htmlspecialchars(CSP_NONCE) ?>">
    window.SERVER_LIMITS = <?= json_encode($serverLimits) ?>;
    window.CSRF_TOKEN = <?= json_encode(CSRF_TOKEN) ?>;
  </script>
  <script src="assets/js/app.js?v=<?php echo filemtime(__DIR__ . '/assets/js/app.js'); ?>"></script>
</body>
</html>
