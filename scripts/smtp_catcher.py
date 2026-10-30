#!/usr/bin/env python3
"""Local SMTP catcher: captures every mail the Liner mailer sends to :1025
into an .eml file, so the production sending path can be verified end-to-end
without provider credentials."""
import asyncio
import os
from pathlib import Path

from aiosmtpd.controller import Controller

OUT = Path("/home/z/my-project/scripts/email-captures")
OUT.mkdir(parents=True, exist_ok=True)


class Catcher:
    async def handle_DATA(self, server, session, envelope):
        payload = envelope.original_content
        target = OUT / f"mail-{len(list(OUT.glob('mail-*.eml'))) + 1}.eml"
        target.write_bytes(payload)
        print(f"[catcher] captured {target.name} from={envelope.mail_from} "
              f"to={envelope.rcpt_tos} bytes={len(payload)}", flush=True)
        return "250 Message accepted for delivery"


async def main():
    controller = Controller(Catcher(), hostname="127.0.0.1", port=1025)
    controller.start()
    print("[catcher] listening on 127.0.0.1:1025", flush=True)
    await asyncio.Event().wait()


if __name__ == "__main__":
    os.environ.setdefault("PYTHONUNBUFFERED", "1")
    asyncio.run(main())
