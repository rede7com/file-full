<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/includes/functions.php';
require_once __DIR__ . '/includes/auth.php';

send_security_headers(false);
require_login();

$path = $_GET['path'] ?? '';
$size = max(40, min(400, (int)($_GET['size'] ?? 160)));
$full = safe_path($path);

if (!$full || !is_file($full) || !is_image_file($full)) {
    http_response_code(404);
    exit;
}

// Sem a extensão gd não dá pra gerar miniatura nenhuma. Sai com 415 (o JS
// cai no ícone do tipo, que é o mesmo caminho de uma imagem corrompida) em
// vez de deixar estourar um fatal error — que devolvia 500 com stack trace
// e o caminho absoluto do arquivo no corpo da resposta.
if (!function_exists('imagecreatetruecolor')) {
    http_response_code(415);
    exit;
}

$cacheKey = md5($full . filemtime($full) . $size) . '.jpg';
$cacheFile = THUMB_CACHE_DIR . '/' . $cacheKey;

if (!file_exists($cacheFile)) {
    $info = @getimagesize($full);
    if (!$info) { http_response_code(415); exit; }

    switch ($info[2]) {
        case IMAGETYPE_JPEG: $src = @imagecreatefromjpeg($full); break;
        case IMAGETYPE_PNG:  $src = @imagecreatefrompng($full); break;
        case IMAGETYPE_GIF:  $src = @imagecreatefromgif($full); break;
        case IMAGETYPE_WEBP: $src = @imagecreatefromwebp($full); break;
        case IMAGETYPE_BMP:  $src = @imagecreatefrombmp($full); break;
        default: $src = false;
    }
    if (!$src) { http_response_code(415); exit; }

    [$w, $h] = [imagesx($src), imagesy($src)];
    $ratio = min($size / $w, $size / $h);
    $nw = max(1, (int)($w * $ratio));
    $nh = max(1, (int)($h * $ratio));

    $thumb = imagecreatetruecolor($nw, $nh);
    $white = imagecolorallocate($thumb, 255, 255, 255);
    imagefill($thumb, 0, 0, $white);
    imagecopyresampled($thumb, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);
    imagejpeg($thumb, $cacheFile, 82);
    imagedestroy($src);
    imagedestroy($thumb);

    // Só checa o teto quando de fato acabou de gravar uma miniatura nova —
    // varrer o cache a cada requisição de imagem já cacheada seria caro à toa
    // numa pasta com centenas de fotos.
    prune_thumb_cache();
}

header('Content-Type: image/jpeg');
header('Cache-Control: public, max-age=604800');
readfile($cacheFile);
exit;
