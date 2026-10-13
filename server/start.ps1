# Sobe o servidor local do OpenCode com senha fixa para a extensão.
#
#   powershell -ExecutionPolicy Bypass -File server\start.ps1
#   powershell -ExecutionPolicy Bypass -File server\start.ps1 -Port 4177 -Password x
#
# Idempotente: se já houver alguém escutando na porta, sai sem fazer nada.
# Usado também pelo atalho de inicialização do Windows, então precisa
# encerrar em segundos e nunca abrir janela.

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

# ---------------------------------------------------------------- ja existe?

$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  Say "Ja existe um servidor escutando na porta $Port (PID $($existing.OwningProcess))." 'Yellow'
  Say "Se a senha nao bater, rode server\stop.ps1 e tente de novo."
  exit 0
}

# ------------------------------------------------------- acha o executavel

# O comando "opencode" no PATH e um shim .ps1/.cmd, que Start-Process nao
# consegue executar diretamente. Resolve o binario de verdade.
function Resolve-Opencode {
  $candidates = @(
    (Join-Path $env:APPDATA 'npm\node_modules\@opencode\cli\bin\opencode.exe'),
    (Join-Path $env:LOCALAPPDATA 'opencode\bin\opencode.exe')
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { return $c }
  }
  $cmd = Get-Command opencode -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -match '\.exe$') { return $cmd.Source }
  return $null
}

$exe = Resolve-Opencode
if (-not $exe) {
  Say "Nao encontrei o executavel do opencode." 'Red'
  Say "Procurei em: $env:APPDATA\npm\node_modules\@opencode\cli\bin\opencode.exe"
  exit 1
}

if (-not (Test-Path $Directory)) {
  New-Item -ItemType Directory -Force -Path $Directory | Out-Null
}

# ---------------------------------------------------------------- sobe

$env:OPENCODE_SERVER_PASSWORD = $Password

$out = Join-Path $env:TEMP "opencode-browser-chat-$Port.log"
$err = Join-Path $env:TEMP "opencode-browser-chat-$Port.err.log"

Say "Iniciando OpenCode em http://127.0.0.1:$Port" 'Cyan'
Say "Senha ....... $Password"
Say "Pasta ....... $Directory"
Say "Binario ..... $exe"
Say "Para parar: server\stop.ps1"

# Start-Process com -Redirect* segura o script pai até o filho soltar os
# handles (era o que fazia o script imprimir "Pronto" e nunca encerrar), e
# `cmd /c start /b` morre junto com o console. Win32_Process.Create cria o
# processo já destacado: o script termina e o servidor continua.
$cmdLine = 'cmd.exe /c "set OPENCODE_SERVER_PASSWORD={0}&& {1} serve --port {2} --hostname 127.0.0.1"' -f `
  $Password, $exe, $Port

$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create `
  -Arguments @{ CommandLine = $cmdLine; CurrentDirectory = $Directory }

if ($result.ReturnValue -ne 0) {
  Say "Falha ao criar o processo (codigo $($result.ReturnValue))." 'Red'
  exit 1
}
Say "Processo criado (PID $($result.ProcessId))."

# ------------------------------------------------------------- confere

$ok = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 500
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    $ok = $true
    break
  }
}

if ($ok) {
  $pid_ = (Get-NetTCPConnection -LocalPort $Port -State Listen | Select-Object -First 1).OwningProcess
  Say "Pronto. Servidor no ar (PID $pid_)." 'Green'
  exit 0
}

Say "Nao escutou na porta $Port apos 10s." 'Red'
Say "Log: $out"
Say "Erro: $err"
exit 1