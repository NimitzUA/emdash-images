#!/usr/bin/env python3
"""The event log of the Claude roles in an Orca workflow: every approval prompt shown to the user
and every command a kit hook refused, one JSON line each, in the main checkout's
`.scratch/tmp/orca-events.jsonl` (also when the role runs in a plan worktree).

Run as a `PermissionRequest` hook (`orca_events.py --role=<role>`) it records the prompt and
prints nothing, so Claude Code shows the prompt as usual. `plain-commands.py` imports `record`
for its refusals. `orca-watch.sh` warns from the log while a plan runs, and the kit's `audit.py`
counts it afterwards. Logging never fails the hook: any error is swallowed.
"""

import json
import os
import sys
import time
from pathlib import Path

LOG = Path(".scratch") / "tmp" / "orca-events.jsonl"


def main_checkout(start):
    """The main checkout for a checkout or a linked worktree (whose `.git` is a file)."""
    git = start / ".git"
    if git.is_file():
        # gitdir: <main>/.git/worktrees/<name>
        target = git.read_text().split(":", 1)[1].strip()
        return Path(target).parent.parent.parent
    return start


def role_of(argv):
    return next((a.split("=", 1)[1] for a in argv if a.startswith("--role=")), "unknown")


def record(event, tool_name, tool_input, reason="", argv=None):
    try:
        checkout = Path(__file__).resolve().parent.parent.parent
        text = tool_input.get("command") or tool_input.get("file_path") or json.dumps(tool_input)
        entry = {
            "time": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "event": event,
            "role": role_of(argv if argv is not None else sys.argv),
            "checkout": checkout.name,
            "tool": tool_name,
            "input": str(text)[:300],
            "reason": reason[:160],
        }
        if os.environ.get("ORCA_PROBE"):
            # A `probe.py` check, not a real run: audit and orca-watch leave it out. The value
            # names the case, so probes running side by side do not read each other's events.
            entry["probe"] = os.environ["ORCA_PROBE"]
        log = main_checkout(checkout) / LOG
        log.parent.mkdir(parents=True, exist_ok=True)
        with log.open("a") as out:
            out.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:  # noqa: BLE001 - the log must never break a hook
        pass


if __name__ == "__main__":
    try:
        data = json.load(sys.stdin)
        record("prompt", data.get("tool_name", ""), data.get("tool_input") or {})
    except Exception:  # noqa: BLE001
        pass
