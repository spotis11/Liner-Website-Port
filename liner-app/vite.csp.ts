import type { Plugin } from "vite";

function contentSecurityPolicy(isDev: boolean): string {
  const scriptSources = [
    "'self'",
    "'unsafe-eval'",
    "'wasm-unsafe-eval'",
    // YouTube IFrame Player API: bootstrap lives on www.youtube.com and it
    // pulls the widget implementation from s.ytimg.com — without these the
    // video mode can never build its player
    "https://www.youtube.com",
    "https://s.ytimg.com",
    ...(isDev ? ["'unsafe-inline'"] : []),
  ];
  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    // frame-src: two embed surfaces share this directive — the muted,
    // mirrored video frame (a youtube.com / youtube-nocookie.com embed) and
    // the Liner desktop auth/relay iframe (tryliner.fun). CSP ignores a
    // DUPLICATE frame-src directive (only the first wins), so every source
    // MUST live in a single directive or the later one is silently dropped
    // (which was blocking *.tryliner.fun in production with a console
    // "Ignoring duplicate Content-Security-Policy directive 'frame-src'").
    `frame-src https://www.youtube.com https://www.youtube-nocookie.com https://*.tryliner.fun${isDev ? " http://localhost:* http://127.0.0.1:*" : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' * http: https: data: blob: liner-local:",
    "media-src 'self' * http: https: data: blob: liner-local:",
    "connect-src 'self' * http: https: ws: wss: data: blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join("; ");
}

export function contentSecurityPolicyPlugin(): Plugin {
  let isDev = false;
  return {
    name: "liner-content-security-policy",
    configResolved(config) {
      isDev = config.command === "serve";
    },
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: {
            "http-equiv": "Content-Security-Policy",
            content: contentSecurityPolicy(isDev),
          },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}
