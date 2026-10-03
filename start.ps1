# Starts the JalSetu API (:8000) and web app (:5173) in separate windows and opens the browser.
#   .\start.ps1        production build (service worker: the citizen portal works offline; fastest on phones)
#   .\start.ps1 -Dev   Vite dev server with hot reload (offline portal is not reliable in this mode)
param([switch]$Dev)
$root = $PSScriptRoot
$py = "$root\backend\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) { Write-Host "Run .\setup.ps1 first." -ForegroundColor Red; exit 1 }

Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\backend'; & '$py' -m uvicorn app.main:app --port 8000 --reload"
if ($Dev) {
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\frontend'; npm run dev"
} else {
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\frontend'; npm run build; npx vite preview --port 5173"
}
Start-Sleep -Seconds 10
Start-Process "http://localhost:5173/"
Write-Host "API docs: http://localhost:8000/docs   Citizen portal: http://localhost:5173/report   Water schedule: /water" -ForegroundColor Green
