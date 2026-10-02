# Starts the JalSetu API (:8000) and web app (:5173) in separate windows and opens the browser.
$root = $PSScriptRoot
$py = "$root\backend\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) { Write-Host "Run .\setup.ps1 first." -ForegroundColor Red; exit 1 }

Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\backend'; & '$py' -m uvicorn app.main:app --port 8000 --reload"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\frontend'; npm run dev"
Start-Sleep -Seconds 6
Start-Process "http://localhost:5173/"
Write-Host "API docs: http://localhost:8000/docs   Citizen portal: http://localhost:5173/report" -ForegroundColor Green
