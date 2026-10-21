# 플레르 MS팀 업무 도구 — 새 PC에 한 번에 설치 (설치 키트의 '설치하기.cmd'가 부른다)
# 하는 일: 필요한 프로그램(Python·Node.js·Git·Claude Code) → 업무 도구 플러그인 → 비밀 파일(키트) 복사 → 구성요소 설치·자동 시작 → 브라우저로 열기
# 사람이 할 일: 중간에 뜨는 '이 앱이 변경하도록 허용' 창에서 [예], 마지막에 업무 도구에서 Claude 로그인 한 번.
param([string]$Kit = $PSScriptRoot)
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$total = 6
function Step($n, $t) { Write-Host ""; Write-Host "[$n/$total] $t" -ForegroundColor Cyan }
function RefreshPath {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") + ";$env:USERPROFILE\.local\bin;$env:APPDATA\npm"
}
function Works($cmd, $arg) { try { & $cmd $arg *> $null; return $LASTEXITCODE -eq 0 } catch { return $false } }
function Need($id, $name, $cmd, $arg) {
  if (Works $cmd $arg) { Write-Host "  $name 있음"; return }
  Write-Host "  $name 설치 중... (허용 창이 뜨면 [예])"
  winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
  RefreshPath
  if (Works $cmd $arg) { Write-Host "  $name 설치 완료" } else { Write-Host "  [확인 필요] $name 설치가 끝나지 않았어요. 설치 후 이 파일을 다시 실행해 주세요." -ForegroundColor Yellow; Read-Host "엔터를 누르면 닫혀요"; exit 1 }
}

Write-Host "플레르 MS팀 업무 도구 설치를 시작해요. 10분쯤 걸려요." -ForegroundColor Green
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Host "[확인 필요] 이 PC에 winget(앱 설치 관리자)이 없어요. Microsoft Store에서 '앱 설치 관리자'를 설치한 뒤 다시 실행해 주세요." -ForegroundColor Yellow
  Read-Host "엔터를 누르면 닫혀요"; exit 1
}
RefreshPath

Step 1 "필요한 프로그램"
Need "Python.Python.3.12" "Python" "python" "--version"
Need "OpenJS.NodeJS.LTS" "Node.js" "node" "--version"
Need "Git.Git" "Git" "git" "--version"
if (-not (Works "claude" "--version")) {
  Write-Host "  Claude Code 설치 중..."
  Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression
  RefreshPath
}
if (Works "claude" "--version") { Write-Host "  Claude Code 있음" } else { Write-Host "  [확인 필요] Claude Code를 설치하지 못했어요. 인터넷 연결을 확인하고 다시 실행해 주세요." -ForegroundColor Yellow; Read-Host "엔터를 누르면 닫혀요"; exit 1 }

Step 2 "업무 도구 플러그인"
& claude plugin marketplace add plaire2021-creator/plaire-shorts-studio 2>&1 | Out-Null
& claude plugin marketplace update plaire-tools 2>&1 | Out-Null
& claude plugin install plaire-shorts-studio@plaire-tools 2>&1 | Out-Null
& claude plugin update plaire-shorts-studio@plaire-tools 2>&1 | Out-Null
$ip = Get-Content "$env:USERPROFILE\.claude\plugins\installed_plugins.json" -Raw -Encoding UTF8 -ErrorAction SilentlyContinue | ConvertFrom-Json
$root = ($ip.plugins.'plaire-shorts-studio@plaire-tools' | Select-Object -First 1).installPath
if (-not $root) { Write-Host "  [확인 필요] 플러그인을 설치하지 못했어요." -ForegroundColor Yellow; Read-Host "엔터를 누르면 닫혀요"; exit 1 }
Write-Host "  설치됨: $root"

Step 3 "회사 설정·연결 정보 복사 (키트)"
$sec = Join-Path $env:USERPROFILE ".secrets"
$home2 = Join-Path $env:USERPROFILE "plaire-shorts"
New-Item -ItemType Directory -Force $sec, $home2 | Out-Null
$copies = @(
  @("google-sheets-key.json", $sec, "구글 시트 키(주간 매출)"),
  @("ohouse_pw.txt", $sec, "오늘의집 파일 비밀번호(매출 통계)"),
  @("config.json", $home2, "유튜브·인스타·틱톡 앱 설정"),
  @("tokens.json", $home2, "유튜브·인스타·틱톡 연결")
)
foreach ($c in $copies) {
  $src = Join-Path $Kit "secrets\$($c[0])"
  $dst = Join-Path $c[1] $c[0]
  if (-not (Test-Path $src)) { Write-Host "  - $($c[2]): 키트에 없어서 건너뜀"; continue }
  if ((Test-Path $dst) -and $c[0] -eq "tokens.json") { Write-Host "  - $($c[2]): 이 PC에 이미 있어서 그대로 둠"; continue }
  Copy-Item $src $dst -Force
  Write-Host "  - $($c[2]) 복사"
}

Step 4 "구성요소 설치 + PC 켜면 자동 시작"
& powershell -NoProfile -ExecutionPolicy Bypass -File "$root\setup\setup.ps1" -NoPause

Step 5 "업무 도구 켜는 중"
$ok = $false
for ($i = 0; $i -lt 300; $i++) { try { if ((Invoke-WebRequest "http://127.0.0.1:4173/api/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { $ok = $true; break } } catch {}; Start-Sleep 1 }

Step 6 "마무리"
if ($ok) {
  Start-Process "http://localhost:4173"
  Write-Host ""
  Write-Host "설치 끝! 브라우저에 업무 도구가 열렸어요." -ForegroundColor Green
  Write-Host "왼쪽 위 Claude 카드의 [로그인]을 눌러 회사 Claude 계정으로 한 번만 로그인해 주세요."
  Write-Host "다음부터는 PC를 켜면 자동으로 켜져 있고, 바탕화면 '플레르 숏츠 스튜디오' 아이콘으로 열 수 있어요."
} else {
  Write-Host "[확인 필요] 업무 도구가 아직 안 켜졌어요. 1~2분 뒤 바탕화면 '플레르 숏츠 스튜디오' 아이콘을 눌러 보세요. 기록: $home2\logs" -ForegroundColor Yellow
}
Read-Host "엔터를 누르면 닫혀요"
