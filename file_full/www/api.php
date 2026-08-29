<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/includes/functions.php';
require_once __DIR__ . '/includes/auth.php';

send_security_headers(false);
require_login_json();

// Proteção CSRF: todo POST (as únicas ações que alteram estado) precisa
// trazer o token da sessão atual no header X-CSRF-Token — ver CSRF_TOKEN em
// config.php e o wrapper api() em assets/js/app.js, que já anexa o header
// sozinho. GETs (list, search, read_file...) continuam sem exigência, são
// idempotentes e não alteram nada.
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $sentToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!hash_equals($_SESSION['csrf'] ?? '', $sentToken)) {
        json_response(['error' => 'Sessão expirada ou inválida. Recarregue a página e tente novamente.'], 403);
    }
}

$action = $_REQUEST['action'] ?? '';
$isViewer = !is_admin();

// Ações que exigem privilégio de escrita (bloqueadas para role "viewer")
$writeActions = ['mkdir', 'rename', 'delete', 'delete_permanent', 'copy', 'move', 'upload', 'zip', 'unzip', 'chmod', 'update_settings', 'save_file', 'create_file', 'format_disk', 'save_addon_options', 'restart_addon', 'create_user', 'delete_user', 'trash_restore', 'trash_purge', 'trash_empty', 'create_share', 'revoke_share'];
if (in_array($action, $writeActions, true) && $isViewer) {
    json_response(['error' => 'Seu usuário tem permissão apenas de visualização.'], 403);
}

