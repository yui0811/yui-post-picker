#!/bin/sh
# Commit any pending data changes (status.json / results.json) and push once.
# Use after several `mark.py ... --no-push` calls.
set -e
cd "$(dirname "$0")/.."
python3 tools/bump_version.py >/dev/null
git add data index.html
if git diff --cached --quiet; then echo "nothing to push"; exit 0; fi
git commit -q -m "${1:-update status}"
for i in 1 2 3; do
  if git push -q origin HEAD:main; then echo "pushed"; exit 0; fi
  git pull --rebase -q origin main || true
done
echo "push failed" >&2; exit 1
