(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GameProgression = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const REGIONS = Object.freeze({
    relay: Object.freeze({ key: "relay", name: "近地中继站", durationMs: 15 * 60 * 1000, research: 9, risk: "低风险", description: "短程巡检，适合频繁上线时派遣。" }),
    graveyard: Object.freeze({ key: "graveyard", name: "静默舰骸带", durationMs: 2 * 60 * 60 * 1000, research: 42, risk: "中风险", description: "回收失联舰队残留的数据核心。" }),
    nebula: Object.freeze({ key: "nebula", name: "赫利俄斯星云", durationMs: 8 * 60 * 60 * 1000, research: 150, risk: "高风险", description: "长时间深入未知信号源，收益最高。" }),
  });

  const TECHS = Object.freeze({
    autonomousDrones: Object.freeze({ key: "autonomousDrones", name: "自治采集阵列", max: 20, baseCost: 18, stepCost: 16, description: "提高离线研究效率；10级后单级效果递减。", milestones: ["高效采集", "自治调度", "深夜协议", "完全自治"] }),
    chronoBuffer: Object.freeze({ key: "chronoBuffer", name: "时序缓存扩容", max: 20, baseCost: 24, stepCost: 22, description: "将完整离线收益延长至24小时，之后逐步回收超时数据。", milestones: ["18小时缓存", "24小时缓存", "溢出回收35%", "溢出回收60%"] }),
    deepSensors: Object.freeze({ key: "deepSensors", name: "深空传感矩阵", max: 20, baseCost: 28, stepCost: 24, description: "提高远征收益；每5级缩短一次远征时间。", milestones: ["轨道校准", "异常测绘", "航道折叠", "先驱阵列"] }),
    protocolMemory: Object.freeze({ key: "protocolMemory", name: "协议记忆体", max: 20, baseCost: 36, stepCost: 32, description: "提高局内最终算力，并在里程碑强化每日行动奖励。", milestones: ["协议快照", "并行记忆", "长期归档", "矩阵完成"] }),
  });

  const FRONTIER = Object.freeze({
    offline: Object.freeze({ key: "offline", name: "前沿·自治演算", baseCost: 1200, growth: 1.22, description: "近似无限研究，按平方根缓慢提高离线效率。" }),
    expedition: Object.freeze({ key: "expedition", name: "前沿·深空测绘", baseCost: 1450, growth: 1.23, description: "近似无限研究，按平方根缓慢提高远征收益。" }),
    daily: Object.freeze({ key: "daily", name: "前沿·行动分析", baseCost: 1600, growth: 1.24, description: "近似无限研究，按平方根缓慢提高每日奖励。" }),
  });

  const EVENTS = Object.freeze({
    echo: Object.freeze({
      key: "echo", title: "重复的求救信号", text: "信号每 17 秒重复一次，内容却来自尚未抵达的坐标。",
      choices: [
        { key: "trace", label: "追踪时间回声", detail: "研究数据 ×1.35", researchFactor: 1.35, source: 0 },
        { key: "archive", label: "封存原始波形", detail: "稳定获得 1 段源代码", researchFactor: 0.9, source: 1 },
      ],
    }),
    archive: Object.freeze({
      key: "archive", title: "无主档案库", text: "一座古老节点仍在广播身份认证，但维护者已经消失。",
      choices: [
        { key: "decode", label: "破解索引", detail: "研究数据 ×1.2，并获得 1 段源代码", researchFactor: 1.2, source: 1 },
        { key: "mirror", label: "完整镜像", detail: "研究数据 ×1.45", researchFactor: 1.45, source: 0 },
      ],
    }),
    swarm: Object.freeze({
      key: "swarm", title: "休眠维护蜂群", text: "微型机械群将远征艇识别为等待维修的旧式设备。",
      choices: [
        { key: "wake", label: "唤醒蜂群协作", detail: "研究数据 ×1.3", researchFactor: 1.3, source: 0 },
        { key: "salvage", label: "拆解控制核心", detail: "获得 2 段源代码", researchFactor: 0.75, source: 2 },
      ],
    }),
    lens: Object.freeze({
      key: "lens", title: "引力透镜异常", text: "传感器同时捕获了同一艘远征艇的三个位置。",
      choices: [
        { key: "observe", label: "保持轨道观测", detail: "研究数据 ×1.25", researchFactor: 1.25, source: 0 },
        { key: "cross", label: "穿越异常边界", detail: "研究数据 ×1.55，但不获取源代码", researchFactor: 1.55, source: 0 },
      ],
    }),
  });

  const DAILY_TASKS = Object.freeze({
    play: Object.freeze({ key: "play", name: "执行协议", description: "完成 3 次芯片运算", target: 3, reward: 4 }),
    protocol: Object.freeze({ key: "protocol", name: "协议编译", description: "累计触发 3 类数字协议", target: 3, reward: 5 }),
    overclock: Object.freeze({ key: "overclock", name: "超频测试", description: "成功触发 1 次超频", target: 1, reward: 6 }),
    expedition: Object.freeze({ key: "expedition", name: "深空回收", description: "完成并结算 1 次远征", target: 1, reward: 7 }),
    research: Object.freeze({ key: "research", name: "数据采集", description: "获得 20 研究数据", target: 20, reward: 5 }),
  });

  const ACHIEVEMENTS = Object.freeze({
    firstSignal: Object.freeze({ key: "firstSignal", name: "第一束回波", description: "完成首次深空远征", rewardResearch: 12, rewardSource: 0 }),
    protocolArchitect: Object.freeze({ key: "protocolArchitect", name: "协议架构师", description: "累计触发 30 类数字协议", rewardResearch: 20, rewardSource: 1 }),
    stableOverclock: Object.freeze({ key: "stableOverclock", name: "稳定超频", description: "累计触发 10 次超频", rewardResearch: 24, rewardSource: 1 }),
    layerTen: Object.freeze({ key: "layerTen", name: "第十层边界", description: "单轮抵达第 10 层", rewardResearch: 30, rewardSource: 2 }),
    veteranCore: Object.freeze({ key: "veteranCore", name: "迭代老兵", description: "累计完成 10 次核心迭代", rewardResearch: 35, rewardSource: 2 }),
    dataOcean: Object.freeze({ key: "dataOcean", name: "数据之海", description: "累计获得 500 研究数据", rewardResearch: 50, rewardSource: 2 }),
  });

  function clamp(value, min, max, fallback = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(number)));
  }

  function defaultMeta(now = Date.now()) {
    const daily = createDaily(dailyKey(now));
    return {
      researchData: 0,
      technologies: { autonomousDrones: 0, chronoBuffer: 0, deepSensors: 0, protocolMemory: 0 },
      frontier: { offline: 0, expedition: 0, daily: 0 },
      expedition: null,
      pendingEvent: null,
      totalExpeditions: 0,
      discoveredEvents: [],
      discoveries: { protocols: [], modules: [], chipLevels: [1] },
      stats: { plays: 0, protocols: 0, overclocks: 0, highestScore: 0, stagesCleared: 0, researchEarned: 0, offlineResearch: 0 },
      daily,
      claimedAchievements: [],
      tutorialV04Seen: false,
      lastSeenAt: new Date(now).toISOString(),
    };
  }

  function sanitizeMeta(raw, now = Date.now()) {
    const base = defaultMeta(now);
    if (!raw || typeof raw !== "object") return base;
    const tech = raw.technologies || {};
    const technologies = {};
    Object.values(TECHS).forEach((item) => { technologies[item.key] = clamp(tech[item.key], 0, item.max); });
    const rawFrontier = raw.frontier || {};
    const frontier = {};
    Object.values(FRONTIER).forEach((item) => { frontier[item.key] = clamp(rawFrontier[item.key], 0, 999); });
    const expeditionStart = raw.expedition ? Date.parse(raw.expedition.startedAt) : NaN;
    const expeditionEnd = raw.expedition ? Date.parse(raw.expedition.endsAt) : NaN;
    const expedition = raw.expedition && REGIONS[raw.expedition.regionKey] && Number.isFinite(expeditionStart) && Number.isFinite(expeditionEnd) && expeditionEnd > expeditionStart
      ? {
        regionKey: raw.expedition.regionKey,
        startedAt: new Date(expeditionStart).toISOString(),
        endsAt: new Date(expeditionEnd).toISOString(),
        seed: clamp(raw.expedition.seed, 1, 2147483646, 1),
      }
      : null;
    const pendingEvent = raw.pendingEvent && EVENTS[raw.pendingEvent.eventKey]
      ? {
        eventKey: raw.pendingEvent.eventKey,
        regionKey: REGIONS[raw.pendingEvent.regionKey] ? raw.pendingEvent.regionKey : "relay",
        baseResearch: clamp(raw.pendingEvent.baseResearch, 1, 1e9, 1),
      }
      : null;
    const parsedLastSeen = Date.parse(raw.lastSeenAt);
    const rawDiscoveries = raw.discoveries || {};
    const rawStats = raw.stats || {};
    const date = raw.daily && typeof raw.daily.date === "string" ? raw.daily.date : dailyKey(now);
    const generatedDaily = createDaily(date);
    const rawTasks = raw.daily && Array.isArray(raw.daily.tasks) ? raw.daily.tasks : [];
    const daily = {
      date,
      tasks: generatedDaily.tasks.map((task) => {
        const stored = rawTasks.find((item) => item && item.key === task.key) || {};
        return { ...task, progress: clamp(stored.progress, 0, task.target), claimed: Boolean(stored.claimed) };
      }),
    };
    return {
      ...base,
      researchData: clamp(raw.researchData, 0, 1e15),
      technologies,
      frontier,
      expedition,
      pendingEvent,
      totalExpeditions: clamp(raw.totalExpeditions, 0, 1e9),
      discoveredEvents: Array.isArray(raw.discoveredEvents)
        ? [...new Set(raw.discoveredEvents.filter((key) => EVENTS[key]))].slice(0, Object.keys(EVENTS).length)
        : [],
      discoveries: {
        protocols: Array.isArray(rawDiscoveries.protocols) ? [...new Set(rawDiscoveries.protocols.filter((name) => typeof name === "string" && name.length < 50))].slice(0, 30) : [],
        modules: Array.isArray(rawDiscoveries.modules) ? [...new Set(rawDiscoveries.modules.filter((key) => typeof key === "string" && key.length < 50))].slice(0, 40) : [],
        chipLevels: Array.isArray(rawDiscoveries.chipLevels) ? [...new Set(rawDiscoveries.chipLevels.map((level) => clamp(level, 1, 5, 1)))].sort((a, b) => a - b) : [1],
      },
      stats: {
        plays: clamp(rawStats.plays, 0, 1e12), protocols: clamp(rawStats.protocols, 0, 1e12),
        overclocks: clamp(rawStats.overclocks, 0, 1e12), highestScore: clamp(rawStats.highestScore, 0, 1e15),
        stagesCleared: clamp(rawStats.stagesCleared, 0, 1e12), researchEarned: clamp(rawStats.researchEarned, 0, 1e15),
        offlineResearch: clamp(rawStats.offlineResearch, 0, 1e15),
      },
      daily,
      claimedAchievements: Array.isArray(raw.claimedAchievements)
        ? [...new Set(raw.claimedAchievements.filter((key) => ACHIEVEMENTS[key]))].slice(0, Object.keys(ACHIEVEMENTS).length)
        : [],
      tutorialV04Seen: Boolean(raw.tutorialV04Seen),
      lastSeenAt: Number.isFinite(parsedLastSeen) ? new Date(parsedLastSeen).toISOString() : base.lastSeenAt,
    };
  }

  function dailyKey(now = Date.now()) {
    return new Date(now).toISOString().slice(0, 10);
  }

  function createDaily(date) {
    const cleanDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? String(date) : dailyKey();
    const hash = [...cleanDate].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 17);
    const keys = Object.keys(DAILY_TASKS);
    const rotated = keys.map((_, index) => keys[(index + hash) % keys.length]);
    return { date: cleanDate, tasks: rotated.slice(0, 3).map((key) => ({ key, target: DAILY_TASKS[key].target, progress: 0, claimed: false })) };
  }

  function ensureDaily(meta, now = Date.now()) {
    const key = dailyKey(now);
    if (!meta.daily || meta.daily.date !== key) meta.daily = createDaily(key);
    return meta.daily;
  }

  function progressDaily(meta, key, amount = 1, now = Date.now()) {
    const daily = ensureDaily(meta, now);
    const task = daily.tasks.find((item) => item.key === key);
    if (!task || task.claimed) return false;
    task.progress = Math.min(task.target, Math.max(0, task.progress + Math.max(0, Number(amount) || 0)));
    return true;
  }

  function achievementUnlocked(key, meta, context = {}) {
    if (!ACHIEVEMENTS[key]) return false;
    if (key === "firstSignal") return meta.totalExpeditions >= 1;
    if (key === "protocolArchitect") return meta.stats.protocols >= 30;
    if (key === "stableOverclock") return meta.stats.overclocks >= 10;
    if (key === "layerTen") return Number(context.bestStage) >= 10;
    if (key === "veteranCore") return Number(context.totalIterations) >= 10;
    if (key === "dataOcean") return meta.stats.researchEarned >= 500;
    return false;
  }

  function masteryPoints(cycles, bestStage) {
    return Math.floor(Math.max(0, Number(cycles) || 0) / 5) + Math.floor(Math.max(0, Number(bestStage) || 0) / 10);
  }

  function masteryFactor(level) {
    const clean = clamp(level, 0, 20);
    return 1 + clean * 0.03 + Math.floor(clean / 5) * 0.05;
  }

  function offlineReward(meta, now = Date.now()) {
    const clean = sanitizeMeta(meta, now);
    const elapsedMs = Math.max(0, now - Date.parse(clean.lastSeenAt));
    const bufferLevel = clean.technologies.chronoBuffer;
    const capHours = Math.min(24, 8 + bufferLevel * 2);
    const capMs = capHours * 60 * 60 * 1000;
    const creditedMs = Math.min(elapsedMs, capMs);
    const overflowLevel = Math.max(0, bufferLevel - 8);
    const overflowMs = Math.min(Math.max(0, elapsedMs - capMs), 24 * 60 * 60 * 1000);
    const overflowFactor = Math.min(0.6, overflowLevel * 0.05);
    const automationLevel = clean.technologies.autonomousDrones;
    const automationFactor = 1 + Math.min(automationLevel, 5) * 0.2 + Math.max(automationLevel - 5, 0) * 0.06;
    const frontierFactor = 1 + 0.015 * Math.sqrt(clean.frontier.offline);
    const ratePerHour = 6 * automationFactor * frontierFactor;
    const effectiveMs = creditedMs + overflowMs * overflowFactor;
    return { amount: Math.floor((effectiveMs / 3600000) * ratePerHour), elapsedMs, creditedMs, effectiveMs, capHours, ratePerHour, overflowFactor };
  }

  function techCost(key, level) {
    const tech = TECHS[key];
    if (!tech) return Infinity;
    const clean = clamp(level, 0, tech.max);
    if (clean < 5) return tech.baseCost + clean * tech.stepCost;
    return Math.min(1e12, Math.floor((tech.baseCost + 5 * tech.stepCost) * Math.pow(1.18, clean - 5)));
  }

  function techTotal(meta) {
    return Object.keys(TECHS).reduce((sum, key) => sum + clamp(meta && meta.technologies ? meta.technologies[key] : 0, 0, TECHS[key].max), 0);
  }

  function frontierUnlocked(meta) {
    return techTotal(meta) >= 60;
  }

  function frontierCost(key, level) {
    const item = FRONTIER[key];
    if (!item) return Infinity;
    return Math.min(1e15, Math.floor(item.baseCost * Math.pow(item.growth, clamp(level, 0, 999))));
  }

  function expeditionDurationFactor(meta) {
    const level = meta && meta.technologies ? clamp(meta.technologies.deepSensors, 0, 20) : 0;
    return 1 - Math.floor(level / 5) * 0.075;
  }

  function dailyRewardFactor(meta) {
    const memory = meta && meta.technologies ? clamp(meta.technologies.protocolMemory, 0, 20) : 0;
    const frontierLevel = meta && meta.frontier ? clamp(meta.frontier.daily, 0, 999) : 0;
    return 1 + Math.floor(memory / 5) * 0.05 + 0.01 * Math.sqrt(frontierLevel);
  }

  function expeditionStatus(meta, now = Date.now()) {
    if (!meta || !meta.expedition) return { state: "idle", remainingMs: 0, progress: 0 };
    const start = Date.parse(meta.expedition.startedAt);
    const end = Date.parse(meta.expedition.endsAt);
    const duration = Math.max(1, end - start);
    const remainingMs = Math.max(0, end - now);
    return { state: remainingMs > 0 ? "running" : "ready", remainingMs, progress: Math.min(1, Math.max(0, (now - start) / duration)) };
  }

  function startExpedition(regionKey, now = Date.now(), seed = Math.floor(Math.random() * 2147483645) + 1, durationFactor = 1) {
    const region = REGIONS[regionKey];
    if (!region) throw new Error("未知远征区域");
    const duration = Math.max(60000, Math.floor(region.durationMs * Math.max(0.5, Math.min(1, Number(durationFactor) || 1))));
    return { regionKey, startedAt: new Date(now).toISOString(), endsAt: new Date(now + duration).toISOString(), seed };
  }

  function prepareExpeditionResult(meta, now = Date.now()) {
    const clean = sanitizeMeta(meta, now);
    if (!clean.expedition || expeditionStatus(clean, now).state !== "ready") return null;
    const region = REGIONS[clean.expedition.regionKey];
    const variance = 0.92 + (clean.expedition.seed % 17) / 100;
    const sensorLevel = clean.technologies.deepSensors;
    const sensorFactor = 1 + Math.min(sensorLevel, 5) * 0.12 + Math.max(sensorLevel - 5, 0) * 0.04;
    const frontierFactor = 1 + 0.02 * Math.sqrt(clean.frontier.expedition);
    const baseResearch = Math.max(1, Math.floor(region.research * variance * sensorFactor * frontierFactor));
    const eventKeys = Object.keys(EVENTS);
    const eventKey = eventKeys[clean.expedition.seed % eventKeys.length];
    return { eventKey, regionKey: region.key, baseResearch };
  }

  function resolveEvent(pendingEvent, choiceKey) {
    if (!pendingEvent) return null;
    const event = EVENTS[pendingEvent.eventKey];
    const choice = event && event.choices.find((item) => item.key === choiceKey);
    if (!choice) return null;
    return {
      research: Math.max(1, Math.floor(pendingEvent.baseResearch * choice.researchFactor)),
      source: choice.source,
      eventKey: event.key,
      choiceLabel: choice.label,
    };
  }

  return { REGIONS, TECHS, FRONTIER, EVENTS, DAILY_TASKS, ACHIEVEMENTS, defaultMeta, sanitizeMeta, offlineReward, techCost, techTotal, frontierUnlocked, frontierCost, expeditionDurationFactor, dailyRewardFactor, expeditionStatus, startExpedition, prepareExpeditionResult, resolveEvent, dailyKey, createDaily, ensureDaily, progressDaily, achievementUnlocked, masteryPoints, masteryFactor };
});
