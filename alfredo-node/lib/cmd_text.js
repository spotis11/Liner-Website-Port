// Alfredo text & encoding commands — ported from alfredo.py.
// boldtext/codetext/clapify/emojify, base64/base32/binary/hex suites,
// caesar/atbash ciphers, charcount.
"use strict";

const crypto = require("crypto");

function register(registry) {
  const cmd = (name, handler) => (registry[name] = handler);

  // ---------- styling ----------
  cmd("boldtext", async (ctx) => {
    const t = ctx.args.join(" ");
    if (!t) return ctx.reply("Usage: `.boldtext <text>`");
    await ctx.send({ content: `**${t}**` });
  });
  cmd("codetext", async (ctx) => {
    const t = ctx.args.join(" ");
    if (!t) return ctx.reply("Usage: `.codetext <text>`");
    await ctx.send({ content: `\`${t}\`` });
  });
  cmd("clapify", async (ctx) => {
    const t = ctx.args.join(" ");
    if (!t) return ctx.reply("Usage: `.clapify <text>`");
    await ctx.send({ content: t.toUpperCase().split(/\s+/).join(" 👏 ") + " 👏" });
  });
  cmd("emojify", async (ctx) => {
    const t = ctx.args.join(" ").toLowerCase();
    if (!t) return ctx.reply("Usage: `.emojify <text>`");
    const map = { a: "🇦", b: "🇧", c: "🇨", d: "🇩", e: "🇪", f: "🇫", g: "🇬", h: "🇭", i: "🇮", j: "🇯", k: "🇰", l: "🇱", m: "🇲", n: "🇳", o: "🇴", p: "🇵", q: "🇶", r: "🇷", s: "🇸", t: "🇹", u: "🇺", v: "🇻", w: "🇼", x: "🇽", y: "🇾", z: "🇿" };
    await ctx.send({ content: t.split("").map((c) => map[c] || c).join("") });
  });

  // ---------- base64 / base32 ----------
  cmd("b64encode2", async (ctx) => {
    const t = ctx.args.join(" ");
    if (!t) return ctx.reply("Usage: `.b64encode2 <text>`");
    await ctx.reply(`📤 \`${Buffer.from(t, "utf8").toString("base64")}\``);
  });
  cmd("b64decode2", async (ctx) => {
    const t = ctx.args.join(" ");
    if (!t) return ctx.reply("Usage: `.b64decode2 <base64>`");
    try {
      const out = Buffer.from(t.replace(/\s+/g, ""), "base64").toString("utf8");
      await ctx.reply(`📥 \`${out.replace(/[`\\]/g, "")}\``);
    } catch {
      await ctx.reply("❌ Not valid base64.");
    }
  });
  registry.base64 = registry.b64encode2;
  cmd("base32", async (ctx) => {
    const t = ctx.args.join(" ");
    if (!t) return ctx.reply("Usage: `.base32 <text>` (encodes; pass a valid base32 string starting with A-Z2-7 to decode? use .base32dec)");
    await ctx.reply(`📤 \`${Buffer.from(t, "utf8").toString("base32")}\``);
  });
  cmd("base32dec", async (ctx) => {
    const t = ctx.args.join(" ").replace(/\s+/g, "");
    if (!t) return ctx.reply("Usage: `.base32dec <base32>`");
    try {
      await ctx.reply(`📥 \`${Buffer.from(t, "base32").toString("utf8")}\``);
    } catch {
      await ctx.reply("❌ Not valid base32.");
    }
  });

  // ---------- binary / hex ----------
  cmd("binaryencode", async (ctx) => {
    const t = ctx.args.join(" ");
    if (!t) return ctx.reply("Usage: `.binaryencode <text>`");
    await ctx.reply(`0️⃣1️⃣ \`${t.split("").map((c) => c.charCodeAt(0).toString(2).padStart(8, "0")).join(" ")}\``);
  });
  cmd("binarydecode", binaryDecode);
  registry.binarydecode2 = binaryDecode;
  registry.binary = binaryDecode;
  async function binaryDecode(ctx) {
    const t = ctx.args.join(" ").trim();
    if (!t) return ctx.reply("Usage: `.binarydecode <01000001 ...>`");
    try {
      const out = t.split(/\s+/).map((b) => String.fromCharCode(parseInt(b, 2))).join("");
      if (!out) throw new Error();
      await ctx.reply(`📥 \`${out}\``);
    } catch {
      await ctx.reply("❌ Not valid binary.");
    }
  }
  cmd("bin2dec", async (ctx) => {
    const b = ctx.args[0];
    if (!/^[01]+$/.test(b || "")) return ctx.reply("Usage: `.bin2dec 1010`");
    await ctx.reply(`🔢 \`${b}\` = **${parseInt(b, 2)}**`);
  });
  cmd("dec2bin", async (ctx) => {
    const n = Number(ctx.args[0]);
    if (!Number.isInteger(n) || n < 0) return ctx.reply("Usage: `.dec2bin 10`");
    await ctx.reply(`🔢 \`${n}\` = **${n.toString(2)}**`);
  });
  cmd("dec2hex", async (ctx) => {
    const n = Number(ctx.args[0]);
    if (!Number.isInteger(n) || n < 0) return ctx.reply("Usage: `.dec2hex 255`");
    await ctx.reply(`🔢 \`${n}\` = **0x${n.toString(16).toUpperCase()}**`);
  });
  cmd("hex2dec", async (ctx) => {
    const h = (ctx.args[0] || "").replace(/^0x/i, "");
    if (!/^[0-9a-f]+$/i.test(h)) return ctx.reply("Usage: `.hex2dec FF`");
    await ctx.reply(`🔢 \`0x${h.toUpperCase()}\` = **${parseInt(h, 16)}**`);
  });

  // ---------- ciphers ----------
  cmd("caesar", async (ctx) => {
    const shift = Number(ctx.args[0]) || 3;
    const t = ctx.args.slice(1).join(" ");
    if (!t) return ctx.reply("Usage: `.caesar <shift> <text>` (negative shifts decode)");
    const enc = t.replace(/[a-z]/gi, (c) => {
      const base = c <= "Z" ? 65 : 97;
      return String.fromCharCode(((c.charCodeAt(0) - base + shift) % 26 + 26) % 26 + base);
    });
    await ctx.reply(`🔐 \`${enc}\``);
  });
  cmd("atbash", async (ctx) => {
    const t = ctx.args.join(" ");
    if (!t) return ctx.reply("Usage: `.atbash <text>`");
    const enc = t.replace(/[a-z]/gi, (c) => {
      const base = c <= "Z" ? 65 : 97;
      return String.fromCharCode(base + 25 - (c.charCodeAt(0) - base));
    });
    await ctx.reply(`🔀 \`${enc}\``);
  });

  // ---------- counting ----------
  cmd("charcount", charCount);
  registry.charcount2 = charCount;
  async function charCount(ctx) {
    const t = ctx.args.join(" ");
    if (!t) return ctx.reply("Usage: `.charcount <text>`");
    const chars = t.length;
    const words = t.split(/\s+/).filter(Boolean).length;
    const letters = (t.match(/[a-z]/gi) || []).length;
    const digits = (t.match(/\d/g) || []).length;
    const spaces = (t.match(/ /g) || []).length;
    const lines = t.split("\n").length;
    await ctx.reply(`📏 **${chars}** chars • **${words}** words • **${lines}** line(s)\n📝 ${letters} letters • ${digits} digits • ${spaces} spaces`);
  }
  cmd("uuid2", async (ctx) => {
    await ctx.reply(`🆔 \`${crypto.randomUUID()}\``);
  });
}

module.exports = { register };
