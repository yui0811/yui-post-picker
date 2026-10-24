(() => {
  const REPO = "yui0811/yui-post-picker";
  const BASE = "https://yui0811.github.io/yui-post-picker/";
  const MAX_URL = 7000;
  const STATE_LABEL = { pending: "未処理", idea_saved: "アイデア保存済み", deleted: "削除済み" };
  const $ = (s, el = document) => el.querySelector(s);
  const bust = () => "?t=" + Date.now();
  const Q_KEY = "ypp_queue";
  const TOKEN_KEY = "ypp_token";
  const API = `https://api.github.com/repos/${REPO}`;
  const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
  let runs = [], status = {}, current = null, data = null;

  // ---- local queue: { "run2/01": {state: "queued"|"sent", req, at, sent_at} }
  const loadQ = () => { try { return JSON.parse(localStorage.getItem(Q_KEY) || "{}"); } catch { return {}; } };
  const saveQ = q => localStorage.setItem(Q_KEY, JSON.stringify(q));
  function enqueue(key, req) { const q = loadQ(); q[key] = { state: "queued", req, at: Date.now() }; saveQ(q); }
  function unqueue(key) { const q = loadQ(); delete q[key]; saveQ(q); }

  // Clear "sent" entries once status.json shows a newer result for that post (or after 24h).
  function reconcile() {
    const q = loadQ(); let restored = 0, changed = false;
    for (const [key, e] of Object.entries(q)) {
      if (e.state !== "sent") continue;
      const st = status[key] || {};
      const upd = Date.parse(st.updated_at || "") || 0;
      const done = (st.state === "idea_saved" || st.state === "deleted") && upd >= e.sent_at - 300e3;
      const errored = st.last_error && upd >= e.sent_at - 300e3;
      if (done || errored || Date.now() - e.sent_at > 24 * 3600e3) { delete q[key]; changed = true; if (!done) restored++; }
    }
    if (changed) saveQ(q);
    if (restored) toast(`処理できなかった投稿が${restored}件あり、一覧に戻しました`);
  }

  async function getJSON(path) {
    const r = await fetch(path + bust(), { cache: "no-store" });
    if (!r.ok) throw new Error(path + " " + r.status);
    return r.json();
  }
  function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  const fmt = n => (n == null ? "-" : Number(n).toLocaleString("ja-JP"));
  const stateOf = key => (status[key] && status[key].state) || "pending";

  function jstStamp() {
    const f = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    return f.format(new Date()).replace("T", " ");
  }
  function batchURL(reqs) {
    const ok = reqs.filter(r => r.action === "ok").length, del = reqs.length - ok;
    const title = `BATCH OK${ok} DEL${del} ${jstStamp()}`;
    const body = "このまま『Submit new issue』を押してください。\n\n```json\n" + JSON.stringify({ action: "batch", requests: reqs }) + "\n```\n";
    return `https://github.com/${REPO}/issues/new?labels=batch&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  }
  // Greedy split so each new-issue URL stays under MAX_URL chars.
  function chunk(entries) {
    const out = []; let cur = [];
    for (const e of entries) {
      const next = cur.concat([e]);
      if (cur.length && batchURL(next.map(x => x[1].req)).length > MAX_URL) { out.push(cur); cur = [e]; }
      else cur = next;
    }
    if (cur.length) out.push(cur);
    return out;
  }

  function sendBatch() {
    const q = loadQ();
    const queued = Object.entries(q).filter(([, e]) => e.state === "queued").sort((a, b) => a[1].at - b[1].at);
    if (!queued.length) return;
    const parts = chunk(queued);
    const first = parts[0];
    window.open(batchURL(first.map(x => x[1].req)), "_blank", "noopener");
    const now = Date.now();
    for (const [key] of first) { q[key].state = "sent"; q[key].sent_at = now; }
    saveQ(q); renderBar(); renderPanel();
    if (parts.length > 1) {
      const rest = queued.length - first.length;
      alert(`件数が多いので分けて送ります（今回 ${first.length}件 / 残り ${rest}件）。\n開いたGitHubの画面で『Submit new issue』を押したあと、もう一度「まとめて送信」を押してください。`);
    }
  }

  function renderBar() {
    const q = Object.values(loadQ());
    const ok = q.filter(e => e.state === "queued" && e.req.action === "ok").length;
    const del = q.filter(e => e.state === "queued" && e.req.action === "delete").length;
    const sent = q.filter(e => e.state === "sent").length;
    const bar = $("#qbar");
    bar.hidden = !(ok + del + sent);
    $("#qcount").textContent = `送信待ち: OK ${ok}件 / 削除 ${del}件`;
    $("#qsent").textContent = sent ? `送信済み・処理待ち ${sent}件` : "";
    $("#qsend").disabled = !(ok + del);
    document.body.classList.toggle("has-bar", !bar.hidden);
  }

  function renderPanel() {
    const panel = $("#qpanel");
    if (panel.hidden) return;
    const list = $("#qlist");
    const entries = Object.entries(loadQ()).sort((a, b) => a[1].at - b[1].at);
    list.innerHTML = entries.length ? "" : '<p class="empty">送信待ちはありません</p>';
    for (const [key, e] of entries) {
      const r = e.req, row = document.createElement("div");
      row.className = "qitem";
      const title = (data && data.run === r.run && (data.posts.find(p => p.id === r.post) || {}).title) || "";
      const thumbs = (r.images || []).map((n, i) => `<span class="sv"><span class="snum">${i + 1}</span><img src="runs/${esc(r.run)}/${esc(r.post)}/${esc(n)}" alt=""></span>`).join("");
      row.innerHTML = `<div class="qhead"><span class="badge ${r.action === "ok" ? "b-idea_saved" : "b-deleted"}">${r.action === "ok" ? "OK" : "削除"}</span>
        <b>${esc(key)}</b> ${esc(title)} ${e.state === "sent" ? `<span class="badge b-sent">送信済み・処理待ち${e.issue ? " #" + e.issue : ""}</span>` : ""}</div>
        ${r.action === "ok" ? `<div class="savedimgs">${thumbs}</div><div class="qcap"><span class="pn">${esc(r.caption_pattern || "")}</span> ${esc(r.caption)}</div>` : ""}
        ${e.state === "queued" ? '<button type="button" class="undo">取り消し</button>' : ""}`;
      const u = $(".undo", row);
      if (u) u.addEventListener("click", () => { unqueue(key); render(); renderPanel(); });
      list.appendChild(row);
    }
  }

  // ---- direct submission via GitHub API (token only ever sent to api.github.com)
  async function apiCreateIssue(title, body, labels) {
    const token = getToken();
    const post = lbls => fetch(`${API}/issues`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      body: JSON.stringify(lbls ? { title, body, labels: lbls } : { title, body }),
    });
    let r = await post(labels);
    if (!r.ok && labels && (r.status === 403 || r.status === 422)) r = await post(null); // label permission issue → retry without labels
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${r.status} ${j.message || r.statusText}`);
    return j;
  }
  function singleIssue(req) {
    const full = Object.assign({}, req);
    if (req.action === "ok") {
      full.image_urls = req.images.map(n => `${BASE}runs/${req.run}/${req.post}/${n}`);
      return { title: `OK ${req.run}/${req.post} ${req.images.map(n => n.replace(".jpg", "")).join(",")} ${req.caption_pattern || ""}`.trim(),
        body: "picker から送信\n\n```json\n" + JSON.stringify(full, null, 1) + "\n```\n", labels: ["ok"] };
    }
    return { title: `削除 ${req.run}/${req.post}`, body: "picker から送信\n\n```json\n" + JSON.stringify(full, null, 1) + "\n```\n", labels: ["delete"] };
  }
  async function submit(key, req, btns) {
    if (!getToken()) { // fallback: local batch queue → one GitHub page for many
      enqueue(key, req);
      toast(`${req.post} を${req.action === "ok" ? "OK" : "削除"}の送信待ちに追加しました（トークン未設定のため、あとで「まとめて送信」）`);
      render(); renderPanel(); return;
    }
    btns.forEach(b => { b.disabled = true; });
    const orig = btns.map(b => b.textContent);
    btns[0].textContent = "送信中…";
    try {
      const { title, body, labels } = singleIssue(req);
      const j = await apiCreateIssue(title, body, labels);
      const q = loadQ(); q[key] = { state: "sent", req, at: Date.now(), sent_at: Date.now(), issue: j.number }; saveQ(q);
      toast(`送信しました（#${j.number}）`);
      render(); renderPanel();
    } catch (e) {
      btns.forEach((b, i) => { b.disabled = false; b.textContent = orig[i]; });
      alert("送信できませんでした: " + e.message + "\n（設定のトークンを確認してください）");
    }
  }

  // ---- settings panel
  function renderSettings() {
    const has = !!getToken();
    $("#tokState").textContent = has ? "登録済み（" + "•".repeat(8) + getToken().slice(-4) + "）" : "未登録（OK/削除は「まとめて送信」でGitHub画面を開く方式になります）";
    $("#tokDel").hidden = !has; $("#tokTest").hidden = !has;
    $("#gear").classList.toggle("on", has);
  }
  async function testToken() {
    const out = $("#tokTestRes"); out.textContent = "確認中…"; out.className = "testres";
    try {
      const r = await fetch(API, { headers: { "Authorization": `Bearer ${getToken()}`, "Accept": "application/vnd.github+json" } });
      if (r.ok) { out.textContent = "OK：接続できました"; out.className = "testres tres-ok"; }
      else { const j = await r.json().catch(() => ({})); out.textContent = `NG：${r.status} ${j.message || ""}`; out.className = "testres tres-ng"; }
    } catch (e) { out.textContent = "NG：" + e.message; out.className = "testres tres-ng"; }
  }

  function render() {
    const main = $("#posts");
    const showDone = $("#showDone").checked;
    main.innerHTML = "";
    renderBar();
    if (!data) return;
    const q = loadQ();
    const counts = { pending: 0, queued: 0, idea_saved: 0, deleted: 0 };
    let shown = 0;
    for (const p of data.posts) {
      const key = `${data.run}/${p.id}`;
      const st = stateOf(key);
      const processed = st === "idea_saved" || st === "deleted";
      if (q[key] && !processed) { counts.queued++; continue; }
      counts[st] = (counts[st] || 0) + 1;
      if (processed && !showDone) continue;
      main.appendChild(card(p, key, st, processed));
      shown++;
    }
    $("#summary").textContent = `全${data.posts.length}件：未処理 ${counts.pending} / 送信待ち・処理待ち ${counts.queued} / アイデア保存済み ${counts.idea_saved} / 削除済み ${counts.deleted}`;
    if (!shown) main.innerHTML = '<p class="empty">未処理の投稿はありません（「処理済みも表示」で保存済み・削除済みを見られます）</p>';
  }

  function card(p, key, st, readonly) {
    const el = document.createElement("section");
    el.className = "card" + (readonly ? " readonly" : "") + (st === "deleted" ? " deleted" : "");
    const m = p.metrics || {};
    const info = status[key] || {};
    el.innerHTML = `
      <h2><span>${esc(p.id)}｜${esc(p.title)}</span><span class="badge b-${st}">${STATE_LABEL[st]}</span></h2>
      <p class="meta">元ポスト: ${p.source_url ? `<a href="${esc(p.source_url)}" target="_blank" rel="noopener">${esc(p.author ? "@" + p.author : p.source_url)}</a>` : "-"}<br>
      いいね ${fmt(m.likes)} / リポスト ${fmt(m.reposts)} / リプライ ${fmt(m.replies)} / インプレッション ${fmt(m.impressions)}</p>
      ${st === "idea_saved" ? savedInfo(info, p) : ""}${info.last_error && st === "pending" ? `<p class="err-info">前回の処理でエラー: ${esc(info.last_error)}</p>` : ""}
      <div class="sec">① 画像をえらぶ（最大4枚・タップした順に1〜4・もう一度タップで解除・🔍で拡大）</div>
      <div class="grid"></div>
      <div class="selstrip"><div class="sec2">選んだ順番（←→で並べ替え・×で外す）</div><div class="strip"></div></div>
      <div class="sec">② キャプションをえらぶ</div>
      <div class="caps"></div>
      <div class="sec">③ 投稿する文章（自由に直せます）</div>
      <textarea placeholder="キャプションを選ぶとここに入ります"></textarea>
      <div class="count"></div>
      <div class="btns"><button type="button" class="ok" disabled>OK（Bufferのアイデアに保存）</button><button type="button" class="del">ポスト削除</button></div>`;
    if (readonly) { el.querySelectorAll(".sec, .grid, .selstrip, .caps, textarea, .count, .btns").forEach(x => x.remove()); return el; }
    let selImgs = [], selCap = null;
    const grid = $(".grid", el), caps = $(".caps", el), ta = $("textarea", el), ok = $(".ok", el), cnt = $(".count", el);
    const update = () => {
      ok.disabled = !ta.value.trim();
      cnt.textContent = ta.value.length + "文字";
    };
    for (const img of p.images) {
      const b = document.createElement("div");
      b.className = "thumb"; b.setAttribute("role", "button");
      b.innerHTML = `<img loading="lazy" src="${esc(img.path)}" alt="${esc(img.name)}"><span class="lbl">${esc(img.name.replace(".jpg", ""))}</span><button type="button" class="zoom">🔍</button>`;
      b.addEventListener("click", e => {
        if (e.target.classList.contains("zoom")) { e.stopPropagation(); openLB(img.path); return; }
        const i = selImgs.indexOf(img);
        if (i >= 0) selImgs.splice(i, 1);
        else if (selImgs.length >= 4) { toast("画像は最大4枚まで"); return; }
        else selImgs.push(img);
        renderSel();
      });
      b._img = img;
      grid.appendChild(b);
    }
    const strip = $(".strip", el);
    function renderSel() {
      grid.querySelectorAll(".thumb").forEach(t => {
        const n = selImgs.indexOf(t._img);
        t.classList.toggle("sel", n >= 0);
        let badge = $(".ord", t);
        if (n >= 0) {
          if (!badge) { badge = document.createElement("span"); badge.className = "ord"; t.appendChild(badge); }
          badge.textContent = n + 1;
        } else if (badge) badge.remove();
      });
      strip.innerHTML = selImgs.length ? "" : '<span class="hint">まだ選んでいません</span>';
      selImgs.forEach((img, n) => {
        const it = document.createElement("div");
        it.className = "sitem";
        it.innerHTML = `<span class="snum">${n + 1}</span><img src="${esc(img.path)}" alt=""><div class="sbtns"><button type="button" class="mv l" ${n === 0 ? "disabled" : ""} aria-label="前へ">←</button><button type="button" class="rm" aria-label="外す">×</button><button type="button" class="mv r" ${n === selImgs.length - 1 ? "disabled" : ""} aria-label="後ろへ">→</button></div>`;
        const swap = (a, b2) => { [selImgs[a], selImgs[b2]] = [selImgs[b2], selImgs[a]]; renderSel(); };
        $(".l", it).addEventListener("click", () => n > 0 && swap(n, n - 1));
        $(".r", it).addEventListener("click", () => n < selImgs.length - 1 && swap(n, n + 1));
        $(".rm", it).addEventListener("click", () => { selImgs.splice(n, 1); renderSel(); });
        strip.appendChild(it);
      });
      update();
    }
    renderSel();
    p.captions.forEach((c, i) => {
      const l = document.createElement("label");
      l.className = "cap";
      l.innerHTML = `<input type="radio" name="cap-${esc(key)}" value="${i}"><span><span class="pn">${esc(c.pattern)}</span><span class="tx">${esc(c.text)}</span></span>`;
      $("input", l).addEventListener("change", () => {
        caps.querySelectorAll(".cap").forEach(x => x.classList.remove("sel"));
        l.classList.add("sel"); selCap = c; ta.value = c.text; update();
      });
      caps.appendChild(l);
    });
    ta.addEventListener("input", update);
    update();
    ok.addEventListener("click", () => {
      if (!ta.value.trim()) return;
      if (!selImgs.length) { alert("画像を1枚以上えらんでください（最大4枚）"); return; }
      const pattern = selCap ? (ta.value === selCap.text ? selCap.pattern : selCap.pattern + "（編集）") : "自由入力";
      submit(key, { action: "ok", run: data.run, post: p.id, images: selImgs.map(i => i.name), caption_pattern: pattern, caption: ta.value }, [ok, $(".del", el)]);
    });
    $(".del", el).addEventListener("click", () => {
      if (!confirm(`「${p.id}｜${p.title}」を候補から削除しますか？`)) return;
      submit(key, { action: "delete", run: data.run, post: p.id }, [$(".del", el), ok]);
    });
    return el;
  }

  function savedInfo(info, p) {
    const imgs = info.images || (info.image ? [info.image] : []);
    const byName = Object.fromEntries((p.images || []).map(i => [i.name, i]));
    const thumbs = imgs.map((n, k) => byName[n] ? `<span class="sv"><span class="snum">${k + 1}</span><img src="${esc(byName[n].path)}" alt="${esc(n)}"></span>` : `<span class="sv">${k + 1}. ${esc(n)}</span>`).join("");
    return `<div class="done-info">保存済み${info.caption_pattern ? "（" + esc(info.caption_pattern) + "）" : ""}${info.buffer_idea_id ? " ID: " + esc(info.buffer_idea_id) : ""}${imgs.length ? `<div class="savedimgs">${thumbs}</div>` : (info.note ? "<br>" + esc(info.note) : "")}</div>`;
  }
  let toastT;
  function toast(msg) {
    let t = $("#toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 1800);
  }
  function openLB(src) { const lb = $("#lightbox"); $("img", lb).src = src; lb.hidden = false; }
  $("#lightbox").addEventListener("click", () => { $("#lightbox").hidden = true; });

  async function loadRun(id) {
    current = id;
    $("#posts").innerHTML = '<p class="loading">読み込み中…</p>';
    [data, status] = await Promise.all([getJSON(`data/runs/${id}.json`), getJSON("data/status.json").catch(() => ({}))]);
    reconcile();
    render(); renderPanel();
  }

  async function init() {
    try {
      const idx = await getJSON("data/runs/index.json");
      runs = idx.runs || [];
      const sel = $("#runSel");
      sel.innerHTML = runs.map(r => `<option value="${esc(r.id)}">${esc(r.id)}（${esc((r.created_at || "").slice(0, 10))}・${r.count}件）</option>`).join("");
      sel.addEventListener("change", () => loadRun(sel.value));
      if (runs.length) await loadRun(runs[0].id); else $("#posts").innerHTML = '<p class="empty">まだ投稿がありません</p>';
    } catch (e) {
      $("#posts").innerHTML = `<p class="empty">読み込みに失敗しました: ${esc(e.message)}</p>`;
    }
  }
  $("#showDone").addEventListener("change", render);
  $("#gear").addEventListener("click", () => { $("#settings").hidden = false; renderSettings(); });
  $("#setClose").addEventListener("click", () => { $("#settings").hidden = true; });
  $("#tokSave").addEventListener("click", () => {
    const v = $("#tokIn").value.trim();
    if (!v) return;
    localStorage.setItem(TOKEN_KEY, v); $("#tokIn").value = ""; renderSettings(); testToken();
  });
  $("#tokDel").addEventListener("click", () => { if (confirm("このブラウザからトークンを削除しますか？")) { localStorage.removeItem(TOKEN_KEY); $("#tokTestRes").textContent = ""; renderSettings(); } });
  $("#tokTest").addEventListener("click", testToken);
  renderSettings();
  $("#reload").addEventListener("click", () => current && loadRun(current));
  $("#qsend").addEventListener("click", sendBatch);
  $("#qshow").addEventListener("click", () => { const pn = $("#qpanel"); pn.hidden = !pn.hidden; renderPanel(); });
  $("#qclose").addEventListener("click", () => { $("#qpanel").hidden = true; });
  window.addEventListener("storage", () => { render(); renderPanel(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && current) loadRun(current); });
  init();
})();
