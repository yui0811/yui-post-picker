(() => {
  const REPO = "yui0811/yui-post-picker";
  const BASE = "https://yui0811.github.io/yui-post-picker/";
  const STATE_LABEL = { pending: "未処理", idea_saved: "アイデア保存済み", deleted: "削除済み", sent: "依頼送信済み" };
  const $ = (s, el = document) => el.querySelector(s);
  const bust = () => "?t=" + Date.now();
  const SENT_KEY = "ypp_sent";
  let runs = [], status = {}, current = null, data = null;

  const sent = () => { try { return JSON.parse(localStorage.getItem(SENT_KEY) || "{}"); } catch { return {}; } };
  const setSent = (key, v) => { const s = sent(); if (v) s[key] = v; else delete s[key]; localStorage.setItem(SENT_KEY, JSON.stringify(s)); };

  async function getJSON(path) {
    const r = await fetch(path + bust(), { cache: "no-store" });
    if (!r.ok) throw new Error(path + " " + r.status);
    return r.json();
  }

  function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  const fmt = n => (n == null ? "-" : Number(n).toLocaleString("ja-JP"));

  function stateOf(key) {
    const st = (status[key] && status[key].state) || "pending";
    const s = sent()[key];
    if (st === "pending" && s && Date.now() - s.at < 6 * 3600e3) return "sent";
    if (st !== "pending" && s) setSent(key, null);
    return st;
  }

  function issueURL(labels, title, payload) {
    const body = "このまま『Submit new issue』を押してください。\n\n```json\n" + JSON.stringify(payload, null, 1) + "\n```\n";
    return `https://github.com/${REPO}/issues/new?labels=${encodeURIComponent(labels)}&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  }

  function render() {
    const main = $("#posts");
    const showDel = $("#showDeleted").checked, showDone = $("#showDone").checked;
    main.innerHTML = "";
    if (!data) return;
    const counts = { pending: 0, idea_saved: 0, deleted: 0, sent: 0 };
    let shown = 0;
    for (const p of data.posts) {
      const key = `${data.run}/${p.id}`;
      const st = stateOf(key);
      counts[st] = (counts[st] || 0) + 1;
      if (st === "deleted" && !showDel) continue;
      if (st === "idea_saved" && !showDone) continue;
      main.appendChild(card(p, key, st));
      shown++;
    }
    $("#summary").textContent = `全${data.posts.length}件：未処理 ${counts.pending} / 依頼送信済み ${counts.sent} / アイデア保存済み ${counts.idea_saved} / 削除済み ${counts.deleted}`;
    if (!shown) main.innerHTML = '<p class="empty">表示する投稿はありません（「保存済みも表示」「削除済みも表示」で切り替えできます）</p>';
  }

  function card(p, key, st) {
    const el = document.createElement("section");
    el.className = "card" + (st === "deleted" ? " deleted" : "");
    const m = p.metrics || {};
    const info = status[key] || {};
    el.innerHTML = `
      <h2><span>${esc(p.id)}｜${esc(p.title)}</span><span class="badge b-${st}">${STATE_LABEL[st]}</span></h2>
      <p class="meta">元ポスト: ${p.source_url ? `<a href="${esc(p.source_url)}" target="_blank" rel="noopener">${esc(p.author ? "@" + p.author : p.source_url)}</a>` : "-"}<br>
      いいね ${fmt(m.likes)} / リポスト ${fmt(m.reposts)} / リプライ ${fmt(m.replies)} / インプレッション ${fmt(m.impressions)}</p>
      ${st === "idea_saved" ? savedInfo(info, p) : ""}
      <div class="sec">① 画像をえらぶ（最大4枚・タップした順に1〜4・もう一度タップで解除・🔍で拡大）</div>
      <div class="grid"></div>
      <div class="selstrip"><div class="sec2">選んだ順番（←→で並べ替え・×で外す）</div><div class="strip"></div></div>
      <div class="sec">② キャプションをえらぶ</div>
      <div class="caps"></div>
      <div class="sec">③ 投稿する文章（自由に直せます）</div>
      <textarea placeholder="キャプションを選ぶとここに入ります"></textarea>
      <div class="count"></div>
      <div class="btns"><button type="button" class="ok" disabled>OK（Bufferのアイデアに保存）</button><button type="button" class="del">ポスト削除</button></div>`;
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
      const payload = { action: "ok", run: data.run, post: p.id, images: selImgs.map(i => i.name),
        image_urls: selImgs.map(i => BASE + i.path), caption_pattern: pattern, caption: ta.value };
      const title = `OK ${data.run}/${p.id} ${selImgs.map(i => i.name.replace(".jpg", "")).join(",")} ${pattern}`;
      window.open(issueURL("ok", title, payload), "_blank", "noopener");
      setSent(key, { action: "ok", at: Date.now() }); render();
    });
    $(".del", el).addEventListener("click", () => {
      if (!confirm(`「${p.id}｜${p.title}」を候補から削除しますか？`)) return;
      const payload = { action: "delete", run: data.run, post: p.id };
      window.open(issueURL("delete", `削除 ${data.run}/${p.id}`, payload), "_blank", "noopener");
      setSent(key, { action: "delete", at: Date.now() }); render();
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
    render();
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
  $("#showDeleted").addEventListener("change", render);
  $("#showDone").addEventListener("change", render);
  $("#reload").addEventListener("click", () => current && loadRun(current));
  document.addEventListener("visibilitychange", () => { if (!document.hidden && current) loadRun(current); });
  init();
})();
