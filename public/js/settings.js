/* global renderTopbar, getSession, icon, api, esc, roleLabel */
"use strict";

let currentUser = null;

(async function init() {
  await renderTopbar("settings");
  document.getElementById("eyebrow").innerHTML = icon("gear", 12) + " CONFIGURATION";
  document.getElementById("aiTitle").innerHTML = icon("shield", 13) + " AI接続ステータス";
  document.getElementById("brandTitle").innerHTML = icon("leaf", 13) + " ブランディング";
  document.getElementById("logoBtn").innerHTML = icon("upload", 15) + " ロゴをアップロード";
  document.getElementById("footNote").innerHTML =
    icon("info", 13) +
    "<span>APIキーはサーバー環境変数として安全に保持され、ブラウザには送信・保存されません。データは会社ごとに分離して管理されます。</span>";

  const sess = await getSession();
  currentUser = sess.user || {};

  const data = await api("/api/settings");
  document.getElementById("company").value = data.settings.company_name || "";
  document.getElementById("note").value = data.settings.report_note || "";
  renderLogo(data.settings.logo_data_url);
  renderAiStatus(data.ai_ready);

  document.getElementById("saveInfo").addEventListener("click", saveInfo);
  document.getElementById("logoBtn").addEventListener("click", () => document.getElementById("logoInput").click());
  document.getElementById("logoInput").addEventListener("change", uploadLogo);

  // owner/admin のみユーザー管理・監査ログを表示
  if (currentUser.role === "owner" || currentUser.role === "admin") {
    document.getElementById("usersSection").classList.remove("hidden");
    document.getElementById("auditSection").classList.remove("hidden");
    document.getElementById("usersTitle").innerHTML = icon("users", 13) + " ユーザー管理";
    document.getElementById("auditTitle").innerHTML = icon("list", 13) + " 監査ログ（直近100件）";
    document.getElementById("addUserBtn").innerHTML = icon("plus", 14) + " ユーザー追加";
    setupUserModal();
    await loadUsers();
    await loadAudit();
  }
})();

function renderAiStatus(ready) {
  document.getElementById("aiStatus").innerHTML = ready
    ? `<span class="status-pill ok">${icon("check", 13)} 接続済み · 診断を実行できます</span>`
    : `<div class="notice warn">${icon("warn", 16)}<span>AI APIキーが未設定です。システム管理者にお問い合わせください（サーバーの環境変数 <code>ANTHROPIC_API_KEY</code>）。</span></div>`;
}

function renderLogo(dataUrl) {
  const box = document.getElementById("logoPreview");
  box.innerHTML = dataUrl ? `<img src="${esc(dataUrl)}" alt="ロゴ" style="width:100%;height:100%;object-fit:contain">` : icon("leaf", 26);
}

async function saveInfo() {
  const msg = document.getElementById("infoMsg");
  try {
    await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        company_name: document.getElementById("company").value,
        report_note: document.getElementById("note").value,
      }),
    });
    msg.textContent = "保存しました";
    setTimeout(() => (msg.textContent = ""), 2000);
  } catch (e) {
    msg.textContent = e.message;
  }
}

async function uploadLogo() {
  const input = document.getElementById("logoInput");
  const msg = document.getElementById("logoMsg");
  if (!input.files.length) return;
  const file = input.files[0];
  if (file.size > 2 * 1024 * 1024) { msg.textContent = "画像サイズは2MB以下にしてください。"; return; }
  const fd = new FormData();
  fd.append("logo", file);
  msg.textContent = "アップロード中…";
  try {
    const res = await api("/api/settings/logo", { method: "POST", body: fd });
    renderLogo(res.logo_data_url);
    msg.textContent = "ロゴを更新しました。ページを再読み込みするとヘッダーにも反映されます。";
  } catch (e) {
    msg.textContent = e.message;
  }
}

/* ------------------------- ユーザー管理 ------------------------- */

