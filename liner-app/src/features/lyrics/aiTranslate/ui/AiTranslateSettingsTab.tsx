// Settings → AI Translate tab (mirrors the desktop app's ai_translate tab:
// provider picker + target language + per-provider credentials).

import { useState } from "react";
import { CheckLine, Delete2Line, EyeLine, EyeCloseLine } from "@mingcute/react";
import { useTranslation } from "@/languages";
import { SettingBlock } from "@/features/settings/ui/controls";
import { AI_PROVIDERS, type AiProviderId } from "../providers";
import {
  useAiTranslateStore,
  resolveModel,
} from "../aiTranslateStore";
import { translateLines, TranslationError } from "../translate";

const TARGET_LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "id", label: "Bahasa Indonesia" },
  { code: "tl", label: "Filipino (Tagalog)" },
  { code: "zh-CN", label: "简体中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "pt", label: "Português" },
  { code: "it", label: "Italiano" },
  { code: "ru", label: "Русский" },
  { code: "tr", label: "Türkçe" },
  { code: "pl", label: "Polski" },
  { code: "uk", label: "Українська" },
  { code: "vi", label: "Tiếng Việt" },
  { code: "th", label: "ไทย" },
  { code: "hi", label: "हिन्दी" },
  { code: "ar", label: "العربية" },
];

function providerReady(
  provider: AiProviderId,
  key: string | undefined,
): boolean {
  const def = AI_PROVIDERS.find((p) => p.id === provider);
  if (def?.needsKey) return Boolean(key && key.trim());
  return true;
}

