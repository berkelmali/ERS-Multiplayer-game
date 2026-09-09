#!/usr/bin/env python3
"""
memory_store.py — a local, searchable observation archive for agent sessions.

A durable tier-2 store behind whatever conversational memory the host provides.
SQLite with FTS5 full-text search. Standard library only — no Node, no Bun, no
vector database, no daemon.

    memory_store.py init [--db PATH]
    memory_store.py add --type TYPE --title T [--body B] [--tags a,b] [--files f1,f2]
    memory_store.py search QUERY [--type T] [--project P] [--since 30d] [--limit N]
    memory_store.py timeline [--around ID] [--project P] [--days N]
    memory_store.py get ID [ID ...]
    memory_store.py digest --before 60d          # bundle old entries for summarization
    memory_store.py digest --commit FILE         # store the summary, archive the originals
    memory_store.py stats
    memory_store.py export [--format md|jsonl] [--out FILE]
    memory_store.py import FILE.jsonl
    memory_store.py forget ID [ID ...] | --query Q

Database location, in order of precedence:
    --db PATH  >  $CLAUDE_MEMORY_DB  >  ./.claude-memory/memory.db

The retrieval commands are designed for progressive disclosure: `search` returns
a compact index (roughly 15 tokens per hit), `timeline` gives surrounding
context, and `get` returns full bodies only for the ids you chose. Fetching
everything up front is the failure mode this exists to avoid.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import textwrap
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCHEMA_VERSION = 1

TYPES = ["decision", "constraint", "preference", "bugfix", "pattern",
         "reference", "gotcha", "state", "digest"]

# Patterns that should never be written to a durable store. Detection is
# deliberately conservative — a false positive costs one --force flag, a false
# negative writes a live credential to disk.
SECRET_PATTERNS = [
    (r"\b(sk-[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9\-_]{20,})\b", "API key"),
    (r"\bgh[pousr]_[A-Za-z0-9]{30,}\b", "GitHub token"),
    (r"\bAKIA[0-9A-Z]{16}\b", "AWS access key id"),
    (r"\bxox[baprs]-[A-Za-z0-9\-]{10,}\b", "Slack token"),
    (r"-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----", "private key"),
    (r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b", "JWT"),
    (r"\b(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['\"][^'\"]{8,}['\"]", "inline credential"),
    (r"\b[A-Za-z0-9._%+-]+:[^@\s/]{6,}@[A-Za-z0-9.-]+\b", "credentials in a URL or DSN"),
]

DDL = """
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS observations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT    NOT NULL,
    type       TEXT    NOT NULL,
    project    TEXT    NOT NULL DEFAULT '',
    session    TEXT    NOT NULL DEFAULT '',
    title      TEXT    NOT NULL,
    body       TEXT    NOT NULL DEFAULT '',
    why        TEXT    NOT NULL DEFAULT '',
    tags       TEXT    NOT NULL DEFAULT '',
    files      TEXT    NOT NULL DEFAULT '',
    confidence TEXT    NOT NULL DEFAULT 'probable',
    superseded INTEGER NOT NULL DEFAULT 0,
    archived   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_obs_created ON observations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_obs_project ON observations(project);
CREATE INDEX IF NOT EXISTS idx_obs_type    ON observations(type);

CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
    title, body, why, tags, files,
    content='observations', content_rowid='id', tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS obs_ai AFTER INSERT ON observations BEGIN
    INSERT INTO observations_fts(rowid, title, body, why, tags, files)
    VALUES (new.id, new.title, new.body, new.why, new.tags, new.files);
END;
CREATE TRIGGER IF NOT EXISTS obs_ad AFTER DELETE ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, title, body, why, tags, files)
    VALUES ('delete', old.id, old.title, old.body, old.why, old.tags, old.files);
END;
CREATE TRIGGER IF NOT EXISTS obs_au AFTER UPDATE ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, title, body, why, tags, files)
    VALUES ('delete', old.id, old.title, old.body, old.why, old.tags, old.files);
    INSERT INTO observations_fts(rowid, title, body, why, tags, files)
    VALUES (new.id, new.title, new.body, new.why, new.tags, new.files);
