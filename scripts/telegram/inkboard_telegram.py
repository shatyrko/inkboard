#!/usr/bin/env python3
"""The newest Telegram messages as plain text, for the "Command" widget of an Inkboard dashboard.

    inkboard-telegram login                 one-time sign-in (asks for api_id/api_hash, phone, code, 2FA password)
    inkboard-telegram recent [N] [--width COLS] [--lines L] [--only-incoming]
    inkboard-telegram status                "signed in" or an explanation
    inkboard-telegram logout                forgets the session on this computer
    inkboard-telegram recent --demo         invented messages, no network (for laying out the dashboard)

It signs in as your own Telegram account (Telethon, MTProto), so it sees the same chats as the Telegram app. The api_id/api_hash
come from https://my.telegram.org (API development tools). Everything it stores lives in one private folder next to Inkboard's
settings and nowhere else: config.json and the session file (which is a login for your account: treat it like a password).
"""
import argparse
import asyncio
import fcntl
import getpass
import json
import os
import re
import stat
import sys
import textwrap
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

HOME = Path(os.environ.get("INKBOARD_TELEGRAM_DIR") or Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "inkboard" / "telegram")
CONFIG = HOME / "config.json"
SESSION = HOME / "account"  # Telethon adds ".session"
LOCK = HOME / "run.lock"
FETCH_TIMEOUT = 8  # the widget gives a command 10 seconds


class Failure(Exception):
    """Something the user can act on; printed without a traceback."""


# ------------------------------------------------------------------ formatting (no Telegram needed)


@dataclass
class Msg:
    when: datetime  # local time
    chat: str
    sender: str  # "" for channels and private chats where it equals the chat
    text: str
    mine: bool = False


def clean(text: str) -> str:
    """One line: control characters dropped, runs of whitespace collapsed."""
    text = "".join(" " if c in "\n\r\t" else c for c in text if c in "\n\r\t" or unicodedata.category(c)[0] != "C")
    return re.sub(r"\s+", " ", text).strip()


def cells(text: str) -> int:
    """Terminal cells the text takes: East Asian wide characters count double."""
    return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in text)


def clip(text: str, width: int) -> str:
    """The text cut to `width` cells, ending in an ellipsis when something was cut."""
    if cells(text) <= width:
        return text
    out, used = "", 0
    for c in text:
        w = cells(c)
        if used + w > width - 1:
            break
        out, used = out + c, used + w
    return out.rstrip() + "…"


def when_label(when: datetime, now: datetime) -> str:
    days = (now.date() - when.date()).days
    if days <= 0:
        return when.strftime("%H:%M")
    if days == 1:
        return "Yest " + when.strftime("%H:%M")
    if days < 7:
        return when.strftime("%a %H:%M")
    return when.strftime("%-d %b")


def body_lines(text: str, width: int, max_lines: int) -> list[str]:
    """The message text wrapped to `width` cells, at most `max_lines` lines, the last one ending in an ellipsis when more follows."""
    text = clean(text)
    if not text or max_lines <= 0:
        return []
    lines = textwrap.wrap(text, width=width, break_long_words=True, break_on_hyphens=False)
    if len(lines) <= max_lines:
        return [clip(l, width) for l in lines]
    kept = lines[:max_lines]
    kept[-1] = clip(kept[-1] + " " + " ".join(lines[max_lines:]), width)
    return kept


