#!/usr/bin/env python3
"""Publish a local run folder to the picker site.

usage: publish_run.py <local_run_dir> <run_id> [--no-push]

See tools/README.md for the expected input format.
"""
import json, os, re, shutil, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ROOT, PAGES_BASE, STATUS_PATH, load_json, save_json, now_jst, git_sync, git_commit_push

from PIL import Image, ImageOps

IMAGE_ORDER = ["base1", "base2", "base3", "cute1", "cute2", "cute3", "cute4", "cute5"]
PATTERNS = ["シンプル", "シンプル長文", "絵文字", "絵文字長文", "問いかけ", "問いかけ長文"]
EN2JA = {"simple": "シンプル", "simple_long": "シンプル長文", "emoji": "絵文字",
         "emoji_long": "絵文字長文", "question": "問いかけ", "question_long": "問いかけ長文"}
ALIASES = {**EN2JA, **{p: p for p in PATTERNS},
           "シンプル（長文）": "シンプル長文", "絵文字（長文）": "絵文字長文", "問いかけ（長文）": "問いかけ長文",
           "シンプル(長文)": "シンプル長文", "絵文字(長文)": "絵文字長文", "問いかけ(長文)": "問いかけ長文"}
MAX_SIDE, QUALITY = 1600, 88


def norm_pattern(name):
    n = name.strip().strip("*").strip()
    return ALIASES.get(n) or ALIASES.get(n.lower()) or ALIASES.get(n.replace(" ", ""))


def num(s):
    try:
        return int(str(s).replace(",", ""))
    except Exception:
        return None


def parse_caption_md(path):
    """Returns dict with title, source_url, author, metrics, captions{pattern: text}."""
    out = {"captions": {}, "metrics": {}}
    if not os.path.exists(path):
        return out
    text = open(path, encoding="utf-8").read()
    m = re.search(r"^\*\*\s*\d*\s*[｜|:：]?\s*(.+?)\s*\*\*\s*$", text, re.M)
    if m:
        out["title"] = m.group(1).strip()
    m = re.search(r"元ポスト[:：]\s*(?:\[([^\]]*)\]\()?\s*(https?://[^\s)]+)", text)
    if m:
        out["author"], out["source_url"] = (m.group(1) or "").strip(), m.group(2)
    for key, label in (("likes", "いいね"), ("reposts", "リポスト"), ("replies", "リプライ"),
                       ("impressions", "インプレッション")):
        mm = re.search(label + r"\s*[:：]?\s*([\d,]+)", text)
        if mm:
            out["metrics"][key] = num(mm.group(1))
    mm = re.search(r"投稿\s*[:：]?\s*(\d{4}-\d\d-\d\d[T ][\d:.]+Z?)", text)
    if mm:
        out["posted_at"] = mm.group(1)
    # caption bullets: "- <pattern>: text" possibly continuing on following lines
    cur = None
    for line in text.splitlines():
        b = re.match(r"^\s*[-*・]\s*\**([^:：*]+?)\**\s*[:：]\s*(.*)$", line)
        p = norm_pattern(b.group(1)) if b else None
        if p:
            cur = p
            out["captions"][cur] = b.group(2).rstrip()
        elif cur and line.strip() and not line.startswith(("#", "**")) and not re.match(r"^\s*[-*]\s", line):
            out["captions"][cur] += "\n" + line.rstrip()
        elif not line.strip():
            cur = None
    for k in out["captions"]:
        out["captions"][k] = out["captions"][k].strip()
    return out


def load_manifest(run_dir):
    m = load_json(os.path.join(run_dir, "manifest.json"), [])
    if isinstance(m, dict):
        m = m.get("posts") or list(m.values())
    res = {}
    for i, e in enumerate(m, 1):
        if not isinstance(e, dict):
            continue
        idx = e.get("index") or e.get("id") or i
        res[str(idx).zfill(2)] = e
    return res


def resize(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        im.save(dst, "JPEG", quality=QUALITY, optimize=True, progressive=True)


def build(run_dir, run_id):
    run_dir = os.path.abspath(run_dir)
    manifest = load_manifest(run_dir)
    posts = []
    folders = sorted(d for d in os.listdir(run_dir)
                     if re.fullmatch(r"\d{1,3}", d) and os.path.isdir(os.path.join(run_dir, d)))
    for d in folders:
        pid = d.zfill(2)
        src_dir = os.path.join(run_dir, d)
        md = parse_caption_md(os.path.join(src_dir, "caption.md"))
        man = manifest.get(pid, {})
        caps = dict(md["captions"])
        for k, v in (man.get("captions") or {}).items():
            p = norm_pattern(k)
            if p and p not in caps and v:
                caps[p] = v.strip()
        metrics = {}
        for k in ("likes", "reposts", "replies", "impressions", "quotes", "bookmarks"):
            v = md["metrics"].get(k)
            if v is None:
                v = num(man.get(k))
            if v is not None:
                metrics[k] = v
        images = []
        for name in IMAGE_ORDER + sorted(
                os.path.splitext(f)[0] for f in os.listdir(src_dir)
                if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
                and os.path.splitext(f)[0] not in IMAGE_ORDER):
            src = next((os.path.join(src_dir, name + ext) for ext in (".jpg", ".jpeg", ".png", ".webp")
                        if os.path.exists(os.path.join(src_dir, name + ext))), None)
            if not src:
                continue
            rel = f"runs/{run_id}/{pid}/{name}.jpg"
            resize(src, os.path.join(ROOT, rel))
            images.append({"name": f"{name}.jpg", "kind": "base" if name.startswith("base") else
                           ("cute" if name.startswith("cute") else "other"),
                           "path": rel, "url": f"{PAGES_BASE}/{rel}"})
        if not images:
            print(f"skip {pid}: no images", file=sys.stderr)
            continue
        ordered = [p for p in PATTERNS if p in caps] + [p for p in caps if p not in PATTERNS]
        posts.append({
            "id": pid,
            "title": md.get("title") or man.get("title") or f"#{pid}",
            "source_url": md.get("source_url") or man.get("post_url") or man.get("source_url"),
            "author": md.get("author") or man.get("author"),
            "posted_at": md.get("posted_at") or man.get("posted_at"),
            "metrics": metrics,
            "images": images,
            "captions": [{"pattern": p, "text": caps[p]} for p in ordered],
        })
    data = {"run": run_id, "created_at": now_jst(), "posts": posts}
    save_json(os.path.join(ROOT, "data", "runs", f"{run_id}.json"), data)

    idx_path = os.path.join(ROOT, "data", "runs", "index.json")
    idx = load_json(idx_path, {"runs": []})
    idx["runs"] = [r for r in idx["runs"] if r.get("id") != run_id]
    idx["runs"].insert(0, {"id": run_id, "created_at": data["created_at"], "count": len(posts)})
    save_json(idx_path, idx)

    status = load_json(STATUS_PATH, {})
    for p in posts:
        status.setdefault(f"{run_id}/{p['id']}", {"state": "pending", "updated_at": data["created_at"]})
    save_json(STATUS_PATH, status)
    return posts


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 2:
        sys.exit(__doc__)
    push = "--no-push" not in sys.argv
    if push:
        git_sync()
    posts = build(args[0], args[1])
    print(f"published {len(posts)} posts as {args[1]}")
    for p in posts:
        print(f"  {p['id']} {p['title']} imgs={len(p['images'])} caps={len(p['captions'])}")
    if push:
        git_commit_push(["runs/" + args[1], "data"], f"publish {args[1]} ({len(posts)} posts)")
        print("pushed")


if __name__ == "__main__":
    main()
