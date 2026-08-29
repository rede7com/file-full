<?php
/**
 * Funções utilitárias do Gerenciador de Arquivos
 */

/**
 * Resolve um caminho relativo (vindo do cliente) para um caminho absoluto seguro
 * dentro de BASE_DIR. Bloqueia qualquer tentativa de path traversal (../).
 * Retorna null se o caminho for inválido ou estiver fora de BASE_DIR.
 *
 * Normalizar os segmentos ".." NÃO basta sozinho: um symlink em qualquer
 * componente do caminho pode apontar para fora de BASE_DIR, e symlinks assim
 * são criáveis por quem tem acesso SMB ou SSH ao mesmo disco. Por isso o
 * caminho é sempre confirmado com realpath():
 *
 *  - se o alvo já existe, realpath() resolve a cadeia inteira de symlinks;
 *  - se ainda não existe (upload, mkdir, novo arquivo), resolvemos o
 *    DIRETÓRIO PAI mais próximo que exista e conferimos ele — sem isso, um
 *    upload em "HD/atalho_pra_fora/arquivo.txt" gravaria fora de BASE_DIR,
 *    porque o realpath do caminho completo falha e o valor cru passaria.
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

    // Caminho já existente: realpath resolve symlinks em todos os componentes.
    $resolved = realpath($full);
    if ($resolved !== false) {
        return path_is_inside_base($resolved) ? $resolved : null;
    }

    // Caminho ainda inexistente: sobe até o primeiro ancestral que exista e
    // valida ELE. O que ainda não existe não pode ser symlink, então garantir
    // que o ancestral real está dentro de BASE_DIR garante o caminho todo.
    $probe = $full;
    $tail = [];
    while (true) {
        $parent = dirname($probe);
        if ($parent === $probe) return null; // chegou em "/" sem achar âncora válida
        array_unshift($tail, basename($probe));
        $realParent = realpath($parent);
        if ($realParent !== false) {
            if (!path_is_inside_base($realParent)) return null;
            return $realParent . '/' . implode('/', $tail);
        }
        $probe = $parent;
    }
}

/** true se um caminho JÁ RESOLVIDO (realpath) está dentro de BASE_DIR */
function path_is_inside_base(string $resolved): bool {
    return $resolved === BASE_DIR || strpos($resolved, BASE_DIR . '/') === 0;
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

/**
 * Copia recursivamente um arquivo ou diretório.
 *
 * Symlink é recriado como symlink, nunca seguido: seguir um link que aponte
 * pra fora de BASE_DIR copiaria conteúdo de fora pra dentro do gerenciador
 * (e um link apontando pra dentro de si mesmo causaria recursão infinita).
 */
function recursive_copy(string $src, string $dst): bool {
    if (is_link($src)) {
        $target = @readlink($src);
        return $target !== false && @symlink($target, $dst);
    }
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

/**
 * Busca recursiva por nome de arquivo/pasta a partir de um diretório. Para
 * por dois motivos, o que vier primeiro: atingir $limit resultados, ou
 * estourar $deadline (timestamp de microtime(true) — calculado uma vez na
 * chamada de fora, propagado pelas chamadas recursivas). Retorna true se
 * parou por timeout (resultados parciais), false se terminou a varredura
 * inteira (ou bateu o limite de resultados) a tempo.
 */
function recursive_search(string $dir, string $query, array &$results, int $limit = 200, ?float $deadline = null): bool {
    if ($deadline === null) {
        $deadline = microtime(true) + SEARCH_TIME_LIMIT_SECONDS;
    }
    if (count($results) >= $limit) return false;
    if (microtime(true) > $deadline) return true;

    $items = @scandir($dir);
    if (!$items) return false;

    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        if ($item[0] === '.') continue; // oculta arquivos de sistema
        if (count($results) >= $limit) return false;
        if (microtime(true) > $deadline) return true;

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
        if (is_dir($full) && recursive_search($full, $query, $results, $limit, $deadline)) {
            return true; // subárvore estourou o tempo — propaga o corte pra cima
        }
    }
    return false;
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
 * Grava opções do add-on via API do Supervisor (PATCH /addons/self/options).
 * IMPORTANTE: o Supervisor substitui o objeto de opções inteiro, não faz
 * merge — por isso sempre parte do get_addon_options() atual e sobrescreve
 * só as chaves passadas em $partial antes de enviar, pra nunca perder o
 * resto da configuração. Exige hassio_api: true no config.yaml.
 */
function save_addon_options(array $partial): bool {
    $token = getenv('SUPERVISOR_TOKEN');
    if (!$token) return false;

    $current = get_addon_options();
    $merged = array_merge($current, $partial);

    $ch = curl_init('http://supervisor/addons/self/options');
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => 'POST',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $token,
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS => json_encode(['options' => $merged], JSON_UNESCAPED_UNICODE),
    ]);
    $resp = curl_exec($ch);
    $ok = curl_errno($ch) === 0;
    curl_close($ch);
    if (!$ok) return false;
    $decoded = json_decode($resp ?: '', true);
    return ($decoded['result'] ?? '') === 'ok';
}

