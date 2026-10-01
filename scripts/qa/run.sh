#!/bin/bash
# Run a JS snippet (read from stdin) as account A, B or C, with lib.js helpers prepended:
#   bash scripts/qa/run.sh A < snippet.js
# or with a quoted heredoc.
cd "$(dirname "$0")" && { cat lib.js; cat; } | node qa.cjs "$1"