switch ($action) {

    case 'list': {
        $rel = $_GET['path'] ?? '';
        $showHidden = ($_GET['show_hidden'] ?? '') === '1';
        $offset = max(0, (int) ($_GET['offset'] ?? 0));
        $limit = (int) ($_GET['limit'] ?? LIST_DEFAULT_PAGE_SIZE);
        $limit = max(1, min($limit, LIST_MAX_PAGE_SIZE));

        $sort = in_array($_GET['sort'] ?? '', ['name', 'size', 'modified'], true) ? $_GET['sort'] : 'name';
        $desc = ($_GET['desc'] ?? '') === '1';

        $dir = safe_path($rel);
        if (!$dir || !is_dir($dir)) json_response(['error' => 'Pasta não encontrada.'], 404);

        // 1ª passada: só nome + is_dir (barato — sem filesize/filemtime/fileperms).
        // Precisa ser sobre a listagem inteira pra manter a ordenação global
        // correta entre páginas — do contrário paginar intercalaria pastas e
        // arquivos entre uma página e outra.
        //
        // Ordenar por tamanho ou data exige estatar TODAS as entradas, não só
        // a página: é um custo real em pasta gigante, mas é o único jeito de a
        // ordenação valer pra listagem inteira em vez de só pro lote visível.
        // Por nome (o padrão) o caminho barato continua valendo.
        $needsStatAll = $sort !== 'name';
        $entries = [];
        foreach (scandir($dir) as $name) {
            if ($name === '.' || $name === '..') continue;
            if ($name === TRASH_DIRNAME) continue; // a lixeira tem tela própria
            if (!$showHidden && $name[0] === '.') continue; // oculta arquivos de sistema (.htaccess, .gitkeep etc.)
            $full = $dir . '/' . $name;
            $entry = ['name' => $name, 'is_dir' => is_dir($full)];
            if ($needsStatAll) {
                $entry['size'] = $entry['is_dir'] ? -1 : (@filesize($full) ?: 0);
                $entry['modified'] = @filemtime($full) ?: 0;
            }
            $entries[] = $entry;
        }

        usort($entries, function ($a, $b) use ($sort, $desc) {
            // Pastas sempre antes de arquivos, em qualquer ordenação — é o que
            // as pessoas esperam de um gerenciador de arquivos.
            if ($a['is_dir'] !== $b['is_dir']) return $a['is_dir'] ? -1 : 1;
            $cmp = $sort === 'name'
                ? strcasecmp($a['name'], $b['name'])
                : ($a[$sort] <=> $b[$sort]);
            if ($cmp === 0) $cmp = strcasecmp($a['name'], $b['name']);
            return $desc ? -$cmp : $cmp;
        });

        $total = count($entries);
        $page = array_slice($entries, $offset, $limit);

        // 2ª passada: os dados "caros" (tamanho, data, permissões) só pros
        // itens da página atual — é isso que faz uma pasta com milhares de
        // arquivos não estatar tudo de uma vez só pra mostrar 500.
        $items = [];
        foreach ($page as $entry) {
            $name = $entry['name'];
            $isDir = $entry['is_dir'];
            $full = $dir . '/' . $name;
            $items[] = [
                'name' => $name,
                'path' => relative_path($full),
                'is_dir' => $isDir,
                'size' => $isDir ? null : filesize($full),
                'modified' => filemtime($full),
                'perms' => substr(sprintf('%o', fileperms($full)), -4),
                'is_image' => !$isDir && is_image_file($name),
                'ext' => $isDir ? null : strtolower(pathinfo($name, PATHINFO_EXTENSION)),
                'hidden' => $name[0] === '.',
                'preview' => $isDir ? 'none' : preview_kind($name),
                'is_mount' => is_mount_level_item($full),
            ];
        }

        json_response([
            'path' => relative_path($dir),
            'items' => $items,
            'can_write' => !$isViewer,
            'total' => $total,
            'offset' => $offset,
            'limit' => $limit,
            'sort' => $sort,
            'desc' => $desc,
            'has_more' => ($offset + count($items)) < $total,
        ]);
    }

    case 'mkdir': {
        $rel = $_POST['path'] ?? '';
        $name = trim($_POST['name'] ?? '');
        $dir = safe_path($rel);
        if (!$dir || !is_dir($dir) || $name === '' || strpbrk($name, '/\\') !== false) {
            json_response(['error' => 'Dados inválidos.'], 400);
        }
        $name = unique_name($dir, $name);
        if (!mkdir($dir . '/' . $name, 0755)) json_response(['error' => 'Falha ao criar pasta.'], 500);
        audit_log('mkdir', ['path' => relative_path($dir . '/' . $name)]);
        json_response(['ok' => true, 'name' => $name]);
    }

    case 'rename': {
        $rel = $_POST['path'] ?? '';
        $newName = trim($_POST['new_name'] ?? '');
        $full = safe_path($rel);
        if (!$full || !file_exists($full) || $newName === '' || strpbrk($newName, '/\\') !== false) {
            json_response(['error' => 'Dados inválidos.'], 400);
        }
        if ($newName === '.' || $newName === '..') json_response(['error' => 'Nome inválido.'], 400);
        if (is_mount_level_item($full)) {
            json_response(['error' => 'Este item é um disco/pasta montada — renomeie pelo nome do disco, não por aqui.'], 400);
        }
        $dest = dirname($full) . '/' . $newName;
        if (file_exists($dest)) json_response(['error' => 'Já existe um item com esse nome.'], 409);
        if (!rename($full, $dest)) json_response(['error' => 'Falha ao renomear.'], 500);
        audit_log('rename', ['path' => relative_path($full), 'to' => $newName]);
        json_response(['ok' => true]);
    }

    case 'delete': {
        // Excluir agora MOVE pra lixeira do volume, em vez de apagar de vez.
        // A exclusão definitiva existe à parte (delete_permanent / a tela da
        // Lixeira) — antes um clique errado era irreversível e sem rastro.
        $paths = $_POST['paths'] ?? [];
        if (!is_array($paths) || empty($paths)) json_response(['error' => 'Nenhum item selecionado.'], 400);
        $failed = [];
        $trashed = [];
        foreach ($paths as $rel) {
            $full = safe_path($rel);
            // Ponto de montagem é o disco em si: apagar seu conteúdo por aqui
            // (ou o próprio diretório) nunca é o que a pessoa quis dizer.
            if (!$full || !file_exists($full) || is_mount_level_item($full) || is_in_trash($full)) {
                $failed[] = $rel;
                continue;
            }
            $id = move_to_trash($full);
            if ($id === null) $failed[] = $rel; else $trashed[] = $id;
        }
        audit_log('delete', ['paths' => $paths, 'trashed' => count($trashed), 'failed' => count($failed)], empty($failed));
        purge_expired_trash();
        json_response(['ok' => empty($failed), 'failed' => $failed, 'trashed' => count($trashed)]);
    }

    case 'delete_permanent': {
        require_admin_json();
        $paths = $_POST['paths'] ?? [];
        if (!is_array($paths) || empty($paths)) json_response(['error' => 'Nenhum item selecionado.'], 400);
        $failed = [];
        foreach ($paths as $rel) {
            $full = safe_path($rel);
            if (!$full || !file_exists($full) || is_mount_level_item($full) || !recursive_delete($full)) $failed[] = $rel;
        }
        audit_log('delete_permanent', ['paths' => $paths, 'failed' => count($failed)], empty($failed));
        json_response(['ok' => empty($failed), 'failed' => $failed]);
    }

    case 'trash_list': {
        purge_expired_trash();
        $settings = load_settings();
        json_response([
            'items' => list_trash(),
            'retention_days' => (int) ($settings['trash_retention_days'] ?? TRASH_RETENTION_DAYS_DEFAULT),
        ]);
    }

    case 'trash_restore': {
        $result = restore_from_trash($_POST['id'] ?? '');
        audit_log('trash_restore', ['id' => $_POST['id'] ?? '', 'to' => $result['restored_to'] ?? null], $result['ok']);
        if (!$result['ok']) json_response(['error' => $result['error']], 400);
        json_response($result);
    }

    case 'trash_purge': {
        $id = $_POST['id'] ?? '';
        $ok = purge_trash_item($id);
        audit_log('trash_purge', ['id' => $id], $ok);
        if (!$ok) json_response(['error' => 'Item não encontrado na lixeira.'], 404);
        json_response(['ok' => true]);
    }

    case 'trash_empty': {
        require_admin_json();
        $count = 0;
        foreach (list_trash() as $item) {
            if (purge_trash_item($item['id'])) $count++;
        }
        audit_log('trash_empty', ['removed' => $count]);
        json_response(['ok' => true, 'removed' => $count]);
    }

    case 'copy':
    case 'move': {
        $paths = $_POST['paths'] ?? [];
        $destRel = $_POST['dest'] ?? '';
        $destDir = safe_path($destRel);
        if (!is_array($paths) || empty($paths) || !$destDir || !is_dir($destDir)) {
            json_response(['error' => 'Dados inválidos.'], 400);
        }
        $failed = [];
        foreach ($paths as $rel) {
            $full = safe_path($rel);
            if (!$full || !file_exists($full)) { $failed[] = $rel; continue; }
            if (strpos($destDir, $full . '/') === 0 || $destDir === $full) { $failed[] = $rel; continue; } // não mover pra dentro de si mesmo
            $name = unique_name($destDir, basename($full));
            $target = $destDir . '/' . $name;
            $ok = $action === 'copy' ? recursive_copy($full, $target) : rename($full, $target);
            if (!$ok) $failed[] = $rel;
        }
        audit_log($action, ['paths' => $paths, 'dest' => relative_path($destDir), 'failed' => count($failed)], empty($failed));
        json_response(['ok' => empty($failed), 'failed' => $failed]);
    }

    case 'upload': {
        $rel = $_POST['path'] ?? '';
        $dir = safe_path($rel);
        if (!$dir || !is_dir($dir)) json_response(['error' => 'Pasta de destino inválida.'], 400);

        if (empty($_FILES['files'])) json_response(['error' => 'Nenhum arquivo enviado.'], 400);

        $relPaths = $_POST['relpaths'] ?? [];
        $names = $_FILES['files']['name'];
        $tmp = $_FILES['files']['tmp_name'];
        $errors = $_FILES['files']['error'];
        $sizes = $_FILES['files']['size'];

        $saved = [];
        $failed = [];

        foreach ($names as $i => $originalName) {
            if ($errors[$i] !== UPLOAD_ERR_OK) { $failed[] = $originalName; continue; }
            if ($sizes[$i] > MAX_UPLOAD_SIZE) { $failed[] = $originalName; continue; }
            if (is_extension_blocked($originalName)) { $failed[] = $originalName; continue; }

            // relpaths[i] preserva a estrutura de subpastas quando upload de pasta inteira
            $relativeSub = $relPaths[$i] ?? $originalName;
            $relativeSub = str_replace('\\', '/', $relativeSub);
            $relativeSub = ltrim($relativeSub, '/');

            $destFull = safe_path($rel . '/' . $relativeSub);
            if (!$destFull) { $failed[] = $originalName; continue; }

            $destDirFull = dirname($destFull);
            if (!is_dir($destDirFull)) mkdir($destDirFull, 0755, true);

            if (move_uploaded_file($tmp[$i], $destFull)) {
                $saved[] = $relativeSub;
            } else {
                $failed[] = $originalName;
            }
        }

        audit_log('upload', ['dest' => relative_path($dir), 'saved' => count($saved), 'failed' => count($failed)], empty($failed));
        json_response(['ok' => empty($failed), 'saved' => $saved, 'failed' => $failed]);
    }

    case 'search': {
        $rel = $_GET['path'] ?? '';
        $query = trim($_GET['q'] ?? '');
        $dir = safe_path($rel);
        if (!$dir || !is_dir($dir) || $query === '') json_response(['items' => []]);
        $results = [];
        $timedOut = recursive_search($dir, $query, $results);
        json_response(['items' => $results, 'timed_out' => $timedOut]);
    }

    case 'zip': {
        $paths = $_POST['paths'] ?? [];
        $rel = $_POST['path'] ?? '';
        $zipName = trim($_POST['name'] ?? '') ?: ('arquivos_' . date('Ymd_His'));
        $zipName = preg_replace('/[^a-zA-Z0-9_\-\.]/', '_', $zipName);
        if (!str_ends_with(strtolower($zipName), '.zip')) $zipName .= '.zip';

        $destDir = safe_path($rel);
        if (!is_array($paths) || empty($paths) || !$destDir || !is_dir($destDir)) {
            json_response(['error' => 'Dados inválidos.'], 400);
        }
        $zipName = unique_name($destDir, $zipName);
        $zipPath = $destDir . '/' . $zipName;

        $zip = new ZipArchive();
        if ($zip->open($zipPath, ZipArchive::CREATE) !== true) {
            json_response(['error' => 'Falha ao criar arquivo ZIP.'], 500);
        }
        foreach ($paths as $itemRel) {
            $full = safe_path($itemRel);
            if (!$full || !file_exists($full)) continue;
            if (is_dir($full)) {
                $zip->addEmptyDir(basename($full));
                zip_add_dir($zip, $full, basename($full));
            } else {
                $zip->addFile($full, basename($full));
            }
        }
        $zip->close();
        audit_log('zip', ['name' => $zipName, 'dest' => relative_path($destDir), 'items' => count($paths)]);
        json_response(['ok' => true, 'name' => $zipName]);
    }

    case 'unzip': {
        $rel = $_POST['path'] ?? '';
        $full = safe_path($rel);
        if (!$full || !is_file($full) || strtolower(pathinfo($full, PATHINFO_EXTENSION)) !== 'zip') {
            json_response(['error' => 'Arquivo ZIP inválido.'], 400);
        }
        $destDir = dirname($full) . '/' . unique_name(dirname($full), pathinfo($full, PATHINFO_FILENAME));
        mkdir($destDir, 0755);

        $zip = new ZipArchive();
        if ($zip->open($full) !== true) json_response(['error' => 'Falha ao abrir ZIP.'], 500);

        // Proteção contra path traversal dentro do próprio ZIP (zip slip).
        // A checagem anterior era `strpos($entry, '..') !== false`: barrava
        // nomes legítimos ("foto..jpg", "backup..2024") e ao mesmo tempo
        // deixava passar caminho absoluto. Aqui cada entrada é normalizada
        // segmento a segmento — do mesmo jeito que safe_path faz — e só é
        // aceita se o resultado continuar sendo um caminho relativo pra
        // dentro da pasta de destino.
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $entry = str_replace('\\', '/', (string) $zip->getNameIndex($i));
            $bad = $entry === '' || $entry[0] === '/' || preg_match('#^[A-Za-z]:#', $entry);
            $depth = 0;
            foreach (explode('/', $entry) as $segment) {
                if ($segment === '' || $segment === '.') continue;
                if ($segment === '..') { $depth--; if ($depth < 0) { $bad = true; break; } continue; }
                $depth++;
            }
            if ($bad) {
                $zip->close();
                recursive_delete($destDir);
                json_response(['error' => 'ZIP contém caminhos inválidos (aponta pra fora da pasta de destino).'], 400);
            }
        }
        $zip->extractTo($destDir);
        $zip->close();
        audit_log('unzip', ['path' => relative_path($full), 'to' => relative_path($destDir)]);
        json_response(['ok' => true, 'folder' => relative_path($destDir)]);
    }

    case 'read_file': {
        $rel = $_GET['path'] ?? '';
        $full = safe_path($rel);
        if (!$full || !is_file($full)) json_response(['error' => 'Arquivo não encontrado.'], 404);

        $size = filesize($full);
        if ($size > MAX_EDIT_SIZE) {
            json_response(['error' => 'Arquivo muito grande para o editor (máx. ' . human_filesize(MAX_EDIT_SIZE) . ').'], 413);
        }

        // Sniff simples: byte nulo nos primeiros 64KB indica conteúdo binário
        $sample = file_get_contents($full, false, null, 0, min($size, 65536));
        if ($sample !== false && strpos($sample, "\0") !== false) {
            json_response(['error' => 'Este arquivo parece binário — não é possível editar como texto.'], 415);
        }

        $content = file_get_contents($full);
        if ($content === false) json_response(['error' => 'Falha ao ler arquivo.'], 500);
        json_response(['content' => $content, 'size' => $size]);
    }

    case 'save_file': {
        $rel = $_POST['path'] ?? '';
        $content = $_POST['content'] ?? '';
        $full = safe_path($rel);
        if (!$full || !is_file($full)) json_response(['error' => 'Arquivo não encontrado.'], 404);
        if (strlen($content) > MAX_EDIT_SIZE) {
            json_response(['error' => 'Conteúdo excede o limite do editor (' . human_filesize(MAX_EDIT_SIZE) . ').'], 413);
        }
        if (file_put_contents($full, $content) === false) json_response(['error' => 'Falha ao salvar arquivo.'], 500);
        audit_log('save_file', ['path' => relative_path($full), 'bytes' => strlen($content)]);
        json_response(['ok' => true]);
    }

    case 'create_file': {
        $rel = $_POST['path'] ?? '';
        $name = trim($_POST['name'] ?? '');
        $dir = safe_path($rel);
        if (!$dir || !is_dir($dir) || $name === '' || strpbrk($name, '/\\') !== false) {
            json_response(['error' => 'Dados inválidos.'], 400);
        }
        $name = unique_name($dir, $name);
        if (is_extension_blocked($name)) json_response(['error' => 'Extensão bloqueada nas configurações.'], 400);
        if (file_put_contents($dir . '/' . $name, '') === false) json_response(['error' => 'Falha ao criar arquivo.'], 500);
        audit_log('create_file', ['path' => relative_path($dir . '/' . $name)]);
        json_response(['ok' => true, 'name' => $name]);
    }

    case 'list_disks': {
        require_admin_json();
        json_response(['devices' => list_block_devices()]);
    }

    case 'format_disk': {
        require_admin_json();

        $devicePath = $_POST['device'] ?? '';
        $fstype = $_POST['fstype'] ?? '';
        $label = trim($_POST['label'] ?? '');
        $confirm = $_POST['confirm'] ?? '';

        if ($confirm !== $devicePath) {
            json_response(['error' => 'Confirmação não confere. Digite exatamente o caminho do dispositivo mostrado na tela.'], 400);
        }

        if (!in_array($fstype, ['ext4', 'exfat', 'vfat'], true)) {
            json_response(['error' => 'Tipo de sistema de arquivos inválido.'], 400);
        }

        if ($label === '' || !preg_match('/^[A-Za-z0-9 _-]{1,32}$/', $label)) {
            json_response(['error' => 'Nome inválido. Use letras, números, espaço, - ou _ (até 32 caracteres).'], 400);
        }

        // Re-valida contra a listagem atual do sistema — nunca confia só na
        // string vinda do cliente. Dispositivo protegido (partição do HAOS)
        // ou inexistente é rejeitado aqui, mesmo que a interface já esconda.
        $device = find_safe_device($devicePath);
        if ($device === null) {
            json_response(['error' => 'Dispositivo inválido, protegido ou não encontrado.'], 403);
        }

        // Desmonta o dispositivo e qualquer partição filha montada (formatar
        // montado, ou com filho montado, corrompe o filesystem ou o kernel recusa).
        $unmountResults = unmount_device_and_children($devicePath);
        foreach ($unmountResults as $u) {
            if (!$u['ok']) {
                json_response(['error' => "Não foi possível desmontar {$u['mountpoint']} ({$u['path']}) antes de formatar: {$u['output']}"], 500);
            }
        }

        switch ($fstype) {
            case 'ext4':
                $cmd = 'mkfs.ext4 -F -L ' . escapeshellarg($label) . ' ' . escapeshellarg($devicePath) . ' 2>&1';
                break;
            case 'exfat':
                $cmd = 'mkfs.exfat -n ' . escapeshellarg($label) . ' ' . escapeshellarg($devicePath) . ' 2>&1';
                break;
            case 'vfat':
                // FAT32 limita o label a 11 caracteres, sem alguns símbolos, tradicionalmente maiúsculo
                $fatLabel = strtoupper(substr(preg_replace('/[^A-Za-z0-9_]/', '', $label), 0, 11));
                if ($fatLabel === '') $fatLabel = 'DISCO';
                $cmd = 'mkfs.vfat -F 32 -n ' . escapeshellarg($fatLabel) . ' ' . escapeshellarg($devicePath) . ' 2>&1';
                break;
        }

        exec($cmd, $output, $exitCode);

        if ($exitCode !== 0) {
            json_response(['error' => 'Falha ao formatar.', 'output' => implode("\n", $output)], 500);
        }

        // Monta na hora, sem precisar reiniciar o add-on nem o HA. O label
        // "de verdade" é reconferido via blkid em vez de assumir $label —
        // no caso do FAT32 o nome real gravado pode ter sido transformado
        // (maiúsculo, até 11 caracteres), então confiar no disco é mais
        // seguro do que confiar no que foi pedido.
        usleep(300000); // pequena folga pro kernel atualizar blkid depois do mkfs
        $realLabel = trim((string) shell_exec('blkid -o value -s LABEL ' . escapeshellarg($devicePath) . ' 2>/dev/null'));
        $mountInfo = ['mounted' => false, 'mount_point' => null, 'label' => $realLabel ?: $label];

        if ($realLabel !== '') {
            $mountPoint = rtrim(BASE_DIR, '/') . '/' . $realLabel;
            if (!is_dir($mountPoint)) mkdir($mountPoint, 0755, true);
            exec('mountpoint -q ' . escapeshellarg($mountPoint) . ' 2>/dev/null', $mpOut, $mpCode);
            if ($mpCode !== 0) { // ainda não montado
                exec('mount ' . escapeshellarg($devicePath) . ' ' . escapeshellarg($mountPoint) . ' 2>&1', $mountOut, $mountCode);
                if ($mountCode === 0) {
                    $mountInfo['mounted'] = true;
                    $mountInfo['mount_point'] = $mountPoint;
                }
            } else {
                $mountInfo['mounted'] = true;
                $mountInfo['mount_point'] = $mountPoint;
            }
        }

        audit_log('format_disk', ['device' => $devicePath, 'fstype' => $fstype, 'label' => $label]);
        json_response(['ok' => true, 'output' => implode("\n", $output), 'mount' => $mountInfo]);
    }

    case 'disk_smart': {
        require_admin_json();
        $devicePath = $_GET['device'] ?? '';
        $found = null;
        foreach (list_block_devices() as $d) {
            if ($d['path'] === $devicePath && $d['type'] === 'disk') { $found = $d; break; }
        }
        if (!$found) json_response(['error' => 'Dispositivo inválido.'], 404);
        json_response(['smart' => get_disk_smart($devicePath)]);
    }

    case 'disk_usage': {
        require_admin_json();
        $usage = [];
        foreach (glob(rtrim(BASE_DIR, '/') . '/*', GLOB_ONLYDIR) ?: [] as $dir) {
            if (!is_dir($dir)) continue;
            $total = @disk_total_space($dir);
            $free = @disk_free_space($dir);
            if ($total === false || $free === false) continue;
            $usage[] = [
                'name' => basename($dir),
                'total' => (int) $total,
                'free' => (int) $free,
                'used' => (int) ($total - $free),
                'percent' => $total > 0 ? round((($total - $free) / $total) * 100, 1) : 0,
            ];
        }
        json_response(['usage' => $usage]);
    }

    case 'folder_usage': {
        require_admin_json();
        $rel = $_GET['path'] ?? '';
        $dir = safe_path($rel);
        if (!$dir || !is_dir($dir)) json_response(['error' => 'Pasta não encontrada.'], 404);
        json_response(['items' => shallow_usage_breakdown($dir)]);
    }

    case 'test_notification': {
        require_admin_json();
        $ok = send_ha_notification('file_full_test', 'File Manager HD PHP', 'Notificação de teste — se você está vendo isso, a integração com o Home Assistant está funcionando.');
        if (!$ok) json_response(['error' => 'Falha ao enviar. Verifique se homeassistant_api: true está no config.yaml e se o add-on foi reconstruído.'], 500);
        json_response(['ok' => true]);
    }

    case 'time_machine_status': {
        require_admin_json();
        $options = get_addon_options();
        json_response([
            'enabled' => (bool) ($options['time_machine_enabled'] ?? false),
            'disk' => $options['time_machine_disk'] ?? '',
            'username' => $options['time_machine_username'] ?? '',
            'max_size_gb' => (int) ($options['time_machine_max_size_gb'] ?? 0),
        ]);
    }

    case 'smb_status': {
        require_admin_json();
        $options = get_addon_options();
        json_response([
            'enabled' => (bool) ($options['smb_enabled'] ?? false),
            'username' => $options['smb_username'] ?? '',
        ]);
    }

    case 'wg_status': {
        // Sem require_admin_json de propósito: é só um indicador de status
        // pro badge do cabeçalho, visível pra qualquer usuário logado
        // (require_login_json já rodou no topo do arquivo).
        $options = get_addon_options();
        $clients = [];
        foreach (['wg0' => 'wg', 'wg1' => 'wg2'] as $iface => $prefix) {
            $enabled = (bool) ($options[$prefix . '_enabled'] ?? false);
            $connected = false;
            $lastHandshake = null;
            if ($enabled && @is_dir("/sys/class/net/{$iface}")) {
                $out = trim((string) @shell_exec('wg show ' . escapeshellarg($iface) . ' latest-handshakes 2>/dev/null'));
                if ($out !== '') {
                    $parts = preg_split('/\s+/', $out);
                    $ts = isset($parts[1]) ? (int) $parts[1] : 0;
                    if ($ts > 0) {
                        $lastHandshake = $ts;
                        // Keepalive padrão é 25s; sem handshake nos últimos 3
                        // min, considera a conexão caída mesmo com a interface up.
                        $connected = (time() - $ts) < 180;
                    }
                }
            }
            $clients[$iface] = [
                'enabled' => $enabled,
                'connected' => $connected,
                'last_handshake' => $lastHandshake,
            ];
        }
        json_response(['clients' => $clients]);
    }

    case 'get_settings': {
        require_admin_json();
        $settings = load_settings();
        json_response([
            'settings' => [
                'blocked_extensions' => $settings['blocked_extensions'] ?? DEFAULT_EXTRA_BLOCKED_EXTENSIONS,
                'trash_retention_days' => (int) ($settings['trash_retention_days'] ?? TRASH_RETENTION_DAYS_DEFAULT),
            ],
            'always_blocked' => ALWAYS_BLOCKED_EXTENSIONS,
        ]);
    }

    case 'update_settings': {
        require_admin_json();
        $raw = trim($_POST['blocked_extensions'] ?? '');
        $list = array_filter(array_map(function ($e) {
            return strtolower(trim($e, ". \t\n\r"));
        }, explode(',', $raw)));
        $list = array_values(array_unique($list));
        $retention = max(0, min(365, (int) ($_POST['trash_retention_days'] ?? TRASH_RETENTION_DAYS_DEFAULT)));
        save_settings(['blocked_extensions' => $list, 'trash_retention_days' => $retention]);
        audit_log('update_settings', ['blocked_extensions' => $list, 'trash_retention_days' => $retention]);
        json_response(['ok' => true, 'blocked_extensions' => $list, 'trash_retention_days' => $retention]);
    }

    // ---- Links de compartilhamento temporários ----------------------------

    case 'create_share': {
        require_admin_json();
        $rel = $_POST['path'] ?? '';
        $hours = max(1, min(720, (int) ($_POST['hours'] ?? 24)));
        $full = safe_path($rel);
        if (!$full || !is_file($full)) {
            json_response(['error' => 'Só é possível compartilhar arquivos (não pastas).'], 400);
        }
        $share = create_share(relative_path($full), $hours * 3600);
        audit_log('create_share', ['path' => relative_path($full), 'hours' => $hours]);
        json_response(['ok' => true, 'token' => $share['token'], 'expires_at' => $share['expires_at']]);
    }

    case 'list_shares': {
        require_admin_json();
        // O token completo volta de propósito: é o que a tela precisa pra
        // remontar o link copiável de um compartilhamento já criado.
        json_response(['shares' => prune_shares()]);
    }

    case 'revoke_share': {
        require_admin_json();
        $token = $_POST['token'] ?? '';
        $ok = delete_share($token);
        audit_log('revoke_share', ['token' => substr($token, 0, 8) . '…'], $ok);
        if (!$ok) json_response(['error' => 'Link não encontrado.'], 404);
        json_response(['ok' => true]);
    }

    case 'audit_log': {
        require_admin_json();
        $limit = max(1, min(1000, (int) ($_GET['limit'] ?? 200)));
        json_response(['entries' => read_audit_log($limit)]);
    }

    case 'get_addon_options': {
        require_admin_json();
        $opt = get_addon_options();
        // Senhas nunca voltam pro navegador — só um indicador se já tem valor.
        foreach (['time_machine_password', 'smb_password', 'wg_private_key', 'wg_preshared_key', 'wg2_private_key', 'wg2_preshared_key'] as $k) {
            $opt[$k . '_set'] = !empty($opt[$k]);
            $opt[$k] = '';
        }
        json_response(['options' => $opt]);
    }

    case 'save_addon_options': {
        require_admin_json();
        $incoming = json_decode($_POST['options'] ?? '{}', true);
        if (!is_array($incoming)) json_response(['error' => 'Dados inválidos.'], 400);

        // Campos de senha em branco = "não mexer" (o usuário não digitou nada
        // pra trocar); remove do payload pra save_addon_options() manter o
        // valor atual em vez de apagar.
        foreach (['time_machine_password', 'smb_password', 'wg_private_key', 'wg_preshared_key', 'wg2_private_key', 'wg2_preshared_key'] as $k) {
            if (array_key_exists($k, $incoming) && $incoming[$k] === '') {
                unset($incoming[$k]);
            }
        }

        audit_log('save_addon_options', ['keys' => array_keys($incoming)]);
        if (!save_addon_options($incoming)) {
            json_response(['error' => 'Falha ao salvar. Verifique se hassio_api: true está no config.yaml e se o add-on foi reconstruído.'], 500);
        }
        json_response(['ok' => true]);
    }

    case 'restart_addon': {
        require_admin_json();
        restart_addon();
        json_response(['ok' => true]);
    }

    case 'ssh_generate_keypair': {
        require_admin_json();
        $kp = generate_ssh_keypair();
        if ($kp === null) {
            json_response(['error' => 'Falha ao gerar o par de chaves (ssh-keygen indisponível?).'], 500);
        }
        // A pública já entra em vigor (autorizada); ssh_enabled é ligado
        // junto pra evitar o passo extra de "gerei a chave mas esqueci de
        // ativar". Não reinicia sozinho — o front-end mostra a chave privada
        // pra download antes de reiniciar, pra nunca reiniciar sem o usuário
        // ter tido a chance de guardá-la.
        audit_log('ssh_generate_keypair', []);
        if (!save_addon_options(['ssh_authorized_key' => $kp['public'], 'ssh_enabled' => true])) {
            json_response(['error' => 'Chave gerada, mas falhou ao salvar nas opções do add-on.'], 500);
        }
        json_response(['ok' => true, 'private_key' => $kp['private'], 'public_key' => $kp['public']]);
    }

    case 'list_users': {
        require_admin_json();
        $users = array_map(fn($u) => [
            'username' => $u['username'],
            'role' => $u['role'],
            'created_at' => $u['created_at'] ?? null,
        ], load_users());
        json_response(['users' => $users]);
    }

    case 'create_user': {
        require_admin_json();
        $username = trim($_POST['username'] ?? '');
        $password = $_POST['password'] ?? '';
        $role = ($_POST['role'] ?? '') === 'admin' ? 'admin' : 'viewer';
        if ($username === '' || strlen($password) < 8) {
            json_response(['error' => 'Usuário obrigatório e senha com no mínimo 8 caracteres.'], 400);
        }
        if (!create_user($username, $password, $role)) {
            json_response(['error' => 'Já existe um usuário com esse nome.'], 409);
        }
        audit_log('create_user', ['username' => $username, 'role' => $role]);
        json_response(['ok' => true]);
    }

    case 'delete_user': {
        require_admin_json();
        $username = trim($_POST['username'] ?? '');
        $me = current_user()['username'] ?? '';
        if (strcasecmp($username, $me) === 0) {
            json_response(['error' => 'Você não pode excluir o próprio usuário logado.'], 400);
        }
        $admins = array_filter(load_users(), fn($u) => $u['role'] === 'admin');
        $target = find_user($username);
        if ($target && $target['role'] === 'admin' && count($admins) <= 1) {
            json_response(['error' => 'Precisa sobrar ao menos um administrador.'], 400);
        }
        if (!delete_user($username)) json_response(['error' => 'Usuário não encontrado.'], 404);
        audit_log('delete_user', ['username' => $username]);
        json_response(['ok' => true]);
    }

    case 'chmod': {
        require_admin_json();
        $rel = $_POST['path'] ?? '';
        $mode = $_POST['mode'] ?? '';
        $full = safe_path($rel);
        if (!$full || !file_exists($full) || !preg_match('/^[0-7]{3,4}$/', $mode)) {
            json_response(['error' => 'Dados inválidos.'], 400);
        }
        if (!chmod($full, octdec($mode))) json_response(['error' => 'Falha ao alterar permissões.'], 500);
        audit_log('chmod', ['path' => relative_path($full), 'mode' => $mode]);
        json_response(['ok' => true]);
    }

    default:
        json_response(['error' => 'Ação desconhecida.'], 400);
}
