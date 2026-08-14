(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GameCore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const PROTOCOLS = {
    sync: { name: "同步", color: "cyan" },
    triple: { name: "三重同步", color: "violet" },
    sequence: { name: "连续链", color: "green" },
    arithmetic: { name: "等距链", color: "amber" },
    doubling: { name: "倍增链", color: "pink" },
    fullSequence: { name: "完整序列", color: "white" },
  };

  const MODULES = {
    syncAmplifier: {
      name: "镜像总线",
      description: "同步与三重同步提供的倍率提高 50%。",
      category: "协议强化",
    },
    chainCache: {
      name: "序列缓存",
      description: "连续链额外获得 +2 协议倍率。",
      category: "协议强化",
    },
    highBit: {
      name: "高位寄存器",
      description: "数字 5 及以上的芯片基础算力提高 75%。",
      category: "芯片强化",
    },
    evenBus: {
      name: "偶数总线",
      description: "偶数芯片基础算力提高 40%。",
      category: "芯片强化",
    },
    lowBit: {
      name: "低位反相器",
      description: "数字 1～3 的芯片基础算力提高 80%。",
      category: "芯片强化",
    },
    oddBus: {
      name: "奇数矩阵",
      description: "奇数芯片基础算力提高 45%。",
      category: "芯片强化",
    },
    triadEngine: {
      name: "三元运算器",
      description: "恰好打出 3 张芯片时，最终分数提高 60%。",
      category: "出牌策略",
    },
    slimKernel: {
      name: "极简内核",
      description: "牌组不超过 10 张时，最终分数提高 35%。",
      category: "牌组策略",
      advanced: true,
    },
    overclockCore: {
      name: "量子超频器",
      description: "超频加成从 ×1.5 提高到 ×1.9。",
      category: "协议强化",
      advanced: true,
    },
    fullFrame: {
      name: "满载帧",
      description: "一次打出 5 张芯片时，最终分数提高 25%。",
      category: "出牌策略",
    },
    cascadeCore: {
      name: "级联核心",
      description: "一手触发至少 3 类协议时，最终分数提高 35%。",
      category: "协议强化",
      advanced: true,
    },
    fusionLattice: {
      name: "融合晶格",
      description: "MK-II 及以上芯片的基础算力提高 30%。",
      category: "融合策略",
      advanced: true,
    },
  };

  function shuffle(items, rng = Math.random) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function createCard(value, level = 1, id = "card") {
    return { id, value, level };
  }

  function cardPower(card) {
    return card.value * Math.pow(2.5, card.level - 1);
  }

  function effectiveCardPower(card, options = {}) {
    const modules = new Set(options.modules || []);
    const fusionBoost = Math.max(0, Number(options.fusionBoost) || 0);
    let power = cardPower(card);
    const modifiers = [];

    if (card.level >= 2 && fusionBoost > 0) {
      const factor = 1 + fusionBoost * 0.08;
      power *= factor;
      modifiers.push({ key: "fusionBoost", label: `融合校准 ×${formatNumber(factor)}` });
    }
    if (modules.has("fusionLattice") && card.level >= 2) {
      power *= 1.3;
      modifiers.push({ key: "fusionLattice", label: "融合晶格 ×1.3" });
    }
    if (modules.has("highBit") && card.value >= 5) {
      power *= 1.75;
      modifiers.push({ key: "highBit", label: "高位寄存器 ×1.75" });
    }
    if (modules.has("evenBus") && card.value % 2 === 0) {
      power *= 1.4;
      modifiers.push({ key: "evenBus", label: "偶数总线 ×1.4" });
    }
    if (modules.has("lowBit") && card.value <= 3) {
      power *= 1.8;
      modifiers.push({ key: "lowBit", label: "低位反相器 ×1.8" });
    }
    if (modules.has("oddBus") && card.value % 2 === 1) {
      power *= 1.45;
      modifiers.push({ key: "oddBus", label: "奇数矩阵 ×1.45" });
    }

    return { raw: round(cardPower(card), 2), power: round(power, 2), modifiers };
  }

  function longestConsecutive(values) {
    if (!values.length) return [];
    let best = [values[0]];
    let current = [values[0]];
    for (let i = 1; i < values.length; i += 1) {
      if (values[i] === values[i - 1] + 1) current.push(values[i]);
      else current = [values[i]];
      if (current.length > best.length) best = [...current];
    }
    return best.length >= 3 ? best : [];
  }

  function combinations(values, size) {
    const result = [];
    function visit(start, picked) {
      if (picked.length === size) {
        result.push([...picked]);
        return;
      }
      for (let i = start; i <= values.length - (size - picked.length); i += 1) {
        picked.push(values[i]);
        visit(i + 1, picked);
        picked.pop();
      }
    }
    visit(0, []);
    return result;
  }

  function longestArithmetic(values) {
    for (let size = values.length; size >= 3; size -= 1) {
      for (const candidate of combinations(values, size)) {
        const difference = candidate[1] - candidate[0];
        if (difference < 2) continue;
        if (candidate.every((value, index) => index === 0 || value - candidate[index - 1] === difference)) {
          return candidate;
        }
      }
    }
    return [];
  }

  function longestDoubling(values) {
    let best = [];
    for (const start of values) {
      const chain = [start];
      let next = start * 2;
      while (values.includes(next)) {
        chain.push(next);
        next *= 2;
      }
      if (chain.length > best.length) best = chain;
    }
    return best.length >= 3 ? best : [];
  }

  function analyzeHand(cards, options = {}) {
    const unlocks = options.unlocks || {};
    const modules = new Set(options.modules || []);
    const deckSize = Number.isFinite(options.deckSize) ? options.deckSize : 99;
    const baseBoost = Math.max(0, Number(options.baseBoost) || 0);
    const fusionBoost = Math.max(0, Number(options.fusionBoost) || 0);
    const counts = new Map();
    const moduleTriggers = [];
    const activeModuleKeys = new Set();
    cards.forEach((card) => counts.set(card.value, (counts.get(card.value) || 0) + 1));

    const cardDetails = cards.map((card) => effectiveCardPower(card, {
      modules: [...modules],
      fusionBoost,
    }));
    let base = cardDetails.reduce((sum, detail) => sum + detail.power, 0);
    const globalBaseFactor = 1 + baseBoost * 0.05;
    base = round(base * globalBaseFactor, 2);

    for (const detail of cardDetails) {
      detail.modifiers.forEach((modifier) => activeModuleKeys.add(modifier.key));
    }
    ["highBit", "evenBus", "lowBit", "oddBus", "fusionLattice"].forEach((key) => {
      if (activeModuleKeys.has(key)) moduleTriggers.push({ key, name: MODULES[key].name, detail: "已计入芯片算力" });
    });

    let multiplier = 1;
    const protocols = [];
    const categories = new Set();
    const hasSync = [...counts.values()].some((count) => count >= 2);
    const syncFactor = modules.has("syncAmplifier") && hasSync ? 1.5 : 1;
    if (modules.has("syncAmplifier") && hasSync) {
      activeModuleKeys.add("syncAmplifier");
      moduleTriggers.push({ key: "syncAmplifier", name: MODULES.syncAmplifier.name, detail: "同步倍率 ×1.5" });
    }

    for (const [value, count] of counts.entries()) {
      if (count === 2) {
        const bonus = round(1 * syncFactor, 2);
        multiplier += bonus;
        categories.add("sync");
        protocols.push({ key: "sync", name: `同步 · ${value}`, bonus: `+${formatNumber(bonus)} 倍率`, value: bonus, color: PROTOCOLS.sync.color });
      } else if (count >= 3) {
        const bonus = round(3 * syncFactor, 2);
        multiplier += bonus;
        categories.add("sync");
        protocols.push({ key: "triple", name: `三重同步 · ${value}`, bonus: `+${formatNumber(bonus)} 倍率`, value: bonus, color: PROTOCOLS.triple.color });
      }
    }

    const uniqueValues = [...counts.keys()].sort((a, b) => a - b);
    const consecutive = longestConsecutive(uniqueValues);
    if (consecutive.length >= 3) {
      const table = { 3: 2, 4: 4, 5: 7 };
      const length = Math.min(consecutive.length, 5);
      const cacheBonus = modules.has("chainCache") ? 2 : 0;
      const bonus = table[length] + cacheBonus;
      multiplier += bonus;
      categories.add("sequence");
      protocols.push({ key: "sequence", name: `连续链 · ${consecutive.join("-")}`, bonus: `+${formatNumber(bonus)} 倍率`, value: bonus, color: PROTOCOLS.sequence.color });
      if (cacheBonus) {
        activeModuleKeys.add("chainCache");
        moduleTriggers.push({ key: "chainCache", name: MODULES.chainCache.name, detail: "连续链 +2 倍率" });
      }
      if (consecutive.length >= 5 && cards.length === 5) {
        multiplier += 3;
        protocols.push({ key: "fullSequence", name: "完整序列", bonus: "+3 倍率", value: 3, color: PROTOCOLS.fullSequence.color });
      }
    }

    if (unlocks.arithmetic) {
      const arithmetic = longestArithmetic(uniqueValues);
      if (arithmetic.length >= 3) {
        const table = { 3: 2.5, 4: 5, 5: 8 };
        const bonus = table[Math.min(arithmetic.length, 5)];
        multiplier += bonus;
        categories.add("arithmetic");
        protocols.push({ key: "arithmetic", name: `等距链 · ${arithmetic.join("-")}`, bonus: `+${formatNumber(bonus)} 倍率`, value: bonus, color: PROTOCOLS.arithmetic.color });
      }
    }

    if (unlocks.doubling) {
      const doubling = longestDoubling(uniqueValues);
      if (doubling.length >= 3) {
        const bonus = doubling.length >= 4 ? 8 : 4;
        multiplier += bonus;
        categories.add("doubling");
        protocols.push({ key: "doubling", name: `倍增链 · ${doubling.join("-")}`, bonus: `+${bonus} 倍率`, value: bonus, color: PROTOCOLS.doubling.color });
      }
    }

    multiplier = round(multiplier, 2);
    const overclock = categories.size >= 2;
    const finalFactors = [];
    if (overclock) {
      const factor = modules.has("overclockCore") ? 1.9 : 1.5;
      finalFactors.push({ key: "overclock", name: "超频", value: factor });
      if (modules.has("overclockCore")) {
        activeModuleKeys.add("overclockCore");
        moduleTriggers.push({ key: "overclockCore", name: MODULES.overclockCore.name, detail: "超频提高至 ×1.9" });
      }
    }
    if (modules.has("slimKernel") && deckSize <= 10) {
      finalFactors.push({ key: "slimKernel", name: MODULES.slimKernel.name, value: 1.35 });
      activeModuleKeys.add("slimKernel");
      moduleTriggers.push({ key: "slimKernel", name: MODULES.slimKernel.name, detail: `牌组 ${deckSize} 张，×1.35` });
    }
    if (modules.has("fullFrame") && cards.length === 5) {
      finalFactors.push({ key: "fullFrame", name: MODULES.fullFrame.name, value: 1.25 });
      activeModuleKeys.add("fullFrame");
      moduleTriggers.push({ key: "fullFrame", name: MODULES.fullFrame.name, detail: "满载 5 张，×1.25" });
    }
    if (modules.has("triadEngine") && cards.length === 3) {
      finalFactors.push({ key: "triadEngine", name: MODULES.triadEngine.name, value: 1.6 });
      activeModuleKeys.add("triadEngine");
      moduleTriggers.push({ key: "triadEngine", name: MODULES.triadEngine.name, detail: "三张运算，×1.6" });
    }
    if (modules.has("cascadeCore") && categories.size >= 3) {
      finalFactors.push({ key: "cascadeCore", name: MODULES.cascadeCore.name, value: 1.35 });
      activeModuleKeys.add("cascadeCore");
      moduleTriggers.push({ key: "cascadeCore", name: MODULES.cascadeCore.name, detail: `${categories.size} 类协议，×1.35` });
    }

    const finalFactor = round(finalFactors.reduce((value, factor) => value * factor.value, 1), 5);
    const score = cards.length ? Math.max(1, Math.round(base * multiplier * finalFactor)) : 0;

    return {
      base,
      multiplier,
      finalFactor,
      finalFactors,
      score,
      protocols,
      overclock,
      categories: [...categories],
      cardDetails,
      moduleTriggers,
      activeModuleKeys: [...activeModuleKeys],
      formula: {
        base,
        multiplier,
        factors: finalFactors.map((factor) => ({ ...factor })),
      },
    };
  }

  function findFusionGroups(deck) {
    const groups = new Map();
    deck.forEach((card) => {
      const key = `${card.value}:${card.level}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(card);
    });
    return [...groups.values()].filter((group) => group.length >= 2 && group[0].level < 5);
  }

  function stageTarget(stage) {
    return Math.round((55 * Math.pow(1.65, stage - 1)) / 5) * 5;
  }

  function sourceReward(stage) {
    return Math.max(1, Math.floor((stage + 1) / 2));
  }

  function round(value, digits = 0) {
    const factor = Math.pow(10, digits);
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function formatNumber(value, maxDigits = 2) {
    return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: maxDigits });
  }

  return {
    MODULES,
    PROTOCOLS,
    analyzeHand,
    cardPower,
    combinations,
    createCard,
    effectiveCardPower,
    findFusionGroups,
    formatNumber,
    longestArithmetic,
    longestConsecutive,
    longestDoubling,
    round,
    shuffle,
    sourceReward,
    stageTarget,
  };
});