async function loadUsers() {
  const data = await api("/api/users");
  const tb = document.getElementById("usersBody");
  tb.innerHTML = data.users
    .map((u) => {
      const isSelf = u.id === currentUser.id;
      const last = u.last_login_at ? new Date(u.last_login_at).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" }) : "—";
      const roleBadge = `<span class="badge">${esc(roleLabel(u.role))}</span>`;
      const statusBadge = u.active ? `<span class="badge">有効</span>` : `<span class="badge off">無効</span>`;
      let action = "";
      if (!isSelf && u.role !== "owner") {
        action = u.active
          ? `<button class="btn btn-sm btn-danger" data-deact="${u.id}">無効化</button>`
          : `<button class="btn btn-sm btn-ghost" data-act="${u.id}">有効化</button>`;
      } else if (isSelf) {
        action = `<span class="item-meta">あなた</span>`;
      }
      return `<tr>
        <td><span class="item-name">${esc(u.name || "—")}</span></td>
        <td class="item-meta">${esc(u.email)}</td>
        <td>${roleBadge}</td>
        <td>${statusBadge}</td>
        <td class="item-meta">${last}</td>
        <td><div class="row-actions">${action}</div></td>
      </tr>`;
    })
    .join("");
  tb.querySelectorAll("[data-deact]").forEach((b) => b.addEventListener("click", () => setActive(b.dataset.deact, false)));
  tb.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => setActive(b.dataset.act, true)));
}

async function setActive(id, active) {
  try {
    await api(`/api/users/${id}/active`, { method: "PUT", body: JSON.stringify({ active }) });
    await loadUsers();
    await loadAudit();
  } catch (e) {
    alert(e.message);
  }
}

function setupUserModal() {
  const modal = document.getElementById("userModal");
  document.getElementById("closeUserModal").innerHTML = icon("x", 16);
  document.getElementById("addUserBtn").addEventListener("click", () => {
    document.getElementById("nu_name").value = "";
    document.getElementById("nu_email").value = "";
    document.getElementById("nu_password").value = "";
    document.getElementById("nu_role").value = "member";
    document.getElementById("userModalMsg").textContent = "";
    modal.classList.add("show");
  });
  const close = () => modal.classList.remove("show");
  document.getElementById("closeUserModal").addEventListener("click", close);
  document.getElementById("cancelUserBtn").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target.id === "userModal") close(); });
  document.getElementById("saveUserBtn").addEventListener("click", saveUser);
}

async function saveUser() {
  const msg = document.getElementById("userModalMsg");
  msg.textContent = ""; msg.className = "auth-msg";
  const body = {
    name: document.getElementById("nu_name").value.trim(),
    email: document.getElementById("nu_email").value.trim(),
    password: document.getElementById("nu_password").value,
    role: document.getElementById("nu_role").value,
  };
  if (!body.email) { msg.textContent = "メールアドレスを入力してください。"; msg.classList.add("err"); return; }
  if (body.password.length < 8) { msg.textContent = "パスワードは8文字以上で設定してください。"; msg.classList.add("err"); return; }
  try {
    await api("/api/users", { method: "POST", body: JSON.stringify(body) });
    document.getElementById("userModal").classList.remove("show");
    await loadUsers();
    await loadAudit();
  } catch (e) {
    msg.textContent = e.message; msg.classList.add("err");
  }
}

/* ------------------------- 監査ログ ------------------------- */

const ACTION_LABELS = {
  "login": "ログイン", "login.fail": "ログイン失敗", "logout": "ログアウト",
  "org.signup": "会社登録", "product.create": "製品追加", "product.update": "製品更新",
  "product.delete": "製品削除", "settings.update": "設定変更", "settings.logo": "ロゴ更新",
  "user.create": "ユーザー追加", "user.update": "ユーザー変更", "analyze": "見積診断",
};

async function loadAudit() {
  const data = await api("/api/audit");
  const tb = document.getElementById("auditBody");
  if (!data.logs.length) {
    tb.innerHTML = `<tr><td colspan="4" class="item-meta" style="text-align:center; padding:20px">記録はまだありません。</td></tr>`;
    return;
  }
  tb.innerHTML = data.logs
    .map((l) => {
      const t = new Date(l.created_at).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" });
      const label = ACTION_LABELS[l.action] || l.action;
      return `<tr>
        <td class="item-meta" style="white-space:nowrap">${t}</td>
        <td><span class="badge">${esc(label)}</span></td>
        <td class="item-meta" style="max-width:280px; white-space:normal">${esc(l.detail || "")}</td>
        <td class="item-meta">${esc(l.user_email || "—")}</td>
      </tr>`;
    })
    .join("");
}
