# 플레르 MS팀 업무 도구 열기 (바탕화면 아이콘이 부름)
# 지킴이(화면 없는 백그라운드)가 안 돌고 있으면 켜고, 서버가 뜨면 브라우저로 연다. 창을 닫아도 도구는 계속 켜져 있다.
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$home2 = Join-Path $env:USERPROFILE "plaire-shorts"
New-Item -ItemType Directory -Force $home2 | Out-Null

# 설치된 플러그인에서 최신 실행 파일을 가져온다(업데이트 반영)
try {
  $ip = Get-Content "$env:USERPROFILE\.claude\plugins\installed_plugins.json" -Raw -Encoding UTF8 | ConvertFrom-Json
  $root = ($ip.plugins.'plaire-shorts-studio@plaire-tools' | Select-Object -First 1).installPath
} catch { $root = $null }
if (-not $root) { Write-Host "플러그인 plaire-shorts-studio 가 설치되어 있지 않아요. README의 설치 방법을 먼저 진행해 주세요."; Read-Host "엔터를 누르면 닫혀요"; exit 1 }
foreach ($f in "watchdog.ps1", "start.ps1") { Copy-Item "$root\setup\$f" (Join-Path $home2 $f) -Force -ErrorAction SilentlyContinue }

function Up { try { (Invoke-WebRequest "http://127.0.0.1:4173/api/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $false } }
if (-not (Up)) {
  Start-Process powershell -WindowStyle Hidden -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$(Join-Path $home2 'watchdog.ps1')`"")
  Write-Host "업무 도구를 켜는 중이에요... (처음이거나 업데이트 직후면 1~2분 걸릴 수 있어요)"
  for ($i = 0; $i -lt 240 -and -not (Up); $i++) { Start-Sleep -Seconds 1 }
}
if (Up) { Start-Process "http://localhost:4173"; exit 0 }
Write-Host "업무 도구가 켜지지 않았어요. 기록 폴더: $home2\logs"
Read-Host "엔터를 누르면 닫혀요"
