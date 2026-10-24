# tools

All scripts run from anywhere; they operate on the repo they live in
(`/workspace/yui-post-picker`). Requires `gh` (logged in as yui0811), `git`, Python 3 + Pillow.

## pending.py
`python3 /workspace/yui-post-picker/tools/pending.py`
Prints a JSON array of open, unprocessed request issues authored by yui0811:
`{number, action: "ok"|"delete", run, post, image, image_url, caption_pattern, caption}`
or `{number, error}` if the body can't be parsed. Prints `[]` when nothing is pending.

## mark.py
`python3 /workspace/yui-post-picker/tools/mark.py <issue_number> <result>`
- `idea_saved:<buffer_idea_id>` → status.json state=idea_saved (+image, caption_pattern), comment「Bufferのアイデアに保存しました（ID: …）」
- `deleted` → state=deleted, comment「候補から削除しました」
- `error:<message>` → status.json untouched, comment「処理できませんでした: …」, label `error`
Always adds label `processed` and closes the issue. status.json changes are committed and pushed.

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
