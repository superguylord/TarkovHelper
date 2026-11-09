﻿# Выпуск новой версии: поднимает номер версии, собирает установщик и выкладывает его в GitHub Releases.
# У друга приложение само увидит обновление (проверка при запуске и каждые 3 часа).
#
# Пока идёт разработка, версии начинаются с 0 (0.1.1, 0.1.2, 0.2.0...). Версия 1.0.0 — первый релиз.
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1                  — 0.1.1 -> 0.1.2
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Bump minor      — 0.1.2 -> 0.2.0
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 1.0.0   — точный номер
#
# Номер должен только расти: приложение обновляется лишь на версию новее установленной.
# Нужно: GitHub CLI с выполненным входом (gh auth login).
param(
  [ValidateSet('patch', 'minor', 'major')] [string]$Bump = 'patch',
  [string]$Version = '',
  [string]$Notes = ''
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

$pkg = Get-Content package.json -Raw -Encoding UTF8 | ConvertFrom-Json
$publish = $pkg.build.publish | Select-Object -First 1
$repo = "$($publish.owner)/$($publish.repo)"

if ((git status --porcelain) -ne $null) { throw 'Есть незакоммиченные изменения — сначала закоммитьте их.' }

if ($Version) { npm version $Version --no-git-tag-version --allow-same-version | Out-Null }
else { npm version $Bump --no-git-tag-version | Out-Null }
$version = (Get-Content package.json -Raw -Encoding UTF8 | ConvertFrom-Json).version
Write-Host "Собираю TarkovHelper $version..."
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Ошибки типов — выпуск остановлен.' }
npm run installer
if ($LASTEXITCODE -ne 0) { throw 'Сборка установщика не удалась.' }

$setup = "dist\TarkovHelper-Setup-$version.exe"
foreach ($f in @($setup, "$setup.blockmap", 'dist\latest.yml')) { if (-not (Test-Path $f)) { throw "Нет файла $f" } }

git add package.json package-lock.json
git commit -m "Release $version" | Out-Null
git tag "v$version"
git push origin HEAD --tags

if (-not $Notes) { $Notes = "TarkovHelper $version" }
gh release create "v$version" $setup "$setup.blockmap" 'dist\latest.yml' --repo $repo --title "TarkovHelper $version" --notes $Notes
Write-Host "Готово: https://github.com/$repo/releases/tag/v$version"
