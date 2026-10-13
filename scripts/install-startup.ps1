# Cria o atalho de inicializacao do servidor do OpenCode.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1 -Remove
param([switch]$Remove)

$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root 'server\start.ps1'
$startup = [Environment]::GetFolderPath('Startup')
$link = Join-Path $startup 'OpenCode Chat - servidor.lnk'

if (-not (Test-Path $script)) { throw "start.ps1 nao encontrado em $script" }

if ($Remove) {
  if (Test-Path $link) {
    Remove-Item $link -Force
    Write-Host "Atalho removido: $link" -ForegroundColor Yellow
  } else {
    Write-Host "Nao ha atalho em $link" -ForegroundColor Yellow
  }
  return
}

if (Test-Path $link) { Remove-Item $link -Force }

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($link)
$sc.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$sc.Arguments = "-NoProfile -NoLogo -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$sc.WorkingDirectory = $root
$sc.WindowStyle = 7          # minimizado
$sc.Description = 'Sobe o servidor local do OpenCode usado pela extensao de chat'
$sc.IconLocation = "$env:SystemRoot\System32\shell32.dll,44"
$sc.Save()

Write-Host "Atalho criado:" -ForegroundColor Green
Write-Host "  $link"
Write-Host ""
Write-Host "Alvo ......  powershell -WindowStyle Hidden -File start.ps1"
Write-Host "Log .......  $env:TEMP\opencode-browser-chat-4177.log"
Write-Host "Parar .....  server\stop.ps1"
Write-Host ""
Write-Host "Funciona no proximo login. Para testar agora, abra o atalho." -ForegroundColor DarkGray