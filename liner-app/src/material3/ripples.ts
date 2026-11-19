// Material 3 ripple: a delegated pointerdown listener spawns expanding press
// circles on interactive elements while the M3 design layer is active
// ([data-ui-style="material3"]). One listener for the whole app — no
// per-component wiring — and every spawned span cleans itself up on
// animationend.

let installed = false;

export function installM3Ripples(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0) return;
      const root = document.documentElement;
      if (root.dataset.uiStyle !== "material3") return;
      const target = (event.target as Element | null)?.closest(
        'button:not(:disabled), [role="button"]:not([aria-disabled="true"])',
      );
      if (!target || !root.contains(target)) return;
      spawnRipple(target as HTMLElement, event.clientX, event.clientY);
    },
    true,
  );
}

function spawnRipple(
  host: HTMLElement,
  clientX: number,
  clientY: number,
): void {
  const rect = host.getBoundingClientRect();
  const diameter = Math.max(rect.width, rect.height) * 2.2;
  const x = clientX - rect.left - diameter / 2;
  const y = clientY - rect.top - diameter / 2;

  const ripple = document.createElement("span");
  ripple.className = "m3-ripple";
  ripple.style.width = ripple.style.height = `${diameter}px`;
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;

  // The ripple span is absolutely positioned, so a STATIC host needs
  // position:relative to anchor it (.m3-ripple-host). An already-positioned
  // host (absolute/fixed/…) must keep its position value: forcing relative
  // here turned the header search pill's left:50% into a +50% relative
  // offset and the pill visibly jumped aside mid-press, so the click landed
  // on the header behind it and the search popup never opened.
  const alreadyPositioned = getComputedStyle(host).position !== "static";
  const hostClass = alreadyPositioned ? "m3-ripple-host-pos" : "m3-ripple-host";
  host.classList.add(hostClass);
  host.appendChild(ripple);
  ripple.addEventListener(
    "animationend",
    () => {
      ripple.remove();
      if (!host.querySelector(".m3-ripple")) {
        host.classList.remove("m3-ripple-host", "m3-ripple-host-pos");
      }
    },
    { once: true },
  );
}