/**
 * Reinicia o próprio add-on (necessário pra opções novas surtirem efeito —
 * o Supervisor grava em /data/options.json e reprocessa o config.yaml só na
 * subida do container). Chamado depois de save_addon_options() ter sucesso;
 * a resposta HTTP não chega a voltar pro navegador porque o container já
 * está caindo, então o JS do lado do cliente trata isso como esperado.
 */
function restart_addon(): void {
    $token = getenv('SUPERVISOR_TOKEN');
    if (!$token) return;
    $ch = curl_init('http://supervisor/addons/self/restart');
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => 'POST',
        CURLOPT_TIMEOUT => 3,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token],
    ]);
    @curl_exec($ch);
    curl_close($ch);
}

/**
 * Gera um par de chaves SSH ed25519 novo, pra quem não tem uma chave própria
 * pronta. Roda num diretório temporário isolado (0700), lê as duas chaves e
 * apaga os arquivos na sequência — a privada só existe em disco durante essa
 * chamada, nunca fica persistida. O chamador é responsável por devolvê-la ao
 * navegador uma única vez (ela não pode ser recuperada depois).
 */
function generate_ssh_keypair(): ?array {
    $dir = sys_get_temp_dir() . '/ssh_keygen_' . bin2hex(random_bytes(8));
    if (!mkdir($dir, 0700, true)) return null;

    $keyPath = $dir . '/id_ed25519';
    exec('ssh-keygen -t ed25519 -f ' . escapeshellarg($keyPath) . ' -N ' . escapeshellarg('') . ' -C ' . escapeshellarg('file-full') . ' -q 2>&1', $out, $code);

    if ($code !== 0 || !file_exists($keyPath) || !file_exists($keyPath . '.pub')) {
        foreach (glob($dir . '/*') ?: [] as $f) @unlink($f);
        @rmdir($dir);
        return null;
    }

    $private = file_get_contents($keyPath);
    $public = trim(file_get_contents($keyPath . '.pub'));
    foreach (glob($dir . '/*') ?: [] as $f) @unlink($f);
    @rmdir($dir);

    return ['private' => $private, 'public' => $public];
}

// =============================================================================
// Cabeçalhos de segurança
// =============================================================================

/**
 * Cabeçalhos aplicados a toda resposta do app.
 *
 * A Content-Security-Policy é a rede de proteção contra XSS: mesmo que algum
 * dado vindo do disco escape do escapamento no JS, script injetado não roda
 * porque não carrega o nonce deste request (ver CSP_NONCE em config.php).
 *
 * - script-src: só arquivos do próprio app + o inline com o nonce do request.
 *   Sem 'unsafe-inline' de propósito.
 * - style-src aceita 'unsafe-inline' porque a interface usa muito style=""
 *   direto no markup; isso não reabre execução de script.
 * - frame-ancestors 'self' permite o iframe do Ingress (servido pelo mesmo
 *   origin do HA) e barra qualquer outro site de embutir o app (clickjacking).
 * - img-src/media-src aceitam blob: e data: por causa do visualizador e das
 *   miniaturas geradas no cliente.
 *
 * $html=false (api.php, download.php, thumb.php) manda só o essencial: numa
 * resposta que não é documento, uma CSP completa não acrescenta nada.
 */
