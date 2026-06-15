// =============================================================
// habits-core.js — shared Habits logic for LifeOS.
// Loaded on index.html, habits.html, growth.html.
// Single source of truth: localStorage key `po_habits_v1`.
// Exposes window.Habits. No DOM access at load time, so it is
// safe to include non-deferred in <head> (index.html boots its
// habit rendering synchronously and relies on this being ready).
// =============================================================
(function () {
  'use strict';

  var LS_KEY = 'po_habits_v1';

  // ---------- ids ----------
  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ---------- date helpers (mirror index.html 6 AM active-date boundary) ----------
  function pad2(n) { return String(n).padStart(2, '0'); }
  function dateToKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function parseKey(s) { var p = String(s).split('-').map(Number); return new Date(p[0], (p[1] || 1) - 1, p[2] || 1); }
  function getActiveDateString() {
    var now = new Date();
    if (now.getHours() < 6) { var d = new Date(now); d.setDate(d.getDate() - 1); return dateToKey(d); }
    return dateToKey(now);
  }
  function todayStr() { return getActiveDateString(); }
  function addDays(dateStr, n) { var d = parseKey(dateStr); d.setDate(d.getDate() + n); return dateToKey(d); }
  function daysBetween(a, b) { return Math.round((parseKey(b) - parseKey(a)) / 86400000); }
  function dowOf(dateStr) { return parseKey(dateStr).getDay(); } // 0=Sun..6=Sat
  function weekStartStr(dateStr) {                                // Monday as week start
    var d = parseKey(dateStr);
    var diff = (d.getDay() === 0) ? 6 : (d.getDay() - 1);
    d.setDate(d.getDate() - diff);
    return dateToKey(d);
  }
  function weeksSince(anchor, dateStr) {
    var diff = daysBetween(anchor, dateStr);
    return diff < 0 ? 0 : Math.floor(diff / 7);
  }
  function formatDate(yyyy_mm_dd) {
    var d = parseKey(yyyy_mm_dd);
    var wk = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
    var mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
    return wk + ', ' + mo + ' ' + d.getDate();
  }

  // ---------- small utils ----------
  function numOr(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }
  function formatNum(n) {
    if (n == null || !isFinite(n)) return '0';
    var r = Math.round(n * 100) / 100;
    return (r % 1 === 0) ? String(r) : String(r);
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---------- normalize ----------
  function normalize(s) {
    s = (s && typeof s === 'object') ? s : {};
    s.version = s.version || 1;
    s.categories = Array.isArray(s.categories) ? s.categories : [];
    s.habits = Array.isArray(s.habits) ? s.habits : [];
    s.logs = (s.logs && typeof s.logs === 'object') ? s.logs : {};
    if (!s.logs.milestone || typeof s.logs.milestone !== 'object') s.logs.milestone = {};
    s.categories.forEach(normalizeCategory);
    s.habits.forEach(normalizeHabit);
    return s;
  }
  function normalizeCategory(c, i) {
    c.id = c.id || uid('cat');
    c.name = typeof c.name === 'string' ? c.name : 'Category';
    c.color = (typeof c.color === 'string' && c.color) ? c.color : '#6BE3A4';
    if (typeof c.order !== 'number') c.order = i;
    c.createdDate = c.createdDate || todayStr();
  }
  function normalizeHabit(h, i) {
    h.id = h.id || uid('hab');
    h.name = typeof h.name === 'string' ? h.name : 'Habit';
    h.type = (h.type === 'simple' || h.type === 'complex' || h.type === 'showup') ? h.type : 'showup';
    if (h.categoryId === undefined) h.categoryId = null;
    h.createdDate = h.createdDate || todayStr();
    h.archived = !!h.archived;
    if (typeof h.order !== 'number') h.order = i;

    var sc = (h.schedule && typeof h.schedule === 'object') ? h.schedule : {};
    sc.kind = (sc.kind === 'daily' || sc.kind === 'weekdays' || sc.kind === 'everyN') ? sc.kind : 'daily';
    sc.weekdays = Array.isArray(sc.weekdays) ? sc.weekdays.filter(function (d) { return d >= 0 && d <= 6; }) : [1, 2, 3, 4, 5];
    sc.n = (typeof sc.n === 'number' && sc.n >= 1) ? Math.round(sc.n) : 2;
    sc.timesPerDay = (typeof sc.timesPerDay === 'number' && sc.timesPerDay >= 1) ? Math.round(sc.timesPerDay) : 1;
    h.schedule = sc;

    if (h.type === 'simple') {
      h.unit = (typeof h.unit === 'string' && h.unit) ? h.unit : 'units';
      var es = (h.escalation && typeof h.escalation === 'object') ? h.escalation : {};
      es.start = numOr(es.start, 1);
      es.increment = numOr(es.increment, 0);
      es.anchorDate = es.anchorDate || h.createdDate;
      es.paused = !!es.paused;
      es.overrideTarget = (es.overrideTarget == null) ? null : numOr(es.overrideTarget, null);
      h.escalation = es;
    }
    if (h.type === 'complex') {
      var ms = (h.milestone && typeof h.milestone === 'object') ? h.milestone : {};
      ms.stages = Array.isArray(ms.stages) ? ms.stages : [];
      ms.stages.forEach(function (st) {
        st.id = st.id || uid('st');
        st.name = typeof st.name === 'string' ? st.name : 'Stage';
        st.subSteps = Array.isArray(st.subSteps) ? st.subSteps : [];
        st.subSteps.forEach(function (ss) {
          ss.id = ss.id || uid('ss');
          ss.name = typeof ss.name === 'string' ? ss.name : 'Step';
        });
      });
      h.milestone = ms;
    }
  }

  // ---------- storage ----------
  function load() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) {}
    return normalize(raw);
  }
  function save(state) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
    dispatch();
  }
  function dispatch() {
    try { window.dispatchEvent(new CustomEvent('habits-changed')); } catch (e) {}
  }

  // ---------- lookups ----------
  function catById(state, id) {
    if (!id) return null;
    for (var i = 0; i < state.categories.length; i++) if (state.categories[i].id === id) return state.categories[i];
    return null;
  }
  function habitById(state, id) {
    for (var i = 0; i < state.habits.length; i++) if (state.habits[i].id === id) return state.habits[i];
    return null;
  }
  function categoryColor(state, id) { var c = catById(state, id); return c ? c.color : '#76746E'; }
  function categoryName(state, id) { var c = catById(state, id); return c ? c.name : 'Uncategorized'; }

  // ---------- recurrence ----------
  function isScheduledOn(habit, dateStr) {
    if (!habit) return false;
    var sc = habit.schedule || {};
    if (dateStr < habit.createdDate) return false;
    if (sc.kind === 'daily') return true;
    if (sc.kind === 'weekdays') return (sc.weekdays || []).indexOf(dowOf(dateStr)) !== -1;
    if (sc.kind === 'everyN') {
      var diff = daysBetween(habit.createdDate, dateStr);
      return diff >= 0 && (diff % (sc.n || 1) === 0);
    }
    return false;
  }
  function scheduleSummary(habit) {
    var sc = habit.schedule || {};
    var base;
    if (sc.kind === 'daily') base = 'Every day';
    else if (sc.kind === 'everyN') base = 'Every ' + (sc.n || 1) + ' days';
    else {
      var names = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
      var picked = (sc.weekdays || []).slice().sort(function (a, b) { return a - b; }).map(function (d) { return names[d]; });
      base = picked.length === 7 ? 'Every day' : (picked.join(' ') || 'No days');
    }
    if ((sc.timesPerDay || 1) > 1) base += ' · ' + sc.timesPerDay + '×/day';
    return base;
  }

  // ---------- escalation / target (simple habits) ----------
  function currentTarget(habit, dateStr) {
    if (!habit || habit.type !== 'simple') return null;
    var es = habit.escalation || {};
    if (es.paused) return es.overrideTarget != null ? es.overrideTarget : es.start;
    if (es.overrideTarget != null) return es.overrideTarget;
    return es.start + es.increment * weeksSince(es.anchorDate, dateStr || todayStr());
  }
  // Freeze the climbing target at its current value.
  function pauseEscalation(habit, dateStr) {
    if (!habit || habit.type !== 'simple') return;
    var cur = currentTarget(habit, dateStr || todayStr());
    habit.escalation.overrideTarget = cur;
    habit.escalation.paused = true;
  }
  // Resume climbing from wherever the target currently sits.
  function resumeEscalation(habit, dateStr) {
    if (!habit || habit.type !== 'simple') return;
    var cur = currentTarget(habit, dateStr || todayStr());
    habit.escalation.start = cur;
    habit.escalation.anchorDate = dateStr || todayStr();
    habit.escalation.overrideTarget = null;
    habit.escalation.paused = false;
  }

  // ---------- per-day completion logs ----------
  function getCount(state, habitId, dateStr) {
    var m = state.logs[habitId];
    return (m && m[dateStr]) || 0;
  }
  function setCount(state, habitId, dateStr, n) {
    if (!state.logs[habitId]) state.logs[habitId] = {};
    if (n <= 0) delete state.logs[habitId][dateStr];
    else state.logs[habitId][dateStr] = n;
  }
  function requiredToday(habit) {
    return Math.max(1, (habit.schedule && habit.schedule.timesPerDay) || 1);
  }
  function isDoneOn(state, habit, dateStr) {
    return getCount(state, habit.id, dateStr) >= requiredToday(habit);
  }

  // ---------- convenience for the dashboard ----------
  function scheduledHabitsOn(state, dateStr) {
    return state.habits
      .filter(function (h) { return !h.archived && isScheduledOn(h, dateStr); })
      .sort(function (a, b) {
        var ca = catById(state, a.categoryId), cb = catById(state, b.categoryId);
        var oa = ca ? ca.order : 9999, ob = cb ? cb.order : 9999;
        if (oa !== ob) return oa - ob;
        return (a.order || 0) - (b.order || 0);
      });
  }

  // Remove a habit and all of its logs.
  function deleteHabit(state, habitId) {
    state.habits = state.habits.filter(function (h) { return h.id !== habitId; });
    delete state.logs[habitId];
    if (state.logs.milestone) delete state.logs.milestone[habitId];
  }

  // ---------- milestones (complex habits) ----------
  function milestoneMap(state, habitId) {
    return (state.logs.milestone && state.logs.milestone[habitId]) || {};
  }
  function ensureMilestoneMap(state, habitId) {
    if (!state.logs.milestone) state.logs.milestone = {};
    if (!state.logs.milestone[habitId]) state.logs.milestone[habitId] = {};
    return state.logs.milestone[habitId];
  }
  function stageOfSubStep(habit, subStepId) {
    var stages = (habit.milestone && habit.milestone.stages) || [];
    for (var i = 0; i < stages.length; i++) {
      var subs = stages[i].subSteps || [];
      for (var j = 0; j < subs.length; j++) if (subs[j].id === subStepId) return stages[i];
    }
    return null;
  }
  function stageComplete(state, habit, stage) {
    var map = milestoneMap(state, habit.id);
    if (stage.subSteps && stage.subSteps.length) {
      return stage.subSteps.every(function (ss) { return !!map[ss.id]; });
    }
    return !!map[stage.id];
  }
  function currentStageIndex(state, habit) {
    var stages = (habit.milestone && habit.milestone.stages) || [];
    for (var i = 0; i < stages.length; i++) if (!stageComplete(state, habit, stages[i])) return i;
    return stages.length;
  }
  // Toggle a sub-step; auto-completes/uncompletes the parent stage. Returns {stageCompleted, stage}.
  function setSubStep(state, habit, subStepId, doneBool, dateStr) {
    var map = ensureMilestoneMap(state, habit.id);
    if (doneBool) map[subStepId] = dateStr || todayStr();
    else delete map[subStepId];
    var stage = stageOfSubStep(habit, subStepId);
    var result = { stageCompleted: false, stage: stage };
    if (stage) {
      var allDone = (stage.subSteps || []).every(function (ss) { return !!map[ss.id]; });
      var was = !!map[stage.id];
      if (allDone && !was) { map[stage.id] = dateStr || todayStr(); result.stageCompleted = true; }
      else if (!allDone && was) { delete map[stage.id]; }
    }
    return result;
  }
  // Toggle a stage that has no sub-steps (the stage itself is the checkable milestone).
  function setStage(state, habit, stageId, doneBool, dateStr) {
    var map = ensureMilestoneMap(state, habit.id);
    if (doneBool) map[stageId] = dateStr || todayStr();
    else delete map[stageId];
    return { stageCompleted: !!doneBool };
  }
  function milestoneProgress(state, habit) {
    var stages = (habit.milestone && habit.milestone.stages) || [];
    var map = milestoneMap(state, habit.id);
    var totalStages = stages.length, doneStages = 0, totalSteps = 0, doneSteps = 0;
    stages.forEach(function (st) {
      if (st.subSteps && st.subSteps.length) {
        totalSteps += st.subSteps.length;
        var allDone = true;
        st.subSteps.forEach(function (ss) { if (map[ss.id]) doneSteps++; else allDone = false; });
        if (allDone) doneStages++;
      } else {
        totalSteps += 1;
        if (map[st.id]) { doneSteps++; doneStages++; }
      }
    });
    return {
      totalStages: totalStages, doneStages: doneStages,
      totalSteps: totalSteps, doneSteps: doneSteps,
      percent: totalSteps ? Math.round(doneSteps / totalSteps * 100) : 0
    };
  }
  function milestoneDates(state, habitId) { return milestoneMap(state, habitId); }

  // ---------- analytics (Growth tab) ----------
  // Array of Monday week-start strings, oldest -> newest, length n.
  function weeksRange(n, endDateStr) {
    var end = weekStartStr(endDateStr || todayStr());
    var out = [];
    for (var i = n - 1; i >= 0; i--) out.push(addDays(end, -7 * i));
    return out;
  }
  // Total check-offs for a habit across a Mon-Sun week.
  function habitWeekCompletions(state, habit, weekStart) {
    var total = 0;
    for (var i = 0; i < 7; i++) total += getCount(state, habit.id, addDays(weekStart, i));
    return total;
  }
  // Sum of logged session values for the week (simple = count * target that day; else count).
  function weeklySessionTotal(state, habit, weekStart) {
    var total = 0;
    for (var i = 0; i < 7; i++) {
      var ds = addDays(weekStart, i);
      var c = getCount(state, habit.id, ds);
      if (!c) continue;
      if (habit.type === 'simple') total += c * (currentTarget(habit, ds) || 0);
      else total += c;
    }
    return total;
  }
  // Completion rate + streaks over [from,to] (current streak graces an unfinished today).
  function streakStats(state, habit, fromDateStr, toDateStr) {
    var scheduled = 0, done = 0, longest = 0, run = 0;
    var ds = fromDateStr;
    while (ds <= toDateStr) {
      if (isScheduledOn(habit, ds)) {
        scheduled++;
        if (isDoneOn(state, habit, ds)) { done++; run++; if (run > longest) longest = run; }
        else run = 0;
      }
      ds = addDays(ds, 1);
    }
    var cur = 0, d = toDateStr;
    for (var i = 0; i < 2000; i++) {
      if (d < habit.createdDate) break;
      if (isScheduledOn(habit, d)) {
        if (isDoneOn(state, habit, d)) cur++;
        else if (d !== toDateStr) break;
      }
      d = addDays(d, -1);
    }
    return { scheduled: scheduled, done: done, rate: scheduled ? done / scheduled : 0, longest: longest, current: cur };
  }
  // {subSteps, stages} milestone completions whose completion date falls within the week.
  function milestoneWeekCounts(state, habit, weekStart) {
    var map = milestoneMap(state, habit.id);
    var stages = (habit.milestone && habit.milestone.stages) || [];
    var stageIds = {}, subIds = {};
    stages.forEach(function (st) { stageIds[st.id] = true; (st.subSteps || []).forEach(function (ss) { subIds[ss.id] = true; }); });
    var end = addDays(weekStart, 6), subN = 0, stageN = 0;
    Object.keys(map).forEach(function (id) {
      var dt = map[id];
      if (dt < weekStart || dt > end) return;
      if (stageIds[id]) stageN++; else if (subIds[id]) subN++;
    });
    return { subSteps: subN, stages: stageN };
  }

  // ---------- celebration (basic; Phase D adds particle burst) ----------
  function injectCelebrateStyle() {
    if (typeof document === 'undefined' || document.getElementById('habit-celebrate-style')) return;
    var s = document.createElement('style'); s.id = 'habit-celebrate-style';
    s.textContent = [
      '.habit-celebrate{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:200;pointer-events:none;opacity:0;transition:opacity .35s ease;}',
      '.habit-celebrate.show{opacity:1;}',
      '.habit-celebrate-card{--cc:#F2C063;text-align:center;padding:22px 30px;border-radius:18px;background:rgba(20,20,22,0.72);backdrop-filter:blur(20px) saturate(1.3);-webkit-backdrop-filter:blur(20px) saturate(1.3);border:1px solid var(--cc);box-shadow:0 18px 60px rgba(0,0,0,0.6),0 0 60px -10px var(--cc);transform:scale(0.82) translateY(8px);transition:transform .45s cubic-bezier(0.34,1.56,0.64,1);}',
      '.habit-celebrate.show .habit-celebrate-card{transform:scale(1) translateY(0);}',
      '.habit-celebrate-title{font-size:20px;font-weight:800;color:#FAFAFA;letter-spacing:-0.01em;}',
      '.habit-celebrate-sub{margin-top:6px;font-size:13px;color:var(--cc);font-weight:700;}',
      '.habit-burst{position:fixed;left:50%;top:50%;z-index:201;pointer-events:none;}',
      '.habit-burst .p{position:absolute;width:9px;height:9px;border-radius:50%;left:-4.5px;top:-4.5px;opacity:0;}',
      '@keyframes habit-burst-fly{0%{transform:translate(0,0) scale(1);opacity:1;}100%{transform:translate(var(--tx),var(--ty)) scale(0.3);opacity:0;}}',
      '.habit-mini{position:fixed;left:50%;bottom:84px;transform:translateX(-50%) translateY(10px);z-index:201;pointer-events:none;background:rgba(20,20,22,0.92);border:1px solid var(--cc,#6BE3A4);color:#FAFAFA;font-size:13px;font-weight:600;padding:8px 14px;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,0.5),0 0 20px -6px var(--cc,#6BE3A4);opacity:0;transition:opacity .25s,transform .25s;}',
      '.habit-mini.show{opacity:1;transform:translateX(-50%) translateY(0);}',
      '.habit-mini::before{content:"\\2713 ";color:var(--cc,#6BE3A4);}',
      '@media (prefers-reduced-motion: reduce){.habit-celebrate-card{transition:none;transform:none;}}'
    ].join('');
    document.head.appendChild(s);
  }
  function prefersReducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  function spawnBurst(color) {
    var burst = document.createElement('div'); burst.className = 'habit-burst';
    var N = 18;
    for (var i = 0; i < N; i++) {
      var p = document.createElement('div'); p.className = 'p';
      var ang = (Math.PI * 2) * (i / N) + Math.random() * 0.4;
      var dist = 70 + Math.random() * 70;
      p.style.setProperty('--tx', (Math.cos(ang) * dist).toFixed(1) + 'px');
      p.style.setProperty('--ty', (Math.sin(ang) * dist).toFixed(1) + 'px');
      p.style.background = (i % 3 === 0) ? '#F2C063' : color;
      p.style.animation = 'habit-burst-fly ' + (0.8 + Math.random() * 0.4).toFixed(2) + 's cubic-bezier(0.22,1,0.36,1) forwards';
      p.style.animationDelay = (Math.random() * 0.05).toFixed(2) + 's';
      burst.appendChild(p);
    }
    document.body.appendChild(burst);
    setTimeout(function () { if (burst.parentNode) burst.parentNode.removeChild(burst); }, 1500);
  }
  // opts: { color, title, subtitle, mini, label }
  function celebrate(opts) {
    opts = opts || {};
    try {
      if (typeof document === 'undefined') return;
      injectCelebrateStyle();
      var color = opts.color || '#F2C063';

      if (opts.mini) {
        var pill = document.createElement('div'); pill.className = 'habit-mini';
        pill.style.setProperty('--cc', color);
        pill.textContent = opts.label || 'Done';
        document.body.appendChild(pill);
        requestAnimationFrame(function () { pill.classList.add('show'); });
        setTimeout(function () {
          pill.classList.remove('show');
          setTimeout(function () { if (pill.parentNode) pill.parentNode.removeChild(pill); }, 300);
        }, 1000);
        return;
      }

      var wrap = document.createElement('div'); wrap.className = 'habit-celebrate';
      var card = document.createElement('div'); card.className = 'habit-celebrate-card';
      card.style.setProperty('--cc', color);
      var t = document.createElement('div'); t.className = 'habit-celebrate-title'; t.textContent = opts.title || '🎉 Milestone reached!';
      var sub = document.createElement('div'); sub.className = 'habit-celebrate-sub'; sub.textContent = opts.subtitle || '';
      card.appendChild(t); card.appendChild(sub); wrap.appendChild(card);
      document.body.appendChild(wrap);
      requestAnimationFrame(function () { wrap.classList.add('show'); });
      if (!prefersReducedMotion()) spawnBurst(color);
      setTimeout(function () {
        wrap.classList.remove('show');
        setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 450);
      }, 1900);
    } catch (e) {}
  }

  window.Habits = {
    LS_KEY: LS_KEY,
    // storage
    load: load, save: save, normalize: normalize, dispatch: dispatch,
    // ids + utils
    uid: uid, numOr: numOr, formatNum: formatNum, escapeHtml: escapeHtml,
    // dates
    pad2: pad2, dateToKey: dateToKey, parseKey: parseKey,
    getActiveDateString: getActiveDateString, todayStr: todayStr,
    addDays: addDays, daysBetween: daysBetween, dowOf: dowOf,
    weekStartStr: weekStartStr, weeksSince: weeksSince, formatDate: formatDate,
    // lookups
    catById: catById, habitById: habitById,
    categoryColor: categoryColor, categoryName: categoryName,
    // recurrence + target
    isScheduledOn: isScheduledOn, scheduleSummary: scheduleSummary,
    currentTarget: currentTarget, pauseEscalation: pauseEscalation, resumeEscalation: resumeEscalation,
    // logs
    getCount: getCount, setCount: setCount, requiredToday: requiredToday, isDoneOn: isDoneOn,
    // milestones
    milestoneMap: milestoneMap, milestoneDates: milestoneDates,
    stageComplete: stageComplete, currentStageIndex: currentStageIndex,
    setSubStep: setSubStep, setStage: setStage, milestoneProgress: milestoneProgress,
    // analytics
    weeksRange: weeksRange, habitWeekCompletions: habitWeekCompletions,
    weeklySessionTotal: weeklySessionTotal, streakStats: streakStats,
    milestoneWeekCounts: milestoneWeekCounts,
    // celebration
    celebrate: celebrate,
    // dashboard
    scheduledHabitsOn: scheduledHabitsOn, deleteHabit: deleteHabit
  };
})();
