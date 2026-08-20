# superpowers plugin patches

Local edits to the installed **superpowers** Claude Code plugin. The plugin lives in a
version-keyed cache directory, so **any plugin update installs into a new directory and
silently loses these edits**. Re-apply after every upgrade.

## superpowers-review-rounds.patch

|                 |                                                                     |
| --------------- | ------------------------------------------------------------------- |
| Plugin          | `superpowers@claude-plugins-official`                               |
| Version patched | **6.3.0** (git sha `44c9b2d6e889982ac18c27d05a19fefe335194e1`)      |
| Plugin root     | `~/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0` |
| File patched    | `skills/subagent-driven-development/SKILL.md`                       |
| Backup on disk  | `skills/subagent-driven-development/SKILL.md.bak-2026-08-21`        |

### Why

Stock 6.3.0 reviews every task the same way, regardless of what the task is: `### 3. Review
the task` says **"Never skip the task review"**, and `### 4. The fix loop` allows **"Five
rounds maximum per task"**. In practice that is 2–3 reviewer passes on every task, including
renames and CRUD that mirrors an exemplar — which is what made the audit-log run cost ~8
hours (see `../WORKFLOW.md`).

The patch replaces that blanket behaviour with the **Review-by-risk matrix** from
`../WORKFLOW.md`:

| Task type                                                                              | Review rounds  |
| -------------------------------------------------------------------------------------- | -------------- |
| Mechanical (renames, enum moves, CRUD mirroring an exemplar, contract regen)           | 0 (gates only) |
| Normal feature (a service + endpoint + UI + tests)                                     | 1              |
| High-stakes (Prisma schema, migrations/raw SQL, access resolver, auth, scoring, money) | 2              |

Default when the plan carries no risk signal: **1**. The plugin has no structured risk
field — `scripts/task-brief` copies the whole task block out of the plan — so the controller
reads a `Risk:`/`Reviews:` line from the task text when the plan has one (the lean task
template in `../WORKFLOW.md` emits both), and otherwise judges from the work.

Two safety properties are deliberately kept:

- Reviews are never disabled. A Critical finding, or one the controller confirms is
  load-bearing, raises any task to the high-stakes budget of 2 — a Critical fix never ships
  without a re-review.
- The breaker is unchanged. When the budget is spent with findings open, the controller
  adjudicates and parks them with rulings, and the final whole-branch review still sees
  both sides.

**Out of scope, deliberately untouched:** model selection. The `## Model Selection` section
is byte-identical to stock, and there is no `model:` frontmatter in this skill. Model choice
is handled by the `CLAUDE_CODE_SUBAGENT_MODEL` env var in `.claude/settings.json`.

### Apply (after a plugin update)

```sh
ROOT=~/.claude/plugins/cache/claude-plugins-official/superpowers/<new-version>
cd "$ROOT"
cp -p skills/subagent-driven-development/SKILL.md \
      skills/subagent-driven-development/SKILL.md.bak-$(date +%F)
patch -p1 --dry-run < ~/Projects/iace/docs/superpowers/patches/superpowers-review-rounds.patch
patch -p1          < ~/Projects/iace/docs/superpowers/patches/superpowers-review-rounds.patch
```

If the dry run rejects, upstream rewrote the review sections — re-derive the edit against
the new text rather than forcing it, and update this README's version row.

### Revert

The plugin directory is **not** a git repo, so revert from the backup:

```sh
ROOT=~/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0
cp -p "$ROOT/skills/subagent-driven-development/SKILL.md.bak-2026-08-21" \
      "$ROOT/skills/subagent-driven-development/SKILL.md"
```

Or reinstall the plugin, which restores stock and drops the patch:
`claude plugin update superpowers@claude-plugins-official`.