END;
"""


# --------------------------------------------------------------- helpers


def db_path(args: argparse.Namespace) -> Path:
    if getattr(args, "db", None):
        return Path(args.db)
    env = os.environ.get("CLAUDE_MEMORY_DB")
    if env:
        return Path(env)
    return Path.cwd() / ".claude-memory" / "memory.db"


def connect(path: Path, create: bool = False) -> sqlite3.Connection:
    if not path.exists():
        if not create:
            print(
                f"No memory store at {path}\n"
                f"Run:  memory_store.py init --db {path}",
                file=sys.stderr,
            )
            raise SystemExit(2)
        path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(DDL)
    conn.execute(
        "INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', ?)",
        (str(SCHEMA_VERSION),),
    )
    conn.commit()
    return conn


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def parse_since(value: str | None) -> str | None:
    """Accept '30d', '6h', '2w', or an ISO date. Returns an ISO timestamp."""
    if not value:
        return None
    m = re.fullmatch(r"(\d+)([hdwmy])", value.strip().lower())
    if m:
        n = int(m.group(1))
        unit = {"h": "hours", "d": "days", "w": "weeks", "m": "days", "y": "days"}[m.group(2)]
        n = n * 30 if m.group(2) == "m" else n * 365 if m.group(2) == "y" else n
        return (datetime.now(timezone.utc) - timedelta(**{unit: n})).isoformat()
    try:
        return datetime.fromisoformat(value).astimezone(timezone.utc).isoformat()
    except ValueError:
        print(f"Cannot parse --since {value!r}. Use 30d, 6h, 2w, or an ISO date.", file=sys.stderr)
        raise SystemExit(2)


def scan_secrets(*texts: str) -> list[str]:
    blob = "\n".join(t for t in texts if t)
    return sorted({label for pattern, label in SECRET_PATTERNS
                   if re.search(pattern, blob, re.IGNORECASE)})


def csv_list(value: str | None) -> str:
    if not value:
        return ""
    return ",".join(sorted({p.strip() for p in value.split(",") if p.strip()}))


def short_date(iso: str) -> str:
    return iso[:10]


def fts_escape(query: str) -> str:
    """Quote bare terms so punctuation in a query cannot become FTS syntax."""
    if any(op in query for op in (" AND ", " OR ", " NOT ", "*", '"')):
        return query
    terms = [t for t in re.split(r"\s+", query.strip()) if t]
    return " ".join('"' + t.replace('"', "") + '"' for t in terms)


# --------------------------------------------------------------- commands


def cmd_init(args: argparse.Namespace) -> int:
    path = db_path(args)
    existed = path.exists()
    conn = connect(path, create=True)
    (n,) = conn.execute("SELECT count(*) FROM observations").fetchone()
    conn.close()
    print(f"{'Opened' if existed else 'Created'} memory store: {path}")
    print(f"  schema v{SCHEMA_VERSION} · {n} observation(s)")
    if not existed:
        print("\nAdd this to .gitignore if the store holds anything project-private:")
        print(f"  {path.parent.name}/")
    return 0


def cmd_add(args: argparse.Namespace) -> int:
    conn = connect(db_path(args), create=True)
    body, why = args.body or "", args.why or ""

    # Read the body from stdin ONLY when asked for explicitly.
    #
    # This used to also fire on `not body and not sys.stdin.isatty()`, meaning
    # "a pipe must be feeding us". isatty() cannot tell that apart from *any*
    # non-interactive stdin — an agent shell, a CI step, the right-hand side of
    # an `&&` chain — so omitting `--body` made the command block forever on a
    # stdin that was never going to close, with no output and no error. Same
    # shape as the defects this store exists to remember: a condition that
    # reads like it detects one thing and actually matches a far wider set.
    if args.body == "-":
        body = sys.stdin.read().strip()

    leaks = scan_secrets(args.title, body, why)
    if leaks and not args.force:
        print(
            f"REFUSED — the content looks like it contains: {', '.join(leaks)}.\n"
            f"A memory store is durable and gets read back automatically. Record the\n"
            f"fact ('the deploy key lives in 1Password under X') rather than the secret.\n"
            f"Use --force if this is a false positive.",
            file=sys.stderr,
        )
        return 2
    if leaks:
        print(f"WARNING: stored despite matching {', '.join(leaks)} (--force)", file=sys.stderr)

    cur = conn.execute(
        """INSERT INTO observations
           (created_at, type, project, session, title, body, why, tags, files, confidence)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (now_iso(), args.type, args.project or "", args.session or "",
         args.title, body, why, csv_list(args.tags), csv_list(args.files),
         args.confidence),
    )
    new_id = cur.lastrowid

    if args.supersedes:
        ids = [int(i) for i in args.supersedes.split(",") if i.strip().isdigit()]
        conn.executemany("UPDATE observations SET superseded=? WHERE id=?",
                         [(new_id, i) for i in ids])
        print(f"superseded: {', '.join(map(str, ids))}")

    conn.commit()
    conn.close()
    print(f"#{new_id}  [{args.type}] {args.title}")
    return 0


