#!/bin/sh
# Installs a pre-commit hook that bumps the asset version in index.html.
cd "$(dirname "$0")/.." || exit 1
cat > .git/hooks/pre-commit <<'H'
#!/bin/sh
python3 tools/bump_version.py >/dev/null && git add index.html
H
chmod +x .git/hooks/pre-commit
echo "pre-commit hook installed"
