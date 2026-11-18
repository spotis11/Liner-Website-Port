// YouTube TV player n-parameter solver — in-browser port of
// liner-ref/electron/youtube/n-solver.ts. The desktop solves in the Electron
// main process; the website runs the same code in the user's browser, which
// gives the player script the real browser globals it expects at boot.
import { parseScript, type ESTree } from "meriyah";
import { findUrlFactory, type UrlFactory } from "./nFactory";
import { InnertubeError } from "../innertube/innertubeClient";

const TV_USER_AGENT =
  "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/25.lts.30.1034943-gold (unlike Gecko), Unknown_TV_Unknown_0/Unknown (Unknown, Unknown)";

const PLAYER_VARIANTS = [
  "tv-player-ias-tcl.vflset/tv-player-ias-tcl.js",
  "tv-player-ias.vflset/tv-player-ias.js",
];
const SKIPPED_METHODS = new Set(["constructor", "set", "get", "clone"]);
const PROBE_URL = "https://youtube.com/watch?v=liner";

interface PlayerUrl {
  set: (key: string, value: string) => void;
  get: (key: string) => unknown;
}

type UrlFactoryFn = (...args: Array<number | string>) => PlayerUrl;

interface LoadedPlayer {
  signatureTimestamp: number;
  factory: UrlFactory;
  create: UrlFactoryFn;
}

export interface SolveResult {
  signatureTimestamp: number;
  values: string[];
}

const players = new Map<string, Promise<LoadedPlayer>>();

async function fetchPlayer(playerId: string): Promise<string> {
  for (const variant of PLAYER_VARIANTS) {
    // cross-origin upstream: the web fetch interceptor relays it through
    // /api/fetch (x-liner-user-agent maps to a real User-Agent upstream)
    const response = await fetch(
      `https://www.youtube.com/s/player/${playerId}/${variant}`,
      { headers: { "x-liner-user-agent": TV_USER_AGENT } },
    );
    if (response.ok) return response.text();
  }
  throw new InnertubeError(
    `YouTube TV player ${playerId} is unavailable.`,
    502,
  );
}

function wrapperBody(program: ESTree.Program): ESTree.BlockStatement {
  for (const statement of program.body) {
    if (statement.type !== "ExpressionStatement") continue;
    const call = statement.expression;
    if (call.type !== "CallExpression") continue;
    const callee =
      call.callee.type === "MemberExpression"
        ? call.callee.object
        : call.callee;
    if (callee.type === "FunctionExpression" && callee.body) return callee.body;
  }
  throw new InnertubeError(
    "YouTube TV player has an unexpected layout.",
    502,
  );
}

async function loadPlayer(playerId: string): Promise<LoadedPlayer> {
  const source = await fetchPlayer(playerId);
  const signatureTimestamp = Number(
    /signatureTimestamp:(\d+)/.exec(source)?.[1],
  );
  if (!Number.isFinite(signatureTimestamp))
    throw new InnertubeError(
      "YouTube TV player has no signature timestamp.",
      502,
    );
  const body = wrapperBody(parseScript(source, { ranges: true }));
  const factory = findUrlFactory(body.body);
  if (!factory)
    throw new InnertubeError("YouTube TV player url factory not found.", 502);
  const exportName = `__linerUrlFactory_${playerId.replace(/\W/g, "_")}`;
  const end = (body.range?.[1] ?? source.length) - 1;
  const instrumented = `${source.slice(0, end)};globalThis.${exportName}=${factory.name};${source.slice(end)}`;
  new Function(instrumented)();

  const create: unknown = Reflect.get(globalThis, exportName);
  if (typeof create !== "function")
    throw new InnertubeError(
      "YouTube TV player url factory is not callable.",
      502,
    );
  return { signatureTimestamp, factory, create: create as UrlFactoryFn };
}

function transformN(player: LoadedPlayer, value: string): string {
  const url = player.create(...player.factory.args, PROBE_URL);
  url.set("n", value);
  const proto: object = Object.getPrototypeOf(url);
  const keys = [...Object.keys(proto), ...Object.getOwnPropertyNames(proto)];
  const method = keys.find(
    (key) =>
      !SKIPPED_METHODS.has(key) && typeof Reflect.get(url, key) === "function",
  );
  const transform: unknown = method ? Reflect.get(url, method) : undefined;
  if (typeof transform !== "function")
    throw new InnertubeError("YouTube TV player url has no transform.", 502);
  Reflect.apply(transform, url, []);
  const result = String(url.get("n") ?? "");
  if (!result || result === value || !/^[\w-]+$/.test(result))
    throw new InnertubeError(
      "YouTube TV player returned an invalid n value.",
      502,
    );
  return result;
}

export async function solveN(
  playerId: string,
  values: string[],
): Promise<SolveResult> {
  let loading = players.get(playerId);
  if (!loading) {
    loading = loadPlayer(playerId);
    players.set(playerId, loading);
    loading.catch(() => players.delete(playerId));
  }
  const player = await loading;
  return {
    signatureTimestamp: player.signatureTimestamp,
    values: values.map((value) => transformN(player, value)),
  };
}
