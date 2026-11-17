// Alfredo per-guild + per-user persistent store (Node edition).
// Backs the ported Python config surface: .prefix, .afk, tags, notes,
// reminders, custom commands, todos. JSON file on disk — survives restarts
// on the container FS; atomic writes; never committed.
"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.ALFREDO_DATA_DIR || path.join(__dirname, "..", "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

const DEFAULTS = () => ({
  prefixes: {},      // guildId -> custom prefix string
  afk: {},           // guildId -> { userId -> { reason, since } }
  tags: {},          // guildId -> { name -> content }
  notes: {},         // userId -> [ { text, at } ]
  reminders: [],     // [ { id, userId, channelId, text, at } ]
  todos: {},         // userId -> [ { text, done } ]
  customcmds: {},    // guildId -> { trigger -> response }
  presence: null,    // { status: "online|idle|dnd|invisible", type, text }
  warnings: {},      // guildId -> { userId -> [ { reason, by, at } ] }
  cases: {},         // guildId -> [ { id, type, userId, by, reason, at } ]
  economy: {},       // userId -> { bal, lastDaily, lastBeg, lastCrime, items: [] }
  shop: {},          // guildId -> { itemName -> price }
  counting: {},      // guildId -> { channelId, count }
  automod: {},       // guildId -> { antilink, antiinvite, anticaps, antihoist, antiemoji, antispam }
  nextReminderId: 1,
  nextCaseId: 1,
});

let data = DEFAULTS();
try {
  const raw = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  data = { ...DEFAULTS(), ...raw };
} catch {}

