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
    let opts = { method };
    if (method === 'GET' && params) {
      const q = new URLSearchParams(params);
      url += '&' + q.toString();
    }
    if (method === 'POST') {
      opts.body = body;
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
      const data = await api('list', { params: { path, show_hidden: showHidden ? '1' : '0' } });
      currentPath = data.path;
      items = data.items;
      selection.clear();
      updateToolbarState();
      renderBreadcrumb();
      renderGrid();
      history.replaceState(null, '', '#' + encodeURIComponent(currentPath));
    } catch (e) {
      showToast(e.message, true);
    }
  }

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
    document.getElementById('btnDisks').onclick = () => openDisksPanel();
    document.getElementById('btnFolderUsage').onclick = () => openFolderUsage();
  }

  async function openSettings() {
    try {
      const [data, tmStatus, smbStatus] = await Promise.all([
        api('get_settings'),
        api('time_machine_status').catch(() => null),
        api('smb_status').catch(() => null),
      ]);
      const current = (data.settings.blocked_extensions || []).join(', ');
      const tmHtml = tmStatus ? `
        <hr style="margin:14px 0;border:none;border-top:1px solid var(--line)">
        <p style="font-size:12px;color:var(--ink-soft);margin:0 0 8px">
          <strong>Time Machine:</strong> ${tmStatus.enabled ? '✅ Ativado' : '⭘ Desativado'}
          ${tmStatus.enabled ? `— disco dedicado <code>${tmStatus.disk}</code>, usuário SMB <code>${tmStatus.username}</code>${tmStatus.max_size_gb > 0 ? `, limite ${tmStatus.max_size_gb}GB` : ''}` : ''}
          <br>Configurável na aba "Configuração" do próprio add-on (fora deste app).
        </p>
      ` : '';
      const smbHtml = smbStatus ? `
        <p style="font-size:12px;color:var(--ink-soft);margin:0 0 8px">
          <strong>SMB (acesso geral):</strong> ${smbStatus.enabled ? '✅ Ativado' : '⭘ Desativado'}
          ${smbStatus.enabled ? `— compartilhamento <code>Arquivos</code>, usuário SMB <code>${smbStatus.username}</code>` : ''}
          <br>Configurável na aba "Configuração" do próprio add-on (fora deste app).
        </p>
      ` : '';
      openModal('Configurações de segurança', `
        <p style="font-size:12px;color:var(--ink-soft);margin:0 0 10px">
          Estas extensões nunca podem ser enviadas, mesmo removidas da lista abaixo:
          <strong>${data.always_blocked.join(', ')}</strong>
        </p>
        <label style="display:block;font-size:12px;color:var(--ink-soft);margin-bottom:4px">
          Extensões extras bloqueadas (separadas por vírgula)
        </label>
        <input type="text" id="modalInput" value="${current.replace(/"/g, '&quot;')}" placeholder="exe, bat, sh, jar">
        <hr style="margin:14px 0;border:none;border-top:1px solid var(--line)">
        <p style="font-size:12px;color:var(--ink-soft);margin:0 0 8px">
          Notificações no Home Assistant (disco cheio, falha SMART) — testar se a integração está funcionando:
        </p>
        <button type="button" class="btn" id="btnTestNotif">🔔 Enviar notificação de teste</button>
        ${tmHtml}
        ${smbHtml}
      `, async () => {
        const val = document.getElementById('modalInput').value;
        const fd = new FormData();
        fd.append('blocked_extensions', val);
        try {
          await api('update_settings', { method: 'POST', body: fd });
          showToast('Configurações salvas.');
        } catch (e) { showToast(e.message, true); }
      });
      document.getElementById('btnTestNotif').onclick = async () => {
        try {
          await api('test_notification', { method: 'POST', body: new FormData() });
          showToast('Notificação enviada — confira o sininho do Home Assistant.');
        } catch (e) { showToast(e.message, true); }
      };
    } catch (e) { showToast(e.message, true); }
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
    modalTitle.textContent = '💽 Discos';

    const usageHtml = (usage && usage.length) ? `
      <div class="usage-summary">
        ${usage.map(u => `
          <div class="usage-item">
            <div class="usage-item-head"><strong>${u.name}</strong><span>${u.percent}% usado — ${human_filesize_js(u.used)} de ${human_filesize_js(u.total)}</span></div>
            <div class="usage-bar"><div class="usage-bar-fill" style="width:${Math.min(u.percent, 100)}%; background:${u.percent >= 90 ? 'var(--danger)' : 'var(--accent)'}"></div></div>
          </div>
        `).join('')}
      </div>
    ` : '';

    const rows = devices.map(d => {
      const sizeStr = d.size ? human_filesize_js(d.size) : '—';
      const smartBtn = d.type === 'disk' ? `<button class="btn btn-smart" data-path="${d.path}">🩺 SMART</button>` : '';
      const isTimeMachineDisk = tmStatus && tmStatus.enabled && d.label === tmStatus.disk;
      const tmBadge = isTimeMachineDisk ? ' <span title="Dedicado ao Time Machine">🕰️</span>' : '';
      return `<tr class="disk-row">
        <td>${d.path}</td><td>${d.label || '—'}${tmBadge}</td><td>${d.fstype || '(sem sistema de arquivos)'}</td>
        <td>${sizeStr}</td><td>${d.mountpoint || '—'}</td>
        <td style="white-space:nowrap">${smartBtn} <button class="btn btn-danger btn-format" data-path="${d.path}">Formatar</button></td>
      </tr>`;
    }).join('');

    modalBody.innerHTML = `
      ${usageHtml}
      <p class="editor-hint" style="margin-bottom:10px">
        Discos do sistema do próprio Home Assistant (boot, dados, swap) não aparecem aqui —
        nunca podem ser formatados por esse painel.
      </p>
      <table class="disk-table">
        <thead><tr><th>Dispositivo</th><th>Nome atual</th><th>Sistema</th><th>Tamanho</th><th>Montado em</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6">Nenhum dispositivo encontrado.</td></tr>'}</tbody>
      </table>
    `;
    modalOverlay.classList.remove('hidden');
    modalConfirm.style.display = 'none'; // esse modal não usa o botão de confirmar padrão

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
      } catch (e) { showToast(e.message, true); }
    }, 300);
  });

  function renderSearchResults() {
    fileGrid.innerHTML = '';
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

  // ---------- Init ----------
  const initialPath = decodeURIComponent(location.hash.replace('#', ''));
  loadDir(initialPath || '');
})();
