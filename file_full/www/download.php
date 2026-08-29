<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/includes/functions.php';
require_once __DIR__ . '/includes/auth.php';

send_security_headers(false);

// Duas formas de chegar aqui:
//  - autenticado, com ?path=  (uso normal do app)
//  - anônimo, com ?share=TOKEN (link temporário criado por um admin; o token
//    já carrega o caminho, então ?path= é ignorado nesse modo)
$shareToken = $_GET['share'] ?? '';
$share = null;

if ($shareToken !== '') {
    $share = find_share($shareToken);
    if ($share === null) {
        http_response_code(404);
        send_security_headers();
        die('Link expirado ou inválido.');
    }
    $full = safe_path($share['path']);
} else {
    require_login();
    $full = safe_path($_GET['path'] ?? '');
}

if (!$full || !file_exists($full)) {
    http_response_code(404);
    die('Arquivo não encontrado.');
}

// Link compartilhado nunca serve pasta (ver create_share): um ZIP de tamanho
// arbitrário montado sob demanda pra quem não está autenticado é um jeito
// fácil demais de derrubar o add-on.
if ($share !== null && is_dir($full)) {
    http_response_code(400);
    die('Este link não aponta para um arquivo.');
}

// ---------------------------------------------------------------------------
// Pasta inteira -> ZIP
// ---------------------------------------------------------------------------
if (is_dir($full)) {
    // O ZIP é montado DENTRO do próprio volume da pasta, nunca em
    // sys_get_temp_dir(): /tmp fica no armazenamento interno do container
    // (pequeno — o próprio 00-mount-disk.sh trata isso como caso especial),
    // então compactar uma pasta grande de um HD enchia o container inteiro
    // antes de mandar o primeiro byte. No volume de origem há, por definição,
    // espaço da mesma ordem de grandeza do conteúdo.
    $volume = volume_root_of($full) ?: dirname($full);
    $workDir = $volume . '/' . TRASH_DIRNAME . '/tmp';
    if (!is_dir($workDir)) @mkdir($workDir, 0755, true);

    $tmpZip = $workDir . '/dl_' . bin2hex(random_bytes(8)) . '.zip';

    // O arquivo temporário precisa sumir mesmo se o cliente abortar o download
    // no meio (readfile morre com a conexão e o unlink lá embaixo não roda).
    register_shutdown_function(function () use ($tmpZip) { @unlink($tmpZip); });

    $zip = new ZipArchive();
    if ($zip->open($tmpZip, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        http_response_code(500);
        die('Falha ao preparar o download da pasta.');
    }
    $base = basename($full);
    $zip->addEmptyDir($base);
    zip_add_dir($zip, $full, $base);
    $zip->close();

    audit_log('download_folder', ['path' => relative_path($full)]);

    header('Content-Type: application/zip');
    header('Content-Disposition: ' . content_disposition($base . '.zip'));
    header('Content-Length: ' . filesize($tmpZip));
    readfile($tmpZip);
    @unlink($tmpZip);
    exit;
}

// ---------------------------------------------------------------------------
// Arquivo
// ---------------------------------------------------------------------------
$name = basename($full);
$size = filesize($full);

// ?inline=1 é o modo usado pelo visualizador embutido (imagem, vídeo, áudio,
// PDF). Só vale para tipos de inline_mime(), que é uma lista fechada — o
// navegador nunca é convidado a renderizar um arquivo qualquer como documento
// do nosso próprio origin. SVG fica fora de propósito: é um documento que
// executa script, e serví-lo inline daqui equivaleria a hospedar XSS.
$wantInline = ($_GET['inline'] ?? '') === '1';
$inlineMime = $wantInline ? inline_mime($name) : null;

if ($inlineMime !== null) {
    header('Content-Type: ' . $inlineMime);
    header('Content-Disposition: ' . content_disposition($name, 'inline'));
    header('Cache-Control: private, max-age=3600');
} else {
    header('Content-Type: ' . (mime_content_type($full) ?: 'application/octet-stream'));
    header('Content-Disposition: ' . content_disposition($name));
}

if ($share !== null) {
    increment_share_downloads($shareToken);
    audit_log('share_download', ['path' => relative_path($full), 'token' => substr($shareToken, 0, 8) . '…']);
}

// Range: é o que faz o player de vídeo permitir arrastar a barra de progresso
// (sem isso o navegador só consegue tocar linearmente do início) e o que
// permite retomar um download interrompido.
header('Accept-Ranges: bytes');
$range = $_SERVER['HTTP_RANGE'] ?? '';

if ($range !== '' && preg_match('/^bytes=(\d*)-(\d*)$/', trim($range), $m)) {
    $start = $m[1] === '' ? null : (int) $m[1];
    $end = $m[2] === '' ? null : (int) $m[2];

    if ($start === null) {
        // "bytes=-500" = os últimos 500 bytes
        $length = min((int) $end, $size);
        $start = $size - $length;
        $end = $size - 1;
    } else {
        $end = $end === null ? $size - 1 : min($end, $size - 1);
    }

    if ($start > $end || $start >= $size) {
        http_response_code(416);
        header('Content-Range: bytes */' . $size);
        exit;
    }

    http_response_code(206);
    header('Content-Range: bytes ' . $start . '-' . $end . '/' . $size);
    header('Content-Length: ' . ($end - $start + 1));

    $fh = fopen($full, 'rb');
    if ($fh === false) { http_response_code(500); exit; }
    fseek($fh, $start);
    $remaining = $end - $start + 1;
    while ($remaining > 0 && !feof($fh)) {
        $chunk = fread($fh, (int) min(262144, $remaining));
        if ($chunk === false) break;
        echo $chunk;
        $remaining -= strlen($chunk);
        flush();
    }
    fclose($fh);
    exit;
}

header('Content-Length: ' . $size);
readfile($full);
exit;
