# ============================================================================
# RadNas — package the source for upload (Windows PowerShell).
# Creates radnas-deploy.tgz WITHOUT node_modules / dist / .git / .env / backups.
# Then upload + extract on the server (commands printed at the end).
# ============================================================================

$root = 'C:\work\sityx_projects\radnas'
$out  = Join-Path $root 'radnas-deploy.tgz'

if (Test-Path $out) { Remove-Item $out -Force }

# Windows 10/11 ship bsdtar as `tar`. Exclude heavy / secret / generated paths.
tar --exclude='*/node_modules' --exclude='*/node_modules/*' `
    --exclude='*/dist' --exclude='*/dist/*' `
    --exclude='./.git' --exclude='./.git/*' `
    --exclude='*/.env' `
    --exclude='*/backups/*' `
    -czf $out -C $root .

$sizeMB = [math]::Round((Get-Item $out).Length / 1MB, 1)
Write-Host "Created $out ($sizeMB MB)"
Write-Host ""
Write-Host "Next — upload and extract on the server:" -ForegroundColor Cyan
Write-Host "  scp `"$out`" radnas@<SERVER_IP>:/home/radnas/"
Write-Host "  ssh radnas@<SERVER_IP>"
Write-Host "  mkdir -p ~/app && tar -xzf ~/radnas-deploy.tgz -C ~/app"