export function AiTranslateSettingsTab() {
  const { t } = useTranslation();
  const enabled = useAiTranslateStore((s) => s.enabled);
  const autoTranslate = useAiTranslateStore((s) => s.autoTranslate);
  const provider = useAiTranslateStore((s) => s.provider);
  const targetLang = useAiTranslateStore((s) => s.targetLang);
  const apiKeys = useAiTranslateStore((s) => s.apiKeys);
  const models = useAiTranslateStore((s) => s.models);
  const ollamaUrl = useAiTranslateStore((s) => s.ollamaUrl);
  const cacheCount = useAiTranslateStore((s) => Object.keys(s.cache).length);

  const store = useAiTranslateStore.getState();
  const [showKey, setShowKey] = useState(false);
  const [testState, setTestState] = useState<"idle" | "running" | "ok" | "fail">(
    "idle",
  );
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const def = AI_PROVIDERS.find((p) => p.id === provider)!;
  const key = apiKeys[provider] ?? "";

  const runTest = async () => {
    setTestState("running");
    setTestMessage(null);
    try {
      const state = useAiTranslateStore.getState();
      // translating INTO English with English samples is a no-op — pick a
      // source the chosen target language will actually change
      const samples = state.targetLang.toLowerCase().startsWith("en")
        ? ["Hola mundo, esta es una prueba", "La música es vida"]
        : ["Hello world", "How are you?"];
      const result = await translateLines(samples, {
        provider: state.provider,
        targetLang: state.targetLang,
        apiKey: state.apiKeys[state.provider],
        model: resolveModel(state.provider, state.models),
        ollamaUrl: state.ollamaUrl,
      });
      if (result.every((line, i) => line && line !== samples[i])) {
        setTestState("ok");
        setTestMessage(result.join(" / "));
      } else {
        setTestState("fail");
        setTestMessage(t("settings.ai_translate.test_unexpected"));
      }
    } catch (error) {
      setTestState("fail");
      setTestMessage(
        error instanceof TranslationError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error),
      );
    }
  };

  return (
    <div className="flex flex-col gap-[18px] pb-[24px]">
      {/* enable */}
      <SettingBlock
        title={t("settings.ai_translate.title")}
        description={t("settings.ai_translate.description")}
      >
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => store.setEnabled(!enabled)}
          className="flex w-full items-center justify-between gap-[12px] rounded-xl border border-border-alpha-14 bg-black/[0.045] px-[14px] py-[12px] text-left cursor-pointer transition-colors hover:bg-black/[0.07] dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"
        >
          <span className="min-w-0">
            <span className="block text-[13.5px] font-[600] text-text-primary">
              {t("settings.ai_translate.enable_label")}
            </span>
            <span className="mt-[2px] block text-[12px] leading-[1.4] text-text-tertiary">
              {t("settings.ai_translate.enable_hint")}
            </span>
          </span>
          <span
            className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors ${
              enabled ? "bg-btn-primary-bg" : "bg-border-alpha-33"
            }`}
          >
            <span
              className={`absolute h-[16px] w-[16px] rounded-full bg-white shadow transition-all ${
                enabled ? "left-[19px]" : "left-[3px]"
              }`}
            />
          </span>
        </button>

        {enabled && (
          <button
            type="button"
            role="switch"
            aria-checked={autoTranslate}
            onClick={() => store.setAutoTranslate(!autoTranslate)}
            className="flex w-full items-center justify-between gap-[12px] rounded-xl border border-border-alpha-14 bg-black/[0.045] px-[14px] py-[12px] text-left cursor-pointer transition-colors hover:bg-black/[0.07] dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"
          >
            <span className="min-w-0">
              <span className="block text-[13.5px] font-[600] text-text-primary">
                {t("settings.ai_translate.auto_label")}
              </span>
              <span className="mt-[2px] block text-[12px] leading-[1.4] text-text-tertiary">
                {t("settings.ai_translate.auto_hint")}
              </span>
            </span>
            <span
              className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors ${
                autoTranslate ? "bg-btn-primary-bg" : "bg-border-alpha-33"
              }`}
            >
              <span
                className={`absolute h-[16px] w-[16px] rounded-full bg-white shadow transition-all ${
                  autoTranslate ? "left-[19px]" : "left-[3px]"
                }`}
              />
            </span>
          </button>
        )}
      </SettingBlock>

      {/* provider picker */}
      <SettingBlock
        title={t("settings.ai_translate.provider_section")}
        description={t("settings.ai_translate.provider_hint")}
      >
        <div className="grid grid-cols-2 gap-[8px] sm:grid-cols-3">
          {AI_PROVIDERS.map((p) => {
            const active = p.id === provider;
            const ready = providerReady(p.id, apiKeys[p.id]);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => store.setProvider(p.id)}
                className={`relative flex flex-col items-center gap-[6px] rounded-xl border px-[10px] py-[12px] transition-all cursor-pointer ${
                  active
                    ? "border-btn-primary-bg bg-btn-primary-bg/10"
                    : "border-border-alpha-14 bg-black/[0.045] hover:bg-black/[0.07] dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"
                }`}
              >
                {active && (
                  <span className="absolute right-[6px] top-[6px] flex h-[15px] w-[15px] items-center justify-center rounded-full bg-btn-primary-bg text-btn-primary-text">
                    <CheckLine size={10} />
                  </span>
                )}
                <p.Logo size={22} />
                <span className="text-[12px] font-[600] text-text-primary">
                  {p.label}
                </span>
                <span className="text-[10px] font-[500] uppercase tracking-wide text-text-tertiary">
                  {p.free
                    ? t("settings.ai_translate.free_badge")
                    : ready
                      ? t("settings.ai_translate.ready_badge")
                      : t("settings.ai_translate.key_needed_badge")}
                </span>
              </button>
            );
          })}
        </div>
      </SettingBlock>

      {/* provider credentials */}
      {enabled && (
        <SettingBlock
          title={`${def.label} — ${t("settings.ai_translate.config_section")}`}
        >
          {def.needsKey && (
            <div className="flex flex-col gap-[6px]">
              <label className="text-[12.5px] font-[600] text-text-secondary">
                {t("settings.ai_translate.api_key_label")}
              </label>
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={key}
                  onChange={(event) => store.setApiKey(provider, event.target.value)}
                  placeholder={def.keyHint ?? ""}
                  spellCheck={false}
                  autoComplete="off"
                  className="h-[36px] w-full rounded-lg border border-border-alpha-14 bg-black/[0.055] pl-[12px] pr-[38px] text-[13px] text-text-primary outline-none transition-colors focus:border-border-alpha-33 dark:bg-white/[0.06]"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? "Hide key" : "Show key"}
                  className="absolute right-[6px] top-1/2 -translate-y-1/2 flex h-[24px] w-[24px] items-center justify-center rounded-md border-none bg-transparent text-text-tertiary cursor-pointer hover:text-text-primary"
                >
                  {showKey ? <EyeCloseLine size={15} /> : <EyeLine size={15} />}
                </button>
              </div>
              <p className="m-0 text-[11.5px] leading-[1.45] text-text-tertiary">
                {t("settings.ai_translate.api_key_hint")}
              </p>
            </div>
          )}

          {def.needsModel && (
            <div className="flex flex-col gap-[6px]">
              <label className="text-[12.5px] font-[600] text-text-secondary">
                {t("settings.ai_translate.model_label")}
              </label>
              <input
                type="text"
                value={models[provider] ?? ""}
                onChange={(event) => store.setModel(provider, event.target.value)}
                placeholder={def.defaultModel}
                spellCheck={false}
                className="h-[36px] w-full rounded-lg border border-border-alpha-14 bg-black/[0.055] px-[12px] text-[13px] text-text-primary outline-none transition-colors focus:border-border-alpha-33 dark:bg-white/[0.06]"
              />
              <p className="m-0 text-[11.5px] leading-[1.45] text-text-tertiary">
                {t("settings.ai_translate.model_hint", {
                  model: def.defaultModel,
                })}
              </p>
            </div>
          )}

          {provider === "ollama" && (
            <div className="flex flex-col gap-[6px]">
              <label className="text-[12.5px] font-[600] text-text-secondary">
                {t("settings.ai_translate.ollama_url_label")}
              </label>
              <input
                type="text"
                value={ollamaUrl}
                onChange={(event) => store.setOllamaUrl(event.target.value)}
                placeholder={def.baseUrlHint ?? "http://localhost:11434"}
                spellCheck={false}
                className="h-[36px] w-full rounded-lg border border-border-alpha-14 bg-black/[0.055] px-[12px] text-[13px] text-text-primary outline-none transition-colors focus:border-border-alpha-33 dark:bg-white/[0.06]"
              />
              <p className="m-0 text-[11.5px] leading-[1.45] text-text-tertiary">
                {t("settings.ai_translate.ollama_hint")}
              </p>
            </div>
          )}

          {/* connection test */}
          <div className="flex flex-col gap-[8px]">
            <div className="flex items-center gap-[10px]">
              <button
                type="button"
                disabled={testState === "running"}
                onClick={() => void runTest()}
                className="inline-flex h-[32px] items-center gap-[6px] rounded-lg border-none bg-btn-primary-bg px-[14px] text-[12.5px] font-[700] text-btn-primary-text transition-all hover:opacity-90 disabled:opacity-60 cursor-pointer"
              >
                {t("settings.ai_translate.test_button")}
              </button>
              {testState === "ok" && (
                <span className="inline-flex items-center gap-[4px] text-[12px] font-[600] text-[#3fae5a]">
                  <CheckLine size={14} />
                  {t("settings.ai_translate.test_ok")}
                </span>
              )}
              {testState === "fail" && (
                <span className="text-[12px] font-[600] text-[#e05545]">
                  {t("settings.ai_translate.test_fail")}
                </span>
              )}
            </div>
            {testMessage && (
              <p
                className={`m-0 truncate text-[11.5px] ${
                  testState === "ok" ? "text-text-tertiary" : "text-[#e05545]"
                }`}
                title={testMessage}
              >
                {testMessage}
              </p>
            )}
          </div>
        </SettingBlock>
      )}

      {/* target language */}
      <SettingBlock
        title={t("settings.ai_translate.language_section")}
        description={t("settings.ai_translate.language_hint")}
      >
        <div className="flex flex-wrap gap-[6px]">
          {TARGET_LANGUAGES.map((lang) => {
            const active = lang.code === targetLang;
            return (
              <button
                key={lang.code}
                type="button"
                onClick={() => store.setTargetLang(lang.code)}
                className={`inline-flex h-[30px] items-center rounded-lg border px-[12px] text-[12.5px] font-[500] transition-colors cursor-pointer ${
                  active
                    ? "border-btn-primary-bg bg-btn-primary-bg text-btn-primary-text"
                    : "border-border-alpha-14 bg-black/[0.045] text-text-primary hover:bg-black/[0.08] dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"
                }`}
              >
                {lang.label}
              </button>
            );
          })}
        </div>
      </SettingBlock>

      {/* cache */}
      <SettingBlock
        title={t("settings.ai_translate.cache_section")}
        description={t("settings.ai_translate.cache_hint")}
      >
        <button
          type="button"
          disabled={cacheCount === 0}
          onClick={() => store.clearCache()}
          className="inline-flex h-[32px] items-center gap-[6px] rounded-lg border border-border-alpha-14 bg-transparent px-[12px] text-[12.5px] font-[600] text-text-primary transition-colors hover:bg-black/[0.06] disabled:opacity-50 dark:hover:bg-white/[0.08] cursor-pointer"
        >
          <Delete2Line size={14} />
          {t("settings.ai_translate.cache_clear", { count: cacheCount })}
        </button>
      </SettingBlock>
    </div>
  );
}
