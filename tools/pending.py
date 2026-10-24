#!/usr/bin/env python3
"""Print unprocessed OK/delete requests from GitHub issues as a JSON array.

Only open issues authored by yui0811 and without the `processed` label.
Each item: {number, action, run, post, images[], image_urls[], caption_pattern, caption}
(images ordered, max 4; old single image/image_url bodies become 1-element lists)
or {number, error} when the body can't be parsed. Prints [] when none.
"""
import json, re, subprocess, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, OWNER, PAGES_BASE

FENCE = re.compile(r"```(?:json)?\s*\n(.*?)\n\s*```", re.S)


def parse(issue):
    body = issue.get("body") or ""
    m = FENCE.search(body)
    raw = m.group(1) if m else body.strip()
    try:
        d = json.loads(raw)
    except Exception as e:
        return {"number": issue["number"], "error": f"JSONを読めません: {e}"}
    if not isinstance(d, dict):
        return {"number": issue["number"], "error": "JSONがオブジェクトではありません"}
    action = d.get("action")
    if action not in ("ok", "delete"):
        return {"number": issue["number"], "error": f"不明なaction: {action!r}"}
    run, post = str(d.get("run") or ""), str(d.get("post") or "")
    if not run or not post:
        return {"number": issue["number"], "error": "run/post がありません"}
    images = d.get("images")
    urls = d.get("image_urls")
    if images is None and d.get("image"):  # old single-image format
        images = [d["image"]]
        urls = [d["image_url"]] if d.get("image_url") else None
    if isinstance(images, str):
        images = [images]
    if isinstance(urls, str):
        urls = [urls]
    images = [str(x) for x in (images or []) if x]
    urls = [str(x) for x in (urls or []) if x]
    if images and len(urls) != len(images):
        urls = [f"{PAGES_BASE}/runs/{run}/{post.zfill(2)}/{n}" for n in images]
    out = {"number": issue["number"], "action": action, "run": run, "post": post.zfill(2),
           "images": images, "image_urls": urls,
           "caption_pattern": d.get("caption_pattern"), "caption": d.get("caption")}
    if action == "ok":
        if not images or not out["caption"]:
            return {"number": issue["number"], "error": "画像またはキャプションが未選択です"}
        if len(images) > 4:
            return {"number": issue["number"], "error": "画像は最大4枚までです"}
    return out


def main():
    r = subprocess.run(["gh", "issue", "list", "--repo", REPO, "--state", "open", "--limit", "200",
                        "--json", "number,title,body,labels,author,createdAt"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stderr)
        sys.exit(1)
    issues = json.loads(r.stdout or "[]")
    res = []
    for i in sorted(issues, key=lambda x: x["number"]):
        if (i.get("author") or {}).get("login") != OWNER:
            continue
        if any(l.get("name") == "processed" for l in i.get("labels") or []):
            continue
        res.append(parse(i))
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
