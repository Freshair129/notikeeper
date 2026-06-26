# NotiKeeper Control Panel
# A small WinForms GUI that starts/stops the NotiKeeper MCP server,
# polls its live status, and gives one-click access to the dashboard.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ===== config =====
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ServerScript = Join-Path $ScriptDir 'server.mjs'
$DataFile = Join-Path $ScriptDir 'data.jsonl'
$Port = 8765
$NodeExe = 'C:\Users\freshair\AppData\Local\GoVibeToolchains\node-v24.16.0-win-x64\node.exe'
if (-not (Test-Path $NodeExe)) { $NodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source }

# Brand colors (match the app icon)
$colInk    = [System.Drawing.Color]::FromArgb(15, 27, 45)    # navy
$colInk2   = [System.Drawing.Color]::FromArgb(21, 36, 58)
$colSky    = [System.Drawing.Color]::FromArgb(94, 193, 255)
$colGold   = [System.Drawing.Color]::FromArgb(255, 200, 87)
$colPaper  = [System.Drawing.Color]::FromArgb(230, 238, 248)
$colMuted  = [System.Drawing.Color]::FromArgb(143, 164, 188)
$colGreen  = [System.Drawing.Color]::FromArgb(94, 230, 140)
$colRed    = [System.Drawing.Color]::FromArgb(255, 110, 110)

# ===== window =====
$form = New-Object System.Windows.Forms.Form
$form.Text = 'NotiKeeper Control'
$form.Size = New-Object System.Drawing.Size(520, 360)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false
$form.BackColor = $colInk
$form.ForeColor = $colPaper
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)

# Title bar
$title = New-Object System.Windows.Forms.Label
$title.Text = '  🔔  NotiKeeper'
$title.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 16, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = $colPaper
$title.AutoSize = $false
$title.Size = New-Object System.Drawing.Size(500, 36)
$title.Location = New-Object System.Drawing.Point(16, 12)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = '  MCP server + ingest + dashboard'
$subtitle.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$subtitle.ForeColor = $colMuted
$subtitle.Size = New-Object System.Drawing.Size(500, 18)
$subtitle.Location = New-Object System.Drawing.Point(16, 46)
$form.Controls.Add($subtitle)

# Status card
$statusBox = New-Object System.Windows.Forms.Panel
$statusBox.BackColor = $colInk2
$statusBox.Size = New-Object System.Drawing.Size(480, 100)
$statusBox.Location = New-Object System.Drawing.Point(16, 76)
$form.Controls.Add($statusBox)

$led = New-Object System.Windows.Forms.Label
$led.Text = '●'
$led.Font = New-Object System.Drawing.Font('Segoe UI', 22, [System.Drawing.FontStyle]::Bold)
$led.ForeColor = $colMuted
$led.AutoSize = $false
$led.Size = New-Object System.Drawing.Size(32, 36)
$led.Location = New-Object System.Drawing.Point(14, 14)
$statusBox.Controls.Add($led)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = 'Checking...'
$statusLabel.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 13, [System.Drawing.FontStyle]::Bold)
$statusLabel.ForeColor = $colPaper
$statusLabel.AutoSize = $false
$statusLabel.Size = New-Object System.Drawing.Size(380, 26)
$statusLabel.Location = New-Object System.Drawing.Point(52, 14)
$statusBox.Controls.Add($statusLabel)

$statusDetail = New-Object System.Windows.Forms.Label
$statusDetail.Text = ''
$statusDetail.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$statusDetail.ForeColor = $colMuted
$statusDetail.AutoSize = $false
$statusDetail.Size = New-Object System.Drawing.Size(420, 18)
$statusDetail.Location = New-Object System.Drawing.Point(52, 42)
$statusBox.Controls.Add($statusDetail)

$msgCount = New-Object System.Windows.Forms.Label
$msgCount.Text = '— messages'
$msgCount.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$msgCount.ForeColor = $colSky
$msgCount.AutoSize = $false
$msgCount.Size = New-Object System.Drawing.Size(420, 18)
$msgCount.Location = New-Object System.Drawing.Point(52, 64)
$statusBox.Controls.Add($msgCount)

# ===== buttons =====
function New-FlatButton {
    param([string]$Text, [int]$X, [int]$Y, [int]$W, [int]$H, $Bg, $Fg)
    $b = New-Object System.Windows.Forms.Button
    $b.Text = $Text
    $b.Size = New-Object System.Drawing.Size($W, $H)
    $b.Location = New-Object System.Drawing.Point($X, $Y)
    $b.FlatStyle = 'Flat'
    $b.FlatAppearance.BorderSize = 0
    $b.BackColor = $Bg
    $b.ForeColor = $Fg
    $b.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 10, [System.Drawing.FontStyle]::Bold)
    $b.Cursor = 'Hand'
    return $b
}

$btnStart    = New-FlatButton '▶ Start'        16 192 150 44 $colSky $colInk
$btnStop     = New-FlatButton '■ Stop'         16 192 150 44 $colRed $colPaper
$btnStop.Visible = $false

