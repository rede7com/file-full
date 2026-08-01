<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/includes/auth.php';
require_once __DIR__ . '/includes/functions.php';

require_login();

$path = $_GET['path'] ?? '';
$full = safe_path($path);

if (!$full || !file_exists($full)) {
    http_response_code(404);
    die('Arquivo não encontrado.');
}

if (is_dir($full)) {
    // Download de pasta inteira: gera um ZIP temporário e envia
    $zipName = basename($full) . '.zip';
    $tmpZip = sys_get_temp_dir() . '/dl_' . uniqid() . '.zip';
    $zip = new ZipArchive();
    $zip->open($tmpZip, ZipArchive::CREATE);
    $zip->addEmptyDir(basename($full));
    zip_add_dir($zip, $full, basename($full));
    $zip->close();

    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . $zipName . '"');
    header('Content-Length: ' . filesize($tmpZip));
    readfile($tmpZip);
    unlink($tmpZip);
    exit;
}

$mime = mime_content_type($full) ?: 'application/octet-stream';
header('Content-Type: ' . $mime);
header('Content-Disposition: attachment; filename="' . basename($full) . '"');
header('Content-Length: ' . filesize($full));
header('X-Content-Type-Options: nosniff');
readfile($full);
exit;
