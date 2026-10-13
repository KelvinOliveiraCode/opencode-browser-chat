# Abre a pasta da extensão já selecionada no Explorer.
#
# Existe por causa de um erro que dá muita confusão: no "carregar sem
# compactação" é fácil selecionar a pasta do projeto em vez da subpasta, e o
# Brave responde que o manifesto não existe. Aqui não há dúvida de qual é.

$ext = Join-Path $PSScriptRoot '..\extension'
$ext = (Resolve-Path $ext).Path

if (-not (Test-Path (Join-Path $ext 'manifest.json'))) {
  Write-Host "ERRO: nao achei manifest.json em $ext" -ForegroundColor Red
  exit 1
}

Write-Host "Pasta da extensao:" -ForegroundColor Green
Write-Host "  $ext" -ForegroundColor White
Write-Host ""
Write-Host "Em brave://extensions -> Carregar sem compactacao -> escolha essa pasta."

# o /select abre o Explorer já com o manifesto selecionado
Start-Process explorer.exe -ArgumentList "/select,`"$ext\manifest.json`""