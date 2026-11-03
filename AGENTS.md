<!-- orca-setup:begin -->
## Working in Orca

This section is for Codex executors. Claude roles (architect, reviewer, QA) follow their own
agent file and skip it.

When your prompt starts with an Orca preamble carrying Task and Dispatch ids:

- The preamble is authoritative. Do only that task, in the worktree Orca started you in.
  Never create or remove worktrees. The preamble and this section hold every Orca command you
  need: do not load Orca skills (`orca skills get`; the Codex rules refuse it) or read
  `orca … --help` (read 342 times in 403 executor sessions).
- Ask the architect with the preamble's `ask` command when the plan leaves a decision open,
  then end your turn: Orca wakes you with the answer. Do not guess, do not wait at a local
  prompt nobody can answer, and do not poll for the answer.
- `ask` is the only message that gets an answer: send no `--type status` or `--type escalation`
  message (a reply to one never reaches you, and nobody waits for a status). Your progress is the
  checklist and the worktree comment.
- Do not run `orca orchestration check`: answers and the architect's messages reach you when
  Orca wakes you. (In plans 015 and 016 executors still ran it, with flags it does not take.)
- If `send` or `ask` returns `consumer_fenced`, this terminal no longer owns the task:
  stop, send no `worker_done` and retry nothing.
- The architect's answer is binding. If it does not work, `ask` again with the reason; do not
  take another route on your own.
- Never install, update or remove dependencies (`npm install`, `npm ci`, `npm update`). Change
  the package files only, then `ask` "dependencies changed, run install". The architect installs
  in your worktree outside the sandbox and answers with the result.
- If the clean change needs a file outside your Ownership, `ask` for it. Do not copy code
  around the boundary: a copy of a shared helper is a defect the next plan has to remove.
- Never type your terminal handle: a handle off by one character makes every
  `orca orchestration` call fail, and retyping it from the preamble or from `printenv` went
  wrong in practice. Write `--from "$ORCA_TERMINAL_HANDLE"` (and
  `--terminal "$ORCA_TERMINAL_HANDLE"`) and let the shell fill it in. Copy the other ids
  from the preamble exactly.
- Put the text you pass to `orca` (`--question`, `--body`, `--comment`) in single quotes and
  write an apostrophe inside it as `’`: in double quotes a backtick or `$(` runs as a shell
  command and the text arrives mangled. Quote a URL with `?` or `&` the same way: zsh reads
  `?` as a glob and refuses the command.
- Keep the checklist at the task's progress path, one line per Acceptance item; when you tick an
  item, set `orca worktree set --worktree current --comment "T<n> · step k/n · <what>"` once
  (not for every command: executors set it 1,294 times). Send
  heartbeats only if the preamble gives a heartbeat command, at its cadence; the checklist and
  the worktree comment carry the progress.
- Read and search files with `rg`, `sed -n '<a>,<b>p'`, `cat` or `nl`, piped among themselves as
  you need: inside the sandbox they ask nobody.
- Change files with `apply_patch`; one patch may touch several places in several files. A
  mechanical change across many lines or files (a rename, tabs for spaces) may run as one
  command inside the worktree (`sed -i`, `perl -pi`, a codemod); name it in your report. Notes
  and reports under `.scratch/` may be written with a heredoc.
- Never write `.env` or another secret file yourself, with `apply_patch`, a shell command or inline
  code: the project's scripts keep it. If a value is missing, `ask`.
- Run every `git`, `orca` command on its own: no `cd`, `&&`, `;`,
  pipes (`| jq`) or `VAR=value` prefixes. Chained, they run inside the sandbox and fail; read
  `--json` output directly.
- Commit with the message the task gives, as plain `-m` options in double quotes (no `$'…'`,
  heredoc or `-F`: they run inside the sandbox). In a FIX round, amend your task's commit. If
  signing fails twice, leave the changes staged, write the report with "commit waits for
  1Password" and finish with `worker_done --outcome failed`. Do not wait for it in `ask` or
  `ask --resume`: nobody may be there to approve it (one executor waited 241 minutes that way);
  the architect commits the staged changes from its own terminal.
- Never start subagents, review agents or other models: the architect runs the review. A skill
  that says to dispatch a reviewer or subagent, or to finish the branch, does not apply to you.
- Before `worker_done`, check your work as the reviewer will:
  - a new or changed test fails without your change: run it before the change (or with the
    change undone) and put its failing line in the report next to the passing one;
  - every command, flag and path you wrote into docs, runbooks, comments or messages exists:
    run it, or check it with its `--help` (not for `orca`) or `ls`;
  - nothing outside your Ownership changed (`git status --short`).
- Write the report to the Report path in your spec, in the format of `docs/templates/report.md`: for each
  Acceptance item the command you ran and the result line it printed. A claim without its
  result line counts as not done. Never paste `.env` values, tokens or connection strings into it.
- Finish with exactly one `worker_done`: the preamble's command with `--outcome succeeded` (or
  `failed`), plus `--report-path <absolute report path> --files-modified <path,path>`
  (comma-separated, no spaces). Then stay idle.
<!-- orca-setup:end -->