function send_security_headers(bool $html = true): void {
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header('X-Frame-Options: SAMEORIGIN'); // navegadores antigos, sem CSP level 2
    if (!$html) return;

    header("Content-Security-Policy: "
        . "default-src 'self'; "
        . "script-src 'self' 'nonce-" . CSP_NONCE . "'; "
        . "style-src 'self' 'unsafe-inline'; "
        . "img-src 'self' data: blob:; "
        . "media-src 'self' blob:; "
        . "frame-src 'self' blob:; "
        . "connect-src 'self'; "
        . "font-src 'self'; "
        . "object-src 'none'; "
        . "base-uri 'none'; "
        . "form-action 'self'; "
        . "frame-ancestors 'self'");
    header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
}

/**
 * Monta um Content-Disposition seguro. Nome de arquivo no Linux pode conter
 * aspas e até quebra de linha — interpolar isso direto no cabeçalho permitia
 * injetar cabeçalhos arbitrários na resposta (HTTP response splitting).
 * Aqui o nome vai sempre percent-encoded na forma RFC 5987 (filename*), com
 * um fallback ASCII sanitizado pros clientes que não a entendem.
 */
function content_disposition(string $filename, string $type = 'attachment'): string {
    $ascii = preg_replace('/[^A-Za-z0-9._\- ]/', '_', $filename);
    if ($ascii === '' || $ascii === null) $ascii = 'arquivo';
    return $type . '; filename="' . $ascii . '"; filename*=UTF-8\'\'' . rawurlencode($filename);
}

// =============================================================================
// Log de auditoria
// =============================================================================

/**
 * Registra uma ação de escrita em /data/audit.log (uma linha JSON por ação).
 * Sem isso não havia como saber quem apagou/moveu o quê — o app tem vários
 * usuários, mas até aqui nenhum rastro. Rotaciona sozinho ao passar do teto,
 * mantendo um arquivo .1 anterior, pra nunca crescer sem limite dentro de
 * /data (que entra no backup do HA).
 */
