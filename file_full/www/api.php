<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/includes/auth.php';
require_once __DIR__ . '/includes/functions.php';

require_login_json();

$action = $_REQUEST['action'] ?? '';
$isViewer = !is_admin();

// Ações que exigem privilégio de escrita (bloqueadas para role "viewer")
$writeActions = ['mkdir', 'rename', 'delete', 'copy', 'move', 'upload', 'zip', 'unzip', 'chmod', 'update_settings', 'save_file', 'create_file', 'format_disk', 'save_addon_options', 'restart_addon', 'create_user', 'delete_user'];
if (in_array($action, $writeActions, true) && $isViewer) {
    json_response(['error' => 'Seu usuário tem permissão apenas de visualização.'], 403);
}

switch ($action) {

    case 'list': {
        $rel = $_GET['path'] ?? '';
        $showHidden = ($_GET['show_hidden'] ?? '') === '1';
        $dir = safe_path($rel);
        if (!$dir || !is_dir($dir)) json_response(['error' => 'Pasta não encontrada.'], 404);

        $items = [];
        foreach (scandir($dir) as $name) {
            if ($name === '.' || $name === '..') continue;
            if (!$showHidden && $name[0] === '.') continue; // oculta arquivos de sistema (.htaccess, .gitkeep etc.)
            $full = $dir . '/' . $name;
            $isDir = is_dir($full);
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
            ];
        }
        // Pastas primeiro, depois ordem alfabética
        usort($items, function ($a, $b) {
            if ($a['is_dir'] !== $b['is_dir']) return $a['is_dir'] ? -1 : 1;
            return strcasecmp($a['name'], $b['name']);
        });

        json_response([
            'path' => relative_path($dir),
            'items' => $items,
            'can_write' => !$isViewer,
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
        json_response(['ok' => true, 'name' => $name]);
    }

    case 'rename': {
        $rel = $_POST['path'] ?? '';
        $newName = trim($_POST['new_name'] ?? '');
        $full = safe_path($rel);
        if (!$full || !file_exists($full) || $newName === '' || strpbrk($newName, '/\\') !== false) {
            json_response(['error' => 'Dados inválidos.'], 400);
        }
        $dest = dirname($full) . '/' . $newName;
        if (file_exists($dest)) json_response(['error' => 'Já existe um item com esse nome.'], 409);
        if (!rename($full, $dest)) json_response(['error' => 'Falha ao renomear.'], 500);
        json_response(['ok' => true]);
    }

    case 'delete': {
        $paths = $_POST['paths'] ?? [];
        if (!is_array($paths) || empty($paths)) json_response(['error' => 'Nenhum item selecionado.'], 400);
        $failed = [];
        foreach ($paths as $rel) {
            $full = safe_path($rel);
            if (!$full || !file_exists($full) || !recursive_delete($full)) $failed[] = $rel;
        }
        json_response(['ok' => empty($failed), 'failed' => $failed]);
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

        json_response(['ok' => empty($failed), 'saved' => $saved, 'failed' => $failed]);
    }

    case 'search': {
        $rel = $_GET['path'] ?? '';
        $query = trim($_GET['q'] ?? '');
        $dir = safe_path($rel);
        if (!$dir || !is_dir($dir) || $query === '') json_response(['items' => []]);
        $results = [];
        recursive_search($dir, $query, $results);
        json_response(['items' => $results]);
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

        // Proteção contra path traversal dentro do próprio ZIP (zip slip)
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $entry = $zip->getNameIndex($i);
            if (strpos($entry, '..') !== false) {
                $zip->close();
                json_response(['error' => 'ZIP contém caminhos inválidos.'], 400);
            }
        }
        $zip->extractTo($destDir);
        $zip->close();
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
        if (file_put_contents($dir . '/' . $name, '') === false) json_response(['error' => 'Falha ao criar arquivo.'], 500);
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
        json_response([
            'settings' => load_settings(),
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
        save_settings(['blocked_extensions' => $list]);
        json_response(['ok' => true, 'blocked_extensions' => $list]);
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
        json_response(['ok' => true]);
    }

    default:
        json_response(['error' => 'Ação desconhecida.'], 400);
}
