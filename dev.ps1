# ============================================================
# AdaptTutor 一键启停脚本（Windows PowerShell）
# 用法：
#   .\dev.ps1 start    —— 启动全部（postgres 容器 + 后端 API + 前端 dev）
#   .\dev.ps1 stop     —— 停止全部（前端 + 后端 + postgres 容器）
#   .\dev.ps1 status   —— 查看各服务状态
# 说明：
#   - 后端用 .venv 直接跑 uvicorn（比 compose 的 api 容器快，本地迭代推荐）
#   - 前端用 npm run dev；日志写入 ./logs/ 下
# ============================================================

param(
  [Parameter(Position = 0)]
  [ValidateSet("start", "stop", "status", "restart")]
  [string]$Action = "status"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path $Root "logs"
$FrontPid = Join-Path $LogDir "frontend.pid"
$BackPid = Join-Path $LogDir "backend.pid"
$VenvPy = Join-Path $Root ".venv\Scripts\python.exe"
$Compose = Join-Path $Root "docker-compose.local.yml"

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

# ---------- 工具函数 ----------
function Get-PortPid([int]$Port) {
  $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($c) { return ($c | Select-Object -First 1).OwningProcess }
  return $null
}

function Write-Step([string]$Msg) {
  Write-Host "==> $Msg" -ForegroundColor Cyan
}

function Write-Ok([string]$Msg) {
  Write-Host "    $Msg" -ForegroundColor Green
}

function Write-Warn2([string]$Msg) {
  Write-Host "    $Msg" -ForegroundColor Yellow
}

# ---------- 停止 ----------
function Stop-All {
  Write-Step "停止前端 (端口 3000)"
  $pid3000 = Get-PortPid 3000
  if ($pid3000) { Stop-Process -Id $pid3000 -Force -ErrorAction SilentlyContinue; Write-Ok "已结束进程 $pid3000" }
  else { Write-Warn2 "前端未运行" }
  if (Test-Path $FrontPid) {
    $fp = Get-Content $FrontPid -ErrorAction SilentlyContinue
    if ($fp -and (Get-Process -Id $fp -ErrorAction SilentlyContinue)) {
      Stop-Process -Id $fp -Force -ErrorAction SilentlyContinue; Write-Ok "已结束记录进程 $fp"
    }
    Remove-Item $FrontPid -Force -ErrorAction SilentlyContinue
  }

  Write-Step "停止后端 (端口 8010)"
  $pid8010 = Get-PortPid 8010
  if ($pid8010) { Stop-Process -Id $pid8010 -Force -ErrorAction SilentlyContinue; Write-Ok "已结束进程 $pid8010" }
  else { Write-Warn2 "后端未运行" }
  if (Test-Path $BackPid) {
    $bp = Get-Content $BackPid -ErrorAction SilentlyContinue
    if ($bp -and (Get-Process -Id $bp -ErrorAction SilentlyContinue)) {
      Stop-Process -Id $bp -Force -ErrorAction SilentlyContinue; Write-Ok "已结束记录进程 $bp"
    }
    Remove-Item $BackPid -Force -ErrorAction SilentlyContinue
  }

  Write-Step "停止 postgres 容器"
  $c = docker ps -a --format "{{.Names}}" | Select-String "^adapttutor-postgres$"
  if ($c) {
    $running = docker ps --format "{{.Names}}" | Select-String "^adapttutor-postgres$"
    if ($running) { docker stop adapttutor-postgres 2>&1 | Out-Null; Write-Ok "容器已停止" }
    else { Write-Warn2 "容器已处于停止状态" }
  } else { Write-Warn2 "未找到 adapttutor-postgres 容器" }
}

# ---------- 启动 ----------
function Start-All {
  Write-Step "启动 postgres 容器"
  $running = docker ps --format "{{.Names}}" | Select-String "^adapttutor-postgres$"
  if ($running) {
    Write-Ok "容器已在运行"
  } else {
    docker start adapttutor-postgres 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
      # 容器不存在则用 compose 拉起
      Write-Warn2 "容器不存在，尝试 docker compose 创建…"
      docker compose -f $Compose up -d postgres 2>&1 | Out-Null
    }
    # 等待健康
    $ok = $false
    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep -Seconds 1
      $h = docker inspect -f "{{.State.Health.Status}}" adapttutor-postgres 2>$null
      if ($h -eq "healthy") { $ok = $true; break }
    }
    if ($ok) { Write-Ok "容器已就绪 (healthy)" }
    else { Write-Warn2 "容器可能仍在启动（health 状态: $h），继续尝试后端…" }
  }

  Write-Step "启动后端 (uvicorn :8010)"
  $pid8010 = Get-PortPid 8010
  if ($pid8010) {
    Write-Warn2 "后端已在运行 (pid $pid8010)，跳过"
  } else {
    $p = Start-Process -FilePath $VenvPy -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8010", "--reload" -WorkingDirectory (Join-Path $Root "backend") -RedirectStandardOutput (Join-Path $LogDir "backend.log") -RedirectStandardError (Join-Path $LogDir "backend.err.log") -WindowStyle Hidden -PassThru
    $p.Id | Out-File $BackPid -Encoding ascii
    Start-Sleep -Seconds 4
    if (Get-PortPid 8010) { Write-Ok "后端已启动 (pid $($p.Id))，日志: logs\backend.log" }
    else { Write-Warn2 "后端可能还在启动中，查看 logs\backend.err.log" }
  }

  Write-Step "启动前端 (Next.js :3000)"
  $pid3000 = Get-PortPid 3000
  if ($pid3000) {
    Write-Warn2 "前端已在运行 (pid $pid3000)，跳过"
  } else {
    $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
    if (-not $npm) { $npm = "npm.cmd" }
    $p = Start-Process -FilePath $npm -ArgumentList "run", "dev" -WorkingDirectory (Join-Path $Root "frontend") -RedirectStandardOutput (Join-Path $LogDir "frontend.log") -RedirectStandardError (Join-Path $LogDir "frontend.err.log") -WindowStyle Hidden -PassThru
    $p.Id | Out-File $FrontPid -Encoding ascii
    Start-Sleep -Seconds 6
    if (Get-PortPid 3000) { Write-Ok "前端已启动 (pid $($p.Id))，日志: logs\frontend.log" }
    else { Write-Warn2 "前端可能还在启动中，查看 logs\frontend.err.log" }
  }

  Write-Step "全部就绪"
  Write-Host "  前端: http://localhost:3000" -ForegroundColor Green
  Write-Host "  后端: http://localhost:8010" -ForegroundColor Green
}

# ---------- 状态 ----------
function Show-Status {
  Write-Step "服务状态"
  $pid3000 = Get-PortPid 3000
  $pid8010 = Get-PortPid 8010
  $pg = docker ps --format "{{.Names}} {{.Status}}" | Select-String "^adapttutor-postgres"

  if ($pid3000) { Write-Ok "前端    : 运行中 (端口 3000, pid $pid3000)" }
  else { Write-Warn2 "前端    : 未运行" }
  if ($pid8010) { Write-Ok "后端    : 运行中 (端口 8010, pid $pid8010)" }
  else { Write-Warn2 "后端    : 未运行" }
  if ($pg) { Write-Ok "postgres: $($pg.Line -replace '^adapttutor-postgres\s*', '')" }
  else { Write-Warn2 "postgres: 未运行" }
}

# ---------- 主入口 ----------
switch ($Action) {
  "start"   { Start-All }
  "stop"    { Stop-All }
  "restart" { Stop-All; Start-Sleep -Seconds 2; Start-All }
  "status"  { Show-Status }
}
