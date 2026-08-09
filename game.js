(function () {
  "use strict";

  const Core = window.GameCore;
  const SAVE_KEY = "infinite-protocol-save-v1";
  const HAND_SIZE = 6;
  const MAX_SELECTED = 5;

  const elements = {
    sourceCode: document.querySelector("#source-code"),
    stageValue: document.querySelector("#stage-value"),
    scoreLabel: document.querySelector("#score-label"),
    scoreProgress: document.querySelector("#score-progress"),
    runData: document.querySelector("#run-data"),
    previewPanel: document.querySelector("#preview-panel"),
    previewScore: document.querySelector("#preview-score"),
    scoreFormula: document.querySelector("#score-formula"),
    protocolList: document.querySelector("#protocol-list"),
    playsLeft: document.querySelector("#plays-left"),
    rerollsLeft: document.querySelector("#rerolls-left"),
    hand: document.querySelector("#hand"),
    selectionHelp: document.querySelector("#selection-help"),
    rerollButton: document.querySelector("#reroll-button"),
    playButton: document.querySelector("#play-button"),
    deckSize: document.querySelector("#deck-size"),
    moduleCount: document.querySelector("#module-count"),
    moduleButton: document.querySelector("#module-button"),
    rebirthButton: document.querySelector("#rebirth-button"),
    eventMessage: document.querySelector("#event-message"),
    helpButton: document.querySelector("#help-button"),
    resetButton: document.querySelector("#reset-button"),
    modalBackdrop: document.querySelector("#modal-backdrop"),
    modal: document.querySelector("#modal"),
    toast: document.querySelector("#toast"),
  };

  const defaultSave = () => ({
    sourceCode: 0,
    totalRebirths: 0,
    bestStage: 0,
    upgrades: {
      arithmetic: false,
      doubling: false,
      advancedModules: false,
      baseBoost: 0,
      extraReroll: false,
    },
  });

  let save = loadSave();
  let cardSerial = 0;
  let toastTimer = null;
  let state = createEmptyState();

  function createEmptyState() {
    return {
      active: false,
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
      rewardChosen: false,
      lastRewardText: "",
    };
  }

  function loadSave() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!parsed) return defaultSave();
      const base = defaultSave();
      return {
        ...base,
        ...parsed,
        upgrades: { ...base.upgrades, ...(parsed.upgrades || {}) },
      };
    } catch (error) {
      return defaultSave();
    }
  }

  function writeSave() {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  }

  function nextCardId() {
    cardSerial += 1;
    return `c-${Date.now()}-${cardSerial}`;
  }

  function newCard(value, level = 1) {
    return Core.createCard(value, level, nextCardId());
  }

  function startRun() {
    state = createEmptyState();
    state.active = true;
    for (let value = 1; value <= 6; value += 1) {
      state.deck.push(newCard(value), newCard(value));
    }
    setupStage();
    hideModal();
    setMessage("协议已启动。选择芯片，寻找可以叠加的数字关系。", "normal");
    render();
  }

  function setupStage() {
    state.target = Core.stageTarget(state.stage);
    state.stageScore = 0;
    state.playsLeft = 3;
    state.rerollsLeft = 2 + (save.upgrades.extraReroll ? 1 : 0);
    state.selected.clear();
    state.drawPile = Core.shuffle(state.deck);
    state.discardPile = [];
    state.hand = [];
    drawToHand();
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

  function currentAnalysis() {
    return Core.analyzeHand(selectedCards(), {
      unlocks: save.upgrades,
      modules: state.modules,
      deckSize: state.deck.length,
      baseBoost: save.upgrades.baseBoost,
    });
  }

  function toggleCard(cardId) {
    if (!state.active) return;
    if (state.selected.has(cardId)) state.selected.delete(cardId);
    else if (state.selected.size < MAX_SELECTED) state.selected.add(cardId);
    else showToast("一次最多执行 5 张芯片");
    render();
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
    if (!state.active || !state.selected.size || state.playsLeft <= 0) return;
    const analysis = currentAnalysis();
    state.stageScore += analysis.score;
    state.playsLeft -= 1;
    const protocolText = analysis.protocols.length
      ? analysis.protocols.map((protocol) => protocol.name).join(" + ")
      : "基础运算";
    setMessage(`${protocolText}，输出 ${analysis.score} 算力${analysis.overclock ? "，超频成功！" : "。"}`);
    consumeSelected();

    if (state.stageScore >= state.target) {
      window.setTimeout(stageCleared, 260);
    } else if (state.playsLeft <= 0) {
      window.setTimeout(() => finishRun(false), 350);
    }
    render();
  }

  function rerollSelected() {
    if (!state.active || !state.selected.size || state.rerollsLeft <= 0) return;
    const count = state.selected.size;
    state.rerollsLeft -= 1;
    consumeSelected();
    setMessage(`已重排 ${count} 张芯片。`);
    render();
  }

  function stageCleared() {
    if (!state.active) return;
    const reward = Core.sourceReward(state.stage);
    state.runData += reward;
    save.bestStage = Math.max(save.bestStage, state.stage);
    writeSave();
    setMessage(`层级 ${state.stage} 已突破，缓存获得 ${reward} 段源代码。`);
    showRewardModal(reward);
    render();
  }

  function buildRewards() {
    const choices = [];
    const moduleKeys = Object.keys(Core.MODULES).filter((key) => {
      const module = Core.MODULES[key];
      return !state.modules.includes(key) && (!module.advanced || save.upgrades.advancedModules);
    });
    if (moduleKeys.length) {
      const key = Core.shuffle(moduleKeys)[0];
      choices.push({
        type: "module",
        key,
        title: Core.MODULES[key].name,
        description: Core.MODULES[key].description,
      });
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
        description: `两张 MK-${roman(group[0].level)} 合成为一张 MK-${roman(group[0].level + 1)}；单卡更强，但失去一次同步机会。`,
      });
    } else {
      const secondValue = 1 + Math.floor(Math.random() * 9);
      choices.push({
        type: "chip",
        value: secondValue,
        title: `复制 ${secondValue} 号芯片`,
        description: "加入一张芯片，为同步与后续融合准备材料。",
      });
    }

    while (choices.length < 3) {
      const value = 1 + Math.floor(Math.random() * 9);
      choices.push({ type: "chip", value, title: `写入 ${value} 号芯片`, description: "将一张新芯片加入牌组。" });
    }
    return Core.shuffle(choices).slice(0, 3);
  }

  function showRewardModal(sourceAmount) {
    const rewards = buildRewards();
    state.rewardChosen = false;
    state.lastRewardText = "";
    const rewardHtml = rewards.map((reward, index) => `
      <button class="reward-card" data-reward-index="${index}">
        <span class="reward-type">${reward.type === "module" ? "PROTOCOL MODULE" : reward.type === "fusion" ? "CHIP FUSION" : "NEW CHIP"}</span>
        <b>${escapeHtml(reward.title)}</b>
        <span>${escapeHtml(reward.description)}</span>
      </button>
    `).join("");
    showModal(`
      <p class="eyebrow">LAYER CLEARED</p>
      <h2 id="modal-title">突破完成</h2>
      <p>本层已有 <b style="color:var(--cyan)">+${sourceAmount}</b> 段源代码写入运行缓存。选择一项强化。</p>
      <div class="reward-grid" id="reward-grid">${rewardHtml}</div>
      <div id="reward-result"></div>
    `);
    elements.modal.querySelectorAll("[data-reward-index]").forEach((button) => {
      button.addEventListener("click", () => chooseReward(rewards[Number(button.dataset.rewardIndex)]));
    });
  }

  function chooseReward(reward) {
    if (state.rewardChosen) return;
    state.rewardChosen = true;
    if (reward.type === "module") {
      state.modules.push(reward.key);
      state.lastRewardText = `模块“${reward.title}”已安装。`;
    } else if (reward.type === "chip") {
      state.deck.push(newCard(reward.value));
      state.lastRewardText = `${reward.value} 号芯片已写入牌组。`;
    } else if (reward.type === "fusion") {
      const picked = state.deck.filter((card) => reward.cardIds.includes(card.id));
      if (picked.length === 2) {
        state.deck = state.deck.filter((card) => !reward.cardIds.includes(card.id));
        state.deck.push(newCard(reward.value, reward.level + 1));
        state.lastRewardText = `${reward.value} 号 MK-${roman(reward.level + 1)} 融合完成。`;
      }
    }
    elements.modal.querySelectorAll(".reward-card").forEach((button) => { button.disabled = true; });
    const result = elements.modal.querySelector("#reward-result");
    result.innerHTML = `
      <p class="lead">${escapeHtml(state.lastRewardText)}</p>
      <div class="modal-actions">
        <button class="button primary" id="continue-button">进入层级 ${String(state.stage + 1).padStart(2, "0")}</button>
        ${state.stage >= 3 ? '<button class="button secondary" id="reward-rebirth-button">携带缓存主动转生</button>' : ""}
      </div>
    `;
    result.querySelector("#continue-button").addEventListener("click", continueRun);
    const rebirthButton = result.querySelector("#reward-rebirth-button");
    if (rebirthButton) rebirthButton.addEventListener("click", () => finishRun(true));
    render();
  }

  function continueRun() {
    state.stage += 1;
    setupStage();
    hideModal();
    setMessage(`已进入层级 ${state.stage}。目标算力提升至 ${state.target}。`);
    render();
  }

  function finishRun(voluntary) {
    if (!state.active) return;
    state.active = false;
    const gained = state.runData;
    save.sourceCode += gained;
    save.totalRebirths += 1;
    save.bestStage = Math.max(save.bestStage, state.stage - (voluntary ? 0 : 1));
    writeSave();
    showUpgradeModal(voluntary, gained);
    render();
  }

  function showUpgradeModal(voluntary, gained) {
    showModal(`
      <p class="eyebrow">${voluntary ? "VOLUNTARY REBIRTH" : "SYSTEM COLLAPSE"}</p>
      <h2 id="modal-title">${voluntary ? "主动转生完成" : "本轮运算结束"}</h2>
      <p>${voluntary ? "当前系统已安全归档，并重置为初始状态。" : "目标算力未能达成；当前层级未结算，但此前缓存的数据已安全归档。"}</p>
      <div class="stat-summary">
        <div><span>获得源代码</span><b>+${gained}</b></div>
        <div><span>抵达层级</span><b>${state.stage}</b></div>
        <div><span>历史最高</span><b>${save.bestStage}</b></div>
      </div>
      <h3>永久升级</h3>
      <div class="upgrade-grid" id="upgrade-grid"></div>
      <div class="modal-actions">
        <button class="button primary" id="new-run-button">启动新一轮协议</button>
      </div>
    `);
    renderUpgradeGrid();
    elements.modal.querySelector("#new-run-button").addEventListener("click", startRun);
  }

  function upgradeDefinitions() {
    const boostCost = 4 + save.upgrades.baseBoost * 4;
    return [
      {
        key: "arithmetic", name: "解锁：等距链", cost: 3,
        description: "识别 2-5-8 等间距数字，开放新的叠加路线。",
        bought: save.upgrades.arithmetic,
      },
      {
        key: "doubling", name: "解锁：倍增链", cost: 6,
        description: "识别 1-2-4-8 等翻倍序列，难度高、倍率也高。",
        bought: save.upgrades.doubling,
      },
      {
        key: "advancedModules", name: "高级模块库", cost: 5,
        description: "将极简内核与量子超频器加入局内奖励池。",
        bought: save.upgrades.advancedModules,
      },
      {
        key: "baseBoost", name: `基础校准 LV.${save.upgrades.baseBoost}`, cost: boostCost,
        description: "所有芯片基础算力永久提高 5%，可以重复升级。",
        bought: false,
      },
      {
        key: "extraReroll", name: "备用缓存区", cost: 8,
        description: "每层的重排次数永久增加 1 次。",
        bought: save.upgrades.extraReroll,
      },
    ];
  }

  function renderUpgradeGrid() {
    const grid = elements.modal.querySelector("#upgrade-grid");
    if (!grid) return;
    grid.innerHTML = upgradeDefinitions().map((upgrade) => {
      const affordable = save.sourceCode >= upgrade.cost;
      return `
        <button class="upgrade-card" data-upgrade="${upgrade.key}" ${upgrade.bought || !affordable ? "disabled" : ""}>
          <b>${escapeHtml(upgrade.name)} · ${upgrade.bought ? "已解锁" : `${upgrade.cost} 源代码`}</b>
          <span>${escapeHtml(upgrade.description)}</span>
        </button>
      `;
    }).join("");
    grid.querySelectorAll("[data-upgrade]").forEach((button) => {
      button.addEventListener("click", () => buyUpgrade(button.dataset.upgrade));
    });
  }

  function buyUpgrade(key) {
    const upgrade = upgradeDefinitions().find((item) => item.key === key);
    if (!upgrade || upgrade.bought || save.sourceCode < upgrade.cost) return;
    save.sourceCode -= upgrade.cost;
    if (key === "baseBoost") save.upgrades.baseBoost += 1;
    else save.upgrades[key] = true;
    writeSave();
    showToast(`${upgrade.name} 已写入永久系统`);
    renderUpgradeGrid();
    render();
  }

  function requestRebirth() {
    if (!state.active || state.stage < 3) return;
    const duringStage = state.stageScore > 0;
    showModal(`
      <p class="eyebrow">REBIRTH REQUEST</p>
      <h2 id="modal-title">确认主动转生？</h2>
      <p>本轮缓存的 <b style="color:var(--cyan)">${state.runData}</b> 段源代码将永久保存。${duringStage ? "当前层尚未完成，已经产生的层内算力会被舍弃。" : ""}</p>
      <div class="modal-actions">
        <button class="button danger-button" id="confirm-rebirth">确认转生</button>
        <button class="button secondary" id="cancel-modal">继续挑战</button>
      </div>
    `);
    elements.modal.querySelector("#confirm-rebirth").addEventListener("click", () => finishRun(true));
    elements.modal.querySelector("#cancel-modal").addEventListener("click", hideModal);
  }

  function showModules() {
    const content = state.modules.length
      ? state.modules.map((key) => `<div class="module-item"><b>${escapeHtml(Core.MODULES[key].name)}</b><span>${escapeHtml(Core.MODULES[key].description)}</span></div>`).join("")
      : '<p>本轮尚未安装任何协议模块。突破层级后，可以在三选一奖励中获得模块。</p>';
    showModal(`
      <p class="eyebrow">INSTALLED MODULES</p>
      <h2 id="modal-title">协议模块</h2>
      <div class="module-list">${content}</div>
      <div class="modal-actions"><button class="button secondary" id="close-modal">返回</button></div>
    `);
    elements.modal.querySelector("#close-modal").addEventListener("click", hideModal);
  }

  function showHelp() {
    const lockedHints = [
      save.upgrades.arithmetic ? "等距链：三个以上数字间距相同，例如 2-5-8。" : "等距链：首次转生后可用源代码解锁。",
      save.upgrades.doubling ? "倍增链：数字依次翻倍，例如 1-2-4。" : "倍增链：通过永久升级解锁。",
    ];
    showModal(`
      <p class="eyebrow">PROTOCOL MANUAL</p>
      <h2 id="modal-title">规则说明</h2>
      <p class="lead">每层有 3 次运算机会。选择最多 5 张芯片，累计达到目标算力即可突破。</p>
      <ul class="rule-list">
        <li><b>同步：</b>两张相同数字；三张相同时升级为三重同步。</li>
        <li><b>连续链：</b>至少三个连续数字，例如 2-3-4。</li>
        <li><b>${lockedHints[0]}</b></li>
        <li><b>${lockedHints[1]}</b></li>
        <li><b>超频：</b>一手同时触发至少两类协议，最终分数 ×1.5。</li>
        <li><b>融合：</b>两张同号同级芯片合为一张高级芯片。高级芯片基础算力更高，但合成后可能更难触发同步。</li>
      </ul>
      <p>达到层级 3 后可主动转生。未完成层级产生的算力不会结算，此前获得的运行缓存则会转换成永久源代码。</p>
      <div class="modal-actions"><button class="button primary" id="close-modal">明白了</button></div>
    `);
    elements.modal.querySelector("#close-modal").addEventListener("click", hideModal);
  }

  function showIntro() {
    showModal(`
      <p class="eyebrow">BOOT SEQUENCE</p>
      <h2 id="modal-title">欢迎接入《无限协议》</h2>
      <p class="lead">组合数字芯片、叠加计分协议，让系统在一次次转生中突破算力极限。</p>
      <ul class="rule-list">
        <li>点击选择最多 5 张芯片，界面会实时预览分数。</li>
        <li>相同数字会触发“同步”，连续数字会触发“连续链”。</li>
        <li>一手同时满足两类协议会进入“超频”，获得额外倍率。</li>
        <li>第一轮结束后，用源代码解锁等距链、倍增链等新玩法。</li>
      </ul>
      <div class="modal-actions"><button class="button primary" id="start-button">启动第一轮协议</button></div>
    `);
    elements.modal.querySelector("#start-button").addEventListener("click", startRun);
  }

  function showModal(html) {
    elements.modal.innerHTML = html;
    elements.modalBackdrop.classList.add("visible");
  }

  function hideModal() {
    elements.modalBackdrop.classList.remove("visible");
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 1800);
  }

  function setMessage(message) {
    elements.eventMessage.textContent = message;
  }

  function renderHand() {
    elements.hand.innerHTML = "";
    state.hand.forEach((card) => {
      const button = document.createElement("button");
      button.className = `card${state.selected.has(card.id) ? " selected" : ""}`;
      button.type = "button";
      button.setAttribute("aria-pressed", state.selected.has(card.id) ? "true" : "false");
      button.innerHTML = `
        <span class="card-level">CHIP / MK-${roman(card.level)}</span>
        <span class="card-value">${card.value}</span>
        <span class="card-power">BASE ${Core.formatNumber(Core.cardPower(card))}</span>
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
      elements.scoreFormula.textContent = "选择芯片以预览协议";
      elements.protocolList.innerHTML = "";
      elements.previewPanel.classList.remove("overclock");
      return;
    }
    const factor = analysis.finalFactor !== 1 ? ` × ${analysis.finalFactor}` : "";
    elements.scoreFormula.textContent = `${analysis.base} 基础算力 × ${analysis.multiplier} 协议倍率${factor}`;
    elements.protocolList.innerHTML = analysis.protocols.length
      ? analysis.protocols.map((protocol) => `<span class="protocol-chip ${protocol.color}">${escapeHtml(protocol.name)} / ${protocol.bonus}</span>`).join("")
      : '<span class="protocol-chip cyan">基础运算</span>';
    if (analysis.overclock) {
      elements.protocolList.insertAdjacentHTML("beforeend", '<span class="protocol-chip violet overclock-label">OVERCLOCK</span>');
      elements.previewPanel.classList.add("overclock");
    } else elements.previewPanel.classList.remove("overclock");
  }

  function render() {
    elements.sourceCode.textContent = save.sourceCode;
    elements.stageValue.textContent = String(state.stage).padStart(2, "0");
    elements.scoreLabel.textContent = `${state.stageScore.toLocaleString("zh-CN")} / ${state.target.toLocaleString("zh-CN")}`;
    elements.scoreProgress.style.width = `${Math.min(100, (state.stageScore / state.target) * 100)}%`;
    elements.runData.textContent = state.runData;
    elements.playsLeft.textContent = state.playsLeft;
    elements.rerollsLeft.textContent = state.rerollsLeft;
    elements.deckSize.textContent = `${state.deck.length} 张`;
    elements.moduleCount.textContent = state.modules.length;
    const hasSelection = state.selected.size > 0;
    elements.playButton.disabled = !state.active || !hasSelection || state.playsLeft <= 0;
    elements.rerollButton.disabled = !state.active || !hasSelection || state.rerollsLeft <= 0;
    elements.rebirthButton.disabled = !state.active || state.stage < 3;
    elements.selectionHelp.textContent = hasSelection
      ? `已选择 ${state.selected.size} 张；点击“执行协议”提交本次运算。`
      : "点击选择最多 5 张芯片；再次点击可取消。";
    renderHand();
    renderPreview();
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
  elements.rebirthButton.addEventListener("click", requestRebirth);
  elements.helpButton.addEventListener("click", showHelp);
  elements.resetButton.addEventListener("click", () => {
    if (!window.confirm("确定清除全部源代码、永久升级和最高层级记录吗？此操作无法撤销。")) return;
    localStorage.removeItem(SAVE_KEY);
    save = defaultSave();
    showToast("存档已重置");
    startRun();
  });

  render();
  showIntro();
})();
