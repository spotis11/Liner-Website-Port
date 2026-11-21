// Direct PostCSS run of the root app's globals.css through @tailwindcss/postcss
const postcss = require("/home/z/my-project/node_modules/postcss");
const tailwindcss = require("/home/z/my-project/node_modules/@tailwindcss/postcss");
const fs = require("fs");

const css = fs.readFileSync("/home/z/my-project/src/app/globals.css", "utf8");
postcss([tailwindcss()])
  .process(css, { from: "/home/z/my-project/src/app/globals.css" })
  .then((r) => {
    console.log("OK — output length:", r.css.length);
  })
  .catch((e) => {
    console.error("POSTCSS FAILED:", e.message || e);
    if (e.stack) console.error(e.stack.split("\n").slice(0, 6).join("\n"));
    process.exit(1);
  });
