// Bisect which part of globals.css crashes the tailwind/oxide transform.
const fs = require("fs");
const postcss = require("postcss");
const twMod = require("@tailwindcss/postcss");
const tw = twMod.default || twMod;

const src = fs.readFileSync("/home/z/my-project/src/app/globals.css", "utf8");
const lines = src.split("\n");

async function tryChunk(name, text) {
  try {
    await postcss([tw()]).process(text, { from: "bisect.css" });
    console.log("OK   ", name, `(${text.length} chars)`);
    return true;
  } catch (e) {
    console.log("THROW", name, e.message?.slice(0, 80));
    return true; // a thrown error is a clean failure, not a crash
  }
  return false;
}

// if the whole file crashes (process dies), we bisect by halving
async function main() {
  // Try full file inside this process; if the process dies, the wrapper
  // script below re-runs us on halves.
  await tryChunk("full", src);
  console.log("full file processed without crash");
}
main();
