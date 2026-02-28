$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "[LLM Chess Arena] working dir: $(Get-Location)"

if (-not (Test-Path ".env")) {
  Write-Host "[LLM Chess Arena] .env not found, creating from .env.example ..."
  Copy-Item ".env.example" ".env"
}

Write-Host "[LLM Chess Arena] installing dependencies ..."
npm install

Write-Host "[LLM Chess Arena] starting dev server ..."
npm run dev