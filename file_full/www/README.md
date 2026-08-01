# Gerenciador de Arquivos (PHP puro, sem banco de dados)

Sistema completo de gerenciamento de arquivos estilo explorador, construído com PHP + HTML + CSS + JS puro, no mesmo padrão flat-file (JSON) dos seus outros sistemas.

## Funcionalidades incluídas

- Navegação por pastas e subpastas (breadcrumb clicável)
- Upload de pasta inteira (preserva subpastas), com drag & drop de pastas do sistema operacional
- Upload de múltiplos arquivos, com drag & drop
- Barra de progresso de envio (por lotes, para não travar em uploads grandes)
- Criar pasta, renomear, excluir (múltiplos itens de uma vez)
- Copiar e mover (recortar) arquivos/pastas entre diretórios
- Pesquisa recursiva por nome
- Miniaturas de imagens (geradas e cacheadas em disco via GD)
- Painel de informações (tamanho, datas, tipo, permissões Unix, caminho)
- Compactação em ZIP (arquivos e pastas selecionados) e descompactação de ZIP
- Controle de permissões: papéis **admin** (acesso total) e **viewer** (somente leitura/download)
- Extensões bloqueadas configuráveis pela interface (botão ⚙️ Configurações), com uma lista mínima de segurança fixa que nunca pode ser desativada
- Login com senha (hash bcrypt via `password_hash`), sem senha padrão — você cria o admin no primeiro acesso

## Requisitos no servidor

- PHP 7.4+ (ideal 8.x) com as extensões: `zip` e `gd` habilitadas
- Apache com `mod_rewrite` e suporte a `.htaccess` (`AllowOverride All` no VirtualHost — o mesmo ponto que já causou problema nos seus outros projetos, então confira isso primeiro)
- Permissão de escrita para o usuário do Apache (`www-data`) nas pastas `data/` e `files/`

## Instalação

1. Envie a pasta `gerenciador-arquivos/` inteira para o seu VPS (via SCP, Git ou upload).
2. Ajuste permissões:
   ```bash
   sudo chown -R www-data:www-data gerenciador-arquivos
   sudo chmod -R 755 gerenciador-arquivos
   sudo chmod -R 775 gerenciador-arquivos/data gerenciador-arquivos/files
   ```
3. Confirme que as extensões PHP necessárias estão ativas:
   ```bash
   php -m | grep -E "zip|gd"
   ```
   Se faltar alguma: `sudo apt install php-zip php-gd && sudo systemctl restart apache2`
4. Acesse `https://seudominio.com/gerenciador-arquivos/` — como ainda não existe nenhum usuário, você verá a tela de **configuração inicial** para criar o administrador.
5. Ajuste `MAX_UPLOAD_SIZE` em `config.php` e também os limites reais do PHP (`php.ini`).

   **Primeiro descubra qual `php.ini` o Apache está usando de fato** (mod_php e PHP-FPM usam arquivos diferentes):
   ```bash
   sudo find /etc/php -name "php.ini"
   ```
   Normalmente aparece algo como `/etc/php/8.3/apache2/php.ini` (mod_php) e/ou `/etc/php/8.3/fpm/php.ini` (PHP-FPM). Use o caminho correspondente ao seu setup nos comandos abaixo (troque `8.3` pela sua versão, se for diferente):

   **Se usa mod_php (Apache clássico):**
   ```bash
   PHP_INI=/etc/php/8.3/apache2/php.ini

   sudo sed -i 's/^upload_max_filesize = .*/upload_max_filesize = 200M/' "$PHP_INI"
   sudo sed -i 's/^post_max_size = .*/post_max_size = 220M/' "$PHP_INI"
   sudo sed -i 's/^max_file_uploads = .*/max_file_uploads = 200/' "$PHP_INI"
   sudo sed -i 's/^memory_limit = .*/memory_limit = 256M/' "$PHP_INI"
   sudo sed -i 's/^max_execution_time = .*/max_execution_time = 300/' "$PHP_INI"
   sudo sed -i 's/^max_input_time = .*/max_input_time = 300/' "$PHP_INI"

   sudo systemctl restart apache2
   ```

   **Se usa PHP-FPM** (mesmos comandos, arquivo e serviço diferentes):
   ```bash
   PHP_INI=/etc/php/8.3/fpm/php.ini

   sudo sed -i 's/^upload_max_filesize = .*/upload_max_filesize = 200M/' "$PHP_INI"
   sudo sed -i 's/^post_max_size = .*/post_max_size = 220M/' "$PHP_INI"
   sudo sed -i 's/^max_file_uploads = .*/max_file_uploads = 200/' "$PHP_INI"
   sudo sed -i 's/^memory_limit = .*/memory_limit = 256M/' "$PHP_INI"
   sudo sed -i 's/^max_execution_time = .*/max_execution_time = 300/' "$PHP_INI"
   sudo sed -i 's/^max_input_time = .*/max_input_time = 300/' "$PHP_INI"

   sudo systemctl restart php8.3-fpm
   sudo systemctl restart apache2
   ```

   Para conferir se os valores realmente mudaram depois do restart:
   ```bash
   php -i | grep -E "upload_max_filesize|post_max_size|max_file_uploads|memory_limit"
   ```
   Se o valor exibido continuar o antigo, é sinal de que o Apache está lendo outro `php.ini` que não o que você editou — confira o resultado do `find` acima novamente.

## Segurança já incluída

- Todo caminho recebido do navegador passa por `safe_path()`, que bloqueia tentativas de `../../` (path traversal)
- A pasta `files/` (onde os arquivos reais ficam) é bloqueada para acesso HTTP direto — todo download passa por `download.php`, que exige login
- As pastas `data/` e `includes/` também são bloqueadas via `.htaccess`
- Extensões perigosas (`.php`, `.exe`, `.sh` etc.) nunca são aceitas no upload, mesmo que o nome do arquivo seja disfarçado
  - Uma lista pequena e fixa de extensões de script (`.php`, `.phtml`, `.cgi`, `.pl` etc.) **não pode ser removida**, nem pela interface — isso evita que alguém desative essa proteção sem querer
  - A lista de extensões **extras** bloqueadas (padrão: `exe, bat, msi, com, vbs, jar, sh`) é editável pelo admin em **⚙️ Configurações**, no topo da tela
- Senhas armazenadas com `password_hash()` (bcrypt), nunca em texto puro
- Proteção contra "zip slip" ao descompactar arquivos ZIP

## Gerenciar usuários adicionais

Ainda não há tela de administração de usuários na interface (pode ser adicionada depois). Por enquanto, para criar mais usuários (ex: um usuário "viewer" para alguém da equipe só consultar), crie um pequeno script temporário:

```php
<?php
require_once 'config.php';
require_once 'includes/auth.php';
create_user('nome_usuario', 'senha_forte_aqui', 'viewer'); // ou 'admin'
echo 'Usuário criado.';
```
Execute uma vez pelo navegador e **apague o arquivo em seguida**.

## Observações

- O sistema não usa banco de dados — tudo é feito diretamente no sistema de arquivos, seguindo o padrão dos seus outros projetos.
- "Permissões" na interface mostra os bits Unix reais dos arquivos e permite ao admin alterá-los (chmod) quando necessário — o controle de acesso à aplicação em si é feito pelo papel (admin/viewer) do usuário logado.
- Se quiser, dá para depois adicionar: versionamento de arquivos, log de auditoria (quem fez o quê), compartilhamento por link temporário, e permissões por pasta específica (ex: cada congregação só vê sua própria pasta).
