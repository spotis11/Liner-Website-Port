// Alfredo math commands — ported from alfredo.py (abs/average/ceil/cos/
// deg2rad/divide) plus the obvious siblings. Uses the same safe arithmetic
// evaluator as .calc.
"use strict";

const { calcExpr } = require("./commands");

function num(args) {
  const n = Number(args[0]);
  if (!Number.isFinite(n)) throw new Error("Give me a number, e.g. `.abs -5`");
  return n;
}

function register(registry) {
  const cmd = (name, fn, label) => {
    registry[name] = async (ctx) => {
      try {
        await ctx.reply(fn(ctx.args));
      } catch (e) {
        await ctx.reply(`❌ ${e.message}`);
      }
    };
    registry[name]._label = label;
  };

  cmd("abs", (a) => `📏 |${num(a)}| = **${Math.abs(num(a))}**`);
  cmd("average", (a) => {
    const nums = a.map(Number).filter(Number.isFinite);
    if (!nums.length) throw new Error("Usage: `.average 3 5 8`");
    return `📊 Average of [${nums.join(", ")}] = **${(nums.reduce((x, y) => x + y, 0) / nums.length).toFixed(4).replace(/\.?0+$/, "")}**`;
  });
  cmd("ceil", (a) => `📈 ceil(${num(a)}) = **${Math.ceil(num(a))}**`);
  cmd("floor", (a) => `📉 floor(${num(a)}) = **${Math.floor(num(a))}**`);
  cmd("round", (a) => `🔄 round(${num(a)}) = **${Math.round(num(a))}**`);
  cmd("sqrt", (a) => {
    const n = num(a);
    if (n < 0) throw new Error("Negative numbers have no real square root.");
    return `√${n} = **${Math.sqrt(n).toFixed(6).replace(/\.?0+$/, "")}**`;
  });
  cmd("cos", (a) => `📐 cos(${num(a)} rad) = **${Math.cos(num(a)).toFixed(6)}**`);
  cmd("sin", (a) => `📐 sin(${num(a)} rad) = **${Math.sin(num(a)).toFixed(6)}**`);
  cmd("tan", (a) => `📐 tan(${num(a)} rad) = **${Math.tan(num(a)).toFixed(6)}**`);
  cmd("deg2rad", (a) => `📐 ${num(a)}° = **${(num(a) * Math.PI / 180).toFixed(6)} rad**`);
  cmd("rad2deg", (a) => `📐 ${num(a)} rad = **${(num(a) * 180 / Math.PI).toFixed(4)}°**`);
  cmd("divide", (a) => {
    const x = Number(a[0]), y = Number(a[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Usage: `.divide 10 4`");
    if (y === 0) throw new Error("Division by zero.");
    return `➗ ${x} ÷ ${y} = **${(x / y).toFixed(6).replace(/\.?0+$/, "")}**`;
  });
  cmd("sum", (a) => {
    const nums = a.map(Number).filter(Number.isFinite);
    if (!nums.length) throw new Error("Usage: `.sum 1 2 3`");
    return `➕ Sum = **${nums.reduce((x, y) => x + y, 0)}**`;
  });
  cmd("max", (a) => {
    const nums = a.map(Number).filter(Number.isFinite);
    if (!nums.length) throw new Error("Usage: `.max 1 9 4`");
    return `⬆️ Max = **${Math.max(...nums)}**`;
  });
  cmd("min", (a) => {
    const nums = a.map(Number).filter(Number.isFinite);
    if (!nums.length) throw new Error("Usage: `.min 1 9 4`");
    return `⬇️ Min = **${Math.min(...nums)}**`;
  });
  cmd("factorial", (a) => {
    let n = num(a);
    if (n < 0 || n > 170 || !Number.isInteger(n)) throw new Error("Give an integer 0–170.");
    let r = 1n;
    for (let i = 2n; i <= BigInt(n); i++) r *= i;
    return `❗ ${n}! = **${r}**`;
  });
  cmd("gcd", (a) => {
    let [x, y] = [Math.abs(num(a)), Math.abs(num(a[1]))];
    while (y) [x, y] = [y, x % y];
    return `🔗 GCD = **${x}**`;
  });
  cmd("lcm", (a) => {
    let [x, y] = [Math.abs(num(a)), Math.abs(num(a[1]))];
    const [p, q] = [x, y];
    while (y) [x, y] = [y, x % y];
    return `🔗 LCM = **${(p * q) / x}**`;
  });
  cmd("isprime", (a) => {
    let n = num(a);
    if (!Number.isInteger(n) || n < 2) throw new Error("Give an integer ≥ 2.");
    let prime = true;
    for (let i = 2; i * i <= n; i++) if (n % i === 0) { prime = false; break; }
    return `🔍 **${n}** is ${prime ? "" : "**not** "}prime`;
  });
  cmd("percent", (a) => {
    const x = Number(a[0]), y = Number(a[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Usage: `.percent 15 200` (15% of 200)");
    return `💯 ${x}% of ${y} = **${(x * y / 100).toFixed(2).replace(/\.00$/, "")}**`;
  });
}

module.exports = { register };
