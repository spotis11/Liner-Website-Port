import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@material/web/switch/switch.js", () => ({}));

import { ToggleSwitch } from "./ToggleSwitch";

// @ts-expect-error - act support flag in vitest browserless DOM environment
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ToggleSwitch", () => {
  it("forwards the Material Web change state to its controlled callback", () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root: Root = createRoot(host);

    act(() => root.render(<ToggleSwitch checked={false} onChange={onChange} />));

    const element = host.querySelector("md-switch") as HTMLElement & {
      selected: boolean;
    };
    element.selected = true;
    act(() => element.dispatchEvent(new Event("change", { bubbles: true })));

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(true);

    act(() => root.unmount());
    host.remove();
  });
});
