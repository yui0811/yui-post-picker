#!/usr/bin/env python3
"""Record the result of one request item and close the issue when all items are done.

usage:
  mark.py <issue_number> <result> [--item K] [--no-push]
  mark.py <issue_number> --flush [--no-push]

  result = idea_saved:<buffer_idea_id> | deleted | error:<message>
  --item K   0-based item index from pending.py (optional for single-item issues)
  --no-push  write data/status.json + data/results.json locally only; run tools/push.sh later
  --flush    close the issue now with a summary even if some items have no result
             (those are reported as 未処理)

Per item: data/results.json[<number>][<K>] is written and data/status.json for that
run/post is updated (idea_saved -> state, buffer_idea_id, images (ordered), caption_pattern;
deleted -> state; error -> last_error, state unchanged).
When every item has a result: ONE summary comment in Japanese, label `processed`
(+ `error` if any item failed), and the issue is closed.
"""
import json, subprocess, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (REPO, STATUS_PATH, RESULTS_PATH, load_json, save_json, now_jst,
                    git_sync, git_commit_push)
from pending import parse_items


def gh(*args):
    return subprocess.run(["gh"] + list(args), check=True, capture_output=True, text=True).stdout


def describe(it, r):
    if "action" in it:
        head = f"{'OK' if it['action'] == 'ok' else '削除'} {it['run']}/{it['post']}"
    else:
        head = "（読み取れない依頼）"
    if r is None:
        return f"{head} → 未処理"
    if r["result"] == "idea_saved":
        s = f"{head} → Bufferのアイデアに保存しました（ID: {r.get('buffer_idea_id')}）"
        if it.get("images"):
            s += "\n   画像の順番: " + " → ".join(f"{i}. {n}" for i, n in enumerate(it["images"], 1))
        return s
    if r["result"] == "deleted":
        return f"{head} → 候補から削除しました"
    return f"{head} → 処理できませんでした: {r.get('message', '')}"


def main():
    argv = sys.argv[1:]
    push = "--no-push" not in argv
    flush = "--flush" in argv
    item = None
    if "--item" in argv:
        k = argv.index("--item")
        item = int(argv[k + 1])
        del argv[k:k + 2]
    pos = [a for a in argv if not a.startswith("--")]
    if not pos or (len(pos) < 2 and not flush):
        sys.exit(__doc__)
    num = str(int(pos[0]))
    result = " ".join(pos[1:]) if len(pos) > 1 else None

    issue = json.loads(gh("issue", "view", num, "--repo", REPO, "--json", "number,body,title,state"))
    items = parse_items(issue)
    if push:
        git_sync()
    results = load_json(RESULTS_PATH, {})
    done = results.setdefault(num, {})

    if result:
        if item is None:
            if len(items) > 1:
                sys.exit(f"issue #{num} has {len(items)} items; pass --item K")
            item = 0
        if not 0 <= item < len(items):
            sys.exit(f"--item {item} out of range (0..{len(items) - 1})")
        it = items[item]
        if result.startswith("idea_saved:"):
            rec = {"result": "idea_saved", "buffer_idea_id": result.split(":", 1)[1].strip()}
        elif result == "deleted":
            rec = {"result": "deleted"}
        elif result.startswith("error:"):
            rec = {"result": "error", "message": result.split(":", 1)[1].strip()}
        else:
            sys.exit("result must be idea_saved:<id> | deleted | error:<message>")
        rec["at"] = now_jst()
        if "action" in it:
            rec.update(run=it["run"], post=it["post"], action=it["action"])
        done[str(item)] = rec

        if "action" in it:
            status = load_json(STATUS_PATH, {})
            key = f"{it['run']}/{it['post']}"
            e = dict(status.get(key) or {"state": "pending"})
            e["updated_at"], e["issue"] = rec["at"], int(num)
            if rec["result"] == "error":
                e["last_error"] = rec["message"]
            else:
                e.pop("last_error", None)
                e["state"] = rec["result"]
                if rec["result"] == "idea_saved":
                    e["buffer_idea_id"] = rec["buffer_idea_id"]
                    e["images"] = it.get("images") or []
                    e["caption_pattern"] = it.get("caption_pattern")
                    e.pop("image", None)
            status[key] = e
            save_json(STATUS_PATH, status)
        save_json(RESULTS_PATH, results)
        if push:
            git_commit_push([STATUS_PATH, RESULTS_PATH], f"#{num} item {item}: {rec['result']}")

    complete = all(str(i) in done for i in range(len(items)))
    closed = False
    if (complete or flush) and issue.get("state") == "OPEN":
        lines = [describe(it, done.get(str(i))) for i, it in enumerate(items)]
        any_err = any((done.get(str(i)) or {}).get("result", "error") == "error" for i in range(len(items)))
        if len(items) == 1:
            body = lines[0].split(" → ", 1)[1] if " → " in lines[0] else lines[0]
        else:
            body = "処理結果:\n" + "\n".join(f"{i + 1}. {l}" for i, l in enumerate(lines))
        gh("issue", "comment", num, "--repo", REPO, "--body", body)
        gh("issue", "edit", num, "--repo", REPO, "--add-label", "processed,error" if any_err else "processed")
        gh("issue", "close", num, "--repo", REPO)
        closed = True
    print(json.dumps({"number": int(num), "item": item, "recorded": result is not None,
                      "items_done": len(done), "items_total": len(items), "closed": closed,
                      "pushed": push and result is not None}, ensure_ascii=False))


if __name__ == "__main__":
    main()
