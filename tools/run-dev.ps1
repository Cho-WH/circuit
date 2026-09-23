param([int]$Port = 5173)
$ErrorActionPreference = 'Stop'
$repoDirectory = Split-Path -Parent $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeExecutable = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $nodeExecutable)) { throw 'Node.js 20.19 이상을 설치하고 npm ci를 실행하세요.' }
$viteEntry = Join-Path $repoDirectory 'node_modules\vite\bin\vite.js'
if (-not (Test-Path -LiteralPath $viteEntry)) { throw '프로젝트 폴더에서 npm ci를 먼저 실행하세요.' }
$env:PATH = (Split-Path -Parent $nodeExecutable) + [IO.Path]::PathSeparator + $env:PATH
Set-Location -LiteralPath $repoDirectory
& $nodeExecutable $viteEntry --host 127.0.0.1 --port $Port
