# PostToolUse hook for Edit | Write | MultiEdit
# Prints a reminder when the Drizzle schema is modified.

$paths = $env:CLAUDE_FILE_PATHS
if ([string]::IsNullOrWhiteSpace($paths)) { exit 0 }

if ($paths -like '*src/server/db/schema.ts*' -or $paths -like '*src\server\db\schema.ts*') {
    Write-Host ""
    Write-Host "Schema changed. Run: npx drizzle-kit generate" -ForegroundColor Yellow
    Write-Host ""
}
exit 0