function audit_log(string $action, array $details = [], bool $ok = true): void {
    if (@filesize(AUDIT_LOG_FILE) > AUDIT_LOG_MAX_BYTES) {
        @rename(AUDIT_LOG_FILE, AUDIT_LOG_FILE . '.1');
    }
    $entry = [
        'ts' => date('c'),
        'user' => $_SESSION['user']['username'] ?? '-',
        'ip' => $_SERVER['REMOTE_ADDR'] ?? '-',
        'action' => $action,
        'ok' => $ok,
    ] + $details;
    @file_put_contents(
        AUDIT_LOG_FILE,
        json_encode($entry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n",
        FILE_APPEND | LOCK_EX
    );
}

/** Últimas $limit entradas do log de auditoria, mais recentes primeiro. */
function read_audit_log(int $limit = 200): array {
    $entries = [];
    foreach ([AUDIT_LOG_FILE, AUDIT_LOG_FILE . '.1'] as $file) {
        if (!is_file($file)) continue;
        $lines = @file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
        foreach (array_reverse($lines) as $line) {
            $decoded = json_decode($line, true);
            if (is_array($decoded)) $entries[] = $decoded;
            if (count($entries) >= $limit) return $entries;
        }
    }
    return $entries;
}

// =============================================================================
// Lixeira
// =============================================================================

/**
 * Volume de topo (disco/pasta exposta) a que um caminho pertence — é o
 * primeiro segmento depois de BASE_DIR. A lixeira vive dentro do próprio
 * volume justamente pra que excluir seja um rename() no mesmo filesystem.
 * Retorna null para o próprio BASE_DIR (a raiz não pertence a volume nenhum).
 */
function volume_root_of(string $absolute): ?string {
    $rel = relative_path($absolute);
    if ($rel === '') return null;
    $first = explode('/', $rel)[0];
    return BASE_DIR . '/' . $first;
}

/** true se o caminho é um item de primeiro nível (ponto de montagem de disco) */
function is_mount_level_item(string $absolute): bool {
    $rel = relative_path($absolute);
    return $rel !== '' && strpos($rel, '/') === false;
}

function trash_dir_for(string $absolute): ?string {
    $volume = volume_root_of($absolute);
    return $volume === null ? null : $volume . '/' . TRASH_DIRNAME;
}

/** true se o caminho está dentro de alguma lixeira (não deve aparecer na listagem) */
function is_in_trash(string $absolute): bool {
    return strpos(relative_path($absolute) . '/', '/' . TRASH_DIRNAME . '/') !== false
        || substr(relative_path($absolute), -strlen(TRASH_DIRNAME)) === TRASH_DIRNAME;
}

/**
 * Move um item para a lixeira do volume dele, guardando os metadados
 * necessários pra restaurar depois (caminho original, quem excluiu, quando).
 * Retorna o id gerado, ou null se não deu.
 */
function move_to_trash(string $absolute): ?string {
    $trash = trash_dir_for($absolute);
    if ($trash === null) return null;

    $id = date('Ymd_His') . '_' . bin2hex(random_bytes(4));
    $itemsDir = $trash . '/items/' . $id;
    $metaDir = $trash . '/meta';
    if (!is_dir($itemsDir) && !mkdir($itemsDir, 0755, true)) return null;
    if (!is_dir($metaDir) && !mkdir($metaDir, 0755, true)) return null;

    $name = basename($absolute);
    $isDir = is_dir($absolute) && !is_link($absolute);
    if (!@rename($absolute, $itemsDir . '/' . $name)) {
        @rmdir($itemsDir);
        return null;
    }

    @file_put_contents($metaDir . '/' . $id . '.json', json_encode([
        'id' => $id,
        'name' => $name,
        'original_path' => relative_path($absolute),
        'is_dir' => $isDir,
        'deleted_at' => time(),
        'deleted_by' => $_SESSION['user']['username'] ?? '-',
    ], JSON_UNESCAPED_UNICODE));

    return $id;
}

/** Lista o conteúdo das lixeiras de todos os volumes, mais recentes primeiro. */
function list_trash(): array {
    $entries = [];
    foreach (glob(BASE_DIR . '/*/' . TRASH_DIRNAME . '/meta/*.json') ?: [] as $metaFile) {
        $meta = json_decode((string) @file_get_contents($metaFile), true);
        if (!is_array($meta) || empty($meta['id'])) continue;
        $itemPath = dirname(dirname($metaFile)) . '/items/' . $meta['id'] . '/' . $meta['name'];
        if (!file_exists($itemPath)) continue;
        $meta['size'] = $meta['is_dir'] ? null : @filesize($itemPath);
        $meta['volume'] = basename(dirname(dirname(dirname($metaFile))));
        $entries[] = $meta;
    }
    usort($entries, fn($a, $b) => ($b['deleted_at'] ?? 0) <=> ($a['deleted_at'] ?? 0));
    return $entries;
}

/** Localiza os caminhos físicos de um item da lixeira pelo id. */
function find_trash_entry(string $id): ?array {
    if (!preg_match('/^[0-9]{8}_[0-9]{6}_[0-9a-f]{8}$/', $id)) return null;
    foreach (glob(BASE_DIR . '/*/' . TRASH_DIRNAME . '/meta/' . $id . '.json') ?: [] as $metaFile) {
        $meta = json_decode((string) @file_get_contents($metaFile), true);
        if (!is_array($meta)) continue;
        $trash = dirname(dirname($metaFile));
        return [
            'meta' => $meta,
            'meta_file' => $metaFile,
            'item_dir' => $trash . '/items/' . $id,
            'item_path' => $trash . '/items/' . $id . '/' . $meta['name'],
        ];
    }
    return null;
}

/**
 * Devolve um item da lixeira ao lugar de origem. Se o caminho original não
 * existir mais (a pasta que continha o arquivo foi apagada), recria a árvore;
 * se já existir algo com o mesmo nome, restaura com nome único em vez de
 * sobrescrever.
 */
function restore_from_trash(string $id): array {
    $entry = find_trash_entry($id);
    if ($entry === null) return ['ok' => false, 'error' => 'Item não encontrado na lixeira.'];

    $target = safe_path($entry['meta']['original_path'] ?? '');
    if (!$target) return ['ok' => false, 'error' => 'Caminho original inválido.'];

    $destDir = dirname($target);
    if (!is_dir($destDir) && !mkdir($destDir, 0755, true)) {
        return ['ok' => false, 'error' => 'Não foi possível recriar a pasta de origem.'];
    }
    $finalName = unique_name($destDir, basename($target));
    if (!@rename($entry['item_path'], $destDir . '/' . $finalName)) {
        return ['ok' => false, 'error' => 'Falha ao restaurar o item.'];
    }
    @unlink($entry['meta_file']);
    @rmdir($entry['item_dir']);
    return ['ok' => true, 'restored_to' => relative_path($destDir . '/' . $finalName)];
}

/** Apaga de vez um item da lixeira. */
function purge_trash_item(string $id): bool {
    $entry = find_trash_entry($id);
    if ($entry === null) return false;
    recursive_delete($entry['item_dir']);
    @unlink($entry['meta_file']);
    return true;
}

/**
 * Expurga itens da lixeira mais velhos que a retenção configurada. Chamado
 * oportunisticamente (ao excluir e ao abrir a lixeira) em vez de por um
 * serviço em background — não vale um processo a mais no container só pra
 * isso, e a lixeira só cresce justamente quando alguém está usando o app.
 */
function purge_expired_trash(): int {
    $settings = load_settings();
    $days = (int) ($settings['trash_retention_days'] ?? TRASH_RETENTION_DAYS_DEFAULT);
    if ($days <= 0) return 0; // 0 = manter pra sempre
    $cutoff = time() - ($days * 86400);
    $removed = 0;
    foreach (list_trash() as $item) {
        if (($item['deleted_at'] ?? 0) < $cutoff && purge_trash_item($item['id'])) $removed++;
    }
    return $removed;
}

// =============================================================================
// Links de compartilhamento temporários
// =============================================================================

function load_shares(): array {
    $data = json_decode((string) @file_get_contents(SHARES_FILE), true);
    return is_array($data) ? $data : [];
}

function save_shares(array $shares): bool {
    return @file_put_contents(SHARES_FILE, json_encode(array_values($shares), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX) !== false;
}

/** Remove da lista os links já vencidos (chamado a cada leitura/escrita) */
function prune_shares(): array {
    $shares = load_shares();
    $alive = array_values(array_filter($shares, fn($s) => ($s['expires_at'] ?? 0) > time()));
    if (count($alive) !== count($shares)) save_shares($alive);
    return $alive;
}

/**
 * Cria um link temporário para um arquivo. Só arquivo, nunca pasta: um link
 * público para uma pasta inteira significaria montar um ZIP arbitrariamente
 * grande sob demanda pra quem não está autenticado.
 */
function create_share(string $relPath, int $ttlSeconds): array {
    $ttlSeconds = max(60, min($ttlSeconds, SHARE_MAX_TTL_SECONDS));
    $token = bin2hex(random_bytes(24));
    $shares = prune_shares();
    $shares[] = [
        'token' => $token,
        'path' => $relPath,
        'created_at' => time(),
        'created_by' => $_SESSION['user']['username'] ?? '-',
        'expires_at' => time() + $ttlSeconds,
        'downloads' => 0,
    ];
    save_shares($shares);
    return ['token' => $token, 'expires_at' => time() + $ttlSeconds];
}

/** Busca um link válido pelo token, em tempo constante contra o token guardado. */
function find_share(string $token): ?array {
    if (!preg_match('/^[0-9a-f]{48}$/', $token)) return null;
    foreach (prune_shares() as $share) {
        if (hash_equals($share['token'], $token)) return $share;
    }
    return null;
}

function delete_share(string $token): bool {
    $shares = prune_shares();
    $filtered = array_values(array_filter($shares, fn($s) => !hash_equals($s['token'], $token)));
    if (count($filtered) === count($shares)) return false;
    return save_shares($filtered);
}

function increment_share_downloads(string $token): void {
    $shares = prune_shares();
    foreach ($shares as &$s) {
        if (hash_equals($s['token'], $token)) { $s['downloads'] = ($s['downloads'] ?? 0) + 1; break; }
    }
    unset($s);
    save_shares($shares);
}

// =============================================================================
// Cache de miniaturas
// =============================================================================

/**
 * Mantém o cache de miniaturas abaixo do teto, removendo as mais antigas até
 * sobrar 80% do limite. Ele mora em /data, que ENTRA no backup do HA — sem
 * poda, navegar por uma biblioteca de fotos grande inchava permanentemente
 * todo backup gerado dali em diante.
 */
function prune_thumb_cache(): void {
    $files = glob(THUMB_CACHE_DIR . '/*.jpg') ?: [];
    $total = 0;
    $stats = [];
    foreach ($files as $f) {
        $size = @filesize($f);
        if ($size === false) continue;
        $total += $size;
        $stats[] = ['path' => $f, 'size' => $size, 'time' => @filemtime($f) ?: 0];
    }
    if ($total <= THUMB_CACHE_MAX_BYTES) return;

    usort($stats, fn($a, $b) => $a['time'] <=> $b['time']); // mais antigas primeiro
    $target = (int) (THUMB_CACHE_MAX_BYTES * 0.8);
    foreach ($stats as $s) {
        if ($total <= $target) break;
        if (@unlink($s['path'])) $total -= $s['size'];
    }
}

// =============================================================================
// Tipos de arquivo (visualizador)
// =============================================================================

/**
 * Classifica um arquivo pra decidir o que o visualizador embutido faz com ele:
 * mostrar imagem, tocar vídeo/áudio, embutir PDF, renderizar markdown, abrir
 * no editor de texto — ou simplesmente oferecer o download.
 */
function preview_kind(string $filename): string {
    $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    if (in_array($ext, ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'], true)) return 'image';
    if (in_array($ext, ['mp4', 'webm', 'ogv', 'mov', 'm4v'], true)) return 'video';
    if (in_array($ext, ['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac'], true)) return 'audio';
    if ($ext === 'pdf') return 'pdf';
    if (in_array($ext, ['md', 'markdown'], true)) return 'markdown';
    return 'none';
}

/**
 * MIME seguro para servir um arquivo inline no visualizador. Só tipos que o
 * navegador renderiza sem risco de tratar o conteúdo como documento HTML do
 * nosso próprio origin — SVG fica de fora de propósito (SVG é um documento
 * que executa script), servido sempre como download.
 */
function inline_mime(string $filename): ?string {
    static $map = [
        'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png',
        'gif' => 'image/gif', 'webp' => 'image/webp', 'bmp' => 'image/bmp',
        'ico' => 'image/x-icon',
        'mp4' => 'video/mp4', 'webm' => 'video/webm', 'ogv' => 'video/ogg',
        'mov' => 'video/quicktime', 'm4v' => 'video/mp4',
        'mp3' => 'audio/mpeg', 'wav' => 'audio/wav', 'ogg' => 'audio/ogg',
        'oga' => 'audio/ogg', 'flac' => 'audio/flac', 'm4a' => 'audio/mp4',
        'aac' => 'audio/aac',
        'pdf' => 'application/pdf',
    ];
    $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    return $map[$ext] ?? null;
}

