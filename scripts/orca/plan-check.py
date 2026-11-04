#!/usr/bin/env python3
"""Check a plan before the user approves it and before it runs.

Usage: ./scripts/orca/plan-check.py <plan.md>

The plan follows docs/templates/plan.md. Checked: Goal and Preconditions are filled in, the
plan has 1 to 5 tasks numbered T1, T2, ..., every task carries Target, Change,
Constraints, Ownership, Acceptance, Commit and Docs, every Acceptance item names a command or a
path in backticks and runs no inline interpreter code or unmarked process check, every Ownership names tests (or says `no existing test changes`), every
commit subject fits in 72 characters, and the
Outcome section exists.
Prints one line per problem, then `PLAN OK` or `PLAN FAILED <count>`; exit 1 on failure.
"""

import re
import sys
from pathlib import Path

MAX_TASKS = 5
FIELDS = ("Target", "Change", "Constraints", "Ownership", "Acceptance", "Commit", "Docs")
PLACEHOLDERS = ("one sentence.", "links to the ADRs", "what must exist before the first dispatch",
                "files, page or component in scope", "the concrete result",
                "one item per line, each a command", "Imperative subject")
# An interpreter, only flags after it, then the flag that takes code: node --input-type=module -e "…".
INLINE_CODE = re.compile(r"\b(node|python3?|perl|ruby)(\s+-[-\w=]+)*?\s+-(e|c|pe|p|-eval)\b")
# A process check fails in every sandbox (`sysmond service not found`, emdash-images plan 017).
PROCESS_CHECK = re.compile(r"`[^`]*\b(pgrep|pkill|ps)\s[^`]*`")
FIELD = re.compile(r"^- \*\*(\w[\w ]*):\*\*\s*(.*)$")

def fields_of(lines):
    """Field name -> its text: the line after the label plus the indented lines under it."""
    out, name = {}, None
    for line in lines:
        match = FIELD.match(line)
        if match:
            name = match.group(1)
            out[name] = [match.group(2)] if match.group(2).strip() else []
        elif name and line.startswith("  ") and line.strip():
            out[name].append(line.rstrip())
        elif not line.strip():
            continue
        else:
            name = None
    return out

def acceptance_items(text):
    """The outermost sub-bullets, each with its wrapped lines and nested bullets; without
    sub-bullets, the inline text."""
    bullets = [len(t) - len(t.lstrip()) for t in text if t.lstrip().startswith(("- ", "* "))]
    if not bullets:
        return [" ".join(t.strip() for t in text)] if text else []
    outer, items = min(bullets), []
    for line in text:
        indent = len(line) - len(line.lstrip())
        if indent == outer and line.lstrip().startswith(("- ", "* ")):
            items.append(line.strip()[2:])
        elif items:
            items[-1] += " " + line.strip()
    return items

def check(path):
    text = path.read_text()
    problems = []
    for placeholder in PLACEHOLDERS:
        if placeholder in text:
            problems.append(f"template text left in the plan: {placeholder!r}")
    if not re.search(r"^# \d{3} \S", text, re.M):
        problems.append("title must be `# NNN Title` with a three-digit number")
    for label in ("Goal", "Preconditions"):
        match = re.search(rf"^\*\*{label}:\*\*\s*(\S.*)$", text, re.M)
        if not match:
            problems.append(f"**{label}:** is missing or empty")
    if not re.search(r"^## Outcome", text, re.M):
        problems.append("## Outcome section is missing")
    tasks_part = re.split(r"^## Tasks\s*$", text, maxsplit=1, flags=re.M)
    if len(tasks_part) < 2:
        problems.append("## Tasks section is missing")
        return problems
    body = re.split(r"^## ", tasks_part[1], maxsplit=1, flags=re.M)[0]
    blocks = re.split(r"^### ", body, flags=re.M)[1:]
    if not blocks:
        problems.append("no tasks: each starts with `### T<n>: Title`")
    if len(blocks) > MAX_TASKS:
        problems.append(f"{len(blocks)} tasks: a plan has at most {MAX_TASKS}; "
                        "split it and plan the rest after this one's Outcome")
    for index, block in enumerate(blocks, 1):
        lines = block.splitlines()
        head = re.match(r"T(\d+):\s*\S", lines[0])
        name = f"T{index}"
        if not head or int(head.group(1)) != index:
            problems.append(f"task {index}: heading must be `### T{index}: Title`, found `### {lines[0]}`")
        fields = fields_of(lines[1:])
        for field in FIELDS:
            if not fields.get(field):
                problems.append(f"{name}: **{field}:** is missing or empty")
        ownership = " ".join(fields.get("Ownership", []))
        if ownership and not re.search(r"\btests?\b|\.(test|spec)\.|/tests?/|_test\.", ownership, re.I):
            problems.append(f"{name}: Ownership names no tests: list the tests the change breaks "
                            "(grep for what it changes) or write `no existing test changes`")
        for item in acceptance_items(fields.get("Acceptance", [])):
            if "`" not in item:
                problems.append(f"{name}: Acceptance item without a command or path in backticks: {item[:70]!r}")
            elif INLINE_CODE.search(item):
                problems.append(f"{name}: Acceptance item runs inline code, which the Claude roles cannot "
                                f"rerun; put the check in a test or a script: {item[:70]!r}")
            elif PROCESS_CHECK.search(item) and "(gate)" not in item:
                problems.append(f"{name}: Acceptance item checks processes, which fails in every sandbox; "
                                f"assert it in a test or mark the item `(gate)`: {item[:70]!r}")
        commit = " ".join(fields.get("Commit", []))
        subject = re.search(r"`([^`]+)`", commit)
        if commit and not subject:
            problems.append(f"{name}: Commit must be a subject in backticks")
        elif subject and len(subject.group(1)) > 72:
            problems.append(f"{name}: commit subject has {len(subject.group(1))} characters, at most 72")
    return problems

def main(args):
    if len(args) != 1:
        sys.exit(__doc__)
    path = Path(args[0])
    if not path.is_file():
        print(f"no such plan: {path}")
        print("PLAN FAILED 1")
        sys.exit(1)
    problems = check(path)
    for problem in problems:
        print(problem)
    print("PLAN OK" if not problems else f"PLAN FAILED {len(problems)}")
    sys.exit(1 if problems else 0)

if __name__ == "__main__":
    main(sys.argv[1:])
