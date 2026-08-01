<?php
/**
 * Funções utilitárias do Gerenciador de Arquivos
 */

/**
 * Resolve um caminho relativo (vindo do cliente) para um caminho absoluto seguro
 * dentro de BASE_DIR. Bloqueia qualquer tentativa de path traversal (../).
 * Retorna null se o caminho for inválido ou estiver fora de BASE_DIR.
 */
function safe_path(string $relative): ?string {
    $relative = str_replace('\\', '/', $relative);
    $relative = ltrim($relative, '/');

    // Normaliza removendo segmentos . e ..
    $parts = [];
    foreach (explode('/', $relative) as $segment) {
        if ($segment === '' || $segment === '.') continue;
        if ($segment === '..') {
            array_pop($parts);
            continue;
        }
        $parts[] = $segment;
    }
    $normalized = implode('/', $parts);
    $full = $normalized === '' ? BASE_DIR : BASE_DIR . '/' . $normalized;

    // Como todo segmento ".." já foi removido acima, $full está garantidamente
    // dentro de BASE_DIR só pela normalização — não depende de o caminho já existir.
    // Se o caminho existir de fato (arquivo/pasta ou até um symlink), confirmamos
    // com realpath() que ele continua fisicamente dentro de BASE_DIR (proteção extra
    // contra symlinks que apontem para fora).
    $resolved = realpath($full);
    if ($resolved !== false) {
        if ($resolved !== BASE_DIR && strpos($resolved, BASE_DIR . '/') !== 0) return null;
        return $resolved;
    }

    return $full;
}

/** Retorna o caminho relativo (para exibição/URLs) a partir de um caminho absoluto */
function relative_path(string $absolute): string {
    $rel = substr($absolute, strlen(BASE_DIR));
    return ltrim(str_replace('\\', '/', $rel), '/');
}

function human_filesize(int $bytes, int $decimals = 1): string {
    $units = ['B', 'KB', 'MB', 'GB', 'TB'];
    $factor = $bytes > 0 ? floor(log($bytes, 1024)) : 0;
    $factor = min($factor, count($units) - 1);
    return sprintf("%.{$decimals}f", $bytes / pow(1024, $factor)) . ' ' . $units[$factor];
}

function load_settings(): array {
    if (!file_exists(SETTINGS_FILE)) {
        $default = ['blocked_extensions' => DEFAULT_EXTRA_BLOCKED_EXTENSIONS];
        file_put_contents(SETTINGS_FILE, json_encode($default, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        return $default;
    }
    $data = json_decode(file_get_contents(SETTINGS_FILE), true);
    if (!is_array($data) || !isset($data['blocked_extensions'])) {
        return ['blocked_extensions' => DEFAULT_EXTRA_BLOCKED_EXTENSIONS];
    }
    return $data;
}

function save_settings(array $settings): bool {
    return file_put_contents(SETTINGS_FILE, json_encode($settings, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) !== false;
}

function is_extension_blocked(string $filename): bool {
    $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    if (in_array($ext, ALWAYS_BLOCKED_EXTENSIONS, true)) return true;
    $settings = load_settings();
    $extra = array_map('strtolower', $settings['blocked_extensions'] ?? []);
    return in_array($ext, $extra, true);
}

function is_image_file(string $filename): bool {
    $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    return in_array($ext, ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'], true);
}

/** Copia recursivamente um arquivo ou diretório */
function recursive_copy(string $src, string $dst): bool {
    if (is_dir($src)) {
        if (!is_dir($dst)) mkdir($dst, 0755, true);
        $items = scandir($src);
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') continue;
            if (!recursive_copy($src . '/' . $item, $dst . '/' . $item)) return false;
        }
        return true;
    }
    return copy($src, $dst);
}

/** Remove recursivamente um arquivo ou diretório */
function recursive_delete(string $path): bool {
    if (is_dir($path) && !is_link($path)) {
        $items = scandir($path);
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') continue;
            recursive_delete($path . '/' . $item);
        }
        return rmdir($path);
    }
    return unlink($path);
}

/** Calcula o tamanho total de um diretório (recursivo) */
function dir_size(string $path): int {
    $size = 0;
    $items = @scandir($path);
    if (!$items) return 0;
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $full = $path . '/' . $item;
        $size += is_dir($full) ? dir_size($full) : filesize($full);
    }
    return $size;
}

/** Gera um nome único caso já exista arquivo/pasta com o mesmo nome no destino */
function unique_name(string $dir, string $name): string {
    $info = pathinfo($name);
    $base = $info['filename'];
    $ext = isset($info['extension']) ? '.' . $info['extension'] : '';
    $candidate = $name;
    $i = 1;
    while (file_exists($dir . '/' . $candidate)) {
        $candidate = $base . ' (' . $i . ')' . $ext;
        $i++;
    }
    return $candidate;
}

/** Busca recursiva por nome de arquivo/pasta a partir de um diretório */
function recursive_search(string $dir, string $query, array &$results, int $limit = 200): void {
    if (count($results) >= $limit) return;
    $items = @scandir($dir);
    if (!$items) return;
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        if ($item[0] === '.') continue; // oculta arquivos de sistema
        if (count($results) >= $limit) return;
        $full = $dir . '/' . $item;
        if (stripos($item, $query) !== false) {
            $isDir = is_dir($full);
            $results[] = [
                'name' => $item,
                'path' => relative_path($full),
                'is_dir' => $isDir,
                'size' => $isDir ? null : filesize($full),
                'modified' => filemtime($full),
            ];
        }
        if (is_dir($full)) {
            recursive_search($full, $query, $results, $limit);
        }
    }
}

