(function () {
  'use strict';

  const app = document.getElementById('app');
  const canWrite = app.dataset.canWrite === '1';

  const fileGrid = document.getElementById('fileGrid');
  const breadcrumb = document.getElementById('breadcrumb');
  const dropZone = document.getElementById('dropZone');
  const searchInput = document.getElementById('searchInput');
  const statusBar = document.getElementById('statusBar');

  const uploadPanel = document.getElementById('uploadPanel');
  const uploadPanelTitle = document.getElementById('uploadPanelTitle');
  const uploadProgressFill = document.getElementById('uploadProgressFill');
  const uploadPanelDetail = document.getElementById('uploadPanelDetail');

  const infoPanel = document.getElementById('infoPanel');
  const infoPanelBody = document.getElementById('infoPanelBody');

  const contextMenu = document.getElementById('contextMenu');
  const modalOverlay = document.getElementById('modalOverlay');
  const modalBox = modalOverlay.querySelector('.modal-box');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  const modalConfirm = document.getElementById('modalConfirm');
  const modalCancel = document.getElementById('modalCancel');
  const toast = document.getElementById('toast');

  // =========================================================================
  // Escapamento
  // -------------------------------------------------------------------------
  // TODO dado que veio do disco (nome de arquivo, label de disco, nome de
  // usuário) passa por aqui antes de entrar em innerHTML. A versão anterior
  // escapava só aspas, então um arquivo chamado, por exemplo,
  // `<img src=x onerror=...>.txt` — criável por upload, por SMB ou por
  // qualquer processo com acesso ao HD — executava script com a sessão do
  // admin aberta. Preferimos, sempre que dá, montar o nó com textContent;
  // onde é template string, é escHtml/escAttr.
  // =========================================================================
  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escHtml(v) {
    return (v == null ? '' : String(v)).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
  }
  const escAttr = escHtml;

  const ICON_BY_EXT = {
    zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', bz2: 'archive',
    pdf: 'pdf',
    doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc', txt: 'doc',
    xls: 'sheet', xlsx: 'sheet', csv: 'sheet', ods: 'sheet',
    ppt: 'doc', pptx: 'doc',
    mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio',
    mp4: 'video', mov: 'video', avi: 'video', mkv: 'video', webm: 'video', m4v: 'video',
    jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', bmp: 'image', svg: 'image', ico: 'image',
    js: 'code', ts: 'code', json: 'code', php: 'code', py: 'code', sh: 'code', html: 'code',
    css: 'code', xml: 'code', yaml: 'code', yml: 'code', sql: 'code', conf: 'code', ini: 'code',
  };
  const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
  const BINARY_EXT = [
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico', 'svg',
    'mp4', 'mov', 'avi', 'mkv', 'webm', 'mp3', 'wav', 'flac', 'ogg', 'm4a',
    'zip', 'rar', '7z', 'tar', 'gz', 'bz2',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'exe', 'dll', 'so', 'bin', 'iso', 'ttf', 'woff', 'woff2',
  ];
  // Filtro de conveniência só pra esconder "Editar" em arquivos obviamente
  // binários — quem decide de verdade se dá pra editar é o backend (sniff de
  // conteúdo), então arquivos sem extensão (Dockerfile, .htaccess) passam aqui.
  function isLikelyTextExt(item) {
    return !item.ext || !BINARY_EXT.includes(item.ext);
  }

  let currentPath = '';
  let items = [];
  let selection = new Set();
  let clipboard = null; // { mode: 'copy'|'move', paths: [] }
  let lastClickedIndex = null;
  let showHidden = false;
  let searchMode = false;

  // Preferências que ficam no navegador de quem está usando (não são estado
  // do servidor): visualização em grade ou lista, ordenação e tema.
  let viewMode = localStorage.getItem('ff_view') || 'grid';
  let sortBy = localStorage.getItem('ff_sort') || 'name';
  let sortDesc = localStorage.getItem('ff_sort_desc') === '1';

  // Paginação da listagem (ver action 'list' em api.php). listOffset é
  // sempre igual ao número de itens já carregados na pasta atual — cada
  // "Carregar mais" pede a partir dali.
  let listOffset = 0;
  let listTotal = 0;
  let listHasMore = false;
  let listLoading = false;

  // ---------- Helpers ----------
  function fmtSize(bytes) {
    if (bytes === null || bytes === undefined) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = bytes > 0 ? Math.floor(Math.log(bytes) / Math.log(1024)) : 0;
    i = Math.min(i, units.length - 1);
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }
  const human_filesize_js = (b) => (!b ? '0 B' : fmtSize(b));

  function fmtDate(ts) {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function fmtRelative(ts) {
    const diff = Math.floor(Date.now() / 1000) - ts;
    if (diff < 60) return 'agora';
    if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
    if (diff < 2592000) return `há ${Math.floor(diff / 86400)} dias`;
    return fmtDate(ts);
  }

  function iconNameFor(item) {
    if (item.is_dir) return 'folder';
    return ICON_BY_EXT[item.ext] || 'file';
  }
  /** <svg><use> pronto pra template string */
  function iconSvg(name) {
    return `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  }
  /** cria o elemento <svg><use> de verdade (namespace correto) */
  function makeIcon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    svg.setAttribute('aria-hidden', 'true');
    return svg;
  }

  function showToast(msg, isError) {
    toast.textContent = msg;
    toast.classList.toggle('error', !!isError);
    toast.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.add('hidden'), 4000);
  }
  function joinPath(base, name) {
    return base ? base + '/' + name : name;
  }

  async function api(action, { method = 'GET', params = null, body = null } = {}) {
    let url = 'api.php?action=' + encodeURIComponent(action);
    let opts = { method, headers: {} };
    if (method === 'GET' && params) {
      const q = new URLSearchParams(params);
      url += '&' + q.toString();
    }
    if (method === 'POST') {
      opts.body = body;
      opts.headers['X-CSRF-Token'] = window.CSRF_TOKEN || '';
    }
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Erro na requisição.');
      Object.assign(err, data); // deixa campos extras (ex: output) acessíveis a quem precisar
      throw err;
    }
    return data;
  }

  // ---------- Tema ----------
  // A escolha manual (localStorage) sempre vence a do sistema; sem escolha
  // gravada, o CSS decide sozinho pelo prefers-color-scheme.
  const themeBtn = document.getElementById('btnTheme');
  function applyTheme(mode) {
    if (mode === 'system') {
      document.documentElement.removeAttribute('data-theme');
      localStorage.removeItem('ff_theme');
    } else {
      document.documentElement.setAttribute('data-theme', mode);
      localStorage.setItem('ff_theme', mode);
    }
    const isDark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    themeBtn.querySelector('use').setAttribute('href', isDark ? '#i-sun' : '#i-moon');
    themeBtn.title = isDark ? 'Mudar para o tema claro' : 'Mudar para o tema escuro';
  }
  applyTheme(localStorage.getItem('ff_theme') || 'system');
  themeBtn.onclick = () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
      || (!document.documentElement.hasAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    applyTheme(isDark ? 'light' : 'dark');
  };

  // ---------- Navegação ----------
  function listParams(offset) {
    return {
      path: currentPath,
      show_hidden: showHidden ? '1' : '0',
      offset,
      sort: sortBy,
      desc: sortDesc ? '1' : '0',
    };
  }

  /** Placeholders animados enquanto a listagem não chega — antes a tela
   *  simplesmente ficava vazia entre uma pasta e outra. */
  function renderSkeleton() {
    fileGrid.className = 'file-grid' + (viewMode === 'list' ? ' view-list' : '');
    fileGrid.innerHTML = '';
    const count = viewMode === 'list' ? 10 : 14;
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'skeleton-item';
      fileGrid.appendChild(el);
    }
    document.getElementById('loadMoreRow').classList.add('hidden');
  }

  async function loadDir(path) {
    searchMode = false;
    renderSkeleton();
    try {
      const prev = currentPath;
      currentPath = path;
      const data = await api('list', { params: listParams(0) });
      currentPath = data.path;
      items = data.items;
      listOffset = data.items.length;
      listTotal = data.total;
      listHasMore = data.has_more;
      selection.clear();
      lastClickedIndex = null;
      updateToolbarState();
      renderBreadcrumb();
      renderGrid();
      history.replaceState(null, '', '#' + encodeURIComponent(currentPath));
    } catch (e) {
      showToast(e.message, true);
      fileGrid.innerHTML = `<div class="empty-state">${iconSvg('info')}${escHtml(e.message)}</div>`;
    }
  }

  async function loadMoreItems() {
    if (listLoading || !listHasMore) return;
    listLoading = true;
    renderLoadMoreRow();
    try {
      const data = await api('list', { params: listParams(listOffset) });
      items = items.concat(data.items);
      listOffset += data.items.length;
      listTotal = data.total;
      listHasMore = data.has_more;
      renderGrid();
    } catch (e) {
      showToast(e.message, true);
    } finally {
      listLoading = false;
    }
  }

  function renderLoadMoreRow() {
    const row = document.getElementById('loadMoreRow');
    const info = document.getElementById('loadMoreInfo');
    const btn = document.getElementById('btnLoadMore');
    if (!listHasMore) { row.classList.add('hidden'); return; }
    row.classList.remove('hidden');
    info.textContent = `Mostrando ${items.length} de ${listTotal}`;
    btn.disabled = listLoading;
    btn.textContent = listLoading ? 'Carregando...' : 'Carregar mais';
  }
  document.getElementById('btnLoadMore').onclick = () => loadMoreItems();

  function renderBreadcrumb() {
    breadcrumb.innerHTML = '';
    const rootLink = document.createElement('a');
    rootLink.textContent = 'Raiz';
    if (!currentPath) rootLink.className = 'current';
    rootLink.onclick = () => loadDir('');
    breadcrumb.appendChild(rootLink);

    if (!currentPath) return;
    const parts = currentPath.split('/');
    let acc = '';
    parts.forEach((part, i) => {
      acc = acc ? acc + '/' + part : part;
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '›';
      breadcrumb.appendChild(sep);
      const a = document.createElement('a');
      a.textContent = part; // textContent: nome de pasta nunca vira markup
      if (i === parts.length - 1) a.className = 'current';
      const target = acc;
      a.onclick = () => loadDir(target);
      breadcrumb.appendChild(a);
    });
  }

  function renderGrid() {
    fileGrid.className = 'file-grid' + (viewMode === 'list' ? ' view-list' : '');
    fileGrid.innerHTML = '';

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.appendChild(makeIcon('folder'));
      const p = document.createElement('div');
      p.textContent = canWrite
        ? 'Esta pasta está vazia. Arraste arquivos ou pastas aqui para enviar.'
        : 'Esta pasta está vazia.';
      empty.appendChild(p);
      fileGrid.appendChild(empty);
      renderLoadMoreRow();
      updateStatusBar();
      return;
    }

    const frag = document.createDocumentFragment();
    items.forEach((item, idx) => {
      frag.appendChild(buildItemElement(item, idx));
    });
    fileGrid.appendChild(frag);
    renderLoadMoreRow();
    updateStatusBar();
  }

  function buildItemElement(item, idx) {
    const el = document.createElement('div');
    el.className = 'file-item';
    if (item.hidden) el.classList.add('is-hidden-item');
    el.dataset.path = item.path;
    el.dataset.idx = idx;
    if (selection.has(item.path)) el.classList.add('selected');
    el.title = item.name;

    const iconName = iconNameFor(item);
    const iconWrap = document.createElement('div');
    iconWrap.className = 'file-icon k-' + (item.is_dir ? 'dir' : iconName);

    if (item.is_image && viewMode === 'grid') {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '';
      img.src = 'thumb.php?path=' + encodeURIComponent(item.path) + '&size=160';
      img.onerror = () => { iconWrap.replaceChildren(makeIcon(iconName)); };
      iconWrap.appendChild(img);
    } else {
      iconWrap.appendChild(makeIcon(iconName));
    }

    const name = document.createElement('div');
    name.className = 'file-name';
    name.textContent = item.name; // textContent, nunca innerHTML

    const meta = document.createElement('div');
    meta.className = 'file-meta';
    if (viewMode === 'list') {
      const date = document.createElement('span');
      date.className = 'meta-date';
      date.textContent = item.modified ? fmtDate(item.modified) : '';
      const size = document.createElement('span');
      size.className = 'meta-size';
      size.textContent = item.is_dir ? '—' : fmtSize(item.size);
      meta.append(date, size);
    } else {
      meta.textContent = item.is_dir ? '' : fmtSize(item.size);
    }

    el.append(iconWrap, name, meta);

    el.addEventListener('click', (e) => handleItemClick(e, item, idx));
    el.addEventListener('dblclick', () => handleItemOpen(item));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!selection.has(item.path)) {
        selection.clear();
        selection.add(item.path);
        renderGrid();
        updateToolbarState();
      }
      const targets = items.filter(i => selection.has(i.path));
      openContextMenu(e.clientX, e.clientY, targets.length ? targets : [item]);
    });
    return el;
  }

  function updateStatusBar() {
    const dirs = items.filter(i => i.is_dir).length;
    const files = items.length - dirs;
    const bytes = items.reduce((sum, i) => sum + (i.size || 0), 0);
    const left = searchMode
      ? `${items.length} resultado(s)`
      : `${dirs} pasta(s), ${files} arquivo(s)${bytes ? ' · ' + fmtSize(bytes) : ''}`;
    const right = selection.size ? `${selection.size} selecionado(s)` : '';
    statusBar.replaceChildren(
      Object.assign(document.createElement('span'), { textContent: left }),
      Object.assign(document.createElement('span'), { textContent: right })
    );
  }

  function handleItemClick(e, item, idx) {
    if (e.shiftKey && lastClickedIndex !== null) {
      const [a, b] = [lastClickedIndex, idx].sort((x, y) => x - y);
      selection.clear();
      for (let i = a; i <= b; i++) selection.add(items[i].path);
    } else if (e.ctrlKey || e.metaKey) {
      selection.has(item.path) ? selection.delete(item.path) : selection.add(item.path);
      lastClickedIndex = idx;
    } else {
      selection.clear();
      selection.add(item.path);
      lastClickedIndex = idx;
    }
    renderGrid();
    updateToolbarState();
  }

  /**
   * Abrir um item: pasta navega; arquivo que o visualizador entende abre no
   * visualizador; texto abre no editor; o resto baixa. Antes, qualquer clique
   * duplo em arquivo forçava download — o que num NAS de fotos é justamente o
   * caso de uso mais comum e o mais mal atendido.
   */
  function handleItemOpen(item) {
    if (item.is_dir) { loadDir(item.path); return; }
    if (item.preview && item.preview !== 'none') { openViewer(item); return; }
    if (isLikelyTextExt(item)) { openEditor(item); return; }
    downloadItem(item);
  }

  function downloadItem(item) {
    window.open('download.php?path=' + encodeURIComponent(item.path), '_blank');
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.file-item') && !e.target.closest('.viewer-overlay') && !e.target.closest('.modal-overlay')) {
      if (selection.size) {
        selection.clear();
        renderGrid();
        updateToolbarState();
      }
    }
    if (!e.target.closest('.context-menu')) contextMenu.classList.add('hidden');
    if (!e.target.closest('.menu-wrap')) closeAllMenus();
  });

  // ---------- Menus da toolbar ----------
  function closeAllMenus() {
    document.querySelectorAll('.menu').forEach(m => { m.hidden = true; });
    document.querySelectorAll('[aria-haspopup]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  }
  function wireMenu(btnId, menuId) {
    const btn = document.getElementById(btnId);
    const menu = document.getElementById(menuId);
    if (!btn || !menu) return;
    btn.onclick = (e) => {
      e.stopPropagation();
      const wasOpen = !menu.hidden;
      closeAllMenus();
      menu.hidden = wasOpen;
      btn.setAttribute('aria-expanded', String(!wasOpen));
    };
    menu.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => closeAllMenus());
    });
  }
  wireMenu('btnNewMenu', 'menuNew');
  wireMenu('btnEditMenu', 'menuEdit');
  wireMenu('btnMoreMenu', 'menuMore');

  // ---------- Estado da toolbar ----------
  function updateToolbarState() {
    const has = selection.size > 0;
    const set = (id, disabled) => {
      const el = document.getElementById(id);
      if (el) el.disabled = disabled;
    };
    set('btnEditMenu', !has);
    set('btnDelete', !has);
    set('btnPaste', !clipboard);
    updateStatusBar();
  }

  // ---------- Ordenação e visualização ----------
  const sortBar = document.getElementById('sortBar');
  function refreshSortBar() {
    sortBar.querySelectorAll('.sort-opt').forEach(b => {
      const active = b.dataset.sort === sortBy;
      b.classList.toggle('active', active);
      const label = { name: 'Nome', size: 'Tamanho', modified: 'Modificado' }[b.dataset.sort];
      b.textContent = active ? `${label} ${sortDesc ? '↓' : '↑'}` : label;
    });
  }
  document.getElementById('btnSort').onclick = () => {
    sortBar.classList.toggle('hidden');
    document.getElementById('btnSort').classList.toggle('active', !sortBar.classList.contains('hidden'));
  };
  sortBar.querySelectorAll('.sort-opt').forEach(btn => {
    btn.onclick = () => {
      // Clicar no critério já ativo inverte a direção — convenção de
      // qualquer gerenciador de arquivos.
      if (sortBy === btn.dataset.sort) sortDesc = !sortDesc;
      else { sortBy = btn.dataset.sort; sortDesc = false; }
      localStorage.setItem('ff_sort', sortBy);
      localStorage.setItem('ff_sort_desc', sortDesc ? '1' : '0');
      refreshSortBar();
      loadDir(currentPath);
    };
  });
  refreshSortBar();

  const btnView = document.getElementById('btnView');
  function refreshViewButton() {
    btnView.querySelector('use').setAttribute('href', viewMode === 'list' ? '#i-grid' : '#i-list');
    btnView.title = viewMode === 'list' ? 'Ver em grade' : 'Ver em lista';
  }
  btnView.onclick = () => {
    viewMode = viewMode === 'list' ? 'grid' : 'list';
    localStorage.setItem('ff_view', viewMode);
    refreshViewButton();
    renderGrid();
  };
  refreshViewButton();

  const btnHidden = document.getElementById('btnToggleHidden');
  btnHidden.onclick = () => {
    showHidden = !showHidden;
    btnHidden.classList.toggle('active', showHidden);
    btnHidden.title = showHidden ? 'Ocultar arquivos ocultos' : 'Mostrar arquivos ocultos';
    loadDir(currentPath);
  };

  // ---------- Menu de contexto ----------
  function openContextMenu(x, y, targetItems) {
    contextMenu.innerHTML = '';
    const add = (iconName, label, fn, danger) => {
      const b = document.createElement('button');
      b.appendChild(makeIcon(iconName));
      b.appendChild(document.createTextNode(' ' + label));
      if (danger) b.classList.add('danger');
      b.onclick = () => { contextMenu.classList.add('hidden'); fn(); };
      contextMenu.appendChild(b);
    };
    const sep = () => contextMenu.appendChild(document.createElement('hr'));

    const single = targetItems.length === 1 ? targetItems[0] : null;

    if (single && single.is_dir) add('folder', 'Abrir', () => loadDir(single.path));
    if (single && !single.is_dir && single.preview !== 'none') add('eye', 'Visualizar', () => openViewer(single));
    if (single && !single.is_dir) add('download', 'Baixar', () => downloadItem(single));
    if (single && !single.is_dir && isLikelyTextExt(single)) {
      add('edit', canWrite ? 'Editar' : 'Ver conteúdo', () => openEditor(single));
    }
    if (single) add('info', 'Informações', () => showInfo(single));
    if (single && !single.is_dir && canWrite) add('share', 'Criar link temporário', () => openShareDialog(single));

    if (canWrite) {
      sep();
      if (single && !single.is_mount) add('edit', 'Renomear', () => renameItem(single));
      add('copy', 'Copiar', () => setClipboard('copy'));
      add('cut', 'Mover', () => setClipboard('move'));
      add('archive', 'Compactar em ZIP', () => zipSelection());
      if (single && single.ext === 'zip') add('archive', 'Descompactar', () => unzipItem(single));
      sep();
      add('trash', 'Mover para a lixeira', () => deleteSelection(), true);
    }

    contextMenu.classList.remove('hidden');
    // Posiciona já dentro da janela: perto da borda direita/inferior o menu
    // saía da tela e ficava inalcançável.
    const rect = contextMenu.getBoundingClientRect();
    contextMenu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
    contextMenu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';
  }

  // ---------- Painel de informações ----------
  function showInfo(item) {
    infoPanel.classList.remove('hidden');
    infoPanelBody.innerHTML = '';

    if (item.is_image) {
      const img = document.createElement('img');
      img.className = 'info-thumb';
      img.alt = '';
      img.src = 'thumb.php?path=' + encodeURIComponent(item.path) + '&size=400';
      infoPanelBody.appendChild(img);
    }
    const row = (k, v) => {
      const div = document.createElement('div');
      div.className = 'info-row';
      const a = document.createElement('span');
      a.textContent = k;
      const b = document.createElement('span');
      b.textContent = v; // textContent: o nome/caminho do arquivo entra como texto
      div.append(a, b);
      infoPanelBody.appendChild(div);
    };
    row('Nome', item.name);
    row('Tipo', item.is_dir ? 'Pasta' : (item.ext ? item.ext.toUpperCase() : 'Arquivo'));
    if (!item.is_dir) row('Tamanho', fmtSize(item.size));
    row('Modificado', fmtDate(item.modified));
    row('Permissões', item.perms);
    row('Caminho', '/' + item.path);
  }
  document.getElementById('infoPanelClose').onclick = () => infoPanel.classList.add('hidden');

  // =========================================================================
  // Visualizador (imagem, vídeo, áudio, PDF, markdown)
  // =========================================================================
  const viewerOverlay = document.getElementById('viewerOverlay');
  const viewerBody = document.getElementById('viewerBody');
  const viewerTitle = document.getElementById('viewerTitle');
  const viewerDownload = document.getElementById('viewerDownload');
  const viewerPrev = document.getElementById('viewerPrev');
  const viewerNext = document.getElementById('viewerNext');
  let viewerIndex = -1;

  /** Itens navegáveis com ← →: só os do mesmo tipo do que está aberto, pra
   *  passar por uma pasta de fotos sem cair num PDF no meio. */
  function viewerSiblings(kind) {
    return items.filter(i => !i.is_dir && i.preview === kind);
  }

  async function openViewer(item) {
    const kind = item.preview;
    const siblings = viewerSiblings(kind);
    viewerIndex = siblings.findIndex(i => i.path === item.path);

    viewerOverlay.classList.remove('hidden');
    viewerTitle.textContent = item.name;
    viewerDownload.href = 'download.php?path=' + encodeURIComponent(item.path);
    viewerPrev.hidden = siblings.length < 2;
    viewerNext.hidden = siblings.length < 2;
    viewerBody.innerHTML = '';

    const src = 'download.php?inline=1&path=' + encodeURIComponent(item.path);

    if (kind === 'image') {
      const img = document.createElement('img');
      img.src = src;
      img.alt = item.name;
      viewerBody.appendChild(img);
    } else if (kind === 'video') {
      const v = document.createElement('video');
      v.src = src; v.controls = true; v.autoplay = true; v.playsInline = true;
      viewerBody.appendChild(v);
    } else if (kind === 'audio') {
      const a = document.createElement('audio');
      a.src = src; a.controls = true; a.autoplay = true;
      viewerBody.appendChild(a);
    } else if (kind === 'pdf') {
      const f = document.createElement('iframe');
      f.src = src;
      viewerBody.appendChild(f);
    } else if (kind === 'markdown') {
      const doc = document.createElement('div');
      doc.className = 'viewer-doc';
      doc.textContent = 'Carregando...';
      viewerBody.appendChild(doc);
      try {
        const data = await api('read_file', { params: { path: item.path } });
        doc.innerHTML = renderMarkdown(data.content);
      } catch (e) {
        doc.textContent = e.message;
      }
    }
  }

  function closeViewer() {
    viewerOverlay.classList.add('hidden');
    viewerBody.innerHTML = ''; // para o vídeo/áudio que estiver tocando
  }
  function stepViewer(delta) {
    const current = viewerBody.querySelector('img, video, audio, iframe, .viewer-doc');
    if (!current) return;
    const kind = viewerBody.querySelector('img') ? 'image'
      : viewerBody.querySelector('video') ? 'video'
      : viewerBody.querySelector('audio') ? 'audio'
      : viewerBody.querySelector('iframe') ? 'pdf' : 'markdown';
    const siblings = viewerSiblings(kind);
    if (siblings.length < 2) return;
    viewerIndex = (viewerIndex + delta + siblings.length) % siblings.length;
    openViewer(siblings[viewerIndex]);
  }
  document.getElementById('viewerClose').onclick = closeViewer;
  viewerPrev.onclick = () => stepViewer(-1);
  viewerNext.onclick = () => stepViewer(1);
  viewerOverlay.addEventListener('click', (e) => { if (e.target === viewerOverlay) closeViewer(); });

  /**
   * Renderizador de Markdown mínimo, sem dependência externa (a CSP do app
   * não permite carregar script de CDN, e uma biblioteca inteira não se
   * justifica só pra pré-visualizar README).
   *
   * A ordem importa: o texto é escapado ANTES de qualquer transformação, então
   * o HTML gerado aqui contém só as tags que este código produz — markdown de
   * um arquivo qualquer nunca injeta markup próprio.
   */
  function renderMarkdown(md) {
    const blocks = [];
    // Blocos de código saem de cena primeiro, pra não sofrerem as outras regras
    let text = escHtml(md).replace(/```([\s\S]*?)```/g, (_, code) => {
      blocks.push(code.replace(/^\w*\n/, ''));
      return ' BLOCK' + (blocks.length - 1) + ' ';
    });

    text = text
      .replace(/^###### (.*)$/gm, '<h6>$1</h6>')
      .replace(/^##### (.*)$/gm, '<h5>$1</h5>')
      .replace(/^#### (.*)$/gm, '<h4>$1</h4>')
      .replace(/^### (.*)$/gm, '<h3>$1</h3>')
      .replace(/^## (.*)$/gm, '<h2>$1</h2>')
      .replace(/^# (.*)$/gm, '<h1>$1</h1>')
      .replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>')
      .replace(/^(---|\*\*\*)$/gm, '<hr>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      // Só http(s) vira link: sem isso um "javascript:" no markdown viraria
      // um link executável.
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/^[-*+] (.*)$/gm, '<li>$1</li>')
      .replace(/^\d+\. (.*)$/gm, '<li>$1</li>');

    text = text.replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>');

    text = text.split(/\n{2,}/).map(p => {
      const t = p.trim();
      if (!t) return '';
      if (/^<(h\d|ul|ol|blockquote|hr|pre|table)/.test(t)) return t;
      return '<p>' + t.replace(/\n/g, '<br>') + '</p>';
    }).join('\n');

    return text.replace(/ BLOCK(\d+) /g, (_, i) => '<pre><code>' + blocks[i] + '</code></pre>');
  }

  // =========================================================================
  // Ações de arquivo
  // =========================================================================
  if (canWrite) {
    document.getElementById('btnNewFolder').onclick = () => {
      openModal('Nova pasta', `<input type="text" id="modalInput" placeholder="Nome da pasta" autofocus>`, async () => {
        const name = document.getElementById('modalInput').value.trim();
        if (!name) return;
        const fd = new FormData();
        fd.append('path', currentPath);
        fd.append('name', name);
        try {
          await api('mkdir', { method: 'POST', body: fd });
          showToast('Pasta criada.');
          loadDir(currentPath);
        } catch (e) { showToast(e.message, true); }
      });
    };

    document.getElementById('btnNewFile').onclick = () => {
      openModal('Novo arquivo', `<input type="text" id="modalInput" placeholder="nome-do-arquivo.txt" autofocus>`, async () => {
        const name = document.getElementById('modalInput').value.trim();
        if (!name) return;
        const fd = new FormData();
        fd.append('path', currentPath);
        fd.append('name', name);
        try {
          const res = await api('create_file', { method: 'POST', body: fd });
          showToast('Arquivo criado.');
          await loadDir(currentPath);
          const created = items.find(i => i.name === res.name);
          if (created) openEditor(created);
        } catch (e) { showToast(e.message, true); }
      });
    };

    document.getElementById('inputUploadFiles').addEventListener('change', (e) => {
      const files = Array.from(e.target.files).map(f => ({ file: f, rel: f.name }));
      uploadFiles(files);
      e.target.value = '';
    });

    document.getElementById('inputUploadFolder').addEventListener('change', (e) => {
      const files = Array.from(e.target.files).map(f => ({ file: f, rel: f.webkitRelativePath || f.name }));
      uploadFiles(files);
      e.target.value = '';
    });

    document.getElementById('btnZip').onclick = () => zipSelection();
    document.getElementById('btnCut').onclick = () => setClipboard('move');
    document.getElementById('btnCopy').onclick = () => setClipboard('copy');
    document.getElementById('btnDelete').onclick = () => deleteSelection();
    document.getElementById('btnPaste').onclick = () => pasteClipboard();
    document.getElementById('btnSettings').onclick = () => openSettings();
    document.getElementById('btnTrash').onclick = () => openTrash();
    document.getElementById('btnFolderUsage').onclick = () => openFolderUsage();
  }

  function renameItem(item) {
    openModal('Renomear', `<input type="text" id="modalInput" value="${escAttr(item.name)}" autofocus>`, async () => {
      const name = document.getElementById('modalInput').value.trim();
      if (!name || name === item.name) return;
      const fd = new FormData();
      fd.append('path', item.path);
      fd.append('new_name', name);
      try {
        await api('rename', { method: 'POST', body: fd });
        showToast('Renomeado.');
        loadDir(currentPath);
      } catch (e) { showToast(e.message, true); }
    });
  }

  function deleteSelection() {
    const paths = Array.from(selection);
    if (paths.length === 0) return;
    const body = `<p>Mover <strong>${paths.length}</strong> item(ns) para a lixeira?</p>
      <p class="editor-hint">Ficam recuperáveis em <strong>Lixeira</strong> até o expurgo automático.</p>`;
    openModal('Mover para a lixeira', body, async () => {
      const fd = new FormData();
      paths.forEach(p => fd.append('paths[]', p));
      try {
        const res = await api('delete', { method: 'POST', body: fd });
        showToast(res.ok ? `${res.trashed} item(ns) movido(s) para a lixeira.` : 'Alguns itens não puderam ser excluídos (discos montados não podem).', !res.ok);
        loadDir(currentPath);
      } catch (e) { showToast(e.message, true); }
    });
  }

  function setClipboard(mode) {
    const paths = Array.from(selection);
    if (paths.length === 0) return;
    clipboard = { mode, paths };
    updateToolbarState();
    showToast(mode === 'copy'
      ? `${paths.length} item(ns) copiado(s). Navegue até o destino e clique em Colar.`
      : `${paths.length} item(ns) marcado(s) para mover. Navegue até o destino e clique em Colar.`);
  }

  async function pasteClipboard() {
    if (!clipboard) return;
    const fd = new FormData();
    clipboard.paths.forEach(p => fd.append('paths[]', p));
    fd.append('dest', currentPath);
    try {
      const res = await api(clipboard.mode, { method: 'POST', body: fd });
      showToast(res.ok ? 'Concluído.' : 'Alguns itens falharam.', !res.ok);
      clipboard = null;
      updateToolbarState();
      loadDir(currentPath);
    } catch (e) { showToast(e.message, true); }
  }

  function zipSelection() {
    const paths = Array.from(selection);
    if (paths.length === 0) return;
    openModal('Compactar em ZIP', `<input type="text" id="modalInput" placeholder="Nome do arquivo (opcional)">`, async () => {
      const name = document.getElementById('modalInput').value.trim();
      const fd = new FormData();
      paths.forEach(p => fd.append('paths[]', p));
      fd.append('path', currentPath);
      fd.append('name', name);
      try {
        await api('zip', { method: 'POST', body: fd });
        showToast('ZIP criado.');
        loadDir(currentPath);
      } catch (e) { showToast(e.message, true); }
    });
  }

  async function unzipItem(item) {
    const fd = new FormData();
    fd.append('path', item.path);
    try {
      await api('unzip', { method: 'POST', body: fd });
      showToast('Arquivo descompactado.');
      loadDir(currentPath);
    } catch (e) { showToast(e.message, true); }
  }

  // =========================================================================
  // Links de compartilhamento
  // =========================================================================
  function openShareDialog(item) {
    const body = `
      <p class="editor-hint">Gera um link temporário para <strong>${escHtml(item.name)}</strong>, que funciona sem login.</p>
      <label class="field-label" for="shareHours">Validade</label>
      <select id="shareHours">
        <option value="1">1 hora</option>
        <option value="24" selected>24 horas</option>
        <option value="168">7 dias</option>
        <option value="720">30 dias</option>
      </select>
      <p class="editor-hint" style="margin-top:12px">
        Atenção: dentro do painel do Home Assistant toda URL do add-on exige a sessão do HA.
        Um link só é realmente público quando aberto pela porta 8099 do host — a mesma
        do botão "abrir em aba separada".
      </p>
      <div id="shareResult"></div>
      <div class="modal-actions">
        <button class="btn" id="shareCancel">Fechar</button>
        <button class="btn btn-primary" id="shareGo">Gerar link</button>
      </div>`;
    openPlainModal('Criar link temporário', body);

    document.getElementById('shareCancel').onclick = () => modalOverlay.classList.add('hidden');
    document.getElementById('shareGo').onclick = async () => {
      const fd = new FormData();
      fd.append('path', item.path);
      fd.append('hours', document.getElementById('shareHours').value);
      try {
        const res = await api('create_share', { method: 'POST', body: fd });
        const url = new URL('share.php?t=' + res.token, location.href).href;
        document.getElementById('shareResult').innerHTML = `
          <hr class="modal-sep">
          <label class="field-label">Link (expira em ${escHtml(new Date(res.expires_at * 1000).toLocaleString('pt-BR'))})</label>
          <div class="copy-field">
            <input type="text" id="shareUrl" readonly value="${escAttr(url)}">
            <button class="btn" id="shareCopy">Copiar</button>
          </div>`;
        document.getElementById('shareCopy').onclick = () => {
          const input = document.getElementById('shareUrl');
          input.select();
          navigator.clipboard?.writeText(input.value)
            .then(() => showToast('Link copiado.'))
            .catch(() => showToast('Selecione e copie manualmente.', true));
        };
      } catch (e) { showToast(e.message, true); }
    };
  }

  // =========================================================================
  // Lixeira
  // =========================================================================
  async function openTrash() {
    modalBox.classList.add('modal-box-editor');
    modalTitle.textContent = 'Lixeira';
    modalBody.innerHTML = '<p class="editor-hint">Carregando...</p>';
    modalOverlay.classList.remove('hidden');
    modalConfirm.style.display = 'none';

    try {
      const data = await api('trash_list');
      renderTrash(data);
    } catch (e) {
      modalBody.innerHTML = `<p class="editor-hint">${escHtml(e.message)}</p>`;
    }
  }

  function renderTrash(data) {
    const rows = (data.items || []).map(it => `
      <tr>
        <td>${escHtml(it.name)}<br><span class="editor-hint">/${escHtml(it.original_path)}</span></td>
        <td class="num">${it.is_dir ? 'pasta' : escHtml(human_filesize_js(it.size))}</td>
        <td class="num">${escHtml(fmtRelative(it.deleted_at))}<br><span class="editor-hint">${escHtml(it.deleted_by)}</span></td>
        <td class="num">
          <button class="btn btn-restore" data-id="${escAttr(it.id)}" title="Restaurar">${iconSvg('restore')}</button>
          <button class="btn btn-danger btn-purge" data-id="${escAttr(it.id)}" title="Excluir definitivamente">${iconSvg('trash')}</button>
        </td>
      </tr>`).join('');

    modalBody.innerHTML = `
      <p class="editor-hint">
        Itens excluídos ficam aqui por <strong>${data.retention_days === 0 ? 'tempo indeterminado' : data.retention_days + ' dias'}</strong>
        e depois são apagados sozinhos. A lixeira mora dentro de cada disco (<code>.file_full_trash</code>),
        então continua ocupando o espaço do próprio disco até ser expurgada.
      </p>
      ${rows
        ? `<table class="data-table"><thead><tr><th>Item</th><th class="num">Tamanho</th><th class="num">Excluído</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
        : '<p style="margin:24px 0;text-align:center;color:var(--ink-soft)">A lixeira está vazia.</p>'}
      <div class="modal-actions">
        <button class="btn" id="trashClose">Fechar</button>
        ${rows ? '<button class="btn btn-danger" id="trashEmpty">Esvaziar lixeira</button>' : ''}
      </div>`;

    document.getElementById('trashClose').onclick = () => modalOverlay.classList.add('hidden');

    modalBody.querySelectorAll('.btn-restore').forEach(btn => {
      btn.onclick = async () => {
        const fd = new FormData();
        fd.append('id', btn.dataset.id);
        try {
          const res = await api('trash_restore', { method: 'POST', body: fd });
          showToast('Restaurado em /' + res.restored_to);
          openTrash();
          loadDir(currentPath);
        } catch (e) { showToast(e.message, true); }
      };
    });

    modalBody.querySelectorAll('.btn-purge').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Excluir este item definitivamente? Não há como recuperar depois.')) return;
        const fd = new FormData();
        fd.append('id', btn.dataset.id);
        try {
          await api('trash_purge', { method: 'POST', body: fd });
          showToast('Item excluído definitivamente.');
          openTrash();
        } catch (e) { showToast(e.message, true); }
      };
    });

    const emptyBtn = document.getElementById('trashEmpty');
    if (emptyBtn) emptyBtn.onclick = async () => {
      if (!confirm('Esvaziar a lixeira apaga TODOS os itens definitivamente. Continuar?')) return;
      try {
        const res = await api('trash_empty', { method: 'POST', body: new FormData() });
        showToast(`${res.removed} item(ns) apagado(s) definitivamente.`);
        openTrash();
      } catch (e) { showToast(e.message, true); }
    };
  }

  // =========================================================================
  // Configurações
  // =========================================================================
  function inputRow(label, id, value, opts = {}) {
    const type = opts.type || 'text';
    return `<label class="field-label" for="${escAttr(id)}">${label}</label>
      <input type="${escAttr(type)}" id="${escAttr(id)}" value="${escAttr(value)}" placeholder="${escAttr(opts.placeholder || '')}">`;
  }
  function checkboxRow(label, id, checked) {
    return `<label class="check-row"><input type="checkbox" id="${escAttr(id)}" ${checked ? 'checked' : ''}> <span>${label}</span></label>`;
  }
  function backBtnHtml() {
    return `<button type="button" class="btn" id="settingsBack" style="margin-bottom:14px">← Voltar</button>`;
  }
  function wireBack() {
    document.getElementById('settingsBack').onclick = () => renderSettingsHub();
  }
  async function saveAddonOptionsAndRestart(partial) {
    try {
      const fd = new FormData();
      fd.append('options', JSON.stringify(partial));
      await api('save_addon_options', { method: 'POST', body: fd });
      showToast('Salvo — reiniciando o add-on...');
      api('restart_addon', { method: 'POST', body: new FormData() }).catch(() => {});
      setTimeout(() => modalOverlay.classList.add('hidden'), 1500);
    } catch (e) { showToast(e.message, true); }
  }

  function openSettings() { renderSettingsHub(); }

  function renderSettingsHub() {
    modalBox.classList.remove('modal-box-disks');
    modalBox.classList.add('modal-box-editor');
    modalTitle.textContent = 'Configurações';
    modalConfirm.style.display = 'none';
    const tile = (key, icon, label) =>
      `<button class="settings-tile" data-s="${key}">${iconSvg(icon)}<span>${label}</span></button>`;
    modalBody.innerHTML = `
      <div class="settings-grid">
        ${tile('geral', 'lock', 'Geral')}
        ${tile('discos', 'disk', 'Discos &amp; Montagem')}
        ${tile('smb', 'folder', 'SMB')}
        ${tile('time_machine', 'history', 'Time Machine')}
        ${tile('wireguard', 'lock', 'WireGuard')}
        ${tile('ssh', 'code', 'SSH')}
        ${tile('usuarios', 'info', 'Usuários')}
        ${tile('compartilhamentos', 'share', 'Links ativos')}
        ${tile('auditoria', 'history', 'Auditoria')}
        ${tile('sistema', 'settings', 'Sistema')}
      </div>
    `;
    modalOverlay.classList.remove('hidden');
    modalBody.querySelectorAll('.settings-tile').forEach(btn => {
      btn.onclick = () => renderSettingsSection(btn.dataset.s);
    });
  }

  async function renderSettingsSection(section) {
    try {
      const fns = {
        geral: renderSettingsGeral,
        discos: renderSettingsDiscos,
        smb: renderSettingsSmb,
        time_machine: renderSettingsTimeMachine,
        wireguard: renderSettingsWireguard,
        ssh: renderSettingsSsh,
        usuarios: renderSettingsUsuarios,
        compartilhamentos: renderSettingsShares,
        auditoria: renderSettingsAuditoria,
        sistema: renderSettingsSistema,
      };
      await fns[section]();
    } catch (e) { showToast(e.message, true); }
  }

  async function renderSettingsGeral() {
    const [data, tmStatus, smbStatus] = await Promise.all([
      api('get_settings'),
      api('time_machine_status').catch(() => null),
      api('smb_status').catch(() => null),
    ]);
    const current = (data.settings.blocked_extensions || []).join(', ');
    modalTitle.textContent = 'Geral';
    modalBody.innerHTML = `
      ${backBtnHtml()}
      ${data.always_blocked.length
        ? `<p class="editor-hint">Nunca podem ser enviadas, mesmo fora da lista: <strong>${escHtml(data.always_blocked.join(', '))}</strong></p>`
        : ''}
      ${inputRow('Extensões bloqueadas no upload (separadas por vírgula)', 'setExt', current, { placeholder: 'exe, bat, sh, jar' })}
      ${inputRow('Lixeira: dias até o expurgo automático (0 = manter para sempre)', 'setTrashDays', data.settings.trash_retention_days, { type: 'number' })}
      <p class="editor-hint" style="margin-top:14px">
        Time Machine: ${tmStatus && tmStatus.enabled ? '<span class="badge badge-ok">ativo</span>' : '<span class="badge">desativado</span>'} ·
        SMB: ${smbStatus && smbStatus.enabled ? '<span class="badge badge-ok">ativo</span>' : '<span class="badge">desativado</span>'}
        (configuráveis nas seções próprias)
      </p>
      <div class="modal-actions">
        <button class="btn" id="btnTestNotif">Testar notificação</button>
        <button class="btn btn-primary" id="btnSaveGeral">Salvar</button>
      </div>
    `;
    wireBack();
    document.getElementById('btnTestNotif').onclick = async () => {
      try { await api('test_notification', { method: 'POST', body: new FormData() }); showToast('Notificação enviada — confira o sino do Home Assistant.'); }
      catch (e) { showToast(e.message, true); }
    };
    document.getElementById('btnSaveGeral').onclick = async () => {
      const fd = new FormData();
      fd.append('blocked_extensions', document.getElementById('setExt').value);
      fd.append('trash_retention_days', document.getElementById('setTrashDays').value);
      try { await api('update_settings', { method: 'POST', body: fd }); showToast('Configurações salvas.'); }
      catch (e) { showToast(e.message, true); }
    };
  }

  async function renderSettingsDiscos() {
    const [optData, disksData] = await Promise.all([
      api('get_addon_options'),
      api('list_disks').catch(() => ({ devices: [] })),
    ]);
    const o = optData.options;
    const labels = (o.disk_labels || []).filter(Boolean).join('\n');
    const found = (disksData.devices || []).map(d => `
      <li><code>${escHtml(d.label || '(sem label)')}</code> — ${escHtml(d.path)}${d.fstype ? ' · ' + escHtml(d.fstype) : ''}${d.size ? ' · ' + escHtml(human_filesize_js(d.size)) : ''}</li>
    `).join('') || '<li>Nenhum disco encontrado ainda — conecte um HD e recarregue esta tela.</li>';
    modalTitle.textContent = 'Discos & Montagem';
    modalBody.innerHTML = `
      ${backBtnHtml()}
      <p class="editor-hint">Discos detectados agora — use o nome (label) daqui na lista de montagem abaixo:</p>
      <ul style="font-size:13px;margin:0 0 12px;padding-left:18px">${found}</ul>
      <label class="field-label" for="setDiskLabels">
        Discos a montar (um por linha — nome, ou <code>uuid:XXXX-YYYY[:nome]</code>)
      </label>
      <textarea id="setDiskLabels" rows="5" style="font-family:inherit">${escHtml(labels)}</textarea>
      <div style="margin-top:12px">
        <button class="btn" id="btnOpenDiskUsage">${iconSvg('chart')} Ver uso de espaço e formatar</button>
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="btnSaveDiscos">Salvar (reinicia o add-on)</button>
      </div>
    `;
    wireBack();
    document.getElementById('btnOpenDiskUsage').onclick = () => openDisksPanel();
    document.getElementById('btnSaveDiscos').onclick = async () => {
      const list = document.getElementById('setDiskLabels').value.split('\n').map(s => s.trim()).filter(Boolean);
      await saveAddonOptionsAndRestart({ disk_labels: list });
    };
  }

  async function renderSettingsSmb() {
    const data = await api('get_addon_options');
    const o = data.options;
    modalTitle.textContent = 'SMB (acesso geral)';
    modalBody.innerHTML = `
      ${backBtnHtml()}
      <p class="editor-hint">Compartilha os mesmos discos do gerenciador via SMB, com login próprio (diferente do login web).</p>
      ${checkboxRow('Ativar SMB de uso geral', 'smbEnabled', o.smb_enabled)}
      ${inputRow('Nome da máquina na rede (Windows, Finder, Bonjour &lt;nome&gt;.local)', 'smbName', o.smb_server_name || 'file-full')}
      <p class="editor-hint">Vale também para o anúncio do Time Machine e do SSH. Em branco = hostname interno do container. Aceita espaços; NetBIOS e <code>.local</code> são ajustados sozinhos.</p>
      ${inputRow('Usuário', 'smbUser', o.smb_username)}
      ${inputRow('Senha (em branco = manter a atual)', 'smbPass', '', { type: 'password', placeholder: o.smb_password_set ? '••••••• (já definida)' : '' })}
      <div class="modal-actions"><button class="btn btn-primary" id="btnSaveSmb">Salvar (reinicia o add-on)</button></div>
    `;
    wireBack();
    document.getElementById('btnSaveSmb').onclick = async () => {
      await saveAddonOptionsAndRestart({
        smb_enabled: document.getElementById('smbEnabled').checked,
        smb_server_name: document.getElementById('smbName').value.trim(),
        smb_username: document.getElementById('smbUser').value.trim(),
        smb_password: document.getElementById('smbPass').value,
      });
    };
  }

  async function renderSettingsTimeMachine() {
    const data = await api('get_addon_options');
    const o = data.options;
    modalTitle.textContent = 'Time Machine';
    modalBody.innerHTML = `
      ${backBtnHtml()}
      <p class="editor-hint">Dedica um disco inteiro ao backup do Mac (não mistura com arquivos comuns). Use o mesmo nome que aparece em "Discos &amp; Montagem".</p>
      ${checkboxRow('Ativar Time Machine', 'tmEnabled', o.time_machine_enabled)}
      ${inputRow('Disco dedicado (nome ou uuid:XXXX-YYYY)', 'tmDisk', o.time_machine_disk)}
      ${inputRow('Usuário SMB', 'tmUser', o.time_machine_username)}
      ${inputRow('Senha (em branco = manter a atual)', 'tmPass', '', { type: 'password', placeholder: o.time_machine_password_set ? '••••••• (já definida)' : '' })}
      ${inputRow('Limite de tamanho em GB (0 = sem limite)', 'tmMax', o.time_machine_max_size_gb, { type: 'number' })}
      <div class="modal-actions"><button class="btn btn-primary" id="btnSaveTm">Salvar (reinicia o add-on)</button></div>
    `;
    wireBack();
    document.getElementById('btnSaveTm').onclick = async () => {
      await saveAddonOptionsAndRestart({
        time_machine_enabled: document.getElementById('tmEnabled').checked,
        time_machine_disk: document.getElementById('tmDisk').value.trim(),
        time_machine_username: document.getElementById('tmUser').value.trim(),
        time_machine_password: document.getElementById('tmPass').value,
        time_machine_max_size_gb: parseInt(document.getElementById('tmMax').value || '0', 10),
      });
    };
  }

  async function renderSettingsWireguard() {
    const data = await api('get_addon_options');
    const o = data.options;
    modalTitle.textContent = 'WireGuard';
    modalBody.innerHTML = `
      ${backBtnHtml()}
      <p class="editor-hint">Cliente WireGuard: conecta este add-on num servidor VPN existente. Cole aqui os dados do <code>.conf</code> que o servidor forneceu.</p>
      ${checkboxRow('Ativar cliente WireGuard', 'wgEnabled', o.wg_enabled)}
      ${inputRow('Chave privada (em branco = manter a atual)', 'wgPriv', '', { type: 'password', placeholder: o.wg_private_key_set ? '••••••• (já definida)' : '' })}
      ${inputRow('Address (ex: 10.96.165.4/24)', 'wgAddr', o.wg_address)}
      ${inputRow('DNS (opcional)', 'wgDns', o.wg_dns)}
      ${inputRow('Chave pública do servidor', 'wgPeerPub', o.wg_peer_public_key)}
      ${inputRow('Chave pré-compartilhada (opcional, em branco = manter)', 'wgPsk', '', { type: 'password', placeholder: o.wg_preshared_key_set ? '••••••• (já definida)' : '' })}
      ${inputRow('Endpoint (host:porta)', 'wgEndpoint', o.wg_endpoint, { placeholder: '203.0.113.10:51820' })}
      ${inputRow('AllowedIPs (em branco = calculado sozinho, NÃO use 0.0.0.0/0)', 'wgAllowed', o.wg_allowed_ips)}
      ${inputRow('Keepalive em segundos (0 desliga)', 'wgKeepalive', o.wg_persistent_keepalive, { type: 'number' })}
      <hr class="modal-sep">
      <p class="editor-hint">Segundo cliente (opcional) — outro servidor VPN, independente do primeiro. Sobe como interface separada (wg1).</p>
      ${checkboxRow('Ativar 2º cliente WireGuard', 'wg2Enabled', o.wg2_enabled)}
      ${inputRow('Chave privada (em branco = manter a atual)', 'wg2Priv', '', { type: 'password', placeholder: o.wg2_private_key_set ? '••••••• (já definida)' : '' })}
      ${inputRow('Address (ex: 10.96.165.5/24)', 'wg2Addr', o.wg2_address)}
      ${inputRow('DNS (opcional)', 'wg2Dns', o.wg2_dns)}
      ${inputRow('Chave pública do servidor', 'wg2PeerPub', o.wg2_peer_public_key)}
      ${inputRow('Chave pré-compartilhada (opcional, em branco = manter)', 'wg2Psk', '', { type: 'password', placeholder: o.wg2_preshared_key_set ? '••••••• (já definida)' : '' })}
      ${inputRow('Endpoint (host:porta)', 'wg2Endpoint', o.wg2_endpoint, { placeholder: '203.0.113.10:51820' })}
      ${inputRow('AllowedIPs (em branco = calculado sozinho, NÃO use 0.0.0.0/0)', 'wg2Allowed', o.wg2_allowed_ips)}
      ${inputRow('Keepalive em segundos (0 desliga)', 'wg2Keepalive', o.wg2_persistent_keepalive, { type: 'number' })}
      <div class="modal-actions"><button class="btn btn-primary" id="btnSaveWg">Salvar (reinicia o add-on)</button></div>
    `;
    wireBack();
    document.getElementById('btnSaveWg').onclick = async () => {
      await saveAddonOptionsAndRestart({
        wg_enabled: document.getElementById('wgEnabled').checked,
        wg_private_key: document.getElementById('wgPriv').value,
        wg_address: document.getElementById('wgAddr').value.trim(),
        wg_dns: document.getElementById('wgDns').value.trim(),
        wg_peer_public_key: document.getElementById('wgPeerPub').value.trim(),
        wg_preshared_key: document.getElementById('wgPsk').value,
        wg_endpoint: document.getElementById('wgEndpoint').value.trim(),
        wg_allowed_ips: document.getElementById('wgAllowed').value.trim(),
        wg_persistent_keepalive: parseInt(document.getElementById('wgKeepalive').value || '0', 10),
        wg2_enabled: document.getElementById('wg2Enabled').checked,
        wg2_private_key: document.getElementById('wg2Priv').value,
        wg2_address: document.getElementById('wg2Addr').value.trim(),
        wg2_dns: document.getElementById('wg2Dns').value.trim(),
        wg2_peer_public_key: document.getElementById('wg2PeerPub').value.trim(),
        wg2_preshared_key: document.getElementById('wg2Psk').value,
        wg2_endpoint: document.getElementById('wg2Endpoint').value.trim(),
        wg2_allowed_ips: document.getElementById('wg2Allowed').value.trim(),
        wg2_persistent_keepalive: parseInt(document.getElementById('wg2Keepalive').value || '0', 10),
      });
    };
  }

  async function renderSettingsSsh() {
    const data = await api('get_addon_options');
    const o = data.options;
    modalTitle.textContent = 'SSH';
    modalBody.innerHTML = `
      ${backBtnHtml()}
      <p class="editor-hint">Acesso root ao container por SSH, somente com chave pública (login por senha nunca é habilitado).</p>
      ${checkboxRow('Ativar SSH', 'sshEnabled', o.ssh_enabled)}
      ${inputRow('Porta', 'sshPort', o.ssh_port || 2222, { type: 'number' })}
      <label class="field-label" for="sshKey">Chave pública autorizada</label>
      <textarea id="sshKey" rows="4" placeholder="ssh-ed25519 AAAA... ou ssh-rsa AAAA..." style="font-family:var(--mono);font-size:12px">${escHtml(o.ssh_authorized_key || '')}</textarea>
      <div class="modal-actions">
        <button class="btn" id="btnGenSsh">Gerar novo par de chaves</button>
        <button class="btn btn-primary" id="btnSaveSsh">Salvar (reinicia o add-on)</button>
      </div>
      <p class="editor-hint" style="margin-top:10px">Não tem uma chave própria? "Gerar novo par" cria uma, preenche o campo acima com a pública e baixa a privada. Ela só é mostrada uma vez — guarde antes de clicar em Salvar.</p>
    `;
    wireBack();
    document.getElementById('btnSaveSsh').onclick = async () => {
      await saveAddonOptionsAndRestart({
        ssh_enabled: document.getElementById('sshEnabled').checked,
        ssh_port: parseInt(document.getElementById('sshPort').value || '2222', 10),
        ssh_authorized_key: document.getElementById('sshKey').value.trim(),
      });
    };
    document.getElementById('btnGenSsh').onclick = async () => {
      if (!confirm('Gerar um novo par de chaves substitui a chave autorizada atual — quem usava a chave antiga perde o acesso. Continuar?')) return;
      try {
        const res = await api('ssh_generate_keypair', { method: 'POST', body: new FormData() });
        document.getElementById('sshKey').value = res.public_key;
        document.getElementById('sshEnabled').checked = true;
        const blob = new Blob([res.private_key], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'file_full_id_ed25519';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
        showToast('Chave privada baixada — guarde-a agora, ela não aparece de novo. Clique em Salvar para ativar.');
      } catch (e) { showToast(e.message, true); }
    };
  }

  async function renderSettingsUsuarios() {
    const data = await api('list_users');
    const rows = data.users.map(u => `
      <tr>
        <td>${escHtml(u.username)}</td>
        <td><span class="badge ${u.role === 'admin' ? 'badge-ok' : ''}">${u.role === 'admin' ? 'administrador' : 'somente leitura'}</span></td>
        <td class="num"><button class="btn btn-danger btn-del-user" data-u="${escAttr(u.username)}">Excluir</button></td>
      </tr>`).join('');
    modalTitle.textContent = 'Usuários';
    modalBody.innerHTML = `
      ${backBtnHtml()}
      <table class="data-table"><thead><tr><th>Usuário</th><th>Papel</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <hr class="modal-sep">
      <p class="editor-hint">Novo usuário — sem relação com as credenciais de SMB ou Time Machine, que têm login próprio.</p>
      ${inputRow('Usuário', 'newUserName', '')}
      ${inputRow('Senha (mín. 8 caracteres)', 'newUserPass', '', { type: 'password' })}
      <label class="field-label" for="newUserRole">Papel</label>
      <select id="newUserRole">
        <option value="viewer">Somente leitura</option>
        <option value="admin">Administrador</option>
      </select>
      <div class="modal-actions"><button class="btn btn-primary" id="btnAddUser">Criar usuário</button></div>
    `;
    wireBack();
    modalBody.querySelectorAll('.btn-del-user').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm(`Excluir o usuário "${btn.dataset.u}"?`)) return;
        const fd = new FormData();
        fd.append('username', btn.dataset.u);
        try { await api('delete_user', { method: 'POST', body: fd }); showToast('Usuário excluído.'); renderSettingsUsuarios(); }
        catch (e) { showToast(e.message, true); }
      };
    });
    document.getElementById('btnAddUser').onclick = async () => {
      const fd = new FormData();
      fd.append('username', document.getElementById('newUserName').value.trim());
      fd.append('password', document.getElementById('newUserPass').value);
      fd.append('role', document.getElementById('newUserRole').value);
      try { await api('create_user', { method: 'POST', body: fd }); showToast('Usuário criado.'); renderSettingsUsuarios(); }
      catch (e) { showToast(e.message, true); }
    };
  }

  async function renderSettingsShares() {
    const data = await api('list_shares');
    const rows = (data.shares || []).map(s => {
      const url = new URL('share.php?t=' + s.token, location.href).href;
      return `<tr>
        <td>/${escHtml(s.path)}<br><span class="editor-hint">por ${escHtml(s.created_by)} · ${s.downloads || 0} download(s)</span></td>
        <td class="num">${escHtml(new Date(s.expires_at * 1000).toLocaleString('pt-BR'))}</td>
        <td class="num">
          <button class="btn btn-copy-share" data-url="${escAttr(url)}">Copiar</button>
          <button class="btn btn-danger btn-revoke" data-token="${escAttr(s.token)}">Revogar</button>
        </td>
      </tr>`;
    }).join('');
    modalTitle.textContent = 'Links de compartilhamento ativos';
    modalBody.innerHTML = `
      ${backBtnHtml()}
      <p class="editor-hint">Links vencidos somem sozinhos desta lista. Revogar invalida o link na hora.</p>
      ${rows
        ? `<table class="data-table"><thead><tr><th>Arquivo</th><th class="num">Expira</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
        : '<p style="margin:24px 0;text-align:center;color:var(--ink-soft)">Nenhum link ativo.</p>'}
    `;
    wireBack();
    modalBody.querySelectorAll('.btn-copy-share').forEach(btn => {
      btn.onclick = () => {
        navigator.clipboard?.writeText(btn.dataset.url)
          .then(() => showToast('Link copiado.'))
          .catch(() => showToast('Não foi possível copiar automaticamente.', true));
      };
    });
    modalBody.querySelectorAll('.btn-revoke').forEach(btn => {
      btn.onclick = async () => {
        const fd = new FormData();
        fd.append('token', btn.dataset.token);
        try { await api('revoke_share', { method: 'POST', body: fd }); showToast('Link revogado.'); renderSettingsShares(); }
        catch (e) { showToast(e.message, true); }
      };
    });
  }

  async function renderSettingsAuditoria() {
    const data = await api('audit_log', { params: { limit: 300 } });
    const rows = (data.entries || []).map(e => {
      const alvo = e.path || e.to || e.username || e.device || (e.paths ? e.paths.join(', ') : '') || '';
      return `<tr>
        <td class="num">${escHtml(new Date(e.ts).toLocaleString('pt-BR'))}</td>
        <td>${escHtml(e.user)}</td>
        <td>${escHtml(e.action)} ${e.ok === false ? '<span class="badge badge-danger">falhou</span>' : ''}</td>
        <td>${escHtml(String(alvo).slice(0, 120))}</td>
      </tr>`;
    }).join('');
    modalTitle.textContent = 'Auditoria';
    modalBody.innerHTML = `
      ${backBtnHtml()}
      <p class="editor-hint">Toda ação de escrita (criar, renomear, excluir, mover, formatar, mexer em usuários/configuração) fica registrada aqui, com quem fez e quando. Guardado em <code>/data/audit.log</code>.</p>
      ${rows
        ? `<div style="max-height:56vh;overflow-y:auto"><table class="data-table"><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Alvo</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : '<p style="margin:24px 0;text-align:center;color:var(--ink-soft)">Nenhum registro ainda.</p>'}
    `;
    wireBack();
  }

  async function renderSettingsSistema() {
    const data = await api('get_addon_options');
    const o = data.options;
    modalTitle.textContent = 'Sistema';
    modalBody.innerHTML = `
      ${backBtnHtml()}
      <p class="editor-hint">Pastas extras visíveis no gerenciador:</p>
      ${checkboxRow('<code>/config</code> — configuração do Home Assistant <strong>(dá acesso de escrita ao secrets.yaml)</strong>', 'sysExposeConfig', o.expose_ha_config)}
      ${checkboxRow('<code>/addons</code> — outros add-ons instalados', 'sysExposeAddons', o.expose_addons)}
      ${checkboxRow('<code>/backup</code> — backups do Home Assistant', 'sysExposeBackup', o.expose_backup)}
      ${checkboxRow('<code>/addon_configs</code> — config privada de outros add-ons (pode conter tokens)', 'sysExposeAddonConfigs', o.expose_addon_configs)}
      <div class="modal-actions"><button class="btn btn-primary" id="btnSaveSistema">Salvar (reinicia o add-on)</button></div>
    `;
    wireBack();
    document.getElementById('btnSaveSistema').onclick = async () => {
      await saveAddonOptionsAndRestart({
        expose_ha_config: document.getElementById('sysExposeConfig').checked,
        expose_addons: document.getElementById('sysExposeAddons').checked,
        expose_backup: document.getElementById('sysExposeBackup').checked,
        expose_addon_configs: document.getElementById('sysExposeAddonConfigs').checked,
      });
    };
  }

  // ---------- Uso de espaço da pasta ----------
  async function openFolderUsage() {
    modalBox.classList.add('modal-box-editor');
    modalTitle.textContent = 'Uso de espaço — /' + (currentPath || '');
    modalBody.innerHTML = '<p class="editor-hint">Calculando... pode demorar em pastas grandes.</p>';
    modalOverlay.classList.remove('hidden');
    modalConfirm.style.display = 'none';

    try {
      const data = await api('folder_usage', { params: { path: currentPath } });
      const list = data.items || [];
      const maxSize = Math.max(1, ...list.map(i => i.size || 0));
      const rows = list.map(i => `
        <div class="usage-item">
          <div class="usage-item-head">
            <span>${escHtml(i.name)}</span>
            <span>${i.timeout ? 'não foi possível calcular a tempo' : escHtml(human_filesize_js(i.size))}</span>
          </div>
          <div class="usage-bar"><div class="usage-bar-fill" style="width:${i.timeout ? 0 : (i.size / maxSize) * 100}%"></div></div>
        </div>
      `).join('');
      modalBody.innerHTML = `<div class="usage-summary">${rows || '<p>Pasta vazia.</p>'}</div>`;
    } catch (e) {
      modalBody.innerHTML = `<p style="color:var(--danger)">${escHtml(e.message)}</p>`;
    }
  }

  // ---------- Discos, SMART e formatação ----------
  async function openDisksPanel() {
    try {
      const [disksData, usageData, tmStatus] = await Promise.all([
        api('list_disks'),
        api('disk_usage').catch(() => ({ usage: [] })),
        api('time_machine_status').catch(() => null),
      ]);
      renderDisksList(disksData.devices, usageData.usage || [], tmStatus);
    } catch (e) { showToast(e.message, true); }
  }

  function renderDisksList(devices, usage, tmStatus) {
    modalBox.classList.add('modal-box-editor');
    modalBox.classList.add('modal-box-disks');
    modalTitle.textContent = 'Discos';

    const usageByName = {};
    (usage || []).forEach(u => { usageByName[u.name] = u; });

    const rows = devices.map((d, idx) => {
      const sizeStr = d.size ? human_filesize_js(d.size) : '—';
      const smartBtn = d.type === 'disk' ? `<button class="btn btn-smart" data-path="${escAttr(d.path)}">SMART</button>` : '';
      const isTimeMachineDisk = tmStatus && tmStatus.enabled && d.label === tmStatus.disk;
      const tmBadge = isTimeMachineDisk ? ' <span class="badge badge-ok">Time Machine</span>' : '';
      const u = usageByName[d.label] || usageByName[(d.mountpoint || '').split('/').pop()];
      const usageHtml = u ? `
        <div class="usage-item" style="margin-top:8px">
          <div class="usage-item-head" style="flex-direction:row;justify-content:space-between">
            <span>${escHtml(String(u.percent))}% usado</span><span>${escHtml(human_filesize_js(u.used))} de ${escHtml(human_filesize_js(u.total))}</span>
          </div>
          <div class="usage-bar"><div class="usage-bar-fill" style="width:${Math.min(u.percent, 100)}%; background:${u.percent >= 90 ? 'var(--danger)' : 'var(--accent)'}"></div></div>
        </div>
      ` : '<p class="editor-hint" style="margin-top:8px">Sem dado de uso (disco sem sistema de arquivos montado).</p>';

      return `
        <div class="disk-card" data-idx="${idx}">
          <div class="disk-card-head">
            <div>
              <strong>${escHtml(d.label || d.path)}</strong>${tmBadge}
              <span class="editor-hint">${escHtml(d.path)} · ${escHtml(d.fstype || 'sem sistema de arquivos')} · ${escHtml(sizeStr)}</span>
            </div>
            <div style="white-space:nowrap">${smartBtn} <button class="btn btn-danger btn-format" data-path="${escAttr(d.path)}">Formatar</button></div>
          </div>
          <div class="disk-card-usage" style="display:none">${usageHtml}</div>
        </div>
      `;
    }).join('');

    modalBody.innerHTML = `
      <p class="editor-hint" style="margin-bottom:10px">
        Clique num disco para ver o espaço usado. Discos do sistema do próprio Home Assistant
        (boot, dados, swap) não aparecem aqui — nunca podem ser formatados por este painel.
      </p>
      <div class="disks-cards">${rows || '<p>Nenhum dispositivo encontrado.</p>'}</div>
    `;
    modalOverlay.classList.remove('hidden');
    modalConfirm.style.display = 'none';

    modalBody.querySelectorAll('.disk-card-head').forEach(head => {
      head.onclick = (ev) => {
        if (ev.target.closest('button')) return;
        const card = head.closest('.disk-card');
        const panel = card.querySelector('.disk-card-usage');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      };
    });

    modalBody.querySelectorAll('.btn-smart').forEach(btn => {
      btn.onclick = () => showSmartInfo(btn.dataset.path, devices, usage, tmStatus);
    });

    modalBody.querySelectorAll('.btn-format').forEach(btn => {
      btn.onclick = () => {
        const device = devices.find(d => d.path === btn.dataset.path);
        if (device) showFormatWizard(device, devices, usage, tmStatus);
      };
    });
  }

  async function showSmartInfo(devicePath, allDevices, usage, tmStatus) {
    try {
      const data = await api('disk_smart', { params: { device: devicePath } });
      const s = data.smart;
      let body;
      if (!s.supported) {
        body = `<p>${escHtml(s.message)}</p>`;
      } else {
        const healthLabel = s.healthy === true
          ? '<span class="badge badge-ok">saudável</span>'
          : (s.healthy === false ? '<span class="badge badge-danger">FALHA — faça backup!</span>' : '<span class="badge">desconhecido</span>');
        const row = (k, v) => `<tr><td>${k}</td><td class="num">${escHtml(v == null ? '—' : String(v))}</td></tr>`;
        body = `
          <table class="data-table">
            <tr><td>Status</td><td class="num">${healthLabel}</td></tr>
            ${row('Modelo', s.model)}
            ${row('Número de série', s.serial)}
            ${row('Temperatura', s.temperature_c != null ? s.temperature_c + ' °C' : null)}
            ${row('Horas ligado', s.power_on_hours != null ? s.power_on_hours + ' h' : null)}
            ${row('Ciclos de energia', s.power_cycles)}
            ${row('Setores realocados', s.reallocated_sectors)}
            ${row('Setores pendentes', s.pending_sectors)}
          </table>
        `;
      }
      modalTitle.textContent = 'SMART — ' + devicePath;
      modalBody.innerHTML = body + `<div class="modal-actions"><button class="btn" id="smartBack">Voltar</button></div>`;
      document.getElementById('smartBack').onclick = () => renderDisksList(allDevices, usage, tmStatus);
    } catch (e) { showToast(e.message, true); }
  }

  function showFormatWizard(device, allDevices, usage, tmStatus) {
    const isTimeMachineDisk = tmStatus && tmStatus.enabled && device.label === tmStatus.disk;
    const tmWarning = isTimeMachineDisk ? `
      <p style="color:var(--danger);font-weight:600;margin:0 0 10px;padding:9px;border:1px solid var(--danger);border-radius:7px">
        Este é o disco configurado para o Time Machine. Formatar aqui apaga todo o backup do Mac também.
      </p>
    ` : '';
    modalTitle.textContent = 'Formatar ' + device.path;
    modalBody.innerHTML = `
      ${tmWarning}
      <p style="color:var(--danger);font-weight:600;margin:0 0 12px">
        Isso apaga TODOS os dados de ${escHtml(device.path)} permanentemente. Não pode ser desfeito.
      </p>
      <label class="field-label" for="fmtFstype">Tipo de sistema de arquivos</label>
      <select id="fmtFstype">
        <option value="ext4">ext4 ${isTimeMachineDisk ? '(recomendado para Time Machine)' : '(recomendado para uso só no Linux/HA)'}</option>
        <option value="exfat">exFAT ${isTimeMachineDisk ? '(NÃO recomendado para Time Machine)' : '(compatível com Windows e Mac)'}</option>
        <option value="vfat">FAT32 ${isTimeMachineDisk ? '(NÃO funciona com Time Machine)' : '(mais compatível, limite de arquivo de 4GB)'}</option>
      </select>
      <p id="fmtFstypeWarning" class="editor-hint" style="display:none;color:var(--danger)"></p>
      <label class="field-label" for="fmtLabel">Nome do disco (label)</label>
      <input type="text" id="fmtLabel" placeholder="Ex: HD_EXTERNO">
      <label class="field-label" for="fmtConfirm">Para confirmar, digite exatamente <code>${escHtml(device.path)}</code></label>
      <input type="text" id="fmtConfirm" placeholder="${escAttr(device.path)}">
      <div id="fmtOutput" class="fmt-output" style="display:none;margin-top:12px"></div>
      <div class="modal-actions">
        <button class="btn" id="fmtCancel">Voltar</button>
        <button class="btn btn-danger" id="fmtGo" disabled>Formatar agora</button>
      </div>
    `;
    modalOverlay.classList.remove('hidden');

    const confirmInput = document.getElementById('fmtConfirm');
    const goBtn = document.getElementById('fmtGo');
    confirmInput.addEventListener('input', () => {
      goBtn.disabled = confirmInput.value !== device.path;
    });
    document.getElementById('fmtCancel').onclick = () => renderDisksList(allDevices, usage, tmStatus);

    if (isTimeMachineDisk) {
      const fstypeSelect = document.getElementById('fmtFstype');
      const fstypeWarning = document.getElementById('fmtFstypeWarning');
      const updateFstypeWarning = () => {
        if (fstypeSelect.value === 'ext4') {
          fstypeWarning.style.display = 'none';
        } else {
          fstypeWarning.style.display = 'block';
          fstypeWarning.textContent = fstypeSelect.value === 'vfat'
            ? 'FAT32 não funciona com Time Machine (sem suporte a atributos estendidos, limite de 4GB por arquivo). O backup vai falhar.'
            : 'exFAT não tem suporte confiável a atributos estendidos — o Time Machine pode falhar ou se corromper com o tempo. ext4 é o recomendado aqui.';
        }
      };
      fstypeSelect.addEventListener('change', updateFstypeWarning);
      updateFstypeWarning();
    }

    goBtn.onclick = async () => {
      goBtn.disabled = true;
      goBtn.textContent = 'Formatando...';
      const fd = new FormData();
      fd.append('device', device.path);
      fd.append('fstype', document.getElementById('fmtFstype').value);
      fd.append('label', document.getElementById('fmtLabel').value.trim());
      fd.append('confirm', confirmInput.value);
      try {
        const res = await api('format_disk', { method: 'POST', body: fd });
        showToast('Disco formatado com sucesso.');
        const out = document.getElementById('fmtOutput');
        out.style.display = 'block';
        let msg = (res.output || '(sem saída)') + '\n\n';
        if (res.mount && res.mount.mounted) {
          msg += `Já montado e disponível em: ${res.mount.mount_point}\n`;
          msg += `Para continuar disponível depois de reiniciar o add-on, adicione "${res.mount.label}" em disk_labels na Configuração.`;
        } else {
          msg += 'Formatado, mas não consegui montar automaticamente — pode precisar reiniciar o add-on.';
        }
        out.textContent = msg;
        goBtn.style.display = 'none';
      } catch (e) {
        showToast(e.message, true);
        goBtn.disabled = false;
        goBtn.textContent = 'Formatar agora';
        if (e.output) {
          const out = document.getElementById('fmtOutput');
          out.style.display = 'block';
          out.textContent = e.output;
        }
      }
    };
  }

  // ---------- Modal ----------
  let modalConfirmHandler = null;
  function openModal(title, bodyHtml, onConfirm) {
    modalBox.classList.remove('modal-box-editor', 'modal-box-disks');
    modalConfirm.style.display = '';
    modalConfirm.textContent = 'Confirmar';
    modalTitle.textContent = title;
    modalBody.innerHTML = bodyHtml;
    modalOverlay.classList.remove('hidden');
    modalConfirmHandler = onConfirm;
    const input = document.getElementById('modalInput');
    if (input) {
      input.focus();
      input.select();
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmModal(); });
    }
  }
  /** Modal sem os botões padrão (a própria tela desenha os seus) */
  function openPlainModal(title, bodyHtml) {
    modalBox.classList.remove('modal-box-disks');
    modalBox.classList.add('modal-box-editor');
    modalTitle.textContent = title;
    modalBody.innerHTML = bodyHtml;
    modalConfirm.style.display = 'none';
    modalConfirmHandler = null;
    modalOverlay.classList.remove('hidden');
  }
  function confirmModal() {
    modalOverlay.classList.add('hidden');
    if (modalConfirmHandler) modalConfirmHandler();
  }
  modalConfirm.onclick = confirmModal;
  modalCancel.onclick = () => modalOverlay.classList.add('hidden');
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) modalOverlay.classList.add('hidden');
  });

  // ---------- Editor de texto ----------
  async function openEditor(item) {
    try {
      const data = await api('read_file', { params: { path: item.path } });
      showEditor(item, data.content);
    } catch (e) { showToast(e.message, true); }
  }

  function showEditor(item, content) {
    const readOnly = !canWrite;
    modalBox.classList.add('modal-box-editor');
    modalTitle.textContent = item.name;
    modalBody.innerHTML = `
      <textarea id="editorTextarea" class="editor-textarea" spellcheck="false" autocapitalize="off" autocomplete="off"${readOnly ? ' readonly' : ''}></textarea>
      <p class="editor-hint">${readOnly ? 'Somente leitura — seu usuário tem permissão apenas de visualização.' : 'Ctrl/Cmd+S salva sem fechar.'}</p>
    `;
    const ta = document.getElementById('editorTextarea');
    ta.value = content; // .value, nunca innerHTML: conteúdo de arquivo é texto
    modalOverlay.classList.remove('hidden');
    modalConfirm.style.display = readOnly ? 'none' : '';
    modalConfirm.textContent = 'Salvar';
    ta.focus();

    ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (!readOnly) saveEditor(item, ta.value, false);
      }
    });

    modalConfirmHandler = readOnly ? null : () => saveEditor(item, ta.value, true);
  }

  async function saveEditor(item, content, closeAfter) {
    const fd = new FormData();
    fd.append('path', item.path);
    fd.append('content', content);
    try {
      await api('save_file', { method: 'POST', body: fd });
      showToast('Arquivo salvo.');
      if (!closeAfter) modalOverlay.classList.remove('hidden'); // Ctrl+S não fecha o modal
    } catch (e) { showToast(e.message, true); }
  }

  // ---------- Upload (com estrutura de pastas + progresso) ----------
  function uploadFiles(fileList) {
    if (!fileList.length) return;
    uploadPanel.classList.remove('hidden');
    uploadPanelTitle.textContent = `Enviando ${fileList.length} item(ns)...`;
    uploadProgressFill.style.width = '0%';

    const limits = window.SERVER_LIMITS || { postMaxBytes: 8 * 1024 * 1024, uploadMaxBytes: 2 * 1024 * 1024, maxFileUploads: 20 };
    // Margem de segurança: o corpo do POST tem overhead do multipart (boundaries, nomes de
    // campo etc.), então usamos ~80% do post_max_size real do servidor por lote.
    const MAX_BATCH_BYTES = Math.max(256 * 1024, Math.floor(limits.postMaxBytes * 0.8));
    const MAX_BATCH_COUNT = Math.max(1, limits.maxFileUploads - 1);

    // Avisa (e descarta) arquivos individuais maiores do que upload_max_filesize —
    // o servidor rejeitaria de qualquer forma, e sem esse aviso a falha seria silenciosa.
    const tooLarge = fileList.filter(f => f.file.size > limits.uploadMaxBytes);
    if (tooLarge.length) {
      const names = tooLarge.map(f => f.rel).slice(0, 5).join(', ');
      showToast(`${tooLarge.length} arquivo(s) maior(es) que o limite do servidor (${(limits.uploadMaxBytes / 1024 / 1024).toFixed(0)}MB) foram ignorados: ${names}`, true);
      fileList = fileList.filter(f => f.file.size <= limits.uploadMaxBytes);
    }
    if (!fileList.length) return;

    let batches = [];
    let current = [];
    let currentBytes = 0;
    fileList.forEach((entry) => {
      const size = entry.file.size;
      if (current.length && (currentBytes + size > MAX_BATCH_BYTES || current.length >= MAX_BATCH_COUNT)) {
        batches.push(current);
        current = [];
        currentBytes = 0;
      }
      current.push(entry);
      currentBytes += size;
    });
    if (current.length) batches.push(current);

    let sent = 0;
    let failedTotal = [];
    let serverErrors = [];

    function sendBatch(idx) {
      if (idx >= batches.length) {
        const totalFailed = failedTotal.length;
        if (totalFailed === 0 && serverErrors.length === 0) {
          uploadPanelDetail.textContent = 'Envio concluído.';
          showToast('Envio concluído.');
        } else {
          const msg = serverErrors.length
            ? `Falha no envio: ${serverErrors[0]}`
            : `Envio concluído com ${totalFailed} falha(s): ${failedTotal.slice(0, 5).join(', ')}${failedTotal.length > 5 ? '...' : ''}`;
          uploadPanelDetail.textContent = msg;
          showToast(msg, true);
          console.error('Falhas no upload:', { failedTotal, serverErrors });
        }
        setTimeout(() => uploadPanel.classList.add('hidden'), 4000);
        loadDir(currentPath);
        return;
      }
      const batch = batches[idx];
      const destPath = currentPath;
      const fd = new FormData();
      fd.append('path', destPath);
      batch.forEach(({ file, rel }) => {
        fd.append('files[]', file, file.name);
        fd.append('relpaths[]', rel);
      });

      const xhr = new XMLHttpRequest();
      xhr.open('POST', 'api.php?action=upload');
      // O token CSRF precisa ir aqui também: este POST não passa pelo wrapper
      // api(), que é quem anexa o header no resto do app. Sem ele o upload
      // era recusado com 403 pela checagem de CSRF do api.php.
      xhr.setRequestHeader('X-CSRF-Token', window.CSRF_TOKEN || '');
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const batchProgress = e.loaded / e.total;
        const overall = (sent + batchProgress) / batches.length;
        uploadProgressFill.style.width = Math.round(overall * 100) + '%';
        uploadPanelDetail.textContent = `Lote ${idx + 1} de ${batches.length}...`;
      };
      xhr.onload = () => {
        sent++;
        let res = null;
        try { res = JSON.parse(xhr.responseText); } catch (e) { /* resposta não é JSON válido */ }

        if (xhr.status < 200 || xhr.status >= 300) {
          const errMsg = (res && res.error) ? res.error : `Erro HTTP ${xhr.status} no lote ${idx + 1}`;
          serverErrors.push(errMsg);
          failedTotal = failedTotal.concat(batch.map(b => b.rel));
          console.error('Upload: lote', idx + 1, 'falhou com status', xhr.status, xhr.responseText);
        } else if (!res) {
          serverErrors.push(`Resposta inválida do servidor no lote ${idx + 1}`);
          failedTotal = failedTotal.concat(batch.map(b => b.rel));
          console.error('Upload: resposta não-JSON no lote', idx + 1, xhr.responseText);
        } else if (res.error) {
          let errMsg = res.error;
          if (/autenticado/i.test(errMsg)) {
            errMsg += ' (se você acabou de logar, isso costuma indicar que o lote excedeu o post_max_size do servidor — veja o README)';
          }
          serverErrors.push(errMsg);
          failedTotal = failedTotal.concat(batch.map(b => b.rel));
          console.error('Upload: erro retornado pela API no lote', idx + 1, res.error);
        } else if (res.failed && res.failed.length) {
          failedTotal = failedTotal.concat(res.failed);
          console.error('Upload: arquivos que falharam no lote', idx + 1, res.failed);
        }
        sendBatch(idx + 1);
      };
      xhr.onerror = () => {
        serverErrors.push(`Falha de rede no lote ${idx + 1}`);
        failedTotal = failedTotal.concat(batch.map(b => b.rel));
        sent++;
        sendBatch(idx + 1);
      };
      xhr.send(fd);
    }
    sendBatch(0);
  }
  document.getElementById('uploadPanelClose').onclick = () => uploadPanel.classList.add('hidden');

  // ---------- Arrastar e soltar (arquivos e pastas inteiras) ----------
  if (canWrite) {
    ['dragenter', 'dragover'].forEach(evt =>
      dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add('dragging'); })
    );
    ['dragleave', 'drop'].forEach(evt =>
      dropZone.addEventListener(evt, (e) => {
        if (evt === 'dragleave' && e.target !== dropZone) return;
        dropZone.classList.remove('dragging');
      })
    );
    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      const dt = e.dataTransfer;
      if (!dt) return;
      const collected = [];

      if (dt.items && dt.items.length && dt.items[0].webkitGetAsEntry) {
        const entries = Array.from(dt.items).map(it => it.webkitGetAsEntry()).filter(Boolean);
        await Promise.all(entries.map(entry => walkEntry(entry, '', collected)));
      } else {
        Array.from(dt.files).forEach(f => collected.push({ file: f, rel: f.name }));
      }
      if (collected.length) uploadFiles(collected);
    });
  }

  function walkEntry(entry, prefix, out) {
    return new Promise((resolve) => {
      if (entry.isFile) {
        entry.file((file) => {
          out.push({ file, rel: prefix ? prefix + '/' + file.name : file.name });
          resolve();
        }, resolve);
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const allEntries = [];
        const readBatch = () => {
          reader.readEntries(async (batch) => {
            if (batch.length === 0) {
              const newPrefix = prefix ? prefix + '/' + entry.name : entry.name;
              await Promise.all(allEntries.map(en => walkEntry(en, newPrefix, out)));
              resolve();
            } else {
              allEntries.push(...batch);
              readBatch();
            }
          }, resolve);
        };
        readBatch();
      } else {
        resolve();
      }
    });
  }

  // ---------- Busca ----------
  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (!q) { loadDir(currentPath); return; }
    searchTimer = setTimeout(async () => {
      try {
        const data = await api('search', { params: { path: currentPath, q } });
        searchMode = true;
        items = data.items.map(it => {
          const ext = it.is_dir ? null : (it.name.split('.').pop() || '').toLowerCase();
          return { ...it, ext, is_image: !it.is_dir && IMAGE_EXT.includes(ext), preview: 'none', perms: '' };
        });
        selection.clear();
        renderSearchResults();
        if (data.timed_out) {
          showToast('A busca demorou demais e foi interrompida — mostrando resultados parciais. Tente um termo mais específico.', true);
        }
      } catch (e) { showToast(e.message, true); }
    }, 300);
  });

  function renderSearchResults() {
    fileGrid.className = 'file-grid view-list';
    fileGrid.innerHTML = '';
    document.getElementById('loadMoreRow').classList.add('hidden'); // busca não é paginada
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.appendChild(makeIcon('search'));
      empty.appendChild(Object.assign(document.createElement('div'), { textContent: 'Nenhum resultado encontrado.' }));
      fileGrid.appendChild(empty);
      updateStatusBar();
      return;
    }
    items.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'file-item';
      const iconWrap = document.createElement('div');
      iconWrap.className = 'file-icon k-' + iconNameFor(item);
      iconWrap.appendChild(makeIcon(iconNameFor(item)));
      const name = document.createElement('div');
      name.className = 'file-name';
      name.textContent = item.name;
      const meta = document.createElement('div');
      meta.className = 'file-meta';
      meta.textContent = '/' + item.path;
      el.append(iconWrap, name, meta);
      el.addEventListener('dblclick', () => {
        if (item.is_dir) { searchInput.value = ''; loadDir(item.path); }
        else { downloadItem(item); }
      });
      fileGrid.appendChild(el);
    });
    updateStatusBar();
  }

  // =========================================================================
  // Atalhos de teclado
  // =========================================================================
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

    if (e.key === 'Escape') {
      if (!viewerOverlay.classList.contains('hidden')) { closeViewer(); return; }
      if (!modalOverlay.classList.contains('hidden')) { modalOverlay.classList.add('hidden'); return; }
      if (!contextMenu.classList.contains('hidden')) { contextMenu.classList.add('hidden'); return; }
      closeAllMenus();
      if (document.activeElement === searchInput) { searchInput.value = ''; searchInput.blur(); loadDir(currentPath); }
      return;
    }

    // Setas navegam o visualizador mesmo com foco em botão
    if (!viewerOverlay.classList.contains('hidden')) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); stepViewer(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); stepViewer(1); }
      return;
    }

    if (typing || !modalOverlay.classList.contains('hidden')) return;

    // "/" e Ctrl+F caem na busca
    if (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key === 'f')) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      items.forEach(i => selection.add(i.path));
      renderGrid();
      updateToolbarState();
      return;
    }
    if (!canWrite) return;

    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selection.size) { e.preventDefault(); setClipboard('copy'); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'x' && selection.size) { e.preventDefault(); setClipboard('move'); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'v' && clipboard) { e.preventDefault(); pasteClipboard(); return; }
    if (e.key === 'Delete' && selection.size) { e.preventDefault(); deleteSelection(); return; }
    if (e.key === 'F2' && selection.size === 1) {
      e.preventDefault();
      const item = items.find(i => selection.has(i.path));
      if (item) renameItem(item);
    }
  });

  // ---------- Status das VPNs (cabeçalho) ----------
  const wgStatusBadge = document.getElementById('wgStatusBadge');
  async function refreshWgStatus() {
    if (!wgStatusBadge) return;
    try {
      const data = await api('wg_status');
      const clients = Object.values(data.clients || {}).filter(c => c.enabled);
      if (clients.length === 0) {
        wgStatusBadge.hidden = true;
        return;
      }
      const connectedCount = clients.filter(c => c.connected).length;
      wgStatusBadge.hidden = false;
      if (connectedCount === clients.length) {
        wgStatusBadge.className = 'wg-status-badge wg-status-ok';
        wgStatusBadge.textContent = clients.length > 1 ? `VPN ativa (${connectedCount})` : 'VPN ativa';
        wgStatusBadge.title = 'Todos os clientes WireGuard configurados estão conectados.';
      } else if (connectedCount > 0) {
        wgStatusBadge.className = 'wg-status-badge wg-status-partial';
        wgStatusBadge.textContent = `VPN parcial (${connectedCount}/${clients.length})`;
        wgStatusBadge.title = 'Nem todos os clientes WireGuard configurados estão conectados no momento.';
      } else {
        wgStatusBadge.className = 'wg-status-badge wg-status-down';
        wgStatusBadge.textContent = 'VPN desconectada';
        wgStatusBadge.title = 'Cliente(s) WireGuard configurado(s), mas sem handshake recente.';
      }
    } catch (e) {
      wgStatusBadge.hidden = true;
    }
  }

  // ---------- Início ----------
  const initialPath = decodeURIComponent(location.hash.replace('#', ''));
  loadDir(initialPath || '');
  refreshWgStatus();
  setInterval(refreshWgStatus, 30000);
})();
