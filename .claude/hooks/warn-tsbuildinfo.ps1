# Stop hook
# Warns if any tsbuildinfo file ended up modified in the working tree.
# These should be in .gitignore — see the workflow audit.

$diff = git diff --name-only HEAD 2>$null

if ($LASTEXITCODE -ne 0) { exit 0 }

if ($diff -match 'tsbuildinfo$') {
    Write-Host ""
    Write-Host "tsbuildinfo files were modified in this session. They should be in .gitignore — do NOT commit them." -ForegroundColor Yellow
    Write-Host ""
}
exit 0