let saveTimer = null;
function save() {
  // coalesce bursts of writes into one flush ≤200ms later
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = `${STORE_PATH}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, STORE_PATH);
    } catch (e) {
      console.error("[store] save failed:", e.message);
    }
  }, 200);
}

const store = {
  // ---- prefix ----
  prefixOf(guildId) {
    return data.prefixes[guildId] || ".";
  },
  setPrefix(guildId, prefix) {
    data.prefixes[guildId] = prefix;
    save();
  },

  // ---- afk ----
  setAfk(guildId, userId, reason) {
    (data.afk[guildId] ||= {})[userId] = { reason, since: new Date().toISOString() };
    save();
  },
  clearAfk(guildId, userId) {
    if (data.afk[guildId]) {
      delete data.afk[guildId][userId];
      save();
    }
  },
  getAfk(guildId, userId) {
    return data.afk[guildId]?.[userId] || null;
  },
  afkMentions(guildId, userIds) {
    // users currently AFK among the mentioned ids
    const g = data.afk[guildId] || {};
    return userIds.filter((id) => g[id]).map((id) => ({ id, ...g[id] }));
  },

  // ---- tags ----
  getTag(guildId, name) {
    return data.tags[guildId]?.[name.toLowerCase()] ?? null;
  },
  setTag(guildId, name, content) {
    (data.tags[guildId] ||= {})[name.toLowerCase()] = content;
    save();
  },
  deleteTag(guildId, name) {
    const t = data.tags[guildId];
    if (!t || !(name.toLowerCase() in t)) return false;
    delete t[name.toLowerCase()];
    save();
    return true;
  },
  listTags(guildId) {
    return Object.keys(data.tags[guildId] || {});
  },

  // ---- notes (per user) ----
  addNote(userId, text) {
    (data.notes[userId] ||= []).push({ text, at: new Date().toISOString() });
    save();
    return data.notes[userId].length;
  },
  listNotes(userId) {
    return data.notes[userId] || [];
  },
  deleteNote(userId, index) {
    const list = data.notes[userId] || [];
    if (index < 0 || index >= list.length) return false;
    list.splice(index, 1);
    save();
    return true;
  },

  // ---- reminders ----
  addReminder(userId, channelId, text, atMs) {
    const id = data.nextReminderId++;
    data.reminders.push({ id, userId, channelId, text, at: atMs });
    save();
    return id;
  },
  listReminders(userId) {
    return data.reminders.filter((r) => r.userId === userId);
  },
  deleteReminder(userId, id) {
    const i = data.reminders.findIndex((r) => r.id === id && r.userId === userId);
    if (i === -1) return false;
    data.reminders.splice(i, 1);
    save();
    return true;
  },
  /** returns due reminders and removes them; call on an interval */
  takeDueReminders() {
    const now = Date.now();
    const due = data.reminders.filter((r) => r.at <= now);
    if (due.length) {
      data.reminders = data.reminders.filter((r) => r.at > now);
      save();
    }
    return due;
  },

  // ---- todos (per user) ----
  addTodo(userId, text) {
    (data.todos[userId] ||= []).push({ text, done: false });
    save();
    return data.todos[userId].length;
  },
  listTodos(userId) {
    return data.todos[userId] || [];
  },
  completeTodo(userId, index) {
    const t = (data.todos[userId] || [])[index];
    if (!t) return false;
    t.done = true;
    save();
    return true;
  },
  clearTodos(userId) {
    data.todos[userId] = [];
    save();
  },

  // ---- custom commands ----
  setCustomCmd(guildId, trigger, response) {
    (data.customcmds[guildId] ||= {})[trigger.toLowerCase()] = response;
    save();
  },
  getCustomCmd(guildId, trigger) {
    return data.customcmds[guildId]?.[trigger.toLowerCase()] ?? null;
  },
  deleteCustomCmd(guildId, trigger) {
    const m = data.customcmds[guildId];
    if (!m || !(trigger.toLowerCase() in m)) return false;
    delete m[trigger.toLowerCase()];
    save();
    return true;
  },
  listCustomCmds(guildId) {
    return Object.keys(data.customcmds[guildId] || {});
  },

  // ---- presence (custom status) ----
  getPresence() {
    return data.presence;
  },
  setPresence(p) {
    data.presence = p;
    save();
  },

  // ---- warnings / cases ----
  addWarning(guildId, userId, reason, by) {
    ((data.warnings[guildId] ||= {})[userId] ||= []).push({ reason, by, at: new Date().toISOString() });
    const id = data.nextCaseId++;
    (data.cases[guildId] ||= []).push({ id, type: "warn", userId, by, reason, at: Date.now() });
    save();
    return { warnIndex: data.warnings[guildId][userId].length, caseId: id };
  },
  getWarnings(guildId, userId) {
    return data.warnings[guildId]?.[userId] || [];
  },
  deleteWarning(guildId, userId, index) {
    const list = data.warnings[guildId]?.[userId];
    if (!list || index < 0 || index >= list.length) return false;
    list.splice(index, 1);
    save();
    return true;
  },
  clearWarnings(guildId, userId) {
    if (data.warnings[guildId]) {
      delete data.warnings[guildId][userId];
      save();
    }
  },
  addCase(guildId, type, userId, by, reason) {
    const id = data.nextCaseId++;
    (data.cases[guildId] ||= []).push({ id, type, userId, by, reason, at: Date.now() });
    save();
    return id;
  },
  getCase(guildId, id) {
    return (data.cases[guildId] || []).find((c) => c.id === id) || null;
  },
  listCases(guildId, userId) {
    const list = data.cases[guildId] || [];
    return userId ? list.filter((c) => c.userId === userId) : list;
  },
  deleteCase(guildId, id) {
    const list = data.cases[guildId] || [];
    const i = list.findIndex((c) => c.id === id);
    if (i === -1) return false;
    list.splice(i, 1);
    save();
    return true;
  },

  // ---- economy (lite port of alfredo.py economy) ----
  econ(userId) {
    return (data.economy[userId] ||= { bal: 0, lastDaily: 0, lastBeg: 0, lastCrime: 0, items: [] });
  },
  shopOf(guildId) {
    return data.shop[guildId] || {};
  },
  shopSet(guildId, name, price) {
    (data.shop[guildId] ||= {})[name.toLowerCase()] = price;
    save();
  },
  shopDelete(guildId, name) {
    const s = data.shop[guildId];
    if (!s || !(name.toLowerCase() in s)) return false;
    delete s[name.toLowerCase()];
    save();
    return true;
  },

  // ---- counting game ----
  getCounting(guildId) {
    return data.counting[guildId] || null;
  },
  setCounting(guildId, channelId, count) {
    data.counting[guildId] = { channelId, count };
    save();
  },

  // ---- automod toggles ----
  automodOf(guildId) {
    return (data.automod[guildId] ||= { antilink: false, antiinvite: false, anticaps: false, antihoist: false, antiemoji: false, antispam: false });
  },
  automodSet(guildId, key, value) {
    const cfg = this.automodOf(guildId);
    cfg[key] = value;
    save();
  },
};

module.exports = { store, parseDurationMs: null };