def _row_line(r: sqlite3.Row) -> str:
    flags = []
    if r["superseded"]:
        flags.append(f"superseded-by-#{r['superseded']}")
    if r["archived"]:
        flags.append("archived")
    tail = f"  ({', '.join(flags)})" if flags else ""
    proj = f" {r['project']}" if r["project"] else ""
    return f"#{r['id']:<5} {short_date(r['created_at'])} {r['type']:<11}{proj} {r['title']}{tail}"


def cmd_search(args: argparse.Namespace) -> int:
    conn = connect(db_path(args))
    where, params = [], []

    if args.query:
        sql = ("SELECT o.* FROM observations o "
               "JOIN observations_fts f ON f.rowid = o.id "
               "WHERE observations_fts MATCH ? ")
        params.append(fts_escape(args.query))
        order = "ORDER BY bm25(observations_fts), o.created_at DESC "
    else:
        sql = "SELECT o.* FROM observations o WHERE 1=1 "
        order = "ORDER BY o.created_at DESC "

    if args.type:
        where.append("o.type = ?")
        params.append(args.type)
    if args.project:
        where.append("o.project = ?")
        params.append(args.project)
    if args.tag:
        where.append("(',' || o.tags || ',') LIKE ?")
        params.append(f"%,{args.tag},%")
    since = parse_since(args.since)
    if since:
        where.append("o.created_at >= ?")
        params.append(since)
    if not args.all:
        where.append("o.superseded = 0 AND o.archived = 0")

    if where:
        sql += "AND " + " AND ".join(where) + " "
    sql += order + "LIMIT ?"
    params.append(args.limit)

    try:
        rows = conn.execute(sql, params).fetchall()
    except sqlite3.OperationalError as exc:
        print(f"Search failed: {exc}", file=sys.stderr)
        return 2
    conn.close()

    if args.json:
        print(json.dumps([dict(r) for r in rows], ensure_ascii=False, indent=2))
        return 0 if rows else 1

    if not rows:
        print("no matches")
        return 1
    for r in rows:
        print(_row_line(r))
    print(f"\n{len(rows)} result(s). Full detail:  memory_store.py get "
          f"{' '.join(str(r['id']) for r in rows[:5])}")
    return 0


def cmd_timeline(args: argparse.Namespace) -> int:
    conn = connect(db_path(args))
    if args.around:
        anchor = conn.execute("SELECT * FROM observations WHERE id=?", (args.around,)).fetchone()
        if not anchor:
            print(f"No observation #{args.around}", file=sys.stderr)
            return 2
        before = conn.execute(
            "SELECT * FROM observations WHERE created_at <= ? AND id != ? "
            "ORDER BY created_at DESC LIMIT ?",
            (anchor["created_at"], anchor["id"], args.window),
        ).fetchall()
        after = conn.execute(
            "SELECT * FROM observations WHERE created_at >= ? AND id != ? "
            "ORDER BY created_at ASC LIMIT ?",
            (anchor["created_at"], anchor["id"], args.window),
        ).fetchall()
        rows = list(reversed(before)) + [anchor] + list(after)
    else:
        params: list = []
        sql = "SELECT * FROM observations WHERE 1=1 "
        if args.project:
            sql += "AND project = ? "
            params.append(args.project)
        since = parse_since(f"{args.days}d")
        sql += "AND created_at >= ? ORDER BY created_at DESC LIMIT ?"
        params += [since, args.limit]
        rows = list(reversed(conn.execute(sql, params).fetchall()))
    conn.close()

    if args.json:
        print(json.dumps([dict(r) for r in rows], ensure_ascii=False, indent=2))
        return 0

    current_day = None
    for r in rows:
        day = short_date(r["created_at"])
        if day != current_day:
            print(f"\n{day}")
            current_day = day
        marker = " >>" if args.around and r["id"] == args.around else "   "
        print(f"{marker} {_row_line(r)}")
    if not rows:
        print("nothing in range")
    return 0