/** Adiciona um diretório inteiro a um ZipArchive já aberto */
function zip_add_dir(ZipArchive $zip, string $dirPath, string $zipPath = ''): void {
    $items = scandir($dirPath);
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $full = $dirPath . '/' . $item;
        $local = $zipPath === '' ? $item : $zipPath . '/' . $item;
        if (is_dir($full)) {
            $zip->addEmptyDir($local);
            zip_add_dir($zip, $full, $local);
        } else {
            $zip->addFile($full, $local);
        }
    }
}

/** Converte valores do php.ini com sufixo (ex: '8M', '2G', '512K') para bytes */
function ini_to_bytes(string $val): int {
    $val = trim($val);
    if ($val === '' || $val === '-1') return PHP_INT_MAX;
    $last = strtolower($val[strlen($val) - 1]);
    $num = (int) $val;
    switch ($last) {
        case 'g': return $num * 1024 * 1024 * 1024;
        case 'm': return $num * 1024 * 1024;
        case 'k': return $num * 1024;
        default: return $num;
    }
}

function json_response(array $data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Lista dispositivos de bloco (discos/partições) via lsblk, marcando como
 * "protegido" qualquer um relacionado ao sistema do próprio HAOS — label
 * começando com "hassos" (hassos-boot, hassos-data, hassos-overlay), e
 * também o disco inteiro caso alguma partição dele seja protegida. Nunca
 * deve ser possível formatar nada marcado como protegido.
 */
function list_block_devices(): array {
    $lsblkJson = (string) @shell_exec('lsblk -J -b -o NAME,PATH,LABEL,FSTYPE,SIZE,MOUNTPOINT,TYPE,PKNAME 2>/dev/null');
    $blkidText = (string) @shell_exec('blkid -o export 2>/dev/null');
    return parse_block_devices($lsblkJson, $blkidText);
}

/**
 * Lógica pura (sem I/O) que processa a saída de lsblk + blkid e decide quais
 * dispositivos ficam marcados como protegidos. Separado de list_block_devices()
 * de propósito, pra poder testar com dados simulados sem depender de discos reais.
 */
function parse_block_devices(string $lsblkJson, string $blkidText): array {
    $data = json_decode($lsblkJson, true);
    $flat = [];
    $flatten = function ($items) use (&$flatten, &$flat) {
        foreach ($items as $item) {
            $flat[] = $item;
            if (!empty($item['children'])) $flatten($item['children']);
        }
    };
    $flatten($data['blockdevices'] ?? []);

    // O LABEL/FSTYPE do lsblk pode vir vazio dependendo do estado do cache do
    // udev no ambiente (visto na prática com loop devices recém-formatados).
    // blkid lê o filesystem diretamente e é mais confiável — cruza os dois.
    $blkidByDevice = [];
    if (trim($blkidText) !== '') {
        foreach (explode("\n\n", trim($blkidText)) as $block) {
            $fields = [];
            foreach (explode("\n", $block) as $line) {
                if (strpos($line, '=') === false) continue;
                [$k, $v] = explode('=', $line, 2);
                $fields[$k] = $v;
            }
            if (!empty($fields['DEVNAME'])) {
                $blkidByDevice[$fields['DEVNAME']] = $fields;
            }
        }
    }
    foreach ($flat as &$d) {
        $path = $d['path'] ?? null;
        $bi = $path ? ($blkidByDevice[$path] ?? null) : null;
        if ($bi) {
            if (empty($d['label']) && !empty($bi['LABEL'])) $d['label'] = $bi['LABEL'];
            if (empty($d['fstype']) && !empty($bi['TYPE'])) $d['fstype'] = $bi['TYPE'];
        }
    }
    unset($d);

    // Passo 1: marca como protegido qualquer device com label hassos-*, ou cujo
    // nome comece com "zram" (memória RAM comprimida usada pelo HAOS como swap —
    // nunca é um disco de dados de verdade, "formatar" ali corromperia o swap
    // do sistema). Marca também o disco pai (pkname) de qualquer um desses.
    $protectedNames = [];
    foreach ($flat as $d) {
        $label = strtolower($d['label'] ?? '');
        $name = strtolower($d['name'] ?? '');
        $isHassos = $label !== '' && strpos($label, 'hassos') === 0;
        $isZram = strpos($name, 'zram') === 0;
        if ($isHassos || $isZram) {
            $protectedNames[$d['name']] = true;
            if (!empty($d['pkname'])) $protectedNames[$d['pkname']] = true;
        }
    }
    // Passo 2: qualquer partição cujo disco pai esteja protegido também fica protegida
    // (evita formatar uma partição "vizinha" de uma partição de sistema no mesmo disco).
    foreach ($flat as $d) {
        if (!empty($d['pkname']) && isset($protectedNames[$d['pkname']])) {
            $protectedNames[$d['name']] = true;
        }
    }

    // Dispositivos protegidos nem aparecem na lista — mais prudente do que só
    // marcar visualmente. A proteção de verdade continua sendo o backend
    // (find_safe_device) recusar qualquer um que não esteja nesta lista.
    $devices = [];
    foreach ($flat as $d) {
        if (!in_array($d['type'] ?? '', ['disk', 'part'], true)) continue;
        if (isset($protectedNames[$d['name']])) continue;
        $devices[] = [
            'path' => $d['path'] ?? null,
            'name' => $d['name'] ?? null,
            'label' => $d['label'] ?? null,
            'fstype' => $d['fstype'] ?? null,
            'size' => isset($d['size']) ? (int) $d['size'] : 0,
            'mountpoint' => $d['mountpoint'] ?? null,
            'type' => $d['type'] ?? null,
        ];
    }
    return $devices;
}

/**
 * Desmonta um dispositivo E qualquer partição filha dele que esteja montada.
 * Necessário antes de formatar um disco inteiro (ex: /dev/sdc) que tenha uma
 * partição montada (ex: /dev/sdc1) — sem isso o mkfs recusa com "apparently
 * in use by the system", mesmo o dispositivo alvo em si não estando
 * diretamente montado. Retorna a lista do que tentou desmontar, com sucesso
 * ou não de cada um.
 */
function unmount_device_and_children(string $devicePath): array {
    $json = @shell_exec('lsblk -J -b -o NAME,PATH,MOUNTPOINT,PKNAME 2>/dev/null');
    $data = json_decode((string) $json, true);
    $flat = [];
    $flatten = function ($items) use (&$flatten, &$flat) {
        foreach ($items as $item) {
            $flat[] = $item;
            if (!empty($item['children'])) $flatten($item['children']);
        }
    };
    $flatten($data['blockdevices'] ?? []);

    // Nome "kernel" (ex: sdc) do dispositivo alvo, pra casar com o pkname dos filhos
    $targetName = null;
    foreach ($flat as $d) {
        if (($d['path'] ?? null) === $devicePath) { $targetName = $d['name'] ?? null; break; }
    }

    $results = [];
    foreach ($flat as $d) {
        $isTarget = ($d['path'] ?? null) === $devicePath;
        $isChild = $targetName !== null && ($d['pkname'] ?? null) === $targetName;
        if (($isTarget || $isChild) && !empty($d['mountpoint'])) {
            exec('umount ' . escapeshellarg($d['mountpoint']) . ' 2>&1', $out, $code);
            $results[] = ['path' => $d['path'] ?? '', 'mountpoint' => $d['mountpoint'], 'ok' => $code === 0, 'output' => implode(' ', $out)];
        }
    }
    return $results;
}

/**
 * Confirma, no momento exato da formatação, que o path informado é um
 * dispositivo real e não protegido. list_block_devices() já nem retorna
 * dispositivos protegidos — então se não achar aqui, ou é inválido ou é
 * justamente um protegido (hassos-*, zram). Nunca confia na string vinda do
 * cliente sem re-checar contra a listagem atual do sistema.
 */
function find_safe_device(string $path): ?array {
    foreach (list_block_devices() as $d) {
        if ($d['path'] === $path) {
            return $d;
        }
    }
    return null;
}

/**
 * Lê dados S.M.A.R.T. de um disco físico via smartctl. Só faz sentido pra
 * dispositivos type=disk (não partições). Discos USB às vezes não expõem
 * SMART através da ponte USB — nesse caso volta supported=false, sem erro.
 */
function get_disk_smart(string $devicePath): array {
    $json = @shell_exec('smartctl -a -j ' . escapeshellarg($devicePath) . ' 2>&1');
    $data = json_decode((string) $json, true);

    if (!is_array($data) || empty($data['smart_status']) && empty($data['ata_smart_attributes'])) {
        return [
            'supported' => false,
            'message' => 'Não foi possível ler dados SMART deste dispositivo (comum em alguns adaptadores USB).',
        ];
    }

    $result = [
        'supported' => true,
        'healthy' => $data['smart_status']['passed'] ?? null,
        'model' => $data['model_name'] ?? ($data['model_family'] ?? null),
        'serial' => $data['serial_number'] ?? null,
        'temperature_c' => $data['temperature']['current'] ?? null,
        'power_on_hours' => $data['power_on_time']['hours'] ?? null,
        'power_cycles' => $data['power_cycle_count'] ?? null,
        'reallocated_sectors' => null,
        'pending_sectors' => null,
    ];

    if (!empty($data['ata_smart_attributes']['table'])) {
        foreach ($data['ata_smart_attributes']['table'] as $attr) {
            $id = $attr['id'] ?? null;
            if ($id === 5) $result['reallocated_sectors'] = $attr['raw']['value'] ?? null;
            if ($id === 197) $result['pending_sectors'] = $attr['raw']['value'] ?? null;
        }
    }

    return $result;
}

/**
 * Calcula o tamanho de cada item (arquivo ou pasta) diretamente dentro de
 * $dirPath, usando o comando `du` do sistema (bem mais rápido que somar
 * recursivamente em PHP puro pra pastas grandes). Cada item tem um timeout
 * curto pra não travar a requisição numa pasta gigante — se estourar, o
 * item volta com 'timeout' => true e o tamanho fica null.
 */
function shallow_usage_breakdown(string $dirPath, int $timeoutSeconds = 8): array {
    $items = @scandir($dirPath);
    if (!$items) return [];
    $results = [];
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $full = $dirPath . '/' . $item;
        $isDir = is_dir($full);
        if (!$isDir) {
            $results[] = ['name' => $item, 'is_dir' => false, 'size' => @filesize($full) ?: 0, 'timeout' => false];
            continue;
        }
        $cmd = 'timeout ' . (int) $timeoutSeconds . ' du -sb ' . escapeshellarg($full) . ' 2>/dev/null';
        $out = @shell_exec($cmd);
        if ($out && preg_match('/^(\d+)/', trim($out), $m)) {
            $results[] = ['name' => $item, 'is_dir' => true, 'size' => (int) $m[1], 'timeout' => false];
        } else {
            $results[] = ['name' => $item, 'is_dir' => true, 'size' => null, 'timeout' => true];
        }
    }
    usort($results, fn($a, $b) => ($b['size'] ?? -1) <=> ($a['size'] ?? -1));
    return $results;
}

