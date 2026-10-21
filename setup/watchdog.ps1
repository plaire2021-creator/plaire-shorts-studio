# 플레르 MS팀 업무 도구 지킴이 (화면 없이 돈다)
# - 서버를 켜 두고, 꺼지면 다시 켠다 (연달아 꺼지면 점점 길게 기다림)
# - 새 버전이 설치되면 서버가 하던 일을 끝낸 뒤 스스로 꺼지고(코드 75), 여기서 새 버전으로 다시 켠다
# - 기록: %USERPROFILE%\plaire-shorts\logs\ (서버 출력 server-날짜.log, 지킴이 watchdog-날짜.log)
# 한 PC에 하나만 돈다(이름 붙은 잠금).
$ErrorActionPreference = "Continue"
$created = $false
$lock = New-Object System.Threading.Mutex($true, "PlaireMsTeamStudioWatchdog", [ref]$created)
if (-not $created) { exit 0 }

$home2 = Join-Path $env:USERPROFILE "plaire-shorts"
$logs = Join-Path $home2 "logs"
New-Item -ItemType Directory -Force $logs | Out-Null
function Log($t) {
  $f = Join-Path $logs ("watchdog-" + (Get-Date -Format "yyyyMMdd") + ".log")
  Add-Content -Path $f -Value ("{0} {1}" -f (Get-Date -Format "HH:mm:ss"), $t) -Encoding UTF8
}
# 30일 지난 기록은 정리
Get-ChildItem $logs -Filter *.log -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -ErrorAction SilentlyContinue

$fails = 0
while ($true) {
  $root = $null
  try {
    $ip = Get-Content "$env:USERPROFILE\.claude\plugins\installed_plugins.json" -Raw -Encoding UTF8 | ConvertFrom-Json
    $root = ($ip.plugins.'plaire-shorts-studio@plaire-tools' | Select-Object -First 1).installPath
  } catch {}
  if (-not $root -or -not (Test-Path "$root\studio\server.js")) {
    Log "플러그인을 찾지 못했어요. 30초 뒤 다시 확인"
    Start-Sleep -Seconds 30
    continue
  }
  foreach ($d in "studio", "engine") {
    if (-not (Test-Path "$root\$d\node_modules")) {
      Log "$d 구성요소 설치 중 ($root)"
      & npm.cmd install --prefix "$root\$d" --no-audit --no-fund *> $null
    }
  }
  $out = Join-Path $logs ("server-" + (Get-Date -Format "yyyyMMdd") + ".log")
  Log "서버 시작: $root"
  $env:PLAIRE_WATCHDOG = "1"
  $started = Get-Date
  & cmd.exe /d /c "node `"$root\studio\server.js`" >> `"$out`" 2>&1"
  $code = $LASTEXITCODE
  Log "서버 꺼짐 (코드 $code)"
  if ($code -eq 75) { $fails = 0; continue }                 # 새 버전으로 갈아타기
  if (((Get-Date) - $started).TotalMinutes -ge 2) { $fails = 0 } else { $fails++ }
  $wait = [Math]::Min(60, 3 * [Math]::Pow(2, [Math]::Min($fails, 4)))
  Log "$wait 초 뒤 다시 켜요"
  Start-Sleep -Seconds $wait
}
