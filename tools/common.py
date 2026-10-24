"""Shared helpers for yui-post-picker tools."""
import json, os, subprocess, datetime

REPO = "yui0811/yui-post-picker"
OWNER = "yui0811"
PAGES_BASE = "https://yui0811.github.io/yui-post-picker"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATUS_PATH = os.path.join(ROOT, "data", "status.json")
RESULTS_PATH = os.path.join(ROOT, "data", "results.json")  # per issue/item results
JST = datetime.timezone(datetime.timedelta(hours=9))


def now_jst():
    return datetime.datetime.now(JST).isoformat(timespec="seconds")


def load_json(path, default):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.write("\n")


def run(cmd, check=True, **kw):
    return subprocess.run(cmd, cwd=ROOT, check=check, text=True, capture_output=True, **kw)


def git_sync():
    """Pull latest main (rebase) so pushes don't conflict."""
    run(["git", "pull", "--rebase", "--autostash", "-q", "origin", "main"], check=False)


def git_commit_push(paths, message):
    run(["python3", os.path.join(ROOT, "tools", "bump_version.py")])
    run(["git", "add", "--"] + list(paths) + [os.path.join(ROOT, "index.html")])
    r = run(["git", "diff", "--cached", "--quiet"], check=False)
    if r.returncode == 0:
        return False  # nothing to commit
    run(["git", "commit", "-q", "-m", message])
    for _ in range(3):
        p = run(["git", "push", "-q", "origin", "HEAD:main"], check=False)
        if p.returncode == 0:
            return True
        run(["git", "pull", "--rebase", "-q", "origin", "main"], check=False)
    raise SystemExit("git push failed: " + p.stderr)
