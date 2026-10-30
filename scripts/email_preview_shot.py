#!/usr/bin/env python3
"""Screenshot the two rendered email previews (dark card + banners)."""
import asyncio
from pathlib import Path

from playwright.async_api import async_playwright

PREVIEWS = Path("/home/z/my-project/download/email-previews")
OUT = Path("/tmp/render/emails")
OUT.mkdir(parents=True, exist_ok=True)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 700, "height": 1200})
        for name in ("welcome", "banned"):
            await page.goto(f"file://{PREVIEWS}/{name}.html")
            await page.wait_for_load_state("networkidle")
            body = page.locator("body")
            await page.screenshot(path=str(OUT / f"{name}.png"), full_page=True)
            print(f"[shot] {OUT / name}.png")
        await browser.close()


asyncio.run(main())