def render(msgs: list[Msg], width: int = 80, max_lines: int = 2, now: datetime | None = None) -> str:
    now = now or datetime.now()
    indent = "  "
    out: list[str] = []
    for m in msgs:
        who = ("→ " if m.mine else "") + clip(m.chat, width // 2)
        head = f"{when_label(m.when, now):<10} {who}" + (f" · {m.sender}" if m.sender and not m.mine else "")
        out.append(clip(head, width))
        out.extend(indent + l for l in body_lines(m.text, width - len(indent), max_lines))
    return "\n".join(out)


def media_label(m) -> str:
    """A short word for what a message carries besides text. Works on a Telethon message."""
    for attr, label in (("photo", "photo"), ("voice", "voice message"), ("video_note", "video message"), ("gif", "GIF"), ("video", "video"), ("audio", "audio"), ("sticker", "sticker"), ("poll", "poll"), ("geo", "location"), ("contact", "contact"), ("document", "file")):
        if getattr(m, attr, None):
            if attr == "sticker":
                emoji = getattr(getattr(m, "file", None), "emoji", None)
                return f"sticker {emoji}" if emoji else "sticker"
            if attr == "document":
                name = getattr(getattr(m, "file", None), "name", None)
                return f"file {name}" if name else "file"
            return label
    return ""


def message_text(m) -> str:
    body = (getattr(m, "raw_text", None) or "").strip()
    label = media_label(m)
    return f"[{label}] {body}".strip() if label else body


# ------------------------------------------------------------------ demo


def demo_messages(now: datetime) -> list[Msg]:
    t = lambda minutes: now - timedelta(minutes=minutes)
    return [
        Msg(t(3), "Ada Lovelace", "", "Are we still on for the demo at four? I can bring the printed slides if the projector acts up again."),
        Msg(t(11), "Book club", "Grace", "Chapter nine is the long one, so maybe start early. The ending is worth it though, no spoilers!"),
        Msg(t(24), "Plumber", "", "[photo] Found the leak, it was the old valve under the sink."),
        Msg(t(55), "Weekend hike", "Linus", "Trail is dry, boots are enough."),
        Msg(t(95), "Family", "Mom", "Dinner on Sunday? I'm making soup."),
        Msg(t(130), "Ada Lovelace", "", "Thanks!", mine=True),
        Msg(t(260), "Neighbours", "Alan", "[voice message]"),
        Msg(t(400), "Release notes", "Margaret", "v2.4 is out: faster sync, a new export dialog and a lot of small fixes. Full list in the pinned message."),
        Msg(t(1500), "Chess club", "Kasparov", "Rematch next Thursday?"),
        Msg(t(1700), "Library", "", "Your reserved book is ready for pickup until Friday."),
        Msg(t(2900), "Garden swap", "Flora", "[photo] Tomato seedlings, free to a good home."),
        Msg(t(4400), "Ada Lovelace", "", "Sent you the notes from Monday."),
        Msg(t(5800), "Weekend hike", "Linus", "Meeting point is the north gate."),
        Msg(t(9000), "Book club", "Grace", "Next month: something short, please."),
        Msg(t(12000), "Family", "Dad", "[sticker 👍]"),
    ]


# ------------------------------------------------------------------ Telegram


def load_config() -> dict:
    try:
        cfg = json.loads(CONFIG.read_text())
        return {"api_id": int(cfg["api_id"]), "api_hash": str(cfg["api_hash"])}
    except (OSError, ValueError, KeyError):
        raise Failure("Telegram is not set up. Run: inkboard-telegram login")


def private_dir() -> None:
    HOME.mkdir(parents=True, exist_ok=True)
    HOME.chmod(0o700)


def lock_down() -> None:
    """The session file is a login for the account: only this user may read it."""
    for p in HOME.glob("*"):
        if p.is_file():
            p.chmod(stat.S_IRUSR | stat.S_IWUSR)


def make_client():
    try:
        from telethon import TelegramClient
    except ImportError:
        raise Failure("Telethon is missing. Run scripts/telegram/setup.sh again.")
    cfg = load_config()
    return TelegramClient(str(SESSION), cfg["api_id"], cfg["api_hash"], connection_retries=1, request_retries=1, timeout=6)


async def fetch(client, n: int, only_incoming: bool) -> list[Msg]:
    """The `n` newest messages over all chats. Chats are visited newest first and the walk stops as soon as no later chat can contribute."""
    dialogs = [d async for d in client.iter_dialogs(limit=200)]
    dialogs.sort(key=lambda d: d.date.timestamp() if d.date else 0, reverse=True)  # pinned chats come first from Telegram, not by date
    found: list[tuple[datetime, Msg]] = []
    for d in dialogs:
        if d.date is None:
            continue
        if len(found) >= n and d.date <= found[n - 1][0]:
            break
        async for m in client.iter_messages(d, limit=n):
            if m.action is not None or (only_incoming and m.out):
                continue
            text = message_text(m)
            if not text:
                continue
            sender = "" if m.out or d.is_user or not m.sender else (getattr(m.sender, "first_name", None) or getattr(m.sender, "title", None) or getattr(m.sender, "username", None) or "")
            found.append((m.date, Msg(m.date.astimezone().replace(tzinfo=None), d.name or "Unknown", sender, text, m.out)))
        found.sort(key=lambda p: p[0], reverse=True)
    return [msg for _, msg in found[:n]]


async def cmd_recent(args) -> str:
    if args.demo:
        return render(demo_messages(datetime.now())[: args.count], args.width, args.lines)
    private_dir()
    with open(LOCK, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        client = make_client()
        try:
            await asyncio.wait_for(client.connect(), FETCH_TIMEOUT)
            if not await client.is_user_authorized():
                raise Failure("Telegram is signed out. Run: inkboard-telegram login")
            msgs = await asyncio.wait_for(fetch(client, args.count, args.only_incoming), FETCH_TIMEOUT)
        except asyncio.TimeoutError:
            raise Failure("Telegram did not answer in time.")
        finally:
            await client.disconnect()
    return render(msgs, args.width, args.lines) or "No messages yet."


async def cmd_login(args) -> str:
    os.umask(0o077)
    private_dir()
    try:
        cfg = load_config()
    except Failure:
        print("Create an app at https://my.telegram.org (API development tools) to get these two values.")
        api_id = int(input("api_id: ").strip())
        api_hash = getpass.getpass("api_hash (hidden): ").strip()
        CONFIG.write_text(json.dumps({"api_id": api_id, "api_hash": api_hash}))
        lock_down()
    client = make_client()
    try:
        await client.start(
            phone=lambda: input("Phone number with country code (+...): ").strip(),
            code_callback=lambda: input("Login code Telegram sent you: ").strip(),
            password=lambda: getpass.getpass("Two-step password (hidden): "),
        )
    finally:
        await client.disconnect()
    lock_down()
    return "Signed in. Messages can now be read by `inkboard-telegram recent`."


async def cmd_status(args) -> str:
    client = make_client()
    try:
        await asyncio.wait_for(client.connect(), FETCH_TIMEOUT)
        return "signed in" if await client.is_user_authorized() else "signed out: run inkboard-telegram login"
    except asyncio.TimeoutError:
        raise Failure("Telegram did not answer in time.")
    finally:
        await client.disconnect()


async def cmd_logout(args) -> str:
    client = make_client()
    try:
        await asyncio.wait_for(client.connect(), FETCH_TIMEOUT)
        if await client.is_user_authorized():
            await client.log_out()  # ends the session on Telegram's side too
    finally:
        await client.disconnect()
    for p in HOME.glob("account.session*"):
        p.unlink(missing_ok=True)
    return "Signed out and session removed."


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="inkboard-telegram", description="Recent Telegram messages as text for an Inkboard dashboard.")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("recent", help="print the newest messages")
    r.add_argument("count", nargs="?", type=int, default=15)
    r.add_argument("--width", type=int, default=80, help="characters per line (default 80)")
    r.add_argument("--lines", type=int, default=2, help="text lines kept per message (default 2)")
    r.add_argument("--only-incoming", action="store_true", help="leave out your own messages")
    r.add_argument("--demo", action="store_true", help="invented messages, no network")
    for name, helptext in (("login", "sign in once"), ("status", "are we signed in?"), ("logout", "sign out and forget the session")):
        sub.add_parser(name, help=helptext)
    return p


COMMANDS = {"recent": cmd_recent, "login": cmd_login, "status": cmd_status, "logout": cmd_logout}


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    args.count = max(1, min(getattr(args, "count", 15), 50))
    if hasattr(args, "width"):
        args.width = max(20, min(args.width, 200))
        args.lines = max(0, min(args.lines, 6))
    try:
        print(asyncio.run(COMMANDS[args.cmd](args)))
    except Failure as e:
        print(e, file=sys.stderr)
        return 1
    except (KeyboardInterrupt, EOFError):
        print("Cancelled.", file=sys.stderr)
        return 1
    except Exception as e:  # Telethon raises many kinds; the widget shows the first line of stderr
        print(f"Telegram failed: {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
