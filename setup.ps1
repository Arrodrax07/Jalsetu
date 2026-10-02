# JalSetu one-time local setup (Windows PowerShell 7+ or 5.1).
#   .\setup.ps1                 # full setup
#   .\setup.ps1 -SkipTraining   # reuse existing models
param([switch]$SkipTraining)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "==> Python virtual environment (backend\.venv)" -ForegroundColor Cyan
if (-not (Test-Path "$root\backend\.venv")) { python -m venv "$root\backend\.venv" }
$py = "$root\backend\.venv\Scripts\python.exe"
& $py -m pip install --upgrade pip | Out-Null
Push-Location "$root\backend"; & $py -m pip install -r requirements.txt; Pop-Location

Write-Host "==> backend\.env" -ForegroundColor Cyan
if (-not (Test-Path "$root\backend\.env")) {
  $secret = & $py -c "import secrets;print(secrets.token_urlsafe(48))"
  (Get-Content "$root\backend\.env.example") -replace '^JWT_SECRET=.*', "JWT_SECRET=$secret" | Set-Content "$root\backend\.env"
  Write-Host "   created with a random JWT secret. Change ADMIN_PASSWORD in backend\.env before sharing access." -ForegroundColor Yellow
}

if (-not $SkipTraining) {
  $art = "$root\ml\artifacts"
  if (-not ((Test-Path "$art\complaint_classifier.joblib") -and (Test-Path "$art\demand_forecaster.joblib"))) {
    Write-Host "==> Training ML models (downloads weather history + embedding model; ~5-10 min first time)" -ForegroundColor Cyan
    Push-Location "$root\ml"; & $py -m jalsetu_ml.train all; Pop-Location
  } else { Write-Host "==> ML models already trained" -ForegroundColor Cyan }
}

Write-Host "==> Database schema, admin, master data, sample staff accounts" -ForegroundColor Cyan
Push-Location "$root\backend"; & $py -m scripts.seed --sample-users; Pop-Location

Write-Host "==> Frontend dependencies" -ForegroundColor Cyan
Push-Location "$root\frontend"; npm ci; Pop-Location

Write-Host "`nSetup complete. Run .\start.ps1" -ForegroundColor Green
