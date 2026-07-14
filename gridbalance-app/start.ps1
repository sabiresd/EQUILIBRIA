# =============================================================================
# GridBalance AI Morocco — lancement local (Windows / PowerShell)
#
#   .\start.ps1              demarre le backend et le frontend
#   .\start.ps1 -Install     installe d'abord les dependances
#
# Aucun Docker, aucun MongoDB, aucun serveur SMTP requis :
#   - base de donnees en memoire  (MONGO_URL=memory)
#   - e-mails ecrits en fichiers  (MAIL_MODE=file  ->  backend\outbox\*.html)
#   - les 4 agents sont simules   (WF_MODE=stub)
# =============================================================================
param([switch]$Install)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

if (-not (Test-Path "$root\.env")) {
    Copy-Item "$root\.env.example" "$root\.env"
    Write-Host "Fichier .env cree depuis .env.example." -ForegroundColor Green
}

if ($Install) {
    Write-Host "`nInstallation des dependances Python..." -ForegroundColor Cyan
    python -m pip install -r "$root\backend\requirements.txt"

    Write-Host "`nInstallation des dependances Node..." -ForegroundColor Cyan
    Push-Location "$root\frontend"; npm install; Pop-Location
}

if (-not (Test-Path "$root\frontend\.env.local")) {
    "NEXT_PUBLIC_API_URL=http://localhost:8000" |
        Out-File -FilePath "$root\frontend\.env.local" -Encoding utf8
}

# Le backend importe contracts/, qui vit a la racine du monorepo : il doit donc
# etre dans le PYTHONPATH, en plus du dossier backend lui-meme.
$env:PYTHONPATH = "$root;$root\backend"

Write-Host "`nDemarrage du backend (http://localhost:8000)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$root\backend'; `$env:PYTHONPATH='$root;$root\backend'; python -m uvicorn app.main:app --reload --port 8000"
)

Start-Sleep -Seconds 3

Write-Host "Demarrage du frontend (http://localhost:3000)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command", "cd '$root\frontend'; npm run dev"
)

Write-Host @"

  Application  : http://localhost:3000
  API (docs)   : http://localhost:8000/docs
  E-mails      : backend\outbox\*.html  (ouvrir dans un navigateur)

  Comptes de demo — mot de passe : demo1234
    operator@demo.ma     lance les simulations, propose un plan
    supervisor@demo.ma   valide les plans, acquitte les alertes
    admin@demo.ma        utilisateurs, configuration, journal

  ATTENTION : la base est EN MEMOIRE. Les runs, decisions et le journal d'audit
  disparaissent a l'arret du backend. Renseignez MONGO_URL dans .env pour
  conserver les donnees.

"@ -ForegroundColor Green
