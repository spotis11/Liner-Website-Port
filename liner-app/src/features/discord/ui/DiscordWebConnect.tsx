import { useEffect, useState } from "react";
import { DiscordFill, WarningFill } from "@mingcute/react";
import { useTranslation } from "@/languages";
import { Button, TextInput } from "@/shared/ui";
import { SettingSection } from "../../settings/ui/controls";
import { discordGateway, type DiscordGatewayStatus } from "../lib/discordGateway";

/**
 * Web-only connect card for the gateway ("self bot") Discord RPC.
 * Shown in place of the desktop IPC auto-connect flow.
 */
export default function DiscordWebConnect() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<DiscordGatewayStatus>(discordGateway.getStatus());
  const [token, setToken] = useState("");
  const [savedToken] = useState(() => discordGateway.hasStoredToken());

  useEffect(() => discordGateway.subscribe(setStatus), []);

  const handleConnect = () => {
    if (!token.trim()) return;
    discordGateway.connect(token);
    setToken("");
  };

  const handleDisconnect = () => {
    discordGateway.disconnect();
    setToken("");
  };

  const statusLine = status.connected
    ? t("settings.discord.web.connected_as", { username: status.username ?? "Discord" }) ||
      `Connected as ${status.username ?? "Discord"}`
    : status.connecting
      ? t("settings.discord.web.connecting") || "Connecting..."
      : t("settings.discord.status.disconnected") || "Offline";

  return (
    <SettingSection label={t("settings.discord.web.section") || "Connect with Discord"}>
      <div className="flex flex-col gap-[12px] rounded-[14px] bg-bg-surface/70 p-[14px] dark:bg-white/[0.06]">
        {/* Self-bot warning (unofficial method) */}
        <div className="flex gap-[10px] rounded-[12px] border border-amber-500/25 bg-amber-500/[0.08] p-[12px]">
          <WarningFill size={16} className="mt-[2px] shrink-0 text-amber-500" />
          <p className="m-0 text-[13px] leading-[1.5] text-amber-600 dark:text-amber-400">
            {t("settings.discord.web.warning") ||
              "Unofficial method — Discord may treat this connection as a self-bot and ban your account. Use at your own risk. Your token is stored locally on this device only."}
          </p>
        </div>

        <div className="flex items-center gap-[10px]">
          <DiscordFill size={16} className="shrink-0 text-text-secondary" />
          <TextInput
            size="sm"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={
              savedToken
                ? t("settings.discord.web.token_saved") || "Token saved on this device"
                : t("settings.discord.web.token_placeholder") || "Paste your Discord token"
            }
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="flex-1"
            aria-label={t("settings.discord.web.token_placeholder") || "Discord token"}
          />
          {status.connected || savedToken ? (
            <Button variant="secondary" size="sm" onClick={handleDisconnect}>
              {t("settings.discord.web.disconnect") || "Disconnect"}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={handleConnect}
              disabled={!token.trim()}
            >
              {t("settings.discord.web.connect") || "Connect"}
            </Button>
          )}
        </div>

        <p className="m-0 text-[12.5px] leading-[1.45] text-text-secondary">
          {statusLine}
        </p>
        {status.error && (
          <p className="m-0 text-[12.5px] leading-[1.45] text-red-500">{status.error}</p>
        )}
      </div>
    </SettingSection>
  );
}
