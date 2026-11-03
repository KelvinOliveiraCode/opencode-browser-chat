# Mata SÓ as instâncias do Brave usadas nos testes.
#
# Existe por um erro que eu cometi várias vezes nesta conversa: rodar
#   Get-CimInstance Win32_Process -Filter "Name='brave.exe'" | Stop-Process
# Isso fecha o Brave principal da pessoa — abas, contas logadas, trabalho.
# Os testes usam perfil temporário em %TEMP%\brave-*, então dá para filtrar.

$teste = Get-CimInstance Win32_Process -Filter "Name='brave.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -match '\\brave-[A-Za-z0-9._-]+' }

if (-not $teste) {
    Write-Host "Nenhuma instancia de teste rodando. Nada a fazer."
    exit 0
}

$teste | ForEach-Object {
    Write-Host "fechando teste PID $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Milliseconds 800

$sobrou = Get-CimInstance Win32_Process -Filter "Name='brave.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -match '\\brave-[A-Za-z0-9._-]+' }
if ($sobrou) {
    Write-Host "ainda restam $($sobrou.Count) instancias de teste" -ForegroundColor Yellow
    exit 1
}

Write-Host "Instancias de teste fechadas. Seu Brave principal nao foi tocado." -ForegroundColor Green
