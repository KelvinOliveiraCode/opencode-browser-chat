# Reinicia o servidor local do OpenCode usado pela extensao.
#
#   powershell -ExecutionPolicy Bypass -File server\restart.ps1
#
# Por que um script proprio, e nao so rodar o start.ps1: o start e
# idempotente de proposito. Se ja houver alguem escutando na porta, ele
# encerra sem fazer nada. Quando o processo fica travado (porta aceita
# conexao, mas nenhuma requisicao e respondida), rodar o start nao resolve:
# o servidor continua la, morto. Aqui ele e derrubado antes.

param(
  [int]$Port = 4177,
  [string]$Password = 'testefixo123',
  [string]$Directory = '',
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

if (-not $Directory) {
  $Directory = Join-Path $env:USERPROFILE 'Desktop'
}

function Say($msg, $color = 'Gray') {
  if (-not $Quiet) { Write-Host $msg -ForegroundColor $color }
}

# ------------------------------------------------------------ 1. derrubar

$ocupante = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($ocupante) {
  $pids = $ocupante.OwningProcess | Sort-Object -Unique
  foreach ($procId in $pids) {
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    $nome = if ($proc) { $proc.ProcessName } else { '(ja saiu)' }
    Say "Parando o servidor travado (PID $procId, $nome)..." 'Yellow'
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  }

  # O Windows pode demorar a soltar o socket. Esperar de verdade antes de
  # subir de novo: se subir enquanto a porta ainda esta presa, o start
  # falha com um erro de endereco em uso que nao explica nada.
  $liberou = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
      $liberou = $true
      break
    }
  }
  if (-not $liberou) {
    Say "A porta $Port continua ocupada depois de 15s." 'Red'
    Say "Feche o processo na mao e tente de novo:" 'Red'
    Say "  Get-NetTCPConnection -LocalPort $Port -State Listen | Select OwningProcess" 'Red'
    exit 1
  }
  Say "Porta $Port liberada." 'Green'
} else {
  Say "Nada escutando na porta ${Port}: nada para parar."
}

# --------------------------------------------------------------- 2. subir

Say ''
Say "Subindo o servidor em http://127.0.0.1:$Port ..." 'Cyan'
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start.ps1') `
  -Port $Port -Password $Password -Directory $Directory

# ----------------------------------------------------------- 3. verificar

# O start so confere se a porta abriu. Aqui a prova e uma requisicao real:
# e o timeout de resposta que distinguia "porta aberta" de "servidor morto".
$H = @{ Authorization = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("opencode:$Password")) }
$respondeu = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $loc = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/location" -Headers $H -TimeoutSec 5
    $respondeu = $true
    break
  } catch {
    # ainda subindo (ou falhou de vez)
  }
}

Say ''
if ($respondeu) {
  Say "Servidor no ar e respondendo." 'Green'
  Say "  endereco  http://127.0.0.1:$Port"
  Say "  pasta     $($loc.directory)"
  Say ''
  Say "A extensao precisa ser recarregada para reconectar:" 'Cyan'
  Say "  brave://extensions  ->  recarregar a extensao"
  exit 0
}

Say "O servidor subiu mas nao respondeu na porta ${Port}." 'Red'
Say "Olhe o log para a causa:" 'Red'
$logBase = Join-Path $env:TEMP "opencode-browser-chat-${Port}"
Say "  ${logBase}.log" 'Red'
Say "  ${logBase}.err.log" 'Red'
exit 1
