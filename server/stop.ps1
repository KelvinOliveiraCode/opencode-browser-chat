# Para o servidor local do OpenCode usado pela extensão.
# Uso: powershell -ExecutionPolicy Bypass -File server\stop.ps1

param([int]$Port = 4177)

$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $conn) {
  Write-Host "Nada escutando na porta $Port." -ForegroundColor Yellow
  exit 0
}

foreach ($pid_ in ($conn.OwningProcess | Sort-Object -Unique)) {
  $proc = Get-Process -Id $pid_ -ErrorAction SilentlyContinue
  Write-Host "Parando PID $pid_ ($($proc.ProcessName))" -ForegroundColor Cyan
  Stop-Process -Id $pid_ -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 1
$still = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($still) {
  Write-Host "Ainda escutando. Tente fechar o processo manualmente." -ForegroundColor Red
} else {
  Write-Host "Servidor parado." -ForegroundColor Green
}