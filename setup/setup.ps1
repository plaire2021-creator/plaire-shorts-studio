# 플레르 숏츠 스튜디오 PC 설치 (PC마다 한 번)
# 실행: powershell -ExecutionPolicy Bypass -File setup.ps1
param([switch]$NoPause)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
function Need($cmd, $hint) { if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Write-Host "[필요] $cmd 가 없어요: $hint"; $script:missing = $true } }
$missing = $false
Need "python" "https://www.python.org 에서 설치 (설치 화면에서 'Add python.exe to PATH' 체크)"
Need "node" "https://nodejs.org 에서 LTS 설치"
if ($missing) { if (-not $NoPause) { Read-Host "설치 후 다시 실행해 주세요. 엔터를 누르면 닫혀요" }; exit 1 }

Write-Host "1/5 파이썬 패키지 (numpy, Pillow)"
python -m pip install --quiet --upgrade numpy pillow openpyxl msoffcrypto-tool gspread google-auth

Write-Host "2/5 영상 엔진 구성요소 (1~2분)"
# 이미 깔려 있으면 건너뜀 (켜져 있는 업무 도구가 새 버전을 준비하며 같은 폴더에 설치 중일 수 있어서)
if (-not (Test-Path "$root\engine\node_modules")) { npm install --prefix "$root\engine" --no-audit --no-fund | Out-Null }
Write-Host "3/5 스튜디오 구성요소"
if (-not (Test-Path "$root\studio\node_modules")) { npm install --prefix "$root\studio" --no-audit --no-fund | Out-Null }

Write-Host "4/5 인스타 업로드용 임시 공개 주소 도구 (cloudflared)"
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue) -and -not (Test-Path "C:\Program Files (x86)\cloudflared\cloudflared.exe")) {
  winget install --id Cloudflare.cloudflared -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
}

Write-Host "5/5 실행 아이콘 + PC 켜면 자동 시작"
$home2 = Join-Path $env:USERPROFILE "plaire-shorts"
New-Item -ItemType Directory -Force $home2 | Out-Null
Copy-Item "$PSScriptRoot\start.ps1" "$home2\start.ps1" -Force
Copy-Item "$PSScriptRoot\watchdog.ps1" "$home2\watchdog.ps1" -Force
$cmd = "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"%USERPROFILE%\plaire-shorts\start.ps1`"`r`n"
$desktop = [Environment]::GetFolderPath("Desktop")
[System.IO.File]::WriteAllText((Join-Path $desktop "플레르 숏츠 스튜디오.cmd"), $cmd, [System.Text.Encoding]::Default)
# 로그인하면 지킴이를 화면 없이 켠다 (시작프로그램 폴더, 관리자 권한 필요 없음)
$vbs = "Set sh = CreateObject(""WScript.Shell"")`r`nsh.Run ""powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """""" & sh.ExpandEnvironmentStrings(""%USERPROFILE%"") & ""\plaire-shorts\watchdog.ps1"""""", 0, False`r`n"
$startup = [Environment]::GetFolderPath("Startup")
[System.IO.File]::WriteAllText((Join-Path $startup "플레르 MS팀 업무 도구.vbs"), $vbs, [System.Text.Encoding]::Unicode)
Start-Process powershell -WindowStyle Hidden -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$home2\watchdog.ps1`"")

Write-Host ""
Write-Host "설치 끝! 이제 PC를 켜면 업무 도구가 자동으로 켜져 있어요. 바탕화면의 '플레르 숏츠 스튜디오' 를 더블클릭하면 열려요."
Write-Host "처음 열면 왼쪽 연결 칸에서 Claude 연결하기를 눌러 회사 Claude 계정으로 로그인해 주세요."
if (-not $NoPause) { Read-Host "엔터를 누르면 닫혀요" }
