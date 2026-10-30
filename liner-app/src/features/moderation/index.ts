/**
 * Website-port moderation (bans). Only exists on the website port — the
 * original desktop app knows nothing about it.
 */
export { BanGate } from "./ui/BanGate";
export { BannedScreen } from "./ui/BannedScreen";
export { ModerationTab } from "./ui/ModerationTab";
export { useBanStore } from "./store/banStore";
export {
  ModerationError,
  addBan,
  checkBan,
  formatBanRemaining,
  listBans,
  normalizeUsername,
  removeBan,
} from "./lib/moderationApi";
export type {
  AddBanInput,
  BanCheckResult,
  BanInfo,
  BanType,
} from "./lib/moderationApi";