def cmd_get(args: argparse.Namespace) -> int:
    conn = connect(db_path(args))
    placeholders = ",".join("?" * len(args.ids))
    rows = conn.execute(
        f"SELECT * FROM observations WHERE id IN ({placeholders}) ORDER BY created_at",
        args.ids,
    ).fetchall()
    conn.close()

    if args.json:
        print(json.dumps([dict(r) for r in rows], ensure_ascii=False, indent=2))
        return 0 if rows else 1

    missing = set(args.ids) - {r["id"] for r in rows}
    for r in rows:
        print(f"\n{'=' * 68}")
        print(f"#{r['id']}  [{r['type']}]  {r['created_at']}"
              + (f"  project={r['project']}" if r["project"] else ""))
        print(f"{r['title']}")
        if r["why"]:
            print(f"\nWhy: {r['why']}")
        if r["body"]:
            print()
            print(textwrap.indent(r["body"], "  "))
        details = []
        if r["tags"]:
            details.append(f"tags: {r['tags']}")
        if r["files"]:
            details.append(f"files: {r['files']}")
        if r["confidence"] != "probable":
            details.append(f"confidence: {r['confidence']}")
        if r["superseded"]:
            details.append(f"SUPERSEDED BY #{r['superseded']}")
        if details:
            print("\n  " + " · ".join(details))
    if missing:
        print(f"\nnot found: {', '.join(map(str, sorted(missing)))}", file=sys.stderr)
    return 0 if rows else 1