/**
 * Envia uma notificação persistente pro Home Assistant, via proxy do
 * Supervisor (exige homeassistant_api: true no config.yaml). notification_id
 * fixo faz o HA atualizar a mesma notificação em vez de duplicar a cada
 * checagem do monitor.
 */
function send_ha_notification(string $notificationId, string $title, string $message): bool {
    $token = getenv('SUPERVISOR_TOKEN');
    if (!$token) return false;

    $ch = curl_init('http://supervisor/core/api/services/persistent_notification/create');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $token,
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS => json_encode([
            'notification_id' => $notificationId,
            'title' => $title,
            'message' => $message,
        ], JSON_UNESCAPED_UNICODE),
    ]);
    curl_exec($ch);
    $ok = curl_errno($ch) === 0;
    curl_close($ch);
    return $ok;
}

/**
 * Lê as opções configuradas do add-on. O Supervisor grava automaticamente
 * TODAS as opções em /data/options.json ao iniciar o container — não precisa
 * de nenhum mecanismo próprio de exportação, só ler esse arquivo.
 */
function get_addon_options(): array {
    $raw = @file_get_contents('/data/options.json');
    $decoded = $raw ? json_decode($raw, true) : null;
    return is_array($decoded) ? $decoded : [];
}

/**
 * Baixa um arquivo via HTTPS com verificação de certificado obrigatória e
 * limite de tamanho. Recusa qualquer URL que não seja https:// de propósito
 * — isso é o que impede a atualização de ser interceptada/adulterada em
 * trânsito (não impede uma origem já maliciosa, só o "no meio do caminho").
 */