$btnDash     = New-FlatButton '🌐 Dashboard' 176 192 150 44 $colInk2 $colPaper
$btnFolder   = New-FlatButton '📂 Folder'   336 192 150 44 $colInk2 $colPaper
$btnRestart  = New-FlatButton '↻ Restart'   176 244 150 36 $colInk2 $colMuted
$btnAutostart= New-FlatButton '⚙ Auto-start'336 244 150 36 $colInk2 $colMuted

$form.Controls.AddRange(@($btnStart, $btnStop, $btnDash, $btnFolder, $btnRestart, $btnAutostart))

# Footer
$footer = New-Object System.Windows.Forms.Label
$footer.Text = "data: $DataFile"
$footer.Font = New-Object System.Drawing.Font('Consolas', 8)
$footer.ForeColor = $colMuted
$footer.AutoSize = $false
$footer.Size = New-Object System.Drawing.Size(480, 18)
$footer.Location = New-Object System.Drawing.Point(16, 292)
$form.Controls.Add($footer)

# ===== logic =====
function Get-ServerPid {
    $c = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    if ($c) { return ($c | Select-Object -First 1 -ExpandProperty OwningProcess) }
    return $null
}

function Test-ServerHttp {
    try {
        $r = Invoke-RestMethod -Uri "http://localhost:$Port/api/stats" -TimeoutSec 1
        return $r
    } catch { return $null }
}

function Update-Status {
    $procId = Get-ServerPid
    if ($procId) {
        $stats = Test-ServerHttp
        if ($stats) {
            $led.ForeColor = $colGreen
            $statusLabel.Text = "Running on port $Port"
            $statusLabel.ForeColor = $colGreen
            $statusDetail.Text = "PID $procId · http://localhost:$Port/"
            $topApp = '—'
            $props = $stats.byApp.PSObject.Properties
            if ($props -and ($props | Measure-Object).Count -gt 0) {
                $topApp = ($props | Select-Object -First 1).Name
            }
            $msgCount.Text = "{0:N0} messages · top: {1}" -f $stats.total, $topApp
            $btnStart.Visible = $false
            $btnStop.Visible = $true
            $btnDash.Enabled = $true
            $btnRestart.Enabled = $true
        } else {
            $led.ForeColor = $colGold
            $statusLabel.Text = "Starting…"
            $statusLabel.ForeColor = $colGold
            $statusDetail.Text = "PID $procId · waiting for HTTP"
            $msgCount.Text = ''
        }
    } else {
        $led.ForeColor = $colRed
        $statusLabel.Text = 'Stopped'
        $statusLabel.ForeColor = $colRed
        $statusDetail.Text = 'Server is not running'
        if (Test-Path $DataFile) {
            $lines = (Get-Content $DataFile | Measure-Object -Line).Lines
            $msgCount.Text = "{0:N0} messages stored (offline)" -f $lines
        } else { $msgCount.Text = 'No data file yet' }
        $btnStart.Visible = $true
        $btnStop.Visible = $false
        $btnDash.Enabled = $false
        $btnRestart.Enabled = $false
    }
}

function Start-Server {
    if (-not (Test-Path $NodeExe)) {
        $nl = [Environment]::NewLine
        [System.Windows.Forms.MessageBox]::Show(("Node.js not found" + $nl + $nl + "Install Node 20+ first"), 'NotiKeeper', 'OK', 'Error') | Out-Null
        return
    }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $NodeExe
    $psi.Arguments = "`"$ServerScript`""
    $psi.WorkingDirectory = $ScriptDir
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    [System.Diagnostics.Process]::Start($psi) | Out-Null
}

function Stop-Server {
    $procId = Get-ServerPid
    if ($procId) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
}

$btnStart.Add_Click({ Start-Server; Start-Sleep -Milliseconds 600; Update-Status })
$btnStop.Add_Click({ Stop-Server; Start-Sleep -Milliseconds 300; Update-Status })
$btnRestart.Add_Click({ Stop-Server; Start-Sleep -Milliseconds 600; Start-Server; Start-Sleep -Milliseconds 600; Update-Status })
$btnDash.Add_Click({ Start-Process "http://localhost:$Port/" })
$btnFolder.Add_Click({ Start-Process explorer.exe $ScriptDir })
$btnAutostart.Add_Click({
    $startup = [Environment]::GetFolderPath('Startup')
    $cmd = Join-Path $ScriptDir 'start-server.cmd'
    $lnk = Join-Path $startup 'NotiKeeper Server.lnk'
    if (Test-Path $lnk) {
        Remove-Item $lnk -Force
        [System.Windows.Forms.MessageBox]::Show('Auto-start disabled', 'NotiKeeper', 'OK', 'Information') | Out-Null
    } else {
        $sh = New-Object -ComObject WScript.Shell
        $s = $sh.CreateShortcut($lnk)
        $s.TargetPath = $cmd
        $s.WorkingDirectory = $ScriptDir
        $s.WindowStyle = 7  # minimized
        $s.Save()
        $nl = [Environment]::NewLine
        [System.Windows.Forms.MessageBox]::Show(("Auto-start enabled" + $nl + $nl + "Server will run on Windows startup"), 'NotiKeeper', 'OK', 'Information') | Out-Null
    }
})

# Poll status every 2s
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({ Update-Status })
$timer.Start()

Update-Status
[void]$form.ShowDialog()
$timer.Stop()
