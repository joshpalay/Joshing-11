# PostToolUse hook for Edit | Write | MultiEdit
# Runs prettier on any edited .ts/.tsx/.js/.jsx/.json/.md files.
# CLAUDE_FILE_PATHS can contain multiple paths when MultiEdit fires.

$paths = $env:CLAUDE_FILE_PATHS
if ([string]::IsNullOrWhiteSpace($paths)) { exit 0 }

$paths -split '\s+' | Where-Object {
    $_ -and ($_ -match '\.(ts|tsx|js|jsx|json|md)$')
} | ForEach-Object {
    try {
        npx prettier --write "$_" 2>$null | Out-Null
    } catch {
        # Prettier not installed or file unreadable - silent, hook is best-effort
    }
}
exit 0
