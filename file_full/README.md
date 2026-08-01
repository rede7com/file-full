# File Manager HD PHP (add-on HA)

Add-on standalone: monta o HD externo diretamente.

## 1. Rotular a partição do HD (uma vez, fora do HA)

Conecte o disco em uma máquina Linux (ou via SSH no host do HAOS, se tiver acesso)
e identifique a partição:

```bash
lsblk -f
```

Rotule de acordo com o sistema de arquivos:

```bash
# ext4
sudo e2label /dev/sdX1 HD_EXTERNO

# NTFS
sudo ntfslabel /dev/sdX1 HD_EXTERNO

# exFAT
sudo exfatlabel /dev/sdX1 HD_EXTERNO
```

O label precisa bater com a opção `disk_label` do add-on (padrão: `HD_EXTERNO`).
Rotular por label evita depender de `/dev/sdX` mudar de nome entre boots.

## 2. Publicar o repositório

Suba esta pasta inteira para um repositório GitHub (mantendo `repository.yaml`
na raiz e a pasta `file_full/` dentro dele).

## 3. Adicionar ao Home Assistant

Settings > Add-ons > Add-on Store > menu (⋮) > Repositories > cole a URL do
seu repositório GitHub.

O add-on "File Manager HD Externo" vai aparecer na loja. Instale, ajuste
`disk_label` e `fs_type` na aba Configuration, e inicie.

## Observações

- `full_access: true` é necessário para o container enxergar `/dev` e montar
  o disco. É equivalente ao `--privileged` do Docker — mais permissivo que
  o mapeamento padrão (`map: - share:rw`), mas te dá independência total do
  sambanas.
- Se preferir reduzir o escopo de acesso mais tarde, dá pra trocar
  `full_access` por `devices: ["/dev/sdX1"]` fixando o device, mas aí você
  perde a resiliência de montar por label caso a numeração mude.
- Ingress está habilitado (`ingress: true`), então o file manager aparece
  direto na sidebar do HA, sem precisar expor porta nem Basic Auth — a
  autenticação é a própria sessão do usuário do HA.
