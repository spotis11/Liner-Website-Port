import { useMemo } from "react";
import { Dialog } from "@/shared/ui";
import { Button, Slider, ToggleSwitch } from "@/shared/ui";
import { Select } from "@/shared/ui";
import { CloseLine } from "@mingcute/react";
import { SliderHorizontal } from "@solar-icons/react";
import { useTranslation } from "@/languages";
import { useEqualizerStore } from "../store/equalizerStore";
import {
  EQ_PRESET_I18N_KEYS,
  EQ_PRESET_ORDER,
  type EqPresetId,
} from "../lib/presets";
import {
  EQ_BAND_FREQUENCIES,
  EQ_MAX_GAIN_DB,
} from "@/features/player/engine/equalizerDsp";
import { BandSlider } from "./BandSlider";

export interface EqualizerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function freqLabel(freq: number): { label: string; unit: string } {
  if (freq >= 1000) return { label: String(freq / 1000), unit: "kHz" };
  return { label: String(freq), unit: "Hz" };
}

/**
 * "Audio Equalizer & Presets" modal — 10-band precision graphic EQ with
 * presets, master preamp and bass boost, matching the desktop app.
 */
export function EqualizerModal({ open, onOpenChange }: EqualizerModalProps) {
  const { t } = useTranslation();
  const bypassed = useEqualizerStore((s) => s.bypassed);
  const bands = useEqualizerStore((s) => s.bands);
  const preampDb = useEqualizerStore((s) => s.preampDb);
  const bassBoostPct = useEqualizerStore((s) => s.bassBoostPct);
  const preset = useEqualizerStore((s) => s.preset);
  const setBypassed = useEqualizerStore((s) => s.setBypassed);
  const setBand = useEqualizerStore((s) => s.setBand);
  const setPreamp = useEqualizerStore((s) => s.setPreamp);
  const setBassBoost = useEqualizerStore((s) => s.setBassBoost);
  const applyPreset = useEqualizerStore((s) => s.applyPreset);
  const resetFlat = useEqualizerStore((s) => s.resetFlat);

  const presetOptions = useMemo(
    () =>
      [...EQ_PRESET_ORDER, "custom" as EqPresetId].map((id) => ({
        value: id,
        label: t(EQ_PRESET_I18N_KEYS[id]),
      })),
    [t],
  );

  const bandLabels = useMemo(
    () => EQ_BAND_FREQUENCIES.map((freq) => freqLabel(freq)),
    [],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange} maxWidth={520}>
      <div className="flex flex-col text-text-primary">
        {/* header */}
        <div className="flex items-start gap-[12px] px-[20px] pt-[18px]">
          <span className="mt-[2px] flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-xl bg-[#e05545]/15 text-[#e05545]">
            <SliderHorizontal size={20} weight="Bold" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-[16px] font-[700] leading-[1.25]">
              {t("player.equalizer.title")}
            </h2>
            <p className="m-0 mt-[2px] text-[12.5px] leading-[1.35] text-text-tertiary">
              {t("player.equalizer.subtitle")}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-lg border-none bg-transparent text-text-tertiary transition-colors hover:bg-black/10 hover:text-text-primary dark:hover:bg-white/10"
          >
            <CloseLine size={18} />
          </button>
        </div>

        {/* bypass + preset row */}
        <div className="mt-[16px] flex items-center justify-between gap-[12px] px-[20px]">
          <div className="flex items-center gap-[10px]">
            <ToggleSwitch
              checked={bypassed}
              onChange={setBypassed}
              ariaLabel={t("player.equalizer.bypassed")}
            />
            <div className="flex flex-col leading-tight">
              <span className="text-[13px] font-[600]">
                {t("player.equalizer.bypassed")}
              </span>
              <span className="text-[11px] text-text-tertiary">
                {bypassed
                  ? t("player.equalizer.bypass_on")
                  : t("player.equalizer.bypass_off")}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-[8px]">
            <Select<EqPresetId>
              options={presetOptions}
              value={preset}
              onChange={(id) => {
                if (id !== "custom") applyPreset(id);
              }}
              aria-label={t("player.equalizer.preset")}
              className="min-w-[128px]"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={resetFlat}
              className="shrink-0"
            >
              {t("player.equalizer.reset_flat")}
            </Button>
          </div>
        </div>

        {/* preamp + bass boost cards */}
        <div className="mt-[14px] grid grid-cols-2 gap-[10px] px-[20px]">
          <div className="rounded-xl bg-black/[0.045] px-[14px] py-[12px] dark:bg-white/[0.05]">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-[600] text-text-secondary">
                {t("player.equalizer.master_preamp")}
              </span>
              <span className="text-[12px] font-[700] tabular-nums">
                {preampDb > 0 ? "+" : ""}
                {preampDb.toFixed(1)} dB
              </span>
            </div>
            <div className="mt-[6px]">
              <Slider
                value={preampDb}
                min={-12}
                max={12}
                step={0.5}
                ariaLabel={t("player.equalizer.master_preamp")}
                onChange={setPreamp}
                showValue={false}
                disabled={bypassed}
              />
            </div>
          </div>
          <div className="rounded-xl bg-black/[0.045] px-[14px] py-[12px] dark:bg-white/[0.05]">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-[600] text-text-secondary">
                {t("player.equalizer.bass_boost")}
              </span>
              <span className="text-[12px] font-[700] tabular-nums">
                {Math.round(bassBoostPct)}%
              </span>
            </div>
            <div className="mt-[6px]">
              <Slider
                value={bassBoostPct}
                min={0}
                max={100}
                step={1}
                ariaLabel={t("player.equalizer.bass_boost")}
                onChange={setBassBoost}
                showValue={false}
                disabled={bypassed}
              />
            </div>
          </div>
        </div>

        {/* 10-band chart */}
        <div className="mx-[20px] mt-[12px] rounded-xl bg-black/[0.03] px-[16px] py-[14px] dark:bg-white/[0.035]">
          <div className="relative flex items-stretch justify-between gap-[2px]">
            {/* dB axis labels */}
            <div className="flex w-[30px] shrink-0 flex-col justify-between pb-[26px] text-right text-[10px] leading-none text-text-tertiary tabular-nums">
              <span>+12dB</span>
              <span>0dB</span>
              <span>-12dB</span>
            </div>
            <div className="relative flex flex-1 items-stretch">
              {/* horizontal guides */}
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 pb-[26px]">
                <div className="absolute top-0 h-px w-full bg-black/[0.07] dark:bg-white/[0.07]" />
                <div className="absolute top-1/2 h-px w-full -translate-y-1/2 bg-[#e05545]/25" />
                <div className="absolute bottom-[26px] h-px w-full bg-black/[0.07] dark:bg-white/[0.07]" />
              </div>
              {bands.map((gain, index) => {
                const { label, unit } = bandLabels[index];
                return (
                  <div
                    key={EQ_BAND_FREQUENCIES[index]}
                    className="relative h-[132px] flex-1"
                  >
                    <BandSlider
                      label={label}
                      unit={unit}
                      value={gain}
                      min={-EQ_MAX_GAIN_DB}
                      max={EQ_MAX_GAIN_DB}
                      onChange={(value) => setBand(index, value)}
                      disabled={bypassed}
                      className="absolute inset-y-0 left-1/2 -translate-x-1/2"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* footer hints */}
        <div className="flex items-center justify-between px-[20px] pb-[16px] pt-[12px] text-[11px] text-text-tertiary">
          <span>{t("player.equalizer.hint_double_click")}</span>
          <span>{t("player.equalizer.hint_freq_range")}</span>
        </div>
      </div>
    </Dialog>
  );
}
