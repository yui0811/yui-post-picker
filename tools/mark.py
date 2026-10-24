#!/usr/bin/env python3
"""Mark a request issue as handled.

usage: mark.py <issue_number> <result>
  result = idea_saved:<buffer_idea_id> | deleted | error:<message>

Updates data/status.json (commit+push), comments on the issue in Japanese,
adds label `processed` (+ `error` on error) and closes the issue.
"""
import json, subprocess, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, STATUS_PATH, load_json, save_json, now_jst, git_sync, git_commit_push, run
from pending import parse


def gh(*args):
    return subprocess.run(["gh"] + list(args), check=True, capture_output=True, text=True).stdout


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    num, result = sys.argv[1], " ".join(sys.argv[2:])
    issue = json.loads(gh("issue", "view", num, "--repo", REPO, "--json", "number,body,title"))
    req = parse(issue)

    if result.startswith("idea_saved:"):
        idea_id = result.split(":", 1)[1].strip()
        kind, comment = "idea_saved", f"Bufferのアイデアに保存しました（ID: {idea_id}）"
    elif result == "deleted":
        idea_id, kind, comment = None, "deleted", "候補から削除しました"
    elif result.startswith("error:"):
        idea_id, kind = None, "error"
        comment = "処理できませんでした: " + result.split(":", 1)[1].strip()
    else:
        sys.exit("result must be idea_saved:<id> | deleted | error:<message>")

    if kind != "error" and "error" not in req:
        git_sync()
        status = load_json(STATUS_PATH, {})
        key = f"{req['run']}/{req['post']}"
        entry = dict(status.get(key) or {})
        entry["state"] = kind
        entry["updated_at"] = now_jst()
        entry["issue"] = int(num)
        if kind == "idea_saved":
            entry["buffer_idea_id"] = idea_id
            entry["image"] = req.get("image")
            entry["caption_pattern"] = req.get("caption_pattern")
        status[key] = entry
        save_json(STATUS_PATH, status)
        git_commit_push([STATUS_PATH], f"{key}: {kind} (#{num})")

    gh("issue", "comment", num, "--repo", REPO, "--body", comment)
    labels = "processed,error" if kind == "error" else "processed"
    gh("issue", "edit", num, "--repo", REPO, "--add-label", labels)
    gh("issue", "close", num, "--repo", REPO)
    print(json.dumps({"number": int(num), "result": kind, "comment": comment}, ensure_ascii=False))


if __name__ == "__main__":
    main()
