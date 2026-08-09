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
    },
    chainCache: {
      name: "序列缓存",
      description: "连续链额外获得 +2 倍率。",
    },
    highBit: {
      name: "高位寄存器",
      description: "数字 5 及以上的芯片基础算力提高 75%。",
    },
    evenBus: {
      name: "偶数总线",
      description: "偶数芯片基础算力提高 40%。",
    },
    slimKernel: {
      name: "极简内核",
      description: "牌组不超过 10 张时，最终分数提高 35%。",
      advanced: true,
    },
    overclockCore: {
      name: "量子超频器",
      description: "超频加成从 ×1.5 提高到 ×1.9。",
      advanced: true,
    },
    fullFrame: {
      name: "满载帧",
      description: "一次打出 5 张芯片时，最终分数提高 25%。",
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

  function longestConsecutive(values) {
    if (!values.length) return [];
    let best = [];
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
      const candidates = combinations(values, size);
      for (const candidate of candidates) {
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
    const deckSize = options.deckSize || 99;
    const baseBoost = options.baseBoost || 0;
    const counts = new Map();
    cards.forEach((card) => counts.set(card.value, (counts.get(card.value) || 0) + 1));

    let base = cards.reduce((sum, card) => {
      let power = cardPower(card);
      if (modules.has("highBit") && card.value >= 5) power *= 1.75;
      if (modules.has("evenBus") && card.value % 2 === 0) power *= 1.4;
      return sum + power;
    }, 0);
    base *= 1 + baseBoost * 0.05;

    let multiplier = 1;
    const protocols = [];
    const categories = new Set();
    const syncFactor = modules.has("syncAmplifier") ? 1.5 : 1;

    for (const [value, count] of counts.entries()) {
      if (count === 2) {
        const bonus = 1 * syncFactor;
        multiplier += bonus;
        categories.add("sync");
        protocols.push({ key: "sync", name: `同步 · ${value}`, bonus: `+${formatNumber(bonus)} 倍率`, color: PROTOCOLS.sync.color });
      } else if (count >= 3) {
        const bonus = 3 * syncFactor;
        multiplier += bonus;
        categories.add("sync");
        protocols.push({ key: "triple", name: `三重同步 · ${value}`, bonus: `+${formatNumber(bonus)} 倍率`, color: PROTOCOLS.triple.color });
      }
    }

    const uniqueValues = [...counts.keys()].sort((a, b) => a - b);
    const consecutive = longestConsecutive(uniqueValues);
    if (consecutive.length >= 3) {
      const table = { 3: 2, 4: 4, 5: 7 };
      const length = Math.min(consecutive.length, 5);
      const bonus = table[length] + (modules.has("chainCache") ? 2 : 0);
      multiplier += bonus;
      categories.add("sequence");
      protocols.push({ key: "sequence", name: `连续链 · ${consecutive.join("-")}`, bonus: `+${formatNumber(bonus)} 倍率`, color: PROTOCOLS.sequence.color });
      if (consecutive.length >= 5 && cards.length === 5) {
        multiplier += 3;
        protocols.push({ key: "fullSequence", name: "完整序列", bonus: "+3 倍率", color: PROTOCOLS.fullSequence.color });
      }
    }

    if (unlocks.arithmetic) {
      const arithmetic = longestArithmetic(uniqueValues);
      if (arithmetic.length >= 3) {
        const table = { 3: 2.5, 4: 5, 5: 8 };
        const bonus = table[Math.min(arithmetic.length, 5)];
        multiplier += bonus;
        categories.add("arithmetic");
        protocols.push({ key: "arithmetic", name: `等距链 · ${arithmetic.join("-")}`, bonus: `+${formatNumber(bonus)} 倍率`, color: PROTOCOLS.arithmetic.color });
      }
    }

    if (unlocks.doubling) {
      const doubling = longestDoubling(uniqueValues);
      if (doubling.length >= 3) {
        const bonus = doubling.length >= 4 ? 8 : 4;
        multiplier += bonus;
        categories.add("doubling");
        protocols.push({ key: "doubling", name: `倍增链 · ${doubling.join("-")}`, bonus: `+${bonus} 倍率`, color: PROTOCOLS.doubling.color });
      }
    }

    const overclock = categories.size >= 2;
    let finalFactor = 1;
    if (overclock) finalFactor *= modules.has("overclockCore") ? 1.9 : 1.5;
    if (modules.has("slimKernel") && deckSize <= 10) finalFactor *= 1.35;
    if (modules.has("fullFrame") && cards.length === 5) finalFactor *= 1.25;
    const score = cards.length ? Math.max(1, Math.round(base * multiplier * finalFactor)) : 0;

    return {
      base: Math.round(base * 10) / 10,
      multiplier: Math.round(multiplier * 10) / 10,
      finalFactor: Math.round(finalFactor * 100) / 100,
      score,
      protocols,
      overclock,
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

  function formatNumber(value) {
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(1).replace(/\.0$/, "");
  }

  return {
    MODULES,
    PROTOCOLS,
    analyzeHand,
    cardPower,
    combinations,
    createCard,
    findFusionGroups,
    formatNumber,
    longestArithmetic,
    longestConsecutive,
    longestDoubling,
    shuffle,
    sourceReward,
    stageTarget,
  };
});