def cmd_digest(args: argparse.Namespace) -> int:
    """Two-phase compaction. The model does the summarizing; this moves bytes."""
    conn = connect(db_path(args))

    if args.commit:
        text = Path(args.commit).read_text(encoding="utf-8")
        ids = [int(i) for i in re.findall(r"#(\d+)", text.split("<!--ids:", 1)[-1])] \
            if "<!--ids:" in text else []
        if not ids:
            print("The digest file must end with a line like:\n"
                  "  <!--ids: #12 #13 #14 -->\n"
                  "naming the observations it replaces.", file=sys.stderr)
            return 2
        summary = text.split("<!--ids:", 1)[0].strip()
        cur = conn.execute(
            """INSERT INTO observations
               (created_at, type, project, session, title, body, why, tags, files, confidence)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (now_iso(), "digest", args.project or "", "",
             args.title or f"Digest of {len(ids)} observations",
             summary, f"Compacted from #{min(ids)}-#{max(ids)}", "digest", "", "certain"),
        )
        new_id = cur.lastrowid
        conn.executemany("UPDATE observations SET archived=1 WHERE id=?", [(i,) for i in ids])
        conn.commit()
        conn.close()
        print(f"#{new_id} digest stored; archived {len(ids)} observation(s).")
        print("Archived entries are still searchable with --all; nothing was deleted.")
        return 0

    before = parse_since(args.before)
    rows = conn.execute(
        "SELECT * FROM observations WHERE created_at < ? AND archived=0 AND type != 'digest' "
        "ORDER BY created_at",
        (before,),
    ).fetchall()
    conn.close()

    if not rows:
        print(f"nothing older than {args.before} to compact")
        return 1

    out = [
        f"# Digest candidates — {len(rows)} observations older than {args.before}",
        "",
        "Summarize these into durable facts. Keep every decision and its reason;",
        "drop the play-by-play. Then append the id line at the bottom and run:",
        "  memory_store.py digest --commit THIS_FILE",
        "",
    ]
    for r in rows:
        out.append(f"## #{r['id']} [{r['type']}] {short_date(r['created_at'])} — {r['title']}")
        if r["why"]:
            out.append(f"Why: {r['why']}")
        if r["body"]:
            out.append(r["body"])
        out.append("")
    out.append(f"<!--ids: {' '.join('#' + str(r['id']) for r in rows)} -->")

    text = "\n".join(out)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"{len(rows)} observation(s) written to {args.out}")
    else:
        print(text)
    return 0


def cmd_stats(args: argparse.Namespace) -> int:
    conn = connect(db_path(args))
    total, = conn.execute("SELECT count(*) FROM observations").fetchone()
    active, = conn.execute(
        "SELECT count(*) FROM observations WHERE superseded=0 AND archived=0").fetchone()
    by_type = conn.execute(
        "SELECT type, count(*) n FROM observations WHERE archived=0 "
        "GROUP BY type ORDER BY n DESC").fetchall()
    by_project = conn.execute(
        "SELECT project, count(*) n FROM observations WHERE archived=0 AND project != '' "
        "GROUP BY project ORDER BY n DESC LIMIT 10").fetchall()
    span = conn.execute(
        "SELECT min(created_at) a, max(created_at) b FROM observations").fetchone()
    conn.close()

    path = db_path(args)
    size = path.stat().st_size / 1024 if path.exists() else 0
    print(f"{path}  ({size:.0f} KB)")
    print(f"  {total} observation(s), {active} active, "
          f"{total - active} superseded or archived")
    if span["a"]:
        print(f"  span: {short_date(span['a'])} .. {short_date(span['b'])}")
    if by_type:
        print("\n  by type")
        for r in by_type:
            print(f"    {r['type']:<12} {r['n']}")
    if by_project:
        print("\n  by project")
        for r in by_project:
            print(f"    {r['project']:<24} {r['n']}")
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    conn = connect(db_path(args))
    sql = "SELECT * FROM observations WHERE 1=1 "
    params: list = []
    if args.project:
        sql += "AND project = ? "
        params.append(args.project)
    if not args.all:
        sql += "AND archived = 0 "
    rows = conn.execute(sql + "ORDER BY created_at", params).fetchall()
    conn.close()

    if args.format == "jsonl":
        text = "\n".join(json.dumps(dict(r), ensure_ascii=False) for r in rows)
    else:
        parts = [f"# Memory export — {len(rows)} observations", f"_{now_iso()}_", ""]
        day = None
        for r in rows:
            d = short_date(r["created_at"])
            if d != day:
                parts.append(f"\n## {d}\n")
                day = d
            parts.append(f"### #{r['id']} [{r['type']}] {r['title']}")
            if r["why"]:
                parts.append(f"**Why:** {r['why']}")
            if r["body"]:
                parts.append(r["body"])
            meta = [f"`{k}`: {r[k]}" for k in ("project", "tags", "files") if r[k]]
            if meta:
                parts.append("_" + " · ".join(meta) + "_")
            parts.append("")
        text = "\n".join(parts)

    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"{len(rows)} observation(s) -> {args.out}")
    else:
        print(text)
    return 0


def cmd_import(args: argparse.Namespace) -> int:
    conn = connect(db_path(args), create=True)
    added = skipped = 0
    for line in Path(args.file).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            skipped += 1
            continue
        if not rec.get("title"):
            skipped += 1
            continue
        leaks = scan_secrets(rec.get("title", ""), rec.get("body", ""), rec.get("why", ""))
        if leaks and not args.force:
            print(f"skipped (looks like {', '.join(leaks)}): {rec['title'][:50]}", file=sys.stderr)
            skipped += 1
            continue
        conn.execute(
            """INSERT INTO observations
               (created_at, type, project, session, title, body, why, tags, files, confidence)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (rec.get("created_at") or now_iso(), rec.get("type", "reference"),
             rec.get("project", ""), rec.get("session", ""), rec["title"],
             rec.get("body", ""), rec.get("why", ""), rec.get("tags", ""),
             rec.get("files", ""), rec.get("confidence", "probable")),
        )
        added += 1
    conn.commit()
    conn.close()
    print(f"imported {added}, skipped {skipped}")
    return 0


