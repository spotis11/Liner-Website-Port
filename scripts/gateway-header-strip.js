// E2E helper: simulates the platform FC gateway's header filtering.
// The real gateway rewrites Host, intercepts HEAD and strips non-standard
// request headers — which silently emptied `x-db-mirror-key` and 403'd every
// deploy-time export (the v1.14.2 bug). This proxy strips `x-db-mirror-*`
// inbound headers and forwards everything else 1:1.
const http = require("node:http");

const UPSTREAM_HOST = process.env.UPSTREAM_HOST || "127.0.0.1";
const UPSTREAM_PORT = Number(process.env.UPSTREAM_PORT || 3000);
const LISTEN_PORT = Number(process.env.LISTEN_PORT || 3200);

const server = http.createServer((req, res) => {
  const headers = { ...req.headers };
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase().startsWith("x-db-mirror")) delete headers[name];
  }
  const proxy = http.request(
    { host: UPSTREAM_HOST, port: UPSTREAM_PORT, path: req.url, method: req.method, headers },
    (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    },
  );
  proxy.on("error", (err) => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `gateway upstream error: ${err.message}` }));
  });
  req.pipe(proxy);
});

server.listen(LISTEN_PORT, "127.0.0.1", () => {
  console.log(`gateway sim on 127.0.0.1:${LISTEN_PORT} -> ${UPSTREAM_HOST}:${UPSTREAM_PORT} (strips x-db-mirror-*)`);
});
