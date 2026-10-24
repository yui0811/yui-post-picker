#!/usr/bin/env python3
"""Print unprocessed requests from GitHub issues as a flat JSON array.

Considers open issues authored by yui0811 without the `processed` label
(labels are NOT required: the JSON block in the body is what counts).
Body formats (fenced ```json block):
  single : {"action":"ok"|"delete", run, post, images[], image_urls[], caption_pattern, caption}
  legacy : {"action":"ok", ..., "image": "...", "image_url": "..."}  -> 1-element lists
  batch  : {"action":"batch", "requests":[ <single>, ... ]}
Each output item:
  {number, item, action, run, post, images[], image_urls[], caption_pattern, caption}
  item = 0-based index inside the issue (single issues are item 0)
or {number, item, error} for a bad item, or {number, error} for an unreadable body.
Items that already have a result in data/results.json (mark.py) are skipped.
Prints [] when nothing is pending.
"""
import json, re, subprocess, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, OWNER, PAGES_BASE, RESULTS_PATH, load_json, git_sync

FENCE = re.compile(r"```(?:json)?\s*\n(.*?)\n\s*```", re.S)


def norm_item(d, number, item):
    base = {"number": number, "item": item}
    if not isinstance(d, dict):
        return {**base, "error": "項目がオブジェクトではありません"}
    action = d.get("action")
    if action not in ("ok", "delete"):
        return {**base, "error": f"不明なaction: {action!r}"}
    run, post = str(d.get("run") or ""), str(d.get("post") or "")
    if not run or not post:
        return {**base, "error": "run/post がありません"}
    post = post.zfill(2)
    images, urls = d.get("images"), d.get("image_urls")
    if images is None and d.get("image"):  # legacy single-image format
        images = [d["image"]]
        urls = [d["image_url"]] if d.get("image_url") else None
    if isinstance(images, str):
        images = [images]
    if isinstance(urls, str):
        urls = [urls]
    images = [str(x) for x in (images or []) if x]
    urls = [str(x) for x in (urls or []) if x]
    if len(urls) != len(images):
        urls = [f"{PAGES_BASE}/runs/{run}/{post}/{n}" for n in images]
    out = {**base, "action": action, "run": run, "post": post, "images": images, "image_urls": urls,
           "caption_pattern": d.get("caption_pattern"), "caption": d.get("caption")}
    if action == "ok":
        if not images or not (out["caption"] or "").strip():
            return {**base, "error": "画像またはキャプションが未選択です"}
        if len(images) > 4:
            return {**base, "error": "画像は最大4枚までです"}
    return out


def parse_items(issue):
    """All items of an issue (list), or [{number, error}] if the body is unreadable."""
    number = issue["number"]
    body = issue.get("body") or ""
    m = FENCE.search(body)
    raw = m.group(1) if m else body.strip()
    try:
        d = json.loads(raw)
    except Exception as e:
        return [{"number": number, "error": f"JSONを読めません: {e}"}]
    if isinstance(d, dict) and d.get("action") == "batch":
        reqs = d.get("requests")
        if not isinstance(reqs, list) or not reqs:
            return [{"number": number, "error": "batchにrequestsがありません"}]
        return [norm_item(r, number, i) for i, r in enumerate(reqs)]
    return [norm_item(d, number, 0)]


def parse(issue):  # backward compat: first item
    return parse_items(issue)[0]


def fetch_open():
    r = subprocess.run(["gh", "issue", "list", "--repo", REPO, "--state", "open", "--limit", "200",
                        "--json", "number,title,body,labels,author,createdAt"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stderr)
        sys.exit(1)
    return json.loads(r.stdout or "[]")


def pending(issues, results):
    res = []
    for i in sorted(issues, key=lambda x: x["number"]):
        if (i.get("author") or {}).get("login") != OWNER:
            continue
        if any(l.get("name") == "processed" for l in i.get("labels") or []):
            continue
        done = results.get(str(i["number"]), {})
        for it in parse_items(i):
            if "item" in it and str(it["item"]) in done:
                continue
            res.append(it)
    return res


def main():
    if "--no-sync" not in sys.argv:
        git_sync()
    print(json.dumps(pending(fetch_open(), load_json(RESULTS_PATH, {})), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
