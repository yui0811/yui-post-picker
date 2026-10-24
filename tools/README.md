# tools

All scripts run from anywhere; they operate on the repo they live in
(`/workspace/yui-post-picker`). Requires `gh` (logged in as yui0811), `git`, Python 3 + Pillow.

## How requests arrive
- **Token mode (normal):** the user registers a fine-grained PAT (only yui-post-picker, Issues: Read and write)
  in the page's ⚙ 設定. It lives only in that browser's localStorage. Each OK / ポスト削除 click POSTs one issue
  via api.github.com (labels `ok`/`delete`; if labels are refused it retries without labels). Body = single request.
- **No token (fallback):** clicks go to a local queue; 「まとめて送信」 opens one prefilled new-issue page
  (label `batch`) with `{"action":"batch","requests":[...]}`. URLs are kept under 7000 chars; larger queues are
  split and sent in several rounds (≈5 long OK items per issue). Batch items omit `image_urls`
  (pending.py rebuilds them from the Pages base URL).
- Either way the card disappears at once and stays hidden until data/status.json shows the post processed
  (or `last_error` newer than the send → the card comes back with the error shown).

## pending.py
`python3 /workspace/yui-post-picker/tools/pending.py`  (does `git pull` first; `--no-sync` to skip)
Open issues by yui0811 without label `processed` (labels otherwise ignored; the ```json body is what counts).
Flat JSON array, one element per request item:
`{number, item, action: "ok"|"delete", run, post, images: [ordered, max 4], image_urls: [same order], caption_pattern, caption}`
- `item` = 0-based index in the issue (single/legacy issues → 0). Legacy `image`/`image_url` → 1-element lists.
- bad item → `{number, item, error}`; unreadable body → `{number, error}` (mark it with `error:...`, no --item).
- items already recorded in `data/results.json` are skipped. `[]` when nothing pending.

## mark.py
`python3 /workspace/yui-post-picker/tools/mark.py <number> <result> [--item K] [--no-push]`
- result: `idea_saved:<buffer_idea_id>` | `deleted` | `error:<message>`
- `--item K` required when the issue has more than one item.
- writes data/results.json[number][K] and data/status.json for that post
  (idea_saved → state, buffer_idea_id, images (ordered), caption_pattern; deleted → state; error → last_error).
- when all items of the issue have results it posts ONE Japanese summary comment (with image order for OK),
  adds `processed` (+ `error` if any item failed) and closes the issue — automatically.
- `mark.py <number> --flush` closes now even if items are missing (reported as 未処理).
- `--no-push`: only write files locally; finish the run with `sh /workspace/yui-post-picker/tools/push.sh`.
  (GitHub comment/close still happens immediately.)

## push.sh
`sh /workspace/yui-post-picker/tools/push.sh ["commit message"]` — bumps the asset version, commits data/ +
index.html if changed, pushes (retries with rebase). Prints `nothing to push` if clean.

## Cache busting
`tools/bump_version.py` sets `?v=<content hash of app.js+style.css>` in index.html. It runs automatically in
git_commit_push / push.sh and via the pre-commit hook (`sh tools/install_hooks.sh` once per clone).

## publish_run.py
`python3 /workspace/yui-post-picker/tools/publish_run.py <local_run_dir> <run_id> [--no-push]`
Example: `publish_run.py /workspace/run3 run3`

Expected input layout:
```
<local_run_dir>/
  manifest.json          (optional) list of {index, title, post_url, author, likes, reposts,
                         replies, impressions, quotes, bookmarks, posted_at,
                         captions:{simple, simple_long, emoji, emoji_long, question, question_long}}
  01/ 02/ ...            one folder per post (numeric name)
    base1.jpg base2.jpg base3.jpg cute1.jpg ... cute5.jpg   (.jpg/.jpeg/.png/.webp; extra images appended)
    caption.md
```
caption.md format (values here win over manifest.json):
```
**01｜タイトル**
元ポスト: [author](https://x.com/author/status/123)
エンゲージメント: いいね 212 / リポスト 30 / リプライ 11 / インプレッション 7503 / 投稿 2026-10-23T21:00:02.000Z

- シンプル: 一行
- シンプル長文: 本文（次の行に続いてもOK、空行か次の「- 」で終わり）
- 絵文字: ...
- 絵文字長文: ...
- 問いかけ: ...
- 問いかけ長文: ...
```
Pattern names may also be the English keys (simple, simple_long, ...).
Images are resized to max 1600px (JPEG q88) into `runs/<run_id>/NN/`, `data/runs/<run_id>.json`
is written, `data/runs/index.json` gets the run at the top, and new posts are added to
`data/status.json` as `pending` (existing statuses are kept). Then commit + push.