def cmd_forget(args: argparse.Namespace) -> int:
    conn = connect(db_path(args))
    if args.query:
        rows = conn.execute(
            "SELECT o.id, o.title FROM observations o JOIN observations_fts f ON f.rowid=o.id "
            "WHERE observations_fts MATCH ?", (fts_escape(args.query),)
        ).fetchall()
        ids = [r["id"] for r in rows]
    else:
        ids = args.ids
        rows = conn.execute(
            f"SELECT id, title FROM observations WHERE id IN ({','.join('?' * len(ids))})", ids
        ).fetchall()

    if not rows:
        print("nothing matched")
        return 1
    for r in rows:
        print(f"  #{r['id']} {r['title']}")
    if not args.yes:
        print(f"\n{len(rows)} observation(s) would be deleted permanently. "
              f"Re-run with --yes to confirm.")
        return 1
    conn.executemany("DELETE FROM observations WHERE id=?", [(i,) for i in ids])
    conn.commit()
    conn.close()
    print(f"\ndeleted {len(ids)}")
    return 0


# --------------------------------------------------------------- cli


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--db", help="path to the memory database")
    sub = ap.add_subparsers(dest="command", required=True)

    sub.add_parser("init", help="create or open the store")

    p = sub.add_parser("add", help="record one observation")
    p.add_argument("--type", required=True, choices=TYPES)
    p.add_argument("--title", required=True, help="one line, the fact itself")
    p.add_argument("--body", help="detail; '-' reads stdin (only when given explicitly)")
    p.add_argument("--why", help="why this is true or why it was decided — the part that ages well")
    p.add_argument("--project", default="")
    p.add_argument("--session", default="")
    p.add_argument("--tags", help="comma separated")
    p.add_argument("--files", help="comma separated paths this concerns")
    p.add_argument("--confidence", choices=["certain", "probable", "speculative"],
                   default="probable")
    p.add_argument("--supersedes", help="comma separated ids this replaces")
    p.add_argument("--force", action="store_true", help="store despite a secret-pattern match")

    p = sub.add_parser("search", help="compact index of matches (cheap)")
    p.add_argument("query", nargs="?", default="")
    p.add_argument("--type", choices=TYPES)
    p.add_argument("--project")
    p.add_argument("--tag")
    p.add_argument("--since", help="30d / 6h / 2w / ISO date")
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--all", action="store_true", help="include superseded and archived")
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("timeline", help="chronological context")
    p.add_argument("--around", type=int, help="observation id to center on")
    p.add_argument("--window", type=int, default=5, help="entries either side of --around")
    p.add_argument("--project")
    p.add_argument("--days", type=int, default=14)
    p.add_argument("--limit", type=int, default=40)
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("get", help="full detail for specific ids (expensive — batch them)")
    p.add_argument("ids", nargs="+", type=int)
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("digest", help="bundle old entries for summarization, then commit it")
    p.add_argument("--before", default="60d", help="age threshold (default 60d)")
    p.add_argument("--out", help="write the bundle to a file")
    p.add_argument("--commit", metavar="FILE", help="store a written digest and archive its sources")
    p.add_argument("--title")
    p.add_argument("--project", default="")

    sub.add_parser("stats", help="what the store holds")

    p = sub.add_parser("export", help="dump to markdown or jsonl")
    p.add_argument("--format", choices=["md", "jsonl"], default="md")
    p.add_argument("--out")
    p.add_argument("--project")
    p.add_argument("--all", action="store_true")

    p = sub.add_parser("import", help="load a jsonl export")
    p.add_argument("file")
    p.add_argument("--force", action="store_true")

    p = sub.add_parser("forget", help="permanently delete observations")
    p.add_argument("ids", nargs="*", type=int)
    p.add_argument("--query")
    p.add_argument("--yes", action="store_true")

    args = ap.parse_args()
    handlers = {
        "init": cmd_init, "add": cmd_add, "search": cmd_search, "timeline": cmd_timeline,
        "get": cmd_get, "digest": cmd_digest, "stats": cmd_stats, "export": cmd_export,
        "import": cmd_import, "forget": cmd_forget,
    }
    try:
        return handlers[args.command](args)
    except BrokenPipeError:
        return 0
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
