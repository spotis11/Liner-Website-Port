import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { ToggleSwitch } from "./ToggleSwitch";

// @ts-expect-error - act support flag in vitest browserless DOM environment
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ToggleSwitch", () => {
  it("reports clicks through its controlled callback and keeps aria-checked", () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root: Root = createRoot(host);

    act(() => root.render(<ToggleSwitch checked={false} onChange={onChange} />));

    const element = host.querySelector('button[role="switch"]') as HTMLButtonElement;
    expect(element.getAttribute("aria-checked")).toBe("false");
    expect(element.querySelector("span")).not.toBeNull();

    act(() => element.click());

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(true);

    act(() => root.unmount());
    host.remove();
  });

  it("ignores clicks while disabled", () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root: Root = createRoot(host);

    act(() =>
      root.render(<ToggleSwitch checked={false} onChange={onChange} disabled />),
    );

    const element = host.querySelector('button[role="switch"]') as HTMLButtonElement;
    expect(element.disabled).toBe(true);

    act(() => element.click());

    expect(onChange).not.toHaveBeenCalled();

    act(() => root.unmount());
    host.remove();
  });
});
