import asyncio
import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace

import inkboard_telegram as t

NOW = datetime(2026, 11, 16, 15, 30)


def msg(minutes_ago, chat, sender, text, mine=False):
    return t.Msg(NOW - timedelta(minutes=minutes_ago), chat, sender, text, mine)


class Formatting(unittest.TestCase):
    def test_when_label(self):
        self.assertEqual(t.when_label(NOW - timedelta(hours=1), NOW), "14:30")
        self.assertEqual(t.when_label(NOW - timedelta(days=1), NOW), "Yest 15:30")
        self.assertEqual(t.when_label(NOW - timedelta(days=3), NOW), "Fri 15:30")
        self.assertEqual(t.when_label(NOW - timedelta(days=20), NOW), "27 Oct")

    def test_clean_flattens_whitespace_and_drops_control_characters(self):
        self.assertEqual(t.clean("a\n\nb\t c\x00\x07  d"), "a b c d")

    def test_clip_counts_wide_characters_double(self):
        self.assertEqual(t.clip("abcdef", 4), "abc…")
        self.assertEqual(t.clip("日本語日本語", 7), "日本語…")
        self.assertEqual(t.clip("short", 10), "short")

    def test_body_is_wrapped_and_the_last_line_marks_the_cut(self):
        lines = t.body_lines("one two three four five six seven eight nine ten", 12, 2)
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[-1].endswith("…"))
        self.assertTrue(all(t.cells(l) <= 12 for l in lines))
        self.assertEqual(t.body_lines("short", 20, 2), ["short"])
        self.assertEqual(t.body_lines("   ", 20, 2), [])
        self.assertEqual(t.body_lines("anything", 20, 0), [])

    def test_render_layout(self):
        out = t.render([msg(5, "Ada", "", "Hello there"), msg(70, "Book club", "Grace", "Chapter nine"), msg(2000, "Ada", "", "Thanks", mine=True)], 40, 2, NOW).split("\n")
        self.assertEqual(out[0], "15:25      Ada")
        self.assertEqual(out[1], "  Hello there")
        self.assertEqual(out[2], "14:20      Book club · Grace")
        self.assertEqual(out[4], "Yest 06:10 → Ada")

    def test_render_never_exceeds_the_width(self):
        long = msg(1, "A very long chat name that keeps going and going", "Someone with a long name too", "x" * 300)
        for line in t.render([long], 50, 3, NOW).split("\n"):
            self.assertLessEqual(t.cells(line), 50, line)

    def test_demo_has_fifteen_messages(self):
        out = t.render(t.demo_messages(NOW), 80, 2, NOW)
        self.assertEqual(sum(1 for l in out.split("\n") if not l.startswith("  ")), 15)


class MediaLabels(unittest.TestCase):
    def test_labels(self):
        self.assertEqual(t.message_text(SimpleNamespace(raw_text="look", photo=True)), "[photo] look")
        self.assertEqual(t.message_text(SimpleNamespace(raw_text="", voice=True)), "[voice message]")
        self.assertEqual(t.message_text(SimpleNamespace(raw_text="hi")), "hi")
        self.assertEqual(t.message_text(SimpleNamespace(raw_text="", sticker=True, file=SimpleNamespace(emoji="👍"))), "[sticker 👍]")
        self.assertEqual(t.message_text(SimpleNamespace(raw_text="", document=True, file=SimpleNamespace(name="a.pdf"))), "[file a.pdf]")
        self.assertEqual(t.message_text(SimpleNamespace(raw_text="")), "")


class FakeClient:
    """Stands in for Telethon: chats come in Telegram's order (pinned first), each with its own messages."""

    def __init__(self, chats):
        self.chats = chats
        self.asked = []

    async def iter_dialogs(self, limit=None):
        for d, _ in self.chats:
            yield d

    async def iter_messages(self, dialog, limit=None):
        self.asked.append(dialog.name)
        for m in dialog.messages[:limit]:
            yield m


def fake_message(minutes_ago, text, out=False, action=None, sender="Sam"):
    when = (NOW - timedelta(minutes=minutes_ago)).astimezone()
    return SimpleNamespace(date=when, raw_text=text, out=out, action=action, sender=SimpleNamespace(first_name=sender))


def fake_dialog(name, messages, is_user=False):
    return SimpleNamespace(name=name, is_user=is_user, messages=messages, date=messages[0].date if messages else None)


class Fetching(unittest.TestCase):
    def run_fetch(self, dialogs, n=3, only_incoming=False):
        client = FakeClient([(d, None) for d in dialogs])
        return asyncio.run(t.fetch(client, n, only_incoming)), client

    def test_newest_messages_across_chats_and_stops_early(self):
        pinned_old = fake_dialog("Pinned", [fake_message(5000, "old")])  # Telegram lists pinned chats first, however old
        busy = fake_dialog("Busy", [fake_message(1, "b1"), fake_message(2, "b2"), fake_message(3, "b3")])
        quiet = fake_dialog("Quiet", [fake_message(10, "q1")])
        stale = fake_dialog("Stale", [fake_message(900, "s1")])
        msgs, client = self.run_fetch([pinned_old, busy, quiet, stale])
        self.assertEqual([m.text for m in msgs], ["b1", "b2", "b3"])
        self.assertNotIn("Stale", client.asked)  # nothing in it can beat the three newest

    def test_busy_chat_does_not_hide_a_chat_with_a_newer_message(self):
        a = fake_dialog("A", [fake_message(10, "a1"), fake_message(11, "a2"), fake_message(12, "a3")])
        b = fake_dialog("B", [fake_message(1, "b1")])
        msgs, _ = self.run_fetch([a, b])
        self.assertEqual([m.text for m in msgs], ["b1", "a1", "a2"])

    def test_skips_service_messages_and_can_leave_out_your_own(self):
        d = fake_dialog("Group", [fake_message(1, "", action=object()), fake_message(2, "mine", out=True), fake_message(3, "theirs")])
        self.assertEqual([m.text for m in self.run_fetch([d])[0]], ["mine", "theirs"])
        self.assertEqual([m.text for m in self.run_fetch([d], only_incoming=True)[0]], ["theirs"])

    def test_sender_is_named_in_groups_only(self):
        group = fake_dialog("Group", [fake_message(1, "hi", sender="Grace")])
        private = fake_dialog("Ada", [fake_message(2, "hello", sender="Ada")], is_user=True)
        msgs, _ = self.run_fetch([group, private])
        self.assertEqual([(m.chat, m.sender) for m in msgs], [("Group", "Grace"), ("Ada", "")])


class Cli(unittest.TestCase):
    def test_arguments_are_clamped(self):
        self.assertEqual(t.parser().parse_args(["recent"]).count, 15)
        self.assertEqual(t.parser().parse_args(["recent", "7", "--width", "60"]).width, 60)


if __name__ == "__main__":
    unittest.main()
