(function () {
  "use strict";

  const Core = window.GameCore;
  const SAVE_KEY = "infinite-protocol-save-v1";
  const BACKUP_KEY = "infinite-protocol-save-backup-v2";
  const SAVE_VERSION = 3;
  const TUTORIAL_VERSION = 2;
  const HAND_SIZE = 6;
  const MAX_SELECTED = 5;

  const elements = {
    sourceCode: document.querySelector("#source-code"),
    sourceHelpButton: document.querySelector("#source-help-button"),
    saveStatus: document.querySelector("#save-status"),
    connectionState: document.querySelector("#connection-state"),
    cloudStatus: document.querySelector("#cloud-status"),
    accountButton: document.querySelector("#account-button"),
    saveManagerButton: document.querySelector("#save-manager-button"),
    stageValue: document.querySelector("#stage-value"),
    scoreLabel: document.querySelector("#score-label"),
    scoreProgress: document.querySelector("#score-progress"),
    runData: document.querySelector("#run-data"),
    runDataHelp: document.querySelector("#run-data-help"),
    coachPanel: document.querySelector("#coach-panel"),
    coachIndex: document.querySelector("#coach-index"),
    coachTitle: document.querySelector("#coach-title"),
    coachText: document.querySelector("#coach-text"),
    coachSkip: document.querySelector("#coach-skip"),
    previewPanel: document.querySelector("#preview-panel"),
    previewScore: document.querySelector("#preview-score"),
    scoreFormula: document.querySelector("#score-formula"),
    protocolList: document.querySelector("#protocol-list"),
    moduleTriggerList: document.querySelector("#module-trigger-list"),
    playsLeft: document.querySelector("#plays-left"),
    rerollsLeft: document.querySelector("#rerolls-left"),
    hand: document.querySelector("#hand"),
    selectionHelp: document.querySelector("#selection-help"),
    rerollButton: document.querySelector("#reroll-button"),
    playButton: document.querySelector("#play-button"),
    deckSize: document.querySelector("#deck-size"),
    moduleCount: document.querySelector("#module-count"),
    moduleButton: document.querySelector("#module-button"),
    iterationButton: document.querySelector("#iteration-button"),
    eventMessage: document.querySelector("#event-message"),
    helpButton: document.querySelector("#help-button"),
    installButton: document.querySelector("#install-button"),
    soundButton: document.querySelector("#sound-button"),
    resetButton: document.querySelector("#reset-button"),
    modalBackdrop: document.querySelector("#modal-backdrop"),
    modal: document.querySelector("#modal"),
    toast: document.querySelector("#toast"),
    scoreBurst: document.querySelector("#score-burst"),
    effectLayer: document.querySelector("#effect-layer"),
  };

  const defaultUpgrades = () => ({
    arithmetic: false,
    doubling: false,
    advancedModules: false,
    baseBoost: 0,
    extraReroll: 0,
    sourceEfficiency: 0,
    fusionCalibration: 0,
    starterFusion: false,
    starterModule: false,
    rewardRefresh: false,
    rewardExpansion: false,
  });

  const defaultSave = () => ({
    version: SAVE_VERSION,
    sourceCode: 0,
    totalIterations: 0,
    bestStage: 0,
    tutorialVersion: 0,
    lastSavedAt: null,
    soundEnabled: true,
    upgrades: defaultUpgrades(),
    runSnapshot: null,
  });

  let save = loadSave();
  let state = createEmptyState();
  let runDecisionPending = Boolean(save.runSnapshot && save.runSnapshot.active);
  let cardSerial = 0;
  let toastTimer = null;
  let deferredInstallPrompt = null;
  let audioContext = null;

  function createEmptyState() {
    return {
      active: false,
      phase: "idle",
      stage: 1,
      target: Core.stageTarget(1),
      stageScore: 0,
      runData: 0,
      deck: [],
      hand: [],
      drawPile: [],
      discardPile: [],
      selected: new Set(),
      modules: [],
      playsLeft: 3,
      rerollsLeft: 2,
      pendingRewards: null,
      pendingSourceAmount: 0,
      rewardChosen: false,
      lastRewardText: "",
      rewardRefreshes: 0,
      tutorialMode: false,
      tutorialStep: null,
      tutorialNeedsUpgrade: false,
    };
  }

  function clampNumber(value, min, max, fallback = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(number)));
  }

  function sanitizeSave(raw) {
    const base = defaultSave();
    if (!raw || typeof raw !== "object") return base;
    const oldExtraReroll = raw.upgrades && raw.upgrades.extraReroll;
    const upgrades = { ...defaultUpgrades(), ...(raw.upgrades || {}) };
    upgrades.arithmetic = Boolean(upgrades.arithmetic);
    upgrades.doubling = Boolean(upgrades.doubling);
    upgrades.advancedModules = Boolean(upgrades.advancedModules);
    upgrades.baseBoost = clampNumber(upgrades.baseBoost, 0, 10);
    upgrades.extraReroll = typeof oldExtraReroll === "boolean"
      ? (oldExtraReroll ? 1 : 0)
      : clampNumber(upgrades.extraReroll, 0, 2);
    upgrades.sourceEfficiency = clampNumber(upgrades.sourceEfficiency, 0, 3);
    upgrades.fusionCalibration = clampNumber(upgrades.fusionCalibration, 0, 5);
    upgrades.starterFusion = Boolean(upgrades.starterFusion);
    upgrades.starterModule = Boolean(upgrades.starterModule);
    upgrades.rewardRefresh = Boolean(upgrades.rewardRefresh);
    upgrades.rewardExpansion = Boolean(upgrades.rewardExpansion);

    return {
      ...base,
      version: SAVE_VERSION,
      sourceCode: clampNumber(raw.sourceCode, 0, 1e12),
      totalIterations: clampNumber(raw.totalIterations ?? raw.totalRebirths, 0, 1e9),
      bestStage: clampNumber(raw.bestStage, 0, 1e6),
      tutorialVersion: clampNumber(raw.tutorialVersion, 0, TUTORIAL_VERSION),
      lastSavedAt: typeof raw.lastSavedAt === "string" ? raw.lastSavedAt : null,
      soundEnabled: raw.soundEnabled !== false,
      upgrades,
      runSnapshot: sanitizeRunSnapshot(raw.runSnapshot),
    };
  }

  function sanitizeCard(card) {
    if (!card || typeof card !== "object") return null;
    const value = clampNumber(card.value, 1, 9, 1);
    const level = clampNumber(card.level, 1, 5, 1);
    const id = typeof card.id === "string" && card.id.length < 100 ? card.id : nextCardId();
    return { id, value, level };
  }

  function sanitizeCardArray(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 200).map(sanitizeCard).filter(Boolean);
  }

  function sanitizeRunSnapshot(raw) {
    if (!raw || typeof raw !== "object" || !raw.active) return null;
    const validModules = Array.isArray(raw.modules)
      ? raw.modules.filter((key) => Object.prototype.hasOwnProperty.call(Core.MODULES, key)).slice(0, 30)
      : [];
    return {
      active: true,
      phase: ["playing", "reward"].includes(raw.phase) ? raw.phase : "playing",
      stage: clampNumber(raw.stage, 1, 1e6, 1),
      target: clampNumber(raw.target, 1, 1e15, 55),
      stageScore: clampNumber(raw.stageScore, 0, 1e15),
      runData: clampNumber(raw.runData, 0, 1e12),
      deck: sanitizeCardArray(raw.deck),
      hand: sanitizeCardArray(raw.hand),
      drawPile: sanitizeCardArray(raw.drawPile),
      discardPile: sanitizeCardArray(raw.discardPile),
      selected: Array.isArray(raw.selected) ? raw.selected.filter((id) => typeof id === "string").slice(0, 5) : [],
      modules: validModules,
      playsLeft: clampNumber(raw.playsLeft, 0, 20, 3),
      rerollsLeft: clampNumber(raw.rerollsLeft, 0, 20, 2),
      pendingRewards: Array.isArray(raw.pendingRewards) ? raw.pendingRewards.slice(0, 5) : null,
      pendingSourceAmount: clampNumber(raw.pendingSourceAmount, 0, 1e9),
      rewardChosen: Boolean(raw.rewardChosen),
      lastRewardText: typeof raw.lastRewardText === "string" ? raw.lastRewardText.slice(0, 300) : "",
      rewardRefreshes: clampNumber(raw.rewardRefreshes, 0, 5),
      tutorialMode: Boolean(raw.tutorialMode),
      tutorialStep: typeof raw.tutorialStep === "string" ? raw.tutorialStep : null,
      tutorialNeedsUpgrade: Boolean(raw.tutorialNeedsUpgrade),
    };
  }

  function loadSave() {
    const candidates = [SAVE_KEY, BACKUP_KEY];
    for (const key of candidates) {
      try {
        const stored = localStorage.getItem(key);
        if (stored) return sanitizeSave(JSON.parse(stored));
      } catch (error) {
        // Try the redundant backup before falling back to a fresh save.
      }
    }
    return defaultSave();
  }

  function serializeRun() {
    if (!state.active) return null;
    return {
      active: true,
      phase: state.phase === "reward" ? "reward" : "playing",
      stage: state.stage,
      target: state.target,
      stageScore: state.stageScore,
      runData: state.runData,
      deck: state.deck,
      hand: state.hand,
      drawPile: state.drawPile,
      discardPile: state.discardPile,
      selected: [...state.selected],
      modules: state.modules,
      playsLeft: state.playsLeft,
      rerollsLeft: state.rerollsLeft,
      pendingRewards: state.pendingRewards,
      pendingSourceAmount: state.pendingSourceAmount,
      rewardChosen: state.rewardChosen,
      lastRewardText: state.lastRewardText,
      rewardRefreshes: state.rewardRefreshes,
      tutorialMode: state.tutorialMode,
      tutorialStep: state.tutorialStep,
      tutorialNeedsUpgrade: state.tutorialNeedsUpgrade,
    };
  }

  function writeSave(options = {}) {
    try {
      save.version = SAVE_VERSION;
      if (!options.preserveTimestamp || !save.lastSavedAt) save.lastSavedAt = new Date().toISOString();
      if (state.active) save.runSnapshot = serializeRun();
      else if (!runDecisionPending) save.runSnapshot = null;
      const serialized = JSON.stringify(save);
      localStorage.setItem(SAVE_KEY, serialized);
      localStorage.setItem(BACKUP_KEY, serialized);
      updateSaveStatus("已自动保存");
      if (options.cloud !== false && window.IPCloud) window.IPCloud.queueSync();
      return true;
    } catch (error) {
      updateSaveStatus("保存失败，请导出存档", true);
      return false;
    }
  }

  function currentSaveCopy() {
    const snapshot = state.active ? serializeRun() : save.runSnapshot;
    return sanitizeSave({ ...save, runSnapshot: snapshot });
  }

  function replaceSaveFromCloud(raw, message) {
    save = sanitizeSave(raw);
    state = createEmptyState();
    runDecisionPending = Boolean(save.runSnapshot && save.runSnapshot.active);
    writeSave({ cloud: false, preserveTimestamp: true });
    sessionStorage.setItem("infinite-protocol-cloud-message", message || "已载入云端进度");
    window.location.reload();
  }

  function setCloudState(cloudState, message) {
    if (!elements.cloudStatus || !elements.accountButton) return;
    elements.cloudStatus.className = "cloud-status";
    if (!cloudState.configured) {
      elements.cloudStatus.textContent = "云端待配置";
      elements.accountButton.textContent = "云存档";
      return;
    }
    if (cloudState.conflict) {
      elements.cloudStatus.textContent = "存档待选择";
      elements.cloudStatus.classList.add("warning");
      elements.accountButton.textContent = "处理冲突";
      return;
    }
    if (cloudState.syncing) {
      elements.cloudStatus.textContent = "云端同步中";
      elements.cloudStatus.classList.add("syncing");
      return;
    }
    if (cloudState.signedIn) {
      elements.cloudStatus.textContent = message || "云端已同步";
      elements.cloudStatus.classList.add("synced");
      elements.accountButton.textContent = "账号";
      return;
    }
    elements.cloudStatus.textContent = message || "云端未登录";
    elements.accountButton.textContent = "登录";
  }

  function updateSaveStatus(prefix) {
    if (!elements.saveStatus) return;
    const stamp = save.lastSavedAt ? new Date(save.lastSavedAt) : new Date();
    const time = stamp.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    elements.saveStatus.textContent = `${prefix} · ${time}`;
    elements.saveStatus.classList.add("save-pulse");
    window.setTimeout(() => elements.saveStatus.classList.remove("save-pulse"), 500);
  }

  function restoreState(snapshot) {
    const clean = sanitizeRunSnapshot(snapshot);
    if (!clean) return false;
    state = { ...createEmptyState(), ...clean, selected: new Set(clean.selected) };
    return state.deck.length > 0;
  }

  function nextCardId() {
    cardSerial += 1;
    return `c-${Date.now()}-${cardSerial}`;
  }

  function newCard(value, level = 1) {
    return Core.createCard(value, level, nextCardId());
  }

  function startRun(tutorial = false) {
    runDecisionPending = false;
    state = createEmptyState();
    state.active = true;
    state.tutorialMode = tutorial;
    state.tutorialStep = tutorial ? "select" : null;
    state.tutorialNeedsUpgrade = tutorial;
    state.rewardRefreshes = save.upgrades.rewardRefresh ? 1 : 0;
    for (let value = 1; value <= 6; value += 1) state.deck.push(newCard(value), newCard(value));

    if (save.upgrades.starterFusion) {
      const value = 1 + Math.floor(Math.random() * 6);
      const pair = state.deck.filter((card) => card.value === value).slice(0, 2);
      state.deck = state.deck.filter((card) => !pair.some((picked) => picked.id === card.id));
      state.deck.push(newCard(value, 2));
    }
    if (save.upgrades.starterModule) {
      const basic = Object.keys(Core.MODULES).filter((key) => !Core.MODULES[key].advanced);
      state.modules.push(Core.shuffle(basic)[0]);
    }

    setupStage({ tutorialOpening: tutorial });
    hideModal();
    setMessage(tutorial
      ? "教学模式已启动：跟随蓝色提示完成第一次协议。"
      : "协议已启动。选择芯片，寻找可以叠加的数字关系。");
    playTone("start");
    render();
    writeSave();
  }

  function setupStage(options = {}) {
    state.phase = "playing";
    state.target = Core.stageTarget(state.stage);
    if (state.tutorialMode && state.stage === 2) state.target = 80;
    if (state.tutorialMode && state.stage === 3) state.target = 120;
    state.stageScore = 0;
    state.playsLeft = 3;
    state.rerollsLeft = 2 + save.upgrades.extraReroll;
    state.selected.clear();
    state.discardPile = [];
    state.hand = [];

    if (options.tutorialOpening && state.stage === 1) {
      const wanted = [];
      [2, 2, 3, 4, 5, 6].forEach((value) => {
        const card = state.deck.find((candidate) => candidate.value === value && !wanted.includes(candidate));
        if (card) wanted.push(card);
      });
      const rest = state.deck.filter((card) => !wanted.includes(card));
      state.drawPile = [...Core.shuffle(rest), ...[...wanted].reverse()];
    } else {
      state.drawPile = Core.shuffle(state.deck);
    }
    drawToHand();

    if (state.tutorialMode) {
      if (state.stage === 2) state.tutorialStep = "reroll";
      if (state.stage >= 3) state.tutorialStep = "iteration";
    }
  }

  function drawToHand() {
    while (state.hand.length < HAND_SIZE) {
      if (!state.drawPile.length) {
        if (!state.discardPile.length) break;
        state.drawPile = Core.shuffle(state.discardPile);
        state.discardPile = [];
      }
      const card = state.drawPile.pop();
      if (card) state.hand.push(card);
    }
  }

  function selectedCards() {
    return state.hand.filter((card) => state.selected.has(card.id));
  }

  function analysisOptions() {
    return {
      unlocks: save.upgrades,
      modules: state.modules,
      deckSize: state.deck.length,
      baseBoost: save.upgrades.baseBoost,
      fusionBoost: save.upgrades.fusionCalibration,
    };
  }

  function currentAnalysis() {
    return Core.analyzeHand(selectedCards(), analysisOptions());
  }

  function tutorialSelectionComplete() {
    const values = selectedCards().map((card) => card.value).sort((a, b) => a - b);
    return values.join(",") === "2,2,3,4";
  }

  function toggleCard(cardId) {
    if (!state.active || state.phase !== "playing") return;
    const card = state.hand.find((item) => item.id === cardId);
    if (!card) return;

    if (state.tutorialMode && state.tutorialStep === "select" && !state.selected.has(cardId)) {
      const selectedValues = selectedCards().map((item) => item.value);
      const allowed = card.value === 2 ? selectedValues.filter((value) => value === 2).length < 2 : [3, 4].includes(card.value);
      if (!allowed) {
        showToast("教学目标：选择两张 2，再选择 3 和 4");
        pulseElement(elements.coachPanel);
        return;
      }
    }

    if (state.selected.has(cardId)) state.selected.delete(cardId);
    else if (state.selected.size < MAX_SELECTED) state.selected.add(cardId);
    else {
      showToast("一次最多执行 5 张芯片");
      return;
    }

    if (state.tutorialMode) {
      if (tutorialSelectionComplete()) state.tutorialStep = "preview";
      else if (["select", "preview"].includes(state.tutorialStep)) state.tutorialStep = "select";
    }
    playTone("select");
    vibrate(10);
    render();
    writeSave();
  }

  function consumeSelected() {
    const consumed = [];
    state.hand = state.hand.filter((card) => {
      if (state.selected.has(card.id)) {
        consumed.push(card);
        return false;
      }
      return true;
    });
    state.discardPile.push(...consumed);
    state.selected.clear();
    drawToHand();
  }

  function playSelected() {
    if (!state.active || state.phase !== "playing" || !state.selected.size || state.playsLeft <= 0) return;
    if (state.tutorialMode && state.tutorialStep === "select") {
      showToast("先按照提示组成 2、2、3、4");
      return;
    }

    state.phase = "resolving";
    const analysis = currentAnalysis();
    state.stageScore += analysis.score;
    state.playsLeft -= 1;
    const protocolText = analysis.protocols.length
      ? analysis.protocols.map((protocol) => protocol.name).join(" + ")
      : "基础运算";
    setMessage(`${protocolText}，输出 ${analysis.score.toLocaleString("zh-CN")} 算力${analysis.overclock ? "，超频成功！" : "。"}`);
    consumeSelected();
    showScoreBurst(analysis.score, analysis.overclock);
    playTone(analysis.overclock ? "overclock" : "score");
    vibrate(analysis.overclock ? [25, 30, 45] : 25);
    if (state.tutorialMode && ["preview", "reroll"].includes(state.tutorialStep)) state.tutorialStep = "build";
    render();
    writeSave();

    window.setTimeout(() => {
      if (!state.active || state.phase !== "resolving") return;
      if (state.stageScore >= state.target) stageCleared();
      else if (state.playsLeft <= 0) finishRun(false);
      else {
        state.phase = "playing";
        render();
        writeSave();
      }
    }, 520);
  }

  function rerollSelected() {
    if (!state.active || state.phase !== "playing" || !state.selected.size || state.rerollsLeft <= 0) return;
    state.phase = "shuffling";
    elements.hand.classList.add("shuffling");
    elements.rerollButton.classList.add("working");
    const count = state.selected.size;
    playTone("shuffle");
    vibrate(15);
    renderControls();

    window.setTimeout(() => {
      state.rerollsLeft -= 1;
      consumeSelected();
      state.phase = "playing";
      if (state.tutorialMode && state.tutorialStep === "reroll") state.tutorialStep = "build";
      elements.hand.classList.remove("shuffling");
      elements.rerollButton.classList.remove("working");
      setMessage(`换牌完成：已替换 ${count} 张芯片。`);
      render();
      writeSave();
    }, 380);
  }

  function stageCleared() {
    if (!state.active || state.phase === "reward") return;
    state.phase = "reward";
    const reward = Core.sourceReward(state.stage);
    state.pendingSourceAmount = reward;
    state.runData += reward;
    state.pendingRewards = buildRewards();
    state.rewardChosen = false;
    state.lastRewardText = "";
    save.bestStage = Math.max(save.bestStage, state.stage);
    setMessage(`层级 ${state.stage} 已突破，${reward} 段源代码写入待归档缓存。`);
    showSuccessEffect();
    playTone("success");
    vibrate([35, 45, 70]);
    render();
    writeSave();
    window.setTimeout(() => showRewardModal(), 420);
  }

  function availableModuleKeys() {
    return Object.keys(Core.MODULES).filter((key) => {
      const module = Core.MODULES[key];
      return !state.modules.includes(key) && (!module.advanced || save.upgrades.advancedModules);
    });
  }

  function buildRewards() {
    const choices = [];
    const moduleKeys = availableModuleKeys();
    if (moduleKeys.length) {
      const key = Core.shuffle(moduleKeys)[0];
      choices.push({ type: "module", key, title: Core.MODULES[key].name, description: Core.MODULES[key].description });
    }

    const chipValue = 1 + Math.floor(Math.random() * 9);
    choices.push({
      type: "chip",
      value: chipValue,
      title: `写入 ${chipValue} 号芯片`,
      description: "将一张新芯片加入牌组，扩大可组成的数字关系。",
    });

    const fusionGroups = state.deck.length > 6 ? Core.findFusionGroups(state.deck) : [];
    if (fusionGroups.length) {
      const group = Core.shuffle(fusionGroups)[0];
      choices.push({
        type: "fusion",
        cardIds: [group[0].id, group[1].id],
        value: group[0].value,
        level: group[0].level,
        title: `融合 ${group[0].value} 号芯片`,
        description: `两张 MK-${roman(group[0].level)} 合成为一张 MK-${roman(group[0].level + 1)}；单卡更强，但会失去一次同步机会。`,
      });
    }

    const wanted = save.upgrades.rewardExpansion ? 4 : 3;
    while (choices.length < wanted) {
      const value = 1 + Math.floor(Math.random() * 9);
      choices.push({ type: "chip", value, title: `复制 ${value} 号芯片`, description: "加入一张芯片，为协议组合或后续融合准备材料。" });
    }
    return Core.shuffle(choices).slice(0, wanted);
  }

  function rewardTypeLabel(reward) {
    if (reward.type === "module") return "局内模块 · 本轮有效";
    if (reward.type === "fusion") return "芯片融合 · 本轮有效";
    return "新芯片 · 本轮有效";
  }

  function showRewardModal() {
    const rewards = state.pendingRewards || buildRewards();
    state.pendingRewards = rewards;
    const rewardHtml = rewards.map((reward, index) => `
      <button class="reward-card" data-reward-index="${index}">
        <span class="reward-type">${escapeHtml(rewardTypeLabel(reward))}</span>
        <b>${escapeHtml(reward.title)}</b>
        <span>${escapeHtml(reward.description)}</span>
      </button>
    `).join("");
    const tutorialNote = state.tutorialMode && !state.rewardChosen ? `
      <div class="tutorial-note"><b>教学：局内强化</b><span>下面三项只在本轮有效。模块会改变计分规则；新芯片扩大组合；融合提高单卡算力但减少重复牌。</span></div>
    ` : "";
    showModal(`
      <p class="eyebrow">LAYER CLEARED</p>
      <h2 id="modal-title">层级突破</h2>
      ${tutorialNote}
      <p>本层已有 <b class="accent">+${state.pendingSourceAmount}</b> 段源代码写入待归档缓存。选择一项强化。</p>
      <div class="reward-grid" id="reward-grid">${rewardHtml}</div>
      ${state.rewardRefreshes > 0 ? `<button class="inline-action" id="refresh-rewards">刷新全部选项（本轮剩余 ${state.rewardRefreshes} 次）</button>` : ""}
      <div id="reward-result"></div>
    `);
    elements.modal.querySelectorAll("[data-reward-index]").forEach((button) => {
      button.addEventListener("click", () => chooseReward(rewards[Number(button.dataset.rewardIndex)]));
    });
    const refresh = elements.modal.querySelector("#refresh-rewards");
    if (refresh) refresh.addEventListener("click", refreshRewards);
  }

  function refreshRewards() {
    if (state.rewardRefreshes <= 0 || state.rewardChosen) return;
    state.rewardRefreshes -= 1;
    state.pendingRewards = buildRewards();
    playTone("shuffle");
    showRewardModal();
    writeSave();
  }

  function chooseReward(reward) {
    if (state.rewardChosen) return;
    state.rewardChosen = true;
    if (reward.type === "module") {
      state.modules.push(reward.key);
      state.lastRewardText = `局内模块“${reward.title}”已安装，本轮结束后重置。`;
    } else if (reward.type === "chip") {
      state.deck.push(newCard(reward.value));
      state.lastRewardText = `${reward.value} 号芯片已写入本轮牌组。`;
    } else if (reward.type === "fusion") {
      const picked = state.deck.filter((card) => reward.cardIds.includes(card.id));
      if (picked.length === 2) {
        state.deck = state.deck.filter((card) => !reward.cardIds.includes(card.id));
        state.deck.push(newCard(reward.value, reward.level + 1));
        state.lastRewardText = `${reward.value} 号 MK-${roman(reward.level + 1)} 融合完成。`;
      } else {
        state.lastRewardText = "融合材料状态已变化，本次保留原牌组。";
      }
    }
    state.pendingRewards = null;
    elements.modal.querySelectorAll(".reward-card").forEach((button) => { button.disabled = true; });
    const refresh = elements.modal.querySelector("#refresh-rewards");
    if (refresh) refresh.disabled = true;
    renderRewardResult();
    playTone("upgrade");
    vibrate(30);
    render();
    writeSave();
  }

  function renderRewardResult() {
    const result = elements.modal.querySelector("#reward-result");
    if (!result) return;
    const canIterate = state.stage >= 3;
    const iterationClass = state.tutorialMode && state.stage >= 3 ? " tutorial-focus" : "";
    result.innerHTML = `
      <p class="lead reward-confirmed">✓ ${escapeHtml(state.lastRewardText)}</p>
      ${canIterate ? '<p class="micro-copy">继续挑战可以获得更多源代码；核心迭代会结束本轮并进入永久升级界面。</p>' : ""}
      <div class="modal-actions">
        <button class="button primary" id="continue-button">进入层级 ${String(state.stage + 1).padStart(2, "0")}</button>
        ${canIterate ? `<button class="button secondary${iterationClass}" id="reward-iteration-button">归档缓存并核心迭代</button>` : ""}
      </div>
    `;
    result.querySelector("#continue-button").addEventListener("click", continueRun);
    const iteration = result.querySelector("#reward-iteration-button");
    if (iteration) iteration.addEventListener("click", () => finishRun(true));
  }

  function continueRun() {
    state.stage += 1;
    setupStage();
    hideModal();
    setMessage(`进入层级 ${state.stage}。目标算力提升至 ${state.target.toLocaleString("zh-CN")}。`);
    playTone("start");
    render();
    writeSave();
  }

  function finishRun(voluntary) {
    if (!state.active) return;
    state.active = false;
    runDecisionPending = false;
    state.phase = "ended";
    const efficiencyLevel = save.upgrades.sourceEfficiency;
    const efficiencyBonus = efficiencyLevel > 0 ? Math.max(1, Math.floor(state.runData * efficiencyLevel * 0.1)) : 0;
    const gained = state.runData + efficiencyBonus;
    save.sourceCode += gained;
    save.totalIterations += 1;
    save.bestStage = Math.max(save.bestStage, voluntary ? state.stage : Math.max(0, state.stage - 1));
    state.tutorialNeedsUpgrade = state.tutorialMode && save.tutorialVersion < TUTORIAL_VERSION && gained >= 3;
    save.runSnapshot = null;
    writeSave();
    showUpgradeModal(voluntary, gained, efficiencyBonus);
    playTone(voluntary ? "iteration" : "fail");
    render();
  }

  function showUpgradeModal(voluntary, gained, efficiencyBonus = 0) {
    const tutorialNote = state.tutorialNeedsUpgrade ? `
      <div class="tutorial-note"><b>教学：永久升级</b><span>源代码已经从本轮缓存归档为永久货币。请在下方购买至少一项迭代增益；这些能力以后每轮都会保留。</span></div>
    ` : "";
    const tutorialRetry = state.tutorialMode && save.tutorialVersion < TUTORIAL_VERSION && !state.tutorialNeedsUpgrade;
    showModal(`
      <p class="eyebrow">${voluntary ? "CORE ITERATION" : "SYSTEM ROLLBACK"}</p>
      <h2 id="modal-title">${voluntary ? "核心迭代完成" : "本轮运算结束"}</h2>
      ${tutorialNote}
      <p>${voluntary ? "本轮系统已安全归档，并部署为新的核心版本。" : "目标算力未达成；当前层级未结算，此前缓存的源代码已经安全归档。"}</p>
      <div class="stat-summary">
        <div><span>永久源代码</span><b>+${gained}</b></div>
        <div><span>抵达层级</span><b>${state.stage}</b></div>
        <div><span>历史最高</span><b>${save.bestStage}</b></div>
      </div>
      ${efficiencyBonus ? `<p class="bonus-line">数据提纯额外获得 +${efficiencyBonus} 源代码</p>` : ""}
      <div class="currency-explain"><b>永久源代码：${save.sourceCode}</b><span>用于购买下方永久生效的“迭代增益”。购买后无需装备。</span></div>
      <h3>迭代增益</h3>
      <div class="upgrade-grid" id="upgrade-grid"></div>
      <div class="modal-actions">
        <button class="button primary" id="new-run-button" ${state.tutorialNeedsUpgrade ? "disabled" : ""}>${tutorialRetry ? "重新开始互动教程" : "启动新一轮协议"}</button>
      </div>
      ${state.tutorialNeedsUpgrade ? '<p class="required-hint" id="upgrade-required">请先购买一项永久增益，再开始下一轮。</p>' : ""}
      ${tutorialRetry ? '<p class="required-hint">这次未获得足够源代码购买增益；重新挑战时教程会继续。</p>' : ""}
    `);
    renderUpgradeGrid();
    elements.modal.querySelector("#new-run-button").addEventListener("click", () => startRun(tutorialRetry));
  }

  function levelUpgrade(key, name, category, description, max, baseCost, stepCost) {
    const level = save.upgrades[key];
    return {
      key,
      name: `${name} LV.${level}`,
      category,
      cost: baseCost + level * stepCost,
      description,
      bought: level >= max,
      maxLabel: level >= max ? "已满级" : null,
    };
  }

  function upgradeDefinitions() {
    return [
      { key: "arithmetic", name: "解析：等距链", category: "协议解锁", cost: 3, description: "识别 2-5-8 等间距数字，开放新的叠加路线。", bought: save.upgrades.arithmetic },
      { key: "doubling", name: "解析：倍增链", category: "协议解锁", cost: 6, description: "识别 1-2-4-8 等翻倍序列，难度高、倍率也高。", bought: save.upgrades.doubling },
      { key: "advancedModules", name: "高级模块库", category: "协议解锁", cost: 5, description: "将极简内核、量子超频器、级联核心和融合晶格加入局内奖励池。", bought: save.upgrades.advancedModules },
      levelUpgrade("baseBoost", "基础校准", "性能调校", "所有芯片基础算力永久提高 5%。", 10, 4, 4),
      levelUpgrade("fusionCalibration", "融合校准", "性能调校", "每级使 MK-II 及以上芯片基础算力提高 8%。", 5, 7, 6),
      levelUpgrade("sourceEfficiency", "数据提纯", "资源效率", "每级在核心迭代时额外归档约 10% 源代码。", 3, 10, 10),
      levelUpgrade("extraReroll", "备用缓存区", "运行工具", "每级使每层换牌次数永久增加 1 次。", 2, 8, 10),
      { key: "rewardRefresh", name: "奖励重编译", category: "运行工具", cost: 10, description: "每轮可免费刷新一次层级奖励选项。", bought: save.upgrades.rewardRefresh },
      { key: "rewardExpansion", name: "并行决策器", category: "运行工具", cost: 18, description: "层级奖励从三选一扩展为四选一。", bought: save.upgrades.rewardExpansion },
      { key: "starterFusion", name: "预编译芯片", category: "启动配置", cost: 12, description: "每轮开始时随机将一对初始芯片融合为 MK-II。", bought: save.upgrades.starterFusion },
      { key: "starterModule", name: "模块快照", category: "启动配置", cost: 14, description: "每轮开始时随机安装一个基础局内模块。", bought: save.upgrades.starterModule },
    ];
  }

  function renderUpgradeGrid() {
    const grid = elements.modal.querySelector("#upgrade-grid");
    if (!grid) return;
    const groups = new Map();
    upgradeDefinitions().forEach((upgrade) => {
      if (!groups.has(upgrade.category)) groups.set(upgrade.category, []);
      groups.get(upgrade.category).push(upgrade);
    });
    grid.innerHTML = [...groups.entries()].map(([category, upgrades]) => `
      <section class="upgrade-category">
        <h4>${escapeHtml(category)}</h4>
        ${upgrades.map((upgrade) => {
          const affordable = save.sourceCode >= upgrade.cost;
          return `
            <button class="upgrade-card" data-upgrade="${upgrade.key}" ${upgrade.bought || !affordable ? "disabled" : ""}>
              <b>${escapeHtml(upgrade.name)} · ${upgrade.bought ? (upgrade.maxLabel || "已解锁") : `${upgrade.cost} 源代码`}</b>
              <span>${escapeHtml(upgrade.description)}</span>
            </button>
          `;
        }).join("")}
      </section>
    `).join("");
    grid.querySelectorAll("[data-upgrade]").forEach((button) => {
      button.addEventListener("click", () => buyUpgrade(button.dataset.upgrade));
    });
  }

  function buyUpgrade(key) {
    const upgrade = upgradeDefinitions().find((item) => item.key === key);
    if (!upgrade || upgrade.bought || save.sourceCode < upgrade.cost) return;
    save.sourceCode -= upgrade.cost;
    if (["baseBoost", "extraReroll", "sourceEfficiency", "fusionCalibration"].includes(key)) save.upgrades[key] += 1;
    else save.upgrades[key] = true;
    playTone("upgrade");
    vibrate([20, 30, 35]);
    showToast(`${upgrade.name} 已写入永久核心`);

    if (state.tutorialNeedsUpgrade) {
      state.tutorialNeedsUpgrade = false;
      state.tutorialMode = false;
      save.tutorialVersion = TUTORIAL_VERSION;
      const newRun = elements.modal.querySelector("#new-run-button");
      if (newRun) newRun.disabled = false;
      const hint = elements.modal.querySelector("#upgrade-required");
      if (hint) hint.textContent = "✓ 教程完成！这项增益将在以后每轮永久生效。";
      spawnParticles(18);
    }
    writeSave();
    renderUpgradeGrid();
    render();
  }

  function requestIteration() {
    if (!state.active || state.phase !== "playing" || state.stage < 3) return;
    if (state.tutorialMode && state.runData < 3) {
      showToast("教学模式：建议先完成第三层，确保有足够源代码购买增益");
      return;
    }
    showModal(`
      <p class="eyebrow">CORE ITERATION REQUEST</p>
      <h2 id="modal-title">确认启动核心迭代？</h2>
      <div class="term-callout"><b>核心迭代</b><span>结束本轮，重置局内牌组和模块，把待归档缓存转换为永久源代码，然后选择永久增益。</span></div>
      <p>本轮缓存的 <b class="accent">${state.runData}</b> 段源代码将永久保存。当前未完成层级已经产生的算力会被舍弃。</p>
      <div class="modal-actions">
        <button class="button danger-button" id="confirm-iteration">确认迭代</button>
        <button class="button secondary" id="cancel-modal">继续挑战</button>
      </div>
    `);
    elements.modal.querySelector("#confirm-iteration").addEventListener("click", () => finishRun(true));
    elements.modal.querySelector("#cancel-modal").addEventListener("click", hideModal);
  }

  function showModules() {
    const content = state.modules.length
      ? state.modules.map((key) => {
        const module = Core.MODULES[key];
        const active = currentAnalysis().activeModuleKeys.includes(key);
        return `<div class="module-item ${active ? "active" : ""}"><b>${escapeHtml(module.name)} ${active ? '<em>当前手牌已触发</em>' : ""}</b><span>${escapeHtml(module.description)}</span></div>`;
      }).join("")
      : '<p>本轮尚未安装任何局内模块。突破层级后，可以在奖励中获得；核心迭代时会重置。</p>';
    showModal(`
      <p class="eyebrow">INSTALLED MODULES</p>
      <h2 id="modal-title">局内模块</h2>
      <p>绿色标记表示该模块正影响当前所选手牌；未标记的模块仍已安装，只是触发条件尚未满足。</p>
      <div class="module-list">${content}</div>
      <div class="modal-actions"><button class="button secondary" id="close-modal">返回</button></div>
    `);
    elements.modal.querySelector("#close-modal").addEventListener("click", hideModal);
  }

  function showHelp() {
    showModal(`
      <p class="eyebrow">PROTOCOL MANUAL / v0.2</p>
      <h2 id="modal-title">教程与术语</h2>
      <h3>一句话目标</h3>
      <p class="lead">每层有 3 次运算机会。组合数字芯片，让累计算力达到目标。</p>
      <ul class="rule-list">
        <li><b>基础算力：</b>芯片本身提供的数值，高级芯片和部分模块会提高它。</li>
        <li><b>协议倍率：</b>同步、连续链等数字关系带来的加成；同一手可以叠加。</li>
        <li><b>超频：</b>同一手触发至少两类协议，最终分数额外乘算。</li>
        <li><b>局内模块：</b>本轮有效的被动规则，核心迭代后重置。</li>
        <li><b>待归档缓存：</b>本轮通关获得、尚未转换成永久货币的源代码。</li>
        <li><b>永久源代码：</b>核心迭代后保留，用来购买永久生效的迭代增益。</li>
        <li><b>核心迭代：</b>结束本轮临时构筑，归档源代码并进入永久升级。</li>
      </ul>
      <h3>基础协议</h3>
      <ul class="rule-list compact">
        <li><b>同步：</b>两张相同数字；三张相同时升级为三重同步。</li>
        <li><b>连续链：</b>至少三个连续数字，例如 2-3-4。</li>
        <li><b>等距链：</b>${save.upgrades.arithmetic ? "已解锁，例如 2-5-8。" : "需要用永久源代码解锁。"}</li>
        <li><b>倍增链：</b>${save.upgrades.doubling ? "已解锁，例如 1-2-4-8。" : "需要用永久源代码解锁。"}</li>
      </ul>
      <div class="modal-actions">
        <button class="button primary" id="replay-tutorial">重新开始互动教程</button>
        <button class="button secondary" id="close-modal">返回游戏</button>
      </div>
    `);
    elements.modal.querySelector("#replay-tutorial").addEventListener("click", () => {
      if (state.active && !window.confirm("重新教学会结束当前未完成的一轮，是否继续？")) return;
      startRun(true);
    });
    elements.modal.querySelector("#close-modal").addEventListener("click", hideModal);
  }

  function showSourceHelp() {
    showModal(`
      <p class="eyebrow">PERMANENT CURRENCY</p>
      <h2 id="modal-title">永久源代码是什么？</h2>
      <div class="term-callout"><b>永久源代码</b><span>游戏的长期升级货币，不会因为失败或关闭网页而消失。</span></div>
      <p>通关层级会先获得“待归档”源代码。启动核心迭代或本轮失败后，它们会归档到这里。随后可以购买协议解锁、性能调校和运行工具。</p>
      <p>当前拥有：<b class="accent">${save.sourceCode}</b> 段永久源代码。</p>
      <div class="modal-actions"><button class="button primary" id="close-modal">明白了</button></div>
    `);
    elements.modal.querySelector("#close-modal").addEventListener("click", hideModal);
  }

  function showRunDataHelp() {
    showModal(`
      <p class="eyebrow">ITERATION CACHE</p>
      <h2 id="modal-title">待归档缓存</h2>
      <p>这是本轮已经通关获得的源代码，目前有 <b class="accent">${state.runData}</b> 段。它们在核心迭代或本轮结束时会转换为永久源代码。</p>
      <p>当前未完成层级中的算力不会转换；此前完成层级的缓存不会因失败丢失。</p>
      <div class="modal-actions"><button class="button primary" id="close-modal">返回</button></div>
    `);
    elements.modal.querySelector("#close-modal").addEventListener("click", hideModal);
  }

  function showIntro() {
    const returning = save.tutorialVersion >= TUTORIAL_VERSION;
    showModal(`
      <p class="eyebrow">BOOT SEQUENCE / v0.2</p>
      <h2 id="modal-title">欢迎接入《无限协议》</h2>
      <p class="lead">组合数字芯片、安装局内模块，在一次次核心迭代中解锁新规则。</p>
      ${returning ? '<p>v0.2 已加入精确计分明细、更多迭代增益、自动恢复当前对局和 PWA 安装。</p>' : `
        <div class="onboarding-terms">
          <div><b>算力</b><span>本层需要达到的分数</span></div>
          <div><b>协议</b><span>数字组合产生的倍率</span></div>
          <div><b>局内模块</b><span>只在本轮生效的规则</span></div>
          <div><b>源代码</b><span>购买永久增益的货币</span></div>
        </div>
      `}
      <div class="modal-actions">
        ${returning ? '<button class="button primary" id="start-button">启动新一轮协议</button>' : '<button class="button primary" id="tutorial-button">开始互动教程（推荐）</button><button class="button secondary" id="skip-tutorial-button">跳过教程，直接开始</button>'}
        ${save.sourceCode > 0 ? '<button class="button secondary" id="view-source-button">查看源代码说明</button>' : ""}
      </div>
    `);
    const start = elements.modal.querySelector("#start-button");
    if (start) start.addEventListener("click", () => startRun(false));
    const tutorial = elements.modal.querySelector("#tutorial-button");
    if (tutorial) tutorial.addEventListener("click", () => startRun(true));
    const skip = elements.modal.querySelector("#skip-tutorial-button");
    if (skip) skip.addEventListener("click", () => {
      save.tutorialVersion = TUTORIAL_VERSION;
      startRun(false);
    });
    const source = elements.modal.querySelector("#view-source-button");
    if (source) source.addEventListener("click", showSourceHelp);
  }

  function showResumeModal() {
    const snapshot = save.runSnapshot;
    showModal(`
      <p class="eyebrow">AUTOSAVE RECOVERED</p>
      <h2 id="modal-title">检测到未完成的一轮</h2>
      <p>自动存档记录在层级 <b class="accent">${snapshot.stage}</b>，本层已有 ${snapshot.stageScore.toLocaleString("zh-CN")} / ${snapshot.target.toLocaleString("zh-CN")} 算力。</p>
      <p>待归档缓存：${snapshot.runData} 段源代码。继续后将恢复手牌、牌组、模块和剩余次数。</p>
      <div class="modal-actions">
        <button class="button primary" id="resume-button">继续未完成的一轮</button>
        <button class="button secondary" id="discard-run-button">放弃并开始新一轮</button>
      </div>
    `);
    elements.modal.querySelector("#resume-button").addEventListener("click", resumeSavedRun);
    elements.modal.querySelector("#discard-run-button").addEventListener("click", () => {
      save.runSnapshot = null;
      startRun(false);
    });
  }

  function resumeSavedRun() {
    runDecisionPending = false;
    if (!restoreState(save.runSnapshot)) {
      showToast("该轮存档损坏，已保留永久进度并开始新一轮");
      startRun(false);
      return;
    }
    hideModal();
    render();
    setMessage(`已恢复层级 ${state.stage} 的自动存档。`);
    if (state.phase === "reward") showRewardModal();
    else if (state.stageScore >= state.target) stageCleared();
    writeSave();
  }

  function encodeSave() {
    const payload = { ...save, runSnapshot: serializeRun(), exportedAt: new Date().toISOString() };
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return `IP2-${btoa(binary)}`;
  }

  function decodeSave(code) {
    const clean = String(code || "").trim();
    if (!clean.startsWith("IP2-") || clean.length > 200000) throw new Error("存档码格式不正确");
    const binary = atob(clean.slice(4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return sanitizeSave(JSON.parse(new TextDecoder().decode(bytes)));
  }

  function showSaveManager() {
    showModal(`
      <p class="eyebrow">SAVE CONTROL</p>
      <h2 id="modal-title">存档管理</h2>
      <section id="cloud-account-panel" class="cloud-account-panel" aria-live="polite">
        <p>正在读取云端状态……</p>
      </section>
      <div class="save-health"><b>双份本地自动保存已开启</b><span>${save.lastSavedAt ? `最近保存：${new Date(save.lastSavedAt).toLocaleString("zh-CN")}` : "尚未生成存档"}</span></div>
      <p>本机存档会始终保留，登录后还会自动同步云端。清理网站数据前仍建议保留一份存档码。</p>
      <textarea id="save-code" class="save-code" placeholder="点击“生成存档码”，或在这里粘贴需要导入的存档码。"></textarea>
      <div class="modal-actions split-actions">
        <button class="button secondary" id="manual-save">立即保存</button>
        <button class="button secondary" id="export-save">生成存档码</button>
        <button class="button secondary" id="copy-save">复制</button>
        <button class="button primary" id="import-save">导入并覆盖</button>
        <button class="button secondary full" id="close-modal">返回</button>
      </div>
    `);
    if (window.IPCloud) window.IPCloud.renderManager(elements.modal.querySelector("#cloud-account-panel"));
    const area = elements.modal.querySelector("#save-code");
    elements.modal.querySelector("#manual-save").addEventListener("click", () => {
      writeSave();
      showToast("当前进度已保存到本机");
    });
    elements.modal.querySelector("#export-save").addEventListener("click", () => {
      writeSave();
      area.value = encodeSave();
      area.focus();
      area.select();
      showToast("存档码已生成");
    });
    elements.modal.querySelector("#copy-save").addEventListener("click", async () => {
      if (!area.value) area.value = encodeSave();
      try {
        await navigator.clipboard.writeText(area.value);
        showToast("存档码已复制");
      } catch (error) {
        area.focus();
        area.select();
        showToast("请使用系统复制功能复制已选文字");
      }
    });
    elements.modal.querySelector("#import-save").addEventListener("click", () => {
      try {
        const imported = decodeSave(area.value);
        if (!window.confirm("导入会覆盖当前本地进度，确定继续吗？")) return;
        save = imported;
        state = createEmptyState();
        runDecisionPending = Boolean(save.runSnapshot && save.runSnapshot.active);
        writeSave();
        window.location.reload();
      } catch (error) {
        showToast(error.message || "无法识别该存档码");
        area.classList.add("invalid");
      }
    });
    elements.modal.querySelector("#close-modal").addEventListener("click", hideModal);
  }

  function skipTutorial() {
    state.tutorialMode = false;
    state.tutorialStep = null;
    state.tutorialNeedsUpgrade = false;
    save.tutorialVersion = TUTORIAL_VERSION;
    showToast("互动教程已跳过，可在“教程与术语”中重新观看");
    render();
    writeSave();
  }

  function renderCoach() {
    if (!state.tutorialMode || !state.active) {
      elements.coachPanel.classList.add("hidden");
      return;
    }
    const content = {
      select: ["01", "组成第一条协议", "点击两张 2，再点击 3 和 4。这一手会同时触发“同步”和“连续链”。"],
      preview: ["02", "看懂预计输出", "上方已经列出基础算力、协议倍率和超频乘数。确认无误后点击“执行协议”。"],
      reroll: ["03", "用换牌修正手牌", "选择暂时用不到的芯片，点击“换掉所选”即可补抽。换牌不消耗运算次数；也可以直接继续出牌。"],
      build: ["04", "独立完成构筑", "继续寻找同步、连续链与超频。通关奖励只在本轮有效，永久成长要通过核心迭代获得。"],
      iteration: ["05", "准备核心迭代", "完成第三层后，可以归档待归档缓存。核心迭代会重置本轮牌组和模块，并让你购买永久增益。"],
    }[state.tutorialStep] || ["04", "继续挑战", "尝试叠加更多协议，让一手牌触发超频。"];
    elements.coachIndex.textContent = content[0];
    elements.coachTitle.textContent = content[1];
    elements.coachText.textContent = content[2];
    elements.coachPanel.classList.remove("hidden");
  }

  function renderHand() {
    elements.hand.innerHTML = "";
    state.hand.forEach((card) => {
      const detail = Core.effectiveCardPower(card, {
        modules: state.modules,
        fusionBoost: save.upgrades.fusionCalibration,
      });
      const boosted = detail.power !== detail.raw;
      const tutorialWanted = state.tutorialMode && state.tutorialStep === "select" && [2, 3, 4].includes(card.value);
      const button = document.createElement("button");
      button.className = `card${state.selected.has(card.id) ? " selected" : ""}${boosted ? " boosted" : ""}${tutorialWanted ? " tutorial-focus" : ""}`;
      button.type = "button";
      button.disabled = state.phase !== "playing";
      button.setAttribute("aria-pressed", state.selected.has(card.id) ? "true" : "false");
      button.setAttribute("aria-label", `${card.value}号 MK-${roman(card.level)}，有效算力 ${Core.formatNumber(detail.power)}`);
      button.innerHTML = `
        <span class="card-level">CHIP / MK-${roman(card.level)}</span>
        <span class="card-value">${card.value}</span>
        <span class="card-power">PWR ${Core.formatNumber(detail.power)}${boosted ? " ↑" : ""}</span>
        ${boosted ? '<span class="boost-mark">BOOST</span>' : ""}
      `;
      button.addEventListener("click", () => toggleCard(card.id));
      elements.hand.appendChild(button);
    });
  }

  function renderPreview() {
    const cards = selectedCards();
    const analysis = currentAnalysis();
    elements.previewScore.textContent = analysis.score.toLocaleString("zh-CN");
    if (!cards.length) {
      elements.scoreFormula.textContent = "选择芯片以预览完整计分过程";
      elements.protocolList.innerHTML = "";
      elements.moduleTriggerList.innerHTML = state.modules.length
        ? '<span class="dormant-hint">选择芯片后会显示本手触发的模块</span>'
        : "";
      elements.previewPanel.classList.remove("overclock");
      return;
    }
    const factors = analysis.finalFactors.map((factor) => ` × ${factor.value} ${factor.name}`).join("");
    elements.scoreFormula.textContent = `${Core.formatNumber(analysis.base)} 基础 × ${Core.formatNumber(analysis.multiplier)} 协议${factors} = ${analysis.score.toLocaleString("zh-CN")}`;
    elements.protocolList.innerHTML = analysis.protocols.length
      ? analysis.protocols.map((protocol) => `<span class="protocol-chip ${protocol.color}">${escapeHtml(protocol.name)} / ${protocol.bonus}</span>`).join("")
      : '<span class="protocol-chip cyan">基础运算</span>';
    if (analysis.overclock) {
      elements.protocolList.insertAdjacentHTML("beforeend", '<span class="protocol-chip violet overclock-label">OVERCLOCK</span>');
      elements.previewPanel.classList.add("overclock");
    } else elements.previewPanel.classList.remove("overclock");
    elements.moduleTriggerList.innerHTML = analysis.moduleTriggers.map((trigger) => `
      <span class="module-trigger">✓ ${escapeHtml(trigger.name)}：${escapeHtml(trigger.detail)}</span>
    `).join("");
  }

  function renderControls() {
    const hasSelection = state.selected.size > 0;
    const canAct = state.active && state.phase === "playing";
    elements.playButton.disabled = !canAct || !hasSelection || state.playsLeft <= 0;
    elements.rerollButton.disabled = !canAct || !hasSelection || state.rerollsLeft <= 0;
    elements.iterationButton.disabled = !canAct || state.stage < 3;
    elements.playButton.classList.toggle("tutorial-focus", state.tutorialMode && state.tutorialStep === "preview");
    elements.rerollButton.classList.toggle("tutorial-focus", state.tutorialMode && state.tutorialStep === "reroll" && hasSelection);
  }

  function render() {
    elements.sourceCode.textContent = save.sourceCode.toLocaleString("zh-CN");
    elements.stageValue.textContent = String(state.stage).padStart(2, "0");
    elements.scoreLabel.textContent = `${state.stageScore.toLocaleString("zh-CN")} / ${state.target.toLocaleString("zh-CN")}`;
    elements.scoreProgress.style.width = `${Math.min(100, (state.stageScore / state.target) * 100)}%`;
    elements.runData.textContent = state.runData.toLocaleString("zh-CN");
    elements.playsLeft.textContent = state.playsLeft;
    elements.rerollsLeft.textContent = state.rerollsLeft;
    elements.deckSize.textContent = `${state.deck.length} 张`;
    elements.moduleCount.textContent = state.modules.length;
    elements.soundButton.textContent = `音效：${save.soundEnabled ? "开" : "关"}`;
    elements.soundButton.setAttribute("aria-pressed", save.soundEnabled ? "true" : "false");
    const hasSelection = state.selected.size > 0;
    elements.selectionHelp.textContent = hasSelection
      ? `已选择 ${state.selected.size} 张；上方分数已包含所有触发模块。`
      : "点击选择最多 5 张芯片；卡面 PWR 已包含当前模块加成。";
    renderControls();
    renderHand();
    renderPreview();
    renderCoach();
  }

  function showModal(html) {
    elements.modal.innerHTML = html;
    elements.modalBackdrop.classList.add("visible");
    elements.modal.classList.remove("modal-pop");
    void elements.modal.offsetWidth;
    elements.modal.classList.add("modal-pop");
  }

  function hideModal() {
    elements.modalBackdrop.classList.remove("visible");
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 2200);
  }

  function setMessage(message) {
    elements.eventMessage.textContent = message;
  }

  function showScoreBurst(score, overclock) {
    elements.scoreBurst.textContent = `+${score.toLocaleString("zh-CN")}${overclock ? "  OVERCLOCK" : ""}`;
    elements.scoreBurst.className = `score-burst visible${overclock ? " overclock" : ""}`;
    window.setTimeout(() => { elements.scoreBurst.className = "score-burst"; }, 900);
  }

  function showSuccessEffect() {
    document.body.classList.add("stage-success");
    elements.scoreProgress.classList.add("complete");
    spawnParticles(28);
    window.setTimeout(() => {
      document.body.classList.remove("stage-success");
      elements.scoreProgress.classList.remove("complete");
    }, 1000);
  }

  function spawnParticles(count) {
    const colors = ["#65e6ff", "#a879ff", "#65f5bd", "#ffc766"];
    for (let i = 0; i < count; i += 1) {
      const particle = document.createElement("i");
      particle.className = "data-particle";
      particle.style.setProperty("--x", `${(Math.random() - 0.5) * 320}px`);
      particle.style.setProperty("--y", `${-80 - Math.random() * 280}px`);
      particle.style.setProperty("--r", `${Math.random() * 540 - 270}deg`);
      particle.style.background = colors[i % colors.length];
      elements.effectLayer.appendChild(particle);
      window.setTimeout(() => particle.remove(), 1100);
    }
  }

  function pulseElement(element) {
    element.classList.remove("attention-pulse");
    void element.offsetWidth;
    element.classList.add("attention-pulse");
  }

  function vibrate(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  function playTone(type) {
    if (!save.soundEnabled) return;
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const settings = {
        select: [420, 0.025, "sine"],
        shuffle: [250, 0.08, "triangle"],
        score: [520, 0.09, "sine"],
        overclock: [760, 0.16, "sawtooth"],
        success: [880, 0.2, "triangle"],
        upgrade: [660, 0.12, "sine"],
        iteration: [340, 0.25, "triangle"],
        fail: [150, 0.18, "sine"],
        start: [480, 0.08, "sine"],
      }[type] || [400, 0.05, "sine"];
      oscillator.frequency.setValueAtTime(settings[0], audioContext.currentTime);
      oscillator.type = settings[2];
      gain.gain.setValueAtTime(0.035, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + settings[1]);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + settings[1]);
    } catch (error) {
      // Audio feedback is optional and must never block play.
    }
  }

  function updateConnectionState() {
    const online = navigator.onLine;
    elements.connectionState.textContent = online ? "在线" : "离线可玩";
    elements.connectionState.className = `connection-state ${online ? "online" : "offline"}`;
  }

  function setupPwa() {
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      elements.installButton.classList.remove("hidden");
    });
    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      elements.installButton.classList.add("hidden");
      showToast("《无限协议》已安装到设备");
    });
  }

  async function installPwa() {
    if (!deferredInstallPrompt) {
      showToast("可使用浏览器菜单中的“添加到主屏幕”安装游戏");
      return;
    }
    await deferredInstallPrompt.prompt();
    deferredInstallPrompt = null;
  }

  function roman(level) {
    return ["0", "I", "II", "III", "IV", "V"][level] || String(level);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  elements.playButton.addEventListener("click", playSelected);
  elements.rerollButton.addEventListener("click", rerollSelected);
  elements.moduleButton.addEventListener("click", showModules);
  elements.iterationButton.addEventListener("click", requestIteration);
  elements.helpButton.addEventListener("click", showHelp);
  elements.sourceHelpButton.addEventListener("click", showSourceHelp);
  elements.runDataHelp.addEventListener("click", showRunDataHelp);
  elements.accountButton.addEventListener("click", showSaveManager);
  elements.saveManagerButton.addEventListener("click", showSaveManager);
  elements.coachSkip.addEventListener("click", skipTutorial);
  elements.installButton.addEventListener("click", installPwa);
  elements.soundButton.addEventListener("click", () => {
    save.soundEnabled = !save.soundEnabled;
    render();
    writeSave();
    if (save.soundEnabled) playTone("select");
  });
  elements.resetButton.addEventListener("click", () => {
    if (!window.confirm("确定清除全部源代码、迭代增益、教程状态和当前对局吗？登录云存档时，空白进度也会同步到云端。此操作无法撤销。")) return;
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem(BACKUP_KEY);
    save = defaultSave();
    state = createEmptyState();
    writeSave();
    showToast("存档已重置");
    showIntro();
    render();
  });
  window.addEventListener("online", updateConnectionState);
  window.addEventListener("offline", updateConnectionState);
  document.addEventListener("visibilitychange", () => { if (document.hidden) writeSave(); });
  window.addEventListener("pagehide", writeSave);

  setupPwa();
  updateConnectionState();
  render();
  if (window.IPCloud) {
    window.IPCloud.init({
      getSave: currentSaveCopy,
      replaceSave: replaceSaveFromCloud,
      setCloudState,
      notify: showToast,
    });
  }
  const cloudMessage = sessionStorage.getItem("infinite-protocol-cloud-message");
  if (cloudMessage) {
    sessionStorage.removeItem("infinite-protocol-cloud-message");
    showToast(cloudMessage);
  }
  if (save.lastSavedAt) updateSaveStatus("已读取存档");
  if (save.runSnapshot && save.runSnapshot.active) showResumeModal();
  else showIntro();
})();
