#!/usr/bin/env node
/**
 * Mock Discord OAuth2 server for E2E testing the website Discord login.
 * Mirrors the three real endpoints the flow touches:
 *   GET  /oauth2/authorize  → auto-approves and 302s back with ?code&state
 *   POST /oauth2/token      → validates grant/code/redirect/PKCE verifier
 *   GET  /users/@me         → fixed profile (e2e_discord_user)
 *
 * PKCE is enforced for real: the token endpoint recomputes
 * S256(code_verifier) and compares it against the challenge that
 * /api/auth/discord/start embedded in the authorize URL.
 */
const http = require("http");
const crypto = require("crypto");

const PORT = 9420;
const codes = new Map(); // code -> { challenge, state, redirectUri, clientId }

const PROFILE = {
  id: "918273645500000001",
  username: "e2e_discord_user",
  global_name: "E2E Discord",
  email: "e2e-discord@example.invalid",
  avatar: null,
  verified: true,
};

function s256(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/oauth2/authorize") {
    const params = url.searchParams;
    const required = [
      "client_id",
      "redirect_uri",
      "state",
      "code_challenge",
      "code_challenge_method",
      "scope",
    ];
    const missing = required.filter((k) => !params.get(k));
    if (missing.length) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end(`missing ${missing.join(",")}`);
      return;
    }
    if (params.get("response_type") !== "code") {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("bad response_type");
      return;
    }
    if (!params.get("scope").includes("identify")) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("scope must include identify");
      return;
    }
    const code = crypto.randomBytes(24).toString("base64url");
    codes.set(code, {
      challenge: params.get("code_challenge"),
      method: params.get("code_challenge_method"),
      state: params.get("state"),
      redirectUri: params.get("redirect_uri"),
      clientId: params.get("client_id"),
    });
    const back = new URL(params.get("redirect_uri"));
    back.searchParams.set("code", code);
    back.searchParams.set("state", params.get("state"));
    res.writeHead(302, { location: back.toString() });
    res.end();
    return;
  }

  if (url.pathname === "/oauth2/token" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const form = new URLSearchParams(body);
      const code = form.get("code");
      const record = codes.get(code);
      const deny = (msg) => {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_grant", error_description: msg }));
      };
      if (!record) return deny("unknown code");
      codes.delete(code);
      if (form.get("grant_type") !== "authorization_code") return deny("bad grant_type");
      if (form.get("client_id") !== record.clientId) return deny("invalid_client");
      if (form.get("redirect_uri") !== record.redirectUri) return deny("redirect mismatch");
      if (form.get("state")) return deny("state must not be sent to the token endpoint");
      const verifier = form.get("code_verifier") || "";
      if (record.method === "S256") {
        if (!verifier || s256(verifier) !== record.challenge) return deny("pkce check failed");
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          access_token: `MOCK-${crypto.randomBytes(12).toString("hex")}`,
          token_type: "Bearer",
          expires_in: 604800,
          refresh_token: `MOCKR-${crypto.randomBytes(12).toString("hex")}`,
          scope: "identify email",
        }),
      );
    });
    return;
  }

  if (url.pathname === "/users/@me") {
    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Bearer MOCK-")) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "401: Unauthorized" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(PROFILE));
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock discord oauth on http://127.0.0.1:${PORT}`);
});
