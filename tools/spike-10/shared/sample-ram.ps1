# SPIKE-10 tieu chi M3 (RAM phang, khong ti le theo kich thuoc file) - xem
# docs/spikes/README.md#spike-10. Chay mot lenh (vi du r3-grammers.exe upload
# ...) va lay mau RSS (WorkingSet64) cua tien trinh do moi ~1s cho toi khi no
# thoat, in dinh RAM + bang thoi gian.
#
# Goi truc tiep (KHONG qua "npm run", PowerShell + CLAUDE.md deu canh bao
# npm nuot --flag):
#   powershell -File tools/spike-10/shared/sample-ram.ps1 `
#     -ExePath "tools/spike-10/target/debug/r3-grammers.exe" `
#     -ExeArgs @("upload","--session","r3.session","--channel","tsmc_mediacenter","--file","<path>")

param(
    [Parameter(Mandatory=$true)][string]$ExePath,
    [Parameter(Mandatory=$true)][string[]]$ExeArgs,
    [int]$IntervalMs = 1000
)

$proc = Start-Process -FilePath $ExePath -ArgumentList $ExeArgs -PassThru -NoNewWindow
Write-Host "Da khoi dong PID $($proc.Id) - lay mau RAM moi ${IntervalMs}ms..."

$samples = @()
$peakMb = 0
while (-not $proc.HasExited) {
    try {
        $p = Get-Process -Id $proc.Id -ErrorAction Stop
        $mb = [math]::Round($p.WorkingSet64 / 1MB, 1)
        $samples += [pscustomobject]@{ t = (Get-Date).ToString("HH:mm:ss"); mb = $mb }
        if ($mb -gt $peakMb) { $peakMb = $mb }
        Write-Host "  $($samples[-1].t)  RSS = $mb MB"
    } catch {
        break
    }
    Start-Sleep -Milliseconds $IntervalMs
}
$proc.WaitForExit()
$proc.Refresh()

Write-Host ""
Write-Host "=== Ket qua M3 ==="
Write-Host "So mau: $($samples.Count)"
Write-Host "Dinh RSS: $peakMb MB"
Write-Host "Exit code: $($proc.ExitCode)"
if ($peakMb -lt 500) {
    Write-Host "M3: DAT (dinh < 500 MB)"
} else {
    Write-Host "M3: CHUA DAT (dinh >= 500 MB)"
}
