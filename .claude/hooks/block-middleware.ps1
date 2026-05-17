# PreToolUse hook for Write
# Blocks creation of src/middleware.ts.
# This repo uses src/proxy.ts for Next.js 16 middleware.
# Five prior reverts of this exact regression: c02a980, 95157a1, 8c8a6f7, b5d8e7d, 635abc6

$paths = $env:CLAUDE_FILE_PATHS
if ([string]::IsNullOrWhiteSpace($paths)) { exit 0 }

if ($paths -like '*src/middleware.ts*' -or $paths -like '*src\middleware.ts*') {
    Write-Host "BLOCKED: this repo uses src/proxy.ts, not middleware.ts."
    Write-Host "See commits c02a980, 95157a1, 8c8a6f7, b5d8e7d, 635abc6 for the 5 previous reverts of this exact change."
    exit 2
}
exit 0
