(function () {
  "use strict";

  const META_KEY = "infinite-protocol-cloud-meta-v1";
  const SDK_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
  const SYNC_DELAY = 1200;

  let bridge = null;
  let client = null;
  let session = null;
  let ready = false;
  let syncing = false;
  let reconciling = false;
  let pending = false;
  let syncTimer = null;
  let conflict = null;
  let lastError = "";
  let meta = loadMeta();

  function createDeviceId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    return `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function loadMeta() {
    try {
      const stored = JSON.parse(localStorage.getItem(META_KEY) || "null");
      if (stored && typeof stored === "object") {
        return {
          deviceId: typeof stored.deviceId === "string" ? stored.deviceId : createDeviceId(),
          userId: typeof stored.userId === "string" ? stored.userId : null,
          revision: Number.isFinite(stored.revision) ? stored.revision : 0,
          lastSyncedLocalAt: typeof stored.lastSyncedLocalAt === "string" ? stored.lastSyncedLocalAt : null,
          lastCloudUpdatedAt: typeof stored.lastCloudUpdatedAt === "string" ? stored.lastCloudUpdatedAt : null,
        };
      }
    } catch (error) {
      // A damaged cloud marker must never block the local save.
    }
    return { deviceId: createDeviceId(), userId: null, revision: 0, lastSyncedLocalAt: null, lastCloudUpdatedAt: null };
  }

  function saveMeta() {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  }

  function configured() {
    const config = window.IP_CLOUD_CONFIG || {};
    return /^https:\/\/.+\.supabase\.co$/i.test(String(config.url || ""))
      && String(config.publishableKey || "").length > 30;
  }

  function publicState() {
    return {
      configured: configured(),
      ready,
      signedIn: Boolean(session && session.user),
      email: session && session.user ? (session.user.email || "已登录玩家") : "",
      syncing,
      conflict: Boolean(conflict),
      lastError,
      lastSyncedAt: meta.lastSyncedLocalAt,
    };
  }

  function emitState(message) {
    if (bridge && bridge.setCloudState) bridge.setCloudState(publicState(), message);
    const panel = document.querySelector("#cloud-account-panel");
    if (panel) renderManager(panel);
  }

  async function init(saveBridge) {
    bridge = saveBridge;
    emitState();
    if (!configured()) return;

    try {
      const { createClient } = await import(SDK_URL);
      const config = window.IP_CLOUD_CONFIG;
      client = createClient(config.url, config.publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      const result = await client.auth.getSession();
      if (result.error) throw result.error;
      session = result.data.session;
      ready = true;
      client.auth.onAuthStateChange((event, nextSession) => {
        session = nextSession;
        window.setTimeout(() => handleSession(event), 0);
      });
      await handleSession("INITIAL_SESSION");
    } catch (error) {
      ready = false;
      lastError = "云端暂时不可用，本机存档不受影响";
      emitState(lastError);
    }
  }

  async function handleSession(event) {
    if (reconciling) return;
    conflict = null;
    lastError = "";
    if (!session || !session.user) {
      emitState();
      return;
    }
    reconciling = true;
    try {
      await reconcile();
    } finally {
      reconciling = false;
    }
  }

  async function fetchCloudRow() {
    const result = await client
      .from("player_saves")
      .select("save_data, revision, updated_at, device_id")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  }

  function localChangedSinceSync(localSave) {
    if (!meta.lastSyncedLocalAt) return true;
    const localTime = Date.parse(localSave.lastSavedAt || "") || 0;
    const syncedTime = Date.parse(meta.lastSyncedLocalAt || "") || 0;
    return localTime > syncedTime;
  }

  async function reconcile() {
    try {
      syncing = true;
      emitState("正在检查云端存档");
      const row = await fetchCloudRow();
      const localSave = bridge.getSave();

      if (!row) {
        meta.userId = session.user.id;
        meta.revision = 0;
        await upload(localSave, true);
        return;
      }

      const knownAccount = meta.userId === session.user.id;
      const cloudAdvanced = knownAccount && row.revision > meta.revision;
      const localChanged = localChangedSinceSync(localSave);

      if (!knownAccount || (cloudAdvanced && localChanged)) {
        conflict = { row, localSave };
        syncing = false;
        emitState("请选择保留本机还是云端进度");
        return;
      }

      meta.userId = session.user.id;
      meta.revision = row.revision;
      meta.lastCloudUpdatedAt = row.updated_at;
      saveMeta();
      if (cloudAdvanced) {
        await applyCloud(row);
      } else if (localChanged) {
        await upload(localSave, false);
      } else {
        syncing = false;
        emitState("云端已同步");
      }
    } catch (error) {
      syncing = false;
      lastError = friendlyError(error, "读取云存档失败，本机进度仍会保存");
      emitState(lastError);
    }
  }

  async function upload(saveData, insert) {
    if (!session || !client) return;
    syncing = true;
    emitState("正在同步云端");
    try {
      let query;
      if (insert) {
        query = client.from("player_saves").insert({
          user_id: session.user.id,
          save_data: saveData,
          device_id: meta.deviceId,
        });
      } else {
        query = client.from("player_saves").update({
          save_data: saveData,
          device_id: meta.deviceId,
        }).eq("user_id", session.user.id).eq("revision", meta.revision);
      }
      const result = await query.select("revision, updated_at").maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) {
        const latest = await fetchCloudRow();
        conflict = { row: latest, localSave: saveData };
        syncing = false;
        emitState("检测到其他设备的新进度");
        return;
      }
      meta.userId = session.user.id;
      meta.revision = result.data.revision;
      meta.lastSyncedLocalAt = saveData.lastSavedAt || new Date().toISOString();
      meta.lastCloudUpdatedAt = result.data.updated_at;
      saveMeta();
      syncing = false;
      lastError = "";
      emitState("云端已同步");
    } catch (error) {
      syncing = false;
      lastError = friendlyError(error, "同步失败，联网后可以重试");
      emitState(lastError);
    }
  }

  async function applyCloud(row) {
    if (!row || !row.save_data) return;
    meta.userId = session.user.id;
    meta.revision = row.revision;
    meta.lastSyncedLocalAt = row.save_data.lastSavedAt || row.updated_at;
    meta.lastCloudUpdatedAt = row.updated_at;
    saveMeta();
    syncing = false;
    conflict = null;
    bridge.replaceSave(row.save_data, "已载入云端进度");
  }

  function queueSync() {
    if (!ready || !session || !session.user || conflict) return;
    pending = true;
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(async function flushPendingSave() {
      if (syncing) {
        syncTimer = window.setTimeout(flushPendingSave, SYNC_DELAY);
        return;
      }
      if (!pending) return;
      pending = false;
      await upload(bridge.getSave(), meta.revision === 0);
    }, SYNC_DELAY);
  }

  async function syncNow() {
    window.clearTimeout(syncTimer);
    pending = false;
    if (!session || !session.user) return;
    if (conflict) {
      emitState("请先选择需要保留的进度");
      return;
    }
    await upload(bridge.getSave(), meta.revision === 0);
  }

  async function requestOtp(email) {
    if (!client) throw new Error("云端服务尚未就绪");
    const normalized = String(email || "").trim();
    if (!/^\S+@\S+\.\S+$/.test(normalized)) throw new Error("请输入有效邮箱地址");
    const redirect = `${location.origin}${location.pathname}`;
    const result = await client.auth.signInWithOtp({ email: normalized, options: { emailRedirectTo: redirect } });
    if (result.error) throw result.error;
    return true;
  }

  async function signOut() {
    if (!client) return;
    const result = await client.auth.signOut();
    if (result.error) throw result.error;
    session = null;
    conflict = null;
    emitState("已退出账号，本机存档仍然保留");
  }

  async function resolveConflict(choice) {
    if (!conflict) return;
    const current = conflict;
    conflict = null;
    if (choice === "cloud") {
      await applyCloud(current.row);
      return;
    }
    meta.userId = session.user.id;
    meta.revision = current.row ? current.row.revision : 0;
    saveMeta();
    await upload(current.localSave, !current.row);
  }

  function friendlyError(error, fallback) {
    const message = String(error && error.message ? error.message : "");
    if (/Failed to fetch|NetworkError/i.test(message)) return "网络不可用，已继续保存到本机";
    if (/player_saves|relation/i.test(message)) return "云端数据表尚未完成配置";
    return fallback;
  }

  function renderManager(container) {
    if (!container) return;
    const state = publicState();
    if (!state.configured) {
      container.innerHTML = `
        <div class="cloud-head"><b>云端存档</b><span class="status-pill muted">等待配置</span></div>
        <p>云端接口尚未部署，当前仍使用可靠的双份本地存档。</p>`;
      return;
    }
    if (!state.ready) {
      container.innerHTML = `
        <div class="cloud-head"><b>云端存档</b><span class="status-pill warning">离线</span></div>
        <p>${lastError || "正在连接云端服务……"}</p>`;
      return;
    }
    if (!state.signedIn) {
      container.innerHTML = `
        <div class="cloud-head"><b>登录云存档</b><span class="status-pill">推荐</span></div>
        <p>输入邮箱后会收到一次性登录链接，不需要设置密码。</p>
        <label class="field-label" for="cloud-email">邮箱</label>
        <input id="cloud-email" class="cloud-input" type="email" autocomplete="email" placeholder="name@example.com" />
        <button id="cloud-login" class="button primary full" type="button">发送登录链接</button>
        <p class="cloud-note">首次登录会让你选择上传本机进度或载入已有云端进度。</p>`;
      container.querySelector("#cloud-login").addEventListener("click", async () => {
        const button = container.querySelector("#cloud-login");
        button.disabled = true;
        try {
          await requestOtp(container.querySelector("#cloud-email").value);
          bridge.notify("登录链接已发送，请检查邮箱");
          button.textContent = "登录链接已发送";
        } catch (error) {
          bridge.notify(error.message || "无法发送登录链接");
          button.disabled = false;
        }
      });
      return;
    }

    const conflictHtml = conflict ? `
      <div class="cloud-conflict">
        <b>发现两份不同进度</b>
        <p>为了避免覆盖，本次不会自动合并。请选择需要保留的一份。</p>
        <div class="modal-actions split-actions">
          <button id="keep-local" class="button secondary" type="button">保留本机进度</button>
          <button id="keep-cloud" class="button primary" type="button">载入云端进度</button>
        </div>
      </div>` : "";
    container.innerHTML = `
      <div class="cloud-head"><b>云端存档</b><span class="status-pill success">已登录</span></div>
      <p class="account-email">${escapeHtml(state.email)}</p>
      <p>${syncing ? "正在同步……" : (lastError || "本机与云端会在关键操作后自动同步。")}</p>
      ${state.lastSyncedAt ? `<p class="cloud-note">最近同步：${new Date(state.lastSyncedAt).toLocaleString("zh-CN")}</p>` : ""}
      ${conflictHtml}
      <div class="modal-actions split-actions">
        <button id="cloud-sync-now" class="button secondary" type="button" ${conflict ? "disabled" : ""}>立即同步</button>
        <button id="cloud-sign-out" class="button secondary" type="button">退出账号</button>
      </div>`;
    const syncButton = container.querySelector("#cloud-sync-now");
    if (syncButton) syncButton.addEventListener("click", syncNow);
    container.querySelector("#cloud-sign-out").addEventListener("click", signOut);
    const localButton = container.querySelector("#keep-local");
    const cloudButton = container.querySelector("#keep-cloud");
    if (localButton) localButton.addEventListener("click", () => resolveConflict("local"));
    if (cloudButton) cloudButton.addEventListener("click", () => resolveConflict("cloud"));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  window.IPCloud = { init, queueSync, syncNow, renderManager, publicState };
})();
