(function () {
  'use strict';

  const app = document.getElementById('app');
  const canWrite = app.dataset.canWrite === '1';

  const fileGrid = document.getElementById('fileGrid');
  const breadcrumb = document.getElementById('breadcrumb');
  const dropZone = document.getElementById('dropZone');
  const searchInput = document.getElementById('searchInput');

  const uploadPanel = document.getElementById('uploadPanel');
  const uploadPanelTitle = document.getElementById('uploadPanelTitle');
  const uploadProgressFill = document.getElementById('uploadProgressFill');
  const uploadPanelDetail = document.getElementById('uploadPanelDetail');

  const infoPanel = document.getElementById('infoPanel');
  const infoPanelBody = document.getElementById('infoPanelBody');

  const contextMenu = document.getElementById('contextMenu');
  const modalOverlay = document.getElementById('modalOverlay');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  const modalConfirm = document.getElementById('modalConfirm');
  const modalCancel = document.getElementById('modalCancel');
  const toast = document.getElementById('toast');

  const ICONS = {
    dir: '📁', zip: '🗜️', pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗',
    ppt: '📙', pptx: '📙', txt: '📄', csv: '📊', json: '🧾', mp3: '🎵', wav: '🎵',
    mp4: '🎬', mov: '🎬', avi: '🎬', mkv: '🎬', default: '📄',
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
  function fmtDate(ts) {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function iconFor(item) {
    if (item.is_dir) return ICONS.dir;
    return ICONS[item.ext] || ICONS.default;
  }
  function showToast(msg, isError) {
    toast.textContent = msg;
    toast.classList.toggle('error', !!isError);
    toast.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.add('hidden'), 3200);
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

  // ---------- Navigation ----------
  async function loadDir(path) {
    try {
      const data = await api('list', { params: { path, show_hidden: showHidden ? '1' : '0', offset: 0 } });
      currentPath = data.path;
      items = data.items;
      listOffset = data.items.length;
      listTotal = data.total;
      listHasMore = data.has_more;
      selection.clear();
      updateToolbarState();
      renderBreadcrumb();
      renderGrid();
      history.replaceState(null, '', '#' + encodeURIComponent(currentPath));
    } catch (e) {
      showToast(e.message, true);
    }
  }

  async function loadMoreItems() {
    if (listLoading || !listHasMore) return;
    listLoading = true;
    renderLoadMoreRow();
    try {
      const data = await api('list', { params: { path: currentPath, show_hidden: showHidden ? '1' : '0', offset: listOffset } });
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
    rootLink.textContent = '🏠 Raiz';
    rootLink.onclick = () => loadDir('');
    breadcrumb.appendChild(rootLink);

    if (!currentPath) return;
    const parts = currentPath.split('/');
    let acc = '';
    parts.forEach((part) => {
      acc = acc ? acc + '/' + part : part;
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '›';
      breadcrumb.appendChild(sep);
      const a = document.createElement('a');
      a.textContent = part;
      const target = acc;
      a.onclick = () => loadDir(target);
      breadcrumb.appendChild(a);
    });
  }

  function renderGrid() {
    fileGrid.innerHTML = '';
    if (items.length === 0) {
      fileGrid.innerHTML = '<div class="empty-state">Esta pasta está vazia.<br>Arraste arquivos ou pastas aqui para enviar.</div>';
      renderLoadMoreRow();
      return;
    }
    items.forEach((item, idx) => {
      const el = document.createElement('div');
      el.className = 'file-item';
      if (item.hidden) el.classList.add('is-hidden-item');
      el.dataset.path = item.path;
      el.dataset.idx = idx;
      if (selection.has(item.path)) el.classList.add('selected');

      const iconWrap = document.createElement('div');
      iconWrap.className = 'file-icon';
      if (item.is_image) {
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.src = 'thumb.php?path=' + encodeURIComponent(item.path) + '&size=160';
        img.onerror = () => { iconWrap.textContent = iconFor(item); };
        iconWrap.appendChild(img);
      } else {
        iconWrap.textContent = iconFor(item);
      }

      const name = document.createElement('div');
      name.className = 'file-name';
      name.textContent = item.name;

      const meta = document.createElement('div');
      meta.className = 'file-meta';
      meta.textContent = item.is_dir ? '' : fmtSize(item.size);

      el.appendChild(iconWrap);
      el.appendChild(name);
      el.appendChild(meta);

      el.addEventListener('click', (e) => handleItemClick(e, item, idx));
      el.addEventListener('dblclick', () => handleItemOpen(item));
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!selection.has(item.path)) {
          selection.clear();
          selection.add(item.path);
          renderGrid();
        }
        openContextMenu(e.clientX, e.clientY, [item]);
      });

      fileGrid.appendChild(el);
    });
    renderLoadMoreRow();
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

  function handleItemOpen(item) {
    if (item.is_dir) {
      loadDir(item.path);
    } else {
      window.open('download.php?path=' + encodeURIComponent(item.path), '_blank');
    }
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.file-item')) {
      selection.clear();
      renderGrid();
      updateToolbarState();
    }
    if (!e.target.closest('.context-menu')) contextMenu.classList.add('hidden');
  });

  // ---------- Toolbar state ----------
  function updateToolbarState() {
    const has = selection.size > 0;
    const btnZip = document.getElementById('btnZip');
    const btnCut = document.getElementById('btnCut');
    const btnCopy = document.getElementById('btnCopy');
    const btnDelete = document.getElementById('btnDelete');
    const btnPaste = document.getElementById('btnPaste');
    if (btnZip) btnZip.disabled = !has;
    if (btnCut) btnCut.disabled = !has;
    if (btnCopy) btnCopy.disabled = !has;
    if (btnDelete) btnDelete.disabled = !has;
    if (btnPaste) btnPaste.disabled = !clipboard;
  }

  // ---------- Context menu ----------
  function openContextMenu(x, y, targetItems) {
    contextMenu.innerHTML = '';
    const add = (label, fn, danger) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (danger) b.classList.add('danger');
      b.onclick = () => { contextMenu.classList.add('hidden'); fn(); };
      contextMenu.appendChild(b);
    };

    const single = targetItems.length === 1 ? targetItems[0] : null;

    if (single && !single.is_dir) add('⬇️ Baixar', () => window.open('download.php?path=' + encodeURIComponent(single.path), '_blank'));
    if (single && single.is_dir) add('📂 Abrir', () => loadDir(single.path));
    if (single && !single.is_dir && isLikelyTextExt(single)) add(canWrite ? '📝 Editar' : '👁️ Ver conteúdo', () => openEditor(single));
    if (single) add('ℹ️ Informações', () => showInfo(single));

    if (canWrite) {
      contextMenu.appendChild(document.createElement('hr'));
      if (single) add('✏️ Renomear', () => renameItem(single));
      add('📋 Copiar', () => setClipboard('copy'));
      add('✂️ Mover', () => setClipboard('move'));
      add('🗜️ Compactar em ZIP', () => zipSelection());
      if (single && single.ext === 'zip') add('📦 Descompactar', () => unzipItem(single));
      contextMenu.appendChild(document.createElement('hr'));
      add('🗑️ Excluir', () => deleteSelection(), true);
    }

    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    contextMenu.classList.remove('hidden');
  }

  // ---------- Info panel ----------
  function showInfo(item) {
    infoPanel.classList.remove('hidden');
    let html = '';
    if (item.is_image) {
      html += `<img class="info-thumb" src="thumb.php?path=${encodeURIComponent(item.path)}&size=400">`;
    }
    html += row('Nome', item.name);
    html += row('Tipo', item.is_dir ? 'Pasta' : (item.ext ? item.ext.toUpperCase() : 'Arquivo'));
    if (!item.is_dir) html += row('Tamanho', fmtSize(item.size));
    html += row('Modificado', fmtDate(item.modified));
    html += row('Permissões', item.perms);
    html += row('Caminho', '/' + item.path);
    infoPanelBody.innerHTML = html;
    function row(k, v) { return `<div class="info-row"><span>${k}</span><span>${v}</span></div>`; }
  }
  document.getElementById('infoPanelClose').onclick = () => infoPanel.classList.add('hidden');

  document.getElementById('btnToggleHidden').onclick = () => {
    showHidden = !showHidden;
    const btn = document.getElementById('btnToggleHidden');
    btn.textContent = showHidden ? '🙈 Ocultar ocultos' : '👁️ Mostrar ocultos';
    btn.classList.toggle('btn-primary', showHidden);
    loadDir(currentPath);
  };

  // ---------- CRUD actions ----------
  if (canWrite) {
    document.getElementById('btnNewFolder').onclick = () => {
      openModal('Nova pasta', `<input type="text" id="modalInput" placeholder="Nome da pasta" autofocus>`, async () => {
        const name = document.getElementById('modalInput').value.trim();
        if (!name) return;
        const fd = new FormData();
        fd.append('path', currentPath);
        fd.append('name', name);
        await api('mkdir', { method: 'POST', body: fd });
        showToast('Pasta criada.');
        loadDir(currentPath);
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
    document.getElementById('btnFolderUsage').onclick = () => openFolderUsage();
  }

  function esc(v) { return (v == null ? '' : String(v)).replace(/"/g, '&quot;'); }
  function inputRow(label, id, value, opts = {}) {
    const type = opts.type || 'text';
    const ph = opts.placeholder || '';
    return `<label style="display:block;font-size:12px;color:var(--ink-soft);margin:10px 0 4px">${label}</label>
      <input type="${type}" id="${id}" value="${esc(value)}" placeholder="${esc(ph)}" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--line);border-radius:6px">`;
  }
  function checkboxRow(label, id, checked) {
    return `<label style="display:flex;align-items:center;gap:8px;margin:10px 0;font-size:13px">
      <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}> ${label}
    </label>`;
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
    modalTitle.textContent = '⚙️ Configurações';
    modalConfirm.style.display = 'none';
    modalBody.innerHTML = `
      <div class="settings-grid">
        <button class="settings-tile" data-s="geral">🔒<span>Geral</span></button>
        <button class="settings-tile" data-s="discos">💽<span>Discos &amp; Montagem</span></button>
        <button class="settings-tile" data-s="smb">🗂️<span>SMB</span></button>
        <button class="settings-tile" data-s="time_machine">🕰️<span>Time Machine</span></button>
        <button class="settings-tile" data-s="wireguard">🔐<span>WireGuard</span></button>
        <button class="settings-tile" data-s="usuarios">👤<span>Usuários</span></button>
        <button class="settings-tile" data-s="sistema">🛠️<span>Sistema</span></button>
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
        usuarios: renderSettingsUsuarios,
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
    modalTitle.textContent = '🔒 Geral';
    modalBody.innerHTML = `
      ${backBtnHtml()}
      <p class="editor-hint">Estas extensões nunca podem ser enviadas, mesmo removidas da lista abaixo: <strong>${data.always_blocked.join(', ')}</strong></p>
      ${inputRow('Extensões extras bloqueadas (separadas por vírgula)', 'setExt', current, { placeholder: 'exe, bat, sh, jar' })}
      <p class="editor-hint" style="margin-top:14px">
        Time Machine: ${tmStatus && tmStatus.enabled ? '✅ Ativado' : '⭘ Desativado'} ·
        SMB: ${smbStatus && smbStatus.enabled ? '✅ Ativado' : '⭘ Desativado'}
        (configuráveis nas seções próprias)
      </p>
      <div class="modal-actions">
        <button class="btn" id="btnTestNotif">🔔 Testar notificação</button>
        <button class="btn btn-primary" id="btnSaveGeral">Salvar</button>
      </div>
    `;
    wireBack();
    document.getElementById('btnTestNotif').onclick = async () => {
      try { await api('test_notification', { method: 'POST', body: new FormData() }); showToast('Notificação enviada — confira o sininho do Home Assistant.'); }
      catch (e) { showToast(e.message, true); }
    };
    document.getElementById('btnSaveGeral').onclick = async () => {
      const fd = new FormData();
      fd.append('blocked_extensions', document.getElementById('setExt').value);
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
      <li><code>${d.label || '(sem label)'}</code> — ${d.path}${d.fstype ? ' · ' + d.fstype : ''}${d.size ? ' · ' + human_filesize_js(d.size) : ''}</li>
    `).join('') || '<li>Nenhum disco encontrado ainda — plugue um HD e recarregue esta tela.</li>';
    modalTitle.textContent = '💽 Discos & Montagem';
    modalBody.innerHTML = `
      ${backBtnHtml()}
      <p class="editor-hint">Discos detectados agora — use o nome (label) daqui na lista de montagem abaixo:</p>
      <ul style="font-size:13px;margin:0 0 12px;padding-left:18px">${found}</ul>
      <label style="display:block;font-size:12px;color:var(--ink-soft);margin:10px 0 4px">
        Discos a montar (um por linha — nome, ou <code>uuid:XXXX-YYYY[:nome]</code>)
      </label>
      <textarea id="setDiskLabels" rows="5" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--line);border-radius:6px;font-family:inherit">${labels}</textarea>
      <div style="margin-top:12px">
        <button class="btn" id="btnOpenDiskUsage">📊 Ver uso de espaço e formatar</button>
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
    modalTitle.textContent = '🗂️ SMB (acesso geral)';
    modalBody.innerHTML = `
      ${backBtnHtml()}
      <p class="editor-hint">Compartilha os mesmos discos do gerenciador via SMB, com login próprio (diferente do login web).</p>
      ${checkboxRow('Ativar SMB de uso geral', 'smbEnabled', o.smb_enabled)}
      ${inputRow('Usuário', 'smbUser', o.smb_username)}
      ${inputRow('Senha (em branco = manter a atual)', 'smbPass', '', { type: 'password', placeholder: o.smb_password_set ? '••••••• (já definida)' : '' })}
      <div class="modal-actions"><button class="btn btn-primary" id="btnSaveSmb">Salvar (reinicia o add-on)</button></div>
    `;
    wireBack();
    document.getElementById('btnSaveSmb').onclick = async () => {
      await saveAddonOptionsAndRestart({
        smb_enabled: document.getElementById('smbEnabled').checked,
        smb_username: document.getElementById('smbUser').value.trim(),
        smb_password: document.getElementById('smbPass').value,
      });
    };
  }

  async function renderSettingsTimeMachine() {
    const data = await api('get_addon_options');
    const o = data.options;
    modalTitle.textContent = '🕰️ Time Machine';
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
    modalTitle.textContent = '🔐 WireGuard';
    modalBody.innerHTML = `
      ${backBtnHtml()}
      <p class="editor-hint">Cliente WireGuard: conecta este add-on num servidor VPN existente. Cole aqui os dados do <code>.conf</code> que o servidor te deu.</p>
      ${checkboxRow('Ativar cliente WireGuard', 'wgEnabled', o.wg_enabled)}
      ${inputRow('Chave privada (em branco = manter a atual)', 'wgPriv', '', { type: 'password', placeholder: o.wg_private_key_set ? '••••••• (já definida)' : '' })}
      ${inputRow('Address (ex: 10.96.165.4/24)', 'wgAddr', o.wg_address)}
      ${inputRow('DNS (opcional)', 'wgDns', o.wg_dns)}
      ${inputRow('Chave pública do servidor', 'wgPeerPub', o.wg_peer_public_key)}
      ${inputRow('Chave pré-compartilhada (opcional, em branco = manter)', 'wgPsk', '', { type: 'password', placeholder: o.wg_preshared_key_set ? '••••••• (já definida)' : '' })}
      ${inputRow('Endpoint (host:porta)', 'wgEndpoint', o.wg_endpoint, { placeholder: '144.22.193.41:51820' })}
      ${inputRow('AllowedIPs (em branco = calculado sozinho, NÃO use 0.0.0.0/0)', 'wgAllowed', o.wg_allowed_ips)}
      ${inputRow('Keepalive em segundos (0 desliga)', 'wgKeepalive', o.wg_persistent_keepalive, { type: 'number' })}
      <hr style="margin:14px 0;border:none;border-top:1px solid var(--line)">
      <p class="editor-hint">Segundo cliente (opcional) — outro servidor VPN, independente do primeiro. Sobe como interface separada (wg1).</p>
      ${checkboxRow('Ativar 2º cliente WireGuard', 'wg2Enabled', o.wg2_enabled)}
      ${inputRow('Chave privada (em branco = manter a atual)', 'wg2Priv', '', { type: 'password', placeholder: o.wg2_private_key_set ? '••••••• (já definida)' : '' })}
      ${inputRow('Address (ex: 10.96.165.5/24)', 'wg2Addr', o.wg2_address)}
      ${inputRow('DNS (opcional)', 'wg2Dns', o.wg2_dns)}
      ${inputRow('Chave pública do servidor', 'wg2PeerPub', o.wg2_peer_public_key)}
      ${inputRow('Chave pré-compartilhada (opcional, em branco = manter)', 'wg2Psk', '', { type: 'password', placeholder: o.wg2_preshared_key_set ? '••••••• (já definida)' : '' })}
      ${inputRow('Endpoint (host:porta)', 'wg2Endpoint', o.wg2_endpoint, { placeholder: '144.22.193.41:51820' })}
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

  async function renderSettingsUsuarios() {
    const data = await api('list_users');
    const rows = data.users.map(u => `
      <tr><td>${u.username}</td><td>${u.role === 'admin' ? 'Administrador' : 'Somente leitura'}</td>
      <td><button class="btn btn-danger btn-del-user" data-u="${u.username}">Excluir</button></td></tr>
    `).join('');
    modalTitle.textContent = '👤 Usuários';
    modalBody.innerHTML = `
      ${backBtnHtml()}
      <table class="disk-table"><thead><tr><th>Usuário</th><th>Papel</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <hr style="margin:14px 0;border:none;border-top:1px solid var(--line)">
      <p class="editor-hint">Novo usuário</p>
      ${inputRow('Usuário', 'newUserName', '')}
      ${inputRow('Senha (mín. 8 caracteres)', 'newUserPass', '', { type: 'password' })}
      <label style="display:block;font-size:12px;color:var(--ink-soft);margin:10px 0 4px">Papel</label>
      <select id="newUserRole" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:6px">
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

  async function renderSettingsSistema() {
    const data = await api('get_addon_options');
    const o = data.options;
    modalTitle.textContent = '🛠️ Sistema';
    modalBody.innerHTML = `
      ${backBtnHtml()}
      ${checkboxRow('Monitor de disco/SMART ativo', 'sysMonitor', o.monitor_enabled)}
      ${inputRow('Intervalo do monitor (minutos)', 'sysInterval', o.monitor_interval_minutes, { type: 'number' })}
      ${inputRow('Alertar quando disco atingir % de uso', 'sysAlertPct', o.disk_usage_alert_percent, { type: 'number' })}
      <hr style="margin:14px 0;border:none;border-top:1px solid var(--line)">
      <p class="editor-hint">Pastas extras visíveis no gerenciador:</p>
      ${checkboxRow('/config (configuração do Home Assistant)', 'sysExposeConfig', o.expose_ha_config)}
      ${checkboxRow('/addons (outros add-ons instalados)', 'sysExposeAddons', o.expose_addons)}
      ${checkboxRow('/backup (backups do Home Assistant)', 'sysExposeBackup', o.expose_backup)}
      ${checkboxRow('/addon_configs (config privada de outros add-ons)', 'sysExposeAddonConfigs', o.expose_addon_configs)}
      <div class="modal-actions"><button class="btn btn-primary" id="btnSaveSistema">Salvar (reinicia o add-on)</button></div>
    `;
    wireBack();
    document.getElementById('btnSaveSistema').onclick = async () => {
      await saveAddonOptionsAndRestart({
        monitor_enabled: document.getElementById('sysMonitor').checked,
        monitor_interval_minutes: parseInt(document.getElementById('sysInterval').value || '30', 10),
        disk_usage_alert_percent: parseInt(document.getElementById('sysAlertPct').value || '90', 10),
        expose_ha_config: document.getElementById('sysExposeConfig').checked,
        expose_addons: document.getElementById('sysExposeAddons').checked,
        expose_backup: document.getElementById('sysExposeBackup').checked,
        expose_addon_configs: document.getElementById('sysExposeAddonConfigs').checked,
      });
    };
  }

  async function openFolderUsage() {
    modalBox.classList.add('modal-box-editor');
    modalTitle.textContent = '📊 Uso de espaço — ' + (currentPath || '/');
    modalBody.innerHTML = '<p class="editor-hint">Calculando... pode demorar em pastas grandes.</p>';
    modalOverlay.classList.remove('hidden');
    modalConfirm.style.display = 'none';

    try {
      const data = await api('folder_usage', { params: { path: currentPath } });
      const items = data.items || [];
      const maxSize = Math.max(1, ...items.map(i => i.size || 0));
      const rows = items.map(i => `
        <div class="usage-item">
          <div class="usage-item-head">
            <span>${i.is_dir ? '📁' : '📄'} ${i.name}</span>
            <span>${i.timeout ? 'não foi possível calcular a tempo' : human_filesize_js(i.size)}</span>
          </div>
          <div class="usage-bar"><div class="usage-bar-fill" style="width:${i.timeout ? 0 : (i.size / maxSize) * 100}%"></div></div>
        </div>
      `).join('');
      modalBody.innerHTML = `<div class="usage-summary">${rows || '<p>Pasta vazia.</p>'}</div>`;
    } catch (e) {
      modalBody.innerHTML = `<p style="color:var(--danger)">${e.message}</p>`;
    }
  }

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
    modalTitle.textContent = '💽 Discos';

    const usageByName = {};
    (usage || []).forEach(u => { usageByName[u.name] = u; });

    const rows = devices.map((d, idx) => {
      const sizeStr = d.size ? human_filesize_js(d.size) : '—';
      const smartBtn = d.type === 'disk' ? `<button class="btn btn-smart" data-path="${d.path}">🩺 SMART</button>` : '';
      const isTimeMachineDisk = tmStatus && tmStatus.enabled && d.label === tmStatus.disk;
      const tmBadge = isTimeMachineDisk ? ' <span title="Dedicado ao Time Machine">🕰️</span>' : '';
      const u = usageByName[d.label] || usageByName[(d.mountpoint || '').split('/').pop()];
      const usageHtml = u ? `
        <div class="usage-item" style="margin-top:8px">
          <div class="usage-item-head" style="flex-direction:row;justify-content:space-between">
            <span>${u.percent}% usado</span><span>${human_filesize_js(u.used)} de ${human_filesize_js(u.total)}</span>
          </div>
          <div class="usage-bar"><div class="usage-bar-fill" style="width:${Math.min(u.percent, 100)}%; background:${u.percent >= 90 ? 'var(--danger)' : 'var(--accent)'}"></div></div>
        </div>
      ` : '<p class="editor-hint" style="margin-top:8px">Sem dado de uso (disco sem sistema de arquivos montado).</p>';

      return `
        <div class="disk-card" data-idx="${idx}">
          <div class="disk-card-head">
            <div>
              <strong>${d.label || d.path}</strong>${tmBadge}
              <span class="editor-hint">${d.path} · ${d.fstype || 'sem sistema de arquivos'} · ${sizeStr}</span>
            </div>
            <div style="white-space:nowrap">${smartBtn} <button class="btn btn-danger btn-format" data-path="${d.path}">Formatar</button></div>
          </div>
          <div class="disk-card-usage" style="display:none">${usageHtml}</div>
        </div>
      `;
    }).join('');

    modalBody.innerHTML = `
      <p class="editor-hint" style="margin-bottom:10px">
        Clique num disco pra ver o espaço usado. Discos do sistema do próprio Home Assistant
        (boot, dados, swap) não aparecem aqui — nunca podem ser formatados por esse painel.
      </p>
      <div class="disks-cards">${rows || '<p>Nenhum dispositivo encontrado.</p>'}</div>
    `;
    modalOverlay.classList.remove('hidden');
    modalConfirm.style.display = 'none'; // esse modal não usa o botão de confirmar padrão

    modalBody.querySelectorAll('.disk-card-head').forEach(head => {
      head.onclick = (ev) => {
        if (ev.target.closest('button')) return; // não expande ao clicar nos botões
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
        body = `<p>${s.message}</p>`;
      } else {
        const healthLabel = s.healthy === true ? '✅ Saudável' : (s.healthy === false ? '❌ FALHA — faça backup!' : '❔ Desconhecido');
        body = `
          <table class="disk-table">
            <tr><td>Status</td><td>${healthLabel}</td></tr>
            <tr><td>Modelo</td><td>${s.model || '—'}</td></tr>
            <tr><td>Número de série</td><td>${s.serial || '—'}</td></tr>
            <tr><td>Temperatura</td><td>${s.temperature_c != null ? s.temperature_c + ' °C' : '—'}</td></tr>
            <tr><td>Horas ligado</td><td>${s.power_on_hours != null ? s.power_on_hours + 'h' : '—'}</td></tr>
            <tr><td>Ciclos de energia</td><td>${s.power_cycles ?? '—'}</td></tr>
            <tr><td>Setores realocados</td><td>${s.reallocated_sectors ?? '—'}</td></tr>
            <tr><td>Setores pendentes</td><td>${s.pending_sectors ?? '—'}</td></tr>
          </table>
        `;
      }
      modalTitle.textContent = '🩺 SMART — ' + devicePath;
      modalBody.innerHTML = body + `<div class="modal-actions"><button class="btn" id="smartBack">Voltar</button></div>`;
      document.getElementById('smartBack').onclick = () => renderDisksList(allDevices, usage, tmStatus);
    } catch (e) { showToast(e.message, true); }
  }

  function showFormatWizard(device, allDevices, usage, tmStatus) {
    const isTimeMachineDisk = tmStatus && tmStatus.enabled && device.label === tmStatus.disk;
    const tmWarning = isTimeMachineDisk ? `
      <p style="color:var(--danger);font-weight:600;margin:0 0 10px;padding:8px;border:1px solid var(--danger);border-radius:6px">
        ⚠️ Este é o disco configurado pro Time Machine! Formatar aqui apaga todo o backup do Mac também.
      </p>
    ` : '';
    modalTitle.textContent = '⚠️ Formatar ' + device.path;
    modalBody.innerHTML = `
      ${tmWarning}
      <p style="color:var(--danger);font-weight:600;margin:0 0 10px">
        Isso apaga TODOS os dados de ${device.path} permanentemente. Não pode ser desfeito.
      </p>
      <label style="display:block;font-size:12px;color:var(--ink-soft);margin-bottom:4px">Tipo de sistema de arquivos</label>
      <select id="fmtFstype" style="width:100%;padding:8px;margin-bottom:6px;border:1px solid var(--line);border-radius:6px">
        <option value="ext4">ext4 ${isTimeMachineDisk ? '(recomendado para Time Machine)' : '(recomendado para uso só no Linux/HA)'}</option>
        <option value="exfat">exFAT ${isTimeMachineDisk ? '(NÃO recomendado para Time Machine)' : '(compatível com Windows e Mac)'}</option>
        <option value="vfat">FAT32 ${isTimeMachineDisk ? '(NÃO funciona com Time Machine)' : '(mais compatível, limite de arquivo de 4GB)'}</option>
      </select>
      <p id="fmtFstypeWarning" class="editor-hint" style="display:none;color:var(--danger);margin:0 0 10px"></p>
      <label style="display:block;font-size:12px;color:var(--ink-soft);margin-bottom:4px">Nome do disco (label)</label>
      <input type="text" id="fmtLabel" placeholder="Ex: HD_EXTERNO" style="width:100%;box-sizing:border-box;padding:8px;margin-bottom:10px;border:1px solid var(--line);border-radius:6px">
      <label style="display:block;font-size:12px;color:var(--ink-soft);margin-bottom:4px">
        Pra confirmar, digite exatamente <code>${device.path}</code>
      </label>
      <input type="text" id="fmtConfirm" placeholder="${device.path}" style="width:100%;box-sizing:border-box;padding:8px;margin-bottom:10px;border:1px solid var(--line);border-radius:6px">
      <div id="fmtOutput" class="fmt-output" style="display:none"></div>
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
          msg += `✅ Já montado e disponível em: ${res.mount.mount_point}\n`;
          msg += `Pra continuar disponível depois de reiniciar o add-on, adicione "${res.mount.label}" em disk_labels na Configuração.`;
        } else {
          msg += '⚠️ Formatado, mas não consegui montar automaticamente — pode precisar reiniciar o add-on.';
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

  function human_filesize_js(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (!bytes) return '0 B';
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
  }


  function renameItem(item) {
    openModal('Renomear', `<input type="text" id="modalInput" value="${item.name.replace(/"/g, '&quot;')}" autofocus>`, async () => {
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
    openModal('Excluir itens', `<p>Tem certeza que deseja excluir <strong>${paths.length}</strong> item(ns)? Esta ação não pode ser desfeita.</p>`, async () => {
      const fd = new FormData();
      paths.forEach(p => fd.append('paths[]', p));
      try {
        const res = await api('delete', { method: 'POST', body: fd });
        showToast(res.ok ? 'Itens excluídos.' : 'Alguns itens não puderam ser excluídos.', !res.ok);
        loadDir(currentPath);
      } catch (e) { showToast(e.message, true); }
    });
  }

  function setClipboard(mode) {
    const paths = Array.from(selection);
    if (paths.length === 0) return;
    clipboard = { mode, paths };
    updateToolbarState();
    showToast(mode === 'copy' ? 'Itens copiados. Navegue até o destino e clique em Colar.' : 'Itens marcados para mover. Navegue até o destino e clique em Colar.');
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

  // ---------- Modal ----------
  let modalConfirmHandler = null;
  const modalBox = modalOverlay.querySelector('.modal-box');
  function openModal(title, bodyHtml, onConfirm) {
    modalBox.classList.remove('modal-box-editor');
    modalBox.classList.remove('modal-box-disks');
    modalConfirm.style.display = '';
    modalConfirm.textContent = 'Confirmar';
    modalTitle.textContent = title;
    modalBody.innerHTML = bodyHtml;
    modalOverlay.classList.remove('hidden');
    modalConfirmHandler = onConfirm;
    const input = document.getElementById('modalInput');
    if (input) { input.focus(); input.select(); input.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmModal(); }); }
  }
  function confirmModal() {
    modalOverlay.classList.add('hidden');
    if (modalConfirmHandler) modalConfirmHandler();
  }
  modalConfirm.onclick = confirmModal;
  modalCancel.onclick = () => modalOverlay.classList.add('hidden');

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
    modalTitle.textContent = (readOnly ? '👁️ ' : '📝 ') + item.name;
    modalBody.innerHTML = `
      <textarea id="editorTextarea" class="editor-textarea" spellcheck="false" autocapitalize="off" autocomplete="off"${readOnly ? ' readonly' : ''}></textarea>
      <p class="editor-hint">${readOnly ? 'Somente leitura — seu usuário tem permissão apenas de visualização.' : 'Ctrl/Cmd+S salva sem fechar.'}</p>
    `;
    const ta = document.getElementById('editorTextarea');
    ta.value = content;
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
      if (!closeAfter) modalOverlay.classList.remove('hidden'); // Ctrl+S não deve fechar o modal
    } catch (e) { showToast(e.message, true); }
  }

  // ---------- Upload (with folder structure support + progress) ----------
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

  // ---------- Drag & drop (files and whole folders) ----------
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

  // ---------- Search ----------
  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (!q) { loadDir(currentPath); return; }
    searchTimer = setTimeout(async () => {
      try {
        const data = await api('search', { params: { path: currentPath, q } });
        items = data.items.map(it => ({ ...it, is_image: !it.is_dir && IMAGE_EXT.includes((it.name.split('.').pop() || '').toLowerCase()), ext: it.is_dir ? null : (it.name.split('.').pop() || '').toLowerCase() }));
        selection.clear();
        renderSearchResults();
        if (data.timed_out) {
          showToast('Busca demorou demais e foi interrompida — mostrando resultados parciais. Tente um termo mais específico.', true);
        }
      } catch (e) { showToast(e.message, true); }
    }, 300);
  });

  function renderSearchResults() {
    fileGrid.innerHTML = '';
    document.getElementById('loadMoreRow').classList.add('hidden'); // busca não é paginada
    if (items.length === 0) {
      fileGrid.innerHTML = '<div class="empty-state">Nenhum resultado encontrado.</div>';
      return;
    }
    items.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'file-item';
      const iconWrap = document.createElement('div');
      iconWrap.className = 'file-icon';
      iconWrap.textContent = iconFor(item);
      const name = document.createElement('div');
      name.className = 'file-name';
      name.textContent = item.name;
      const meta = document.createElement('div');
      meta.className = 'file-meta';
      meta.textContent = item.path;
      el.appendChild(iconWrap); el.appendChild(name); el.appendChild(meta);
      el.addEventListener('dblclick', () => handleItemOpen(item));
      fileGrid.appendChild(el);
    });
  }

  // ---------- WireGuard status badge (cabeçalho) ----------
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
        wgStatusBadge.textContent = clients.length > 1 ? `🔒 VPN ativa (${connectedCount})` : '🔒 VPN ativa';
        wgStatusBadge.title = 'Todos os clientes WireGuard configurados estão conectados.';
      } else if (connectedCount > 0) {
        wgStatusBadge.className = 'wg-status-badge wg-status-partial';
        wgStatusBadge.textContent = `⚠️ VPN parcial (${connectedCount}/${clients.length})`;
        wgStatusBadge.title = 'Nem todos os clientes WireGuard configurados estão conectados no momento.';
      } else {
        wgStatusBadge.className = 'wg-status-badge wg-status-down';
        wgStatusBadge.textContent = '🔴 VPN desconectada';
        wgStatusBadge.title = 'Cliente(s) WireGuard configurado(s), mas sem handshake recente.';
      }
    } catch (e) {
      wgStatusBadge.hidden = true;
    }
  }

  // ---------- Init ----------
  const initialPath = decodeURIComponent(location.hash.replace('#', ''));
  loadDir(initialPath || '');
  refreshWgStatus();
  setInterval(refreshWgStatus, 30000);
})();
