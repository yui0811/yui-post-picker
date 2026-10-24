#!/usr/bin/env python3
"""Set ?v=<hash> on app.js/style.css in index.html (content hash of both files).
Idempotent; prints the version. Run before committing (git_commit_push and the
pre-commit hook do this automatically)."""
import hashlib, os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
h = hashlib.sha1()
for f in ("app.js", "style.css"):
    h.update(open(os.path.join(ROOT, f), "rb").read())
v = h.hexdigest()[:8]
p = os.path.join(ROOT, "index.html")
s = open(p, encoding="utf-8").read()
n = re.sub(r'((?:app\.js|style\.css))\?v=[\w.-]*', rf'\1?v={v}', s)
if n != s:
    open(p, "w", encoding="utf-8").write(n)
print(v)