function download_file(string $url, string $dest, int $maxBytes): bool {
    if (strpos($url, 'https://') !== 0) return false;

    $fp = fopen($dest, 'w');
    if (!$fp) return false;

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_FILE => $fp,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_TIMEOUT => 120,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    curl_exec($ch);
    $httpOk = curl_errno($ch) === 0 && curl_getinfo($ch, CURLINFO_HTTP_CODE) === 200;
    curl_close($ch);
    fclose($fp);

    $size = @filesize($dest);
    if (!$httpOk || $size === false || $size === 0 || $size > $maxBytes) {
        @unlink($dest);
        return false;
    }
    return true;
}

/** Lê o campo "version:" do config.yaml dentro de um pacote de atualização, sem extrair tudo ainda. */
function extract_version_from_zip(string $zipPath): ?string {
    $zip = new ZipArchive();
    if ($zip->open($zipPath) !== true) return null;
    $content = $zip->getFromName('config.yaml');
    $zip->close();
    if ($content === false) return null;
    if (preg_match('/^version:\s*["\']?([^"\'\n]+)["\']?/m', $content, $m)) {
        return trim($m[1]);
    }
    return null;
}

/** Versão atualmente instalada, consultada via API do Supervisor (self/info). */
function get_current_addon_version(): ?string {
    $token = getenv('SUPERVISOR_TOKEN');
    if (!$token) return null;
    $ch = curl_init('http://supervisor/addons/self/info');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token],
    ]);
    $res = curl_exec($ch);
    curl_close($ch);
    $data = json_decode((string) $res, true);
    return $data['data']['version'] ?? null;
}
