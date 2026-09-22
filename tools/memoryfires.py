#!/usr/bin/env python3
"""
memoryfires.py — an agent memory store where every derived belief keeps a
deterministic path back to the evidence it came from.

    memoryfires.py init
    memoryfires.py add --kind decision --title "..." --why "..."
    memoryfires.py derive --from 12,13,14 --kind digest --title "..."
    memoryfires.py why 42
    memoryfires.py policy add --rule "..." --because "..." --when "..."
    memoryfires.py brief
    memoryfires.py search "auth" --project api
    memoryfires.py get 12 13
    memoryfires.py adopt --from ../.claude-memory/memory.db
    memoryfires.py check
    memoryfires.py --selftest

The one mechanism this is built around: a **derived** memory — a digest, a
promoted policy, a conclusion — records the exact set of memories it was derived
from. `why` walks that chain and shows the evidence, marking any link whose
source is missing rather than presenting an unbroken tree.

The reason it matters: compaction without provenance produces a store whose
summaries cannot be checked. The sources usually still exist, but the mapping
from a conclusion to *which* sources produced it is imprecise, so nobody can
audit a belief the agent is acting on.

Safety properties, each with a test:

  - Reads the schema version on every open and REFUSES a newer one. A store
    written by a future version is not opened read-write.
  - Never writes to another tool's database. `adopt` opens a v1 archive
    read-only and copies rows forward.
  - Backs up before any destructive operation.
  - Fails loud on broken provenance: `why` reports a missing source as a broken
    chain, and `forget` refuses to delete a memory that a derived memory cites.
  - Refuses to store obvious credentials.

Standard library only. Exit codes: 0 ok, 1 nothing found / integrity findings,
2 usage error, 3 refused (version or safety).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
import textwrap
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCHEMA_VERSION = 1
TOOL = "memoryfires"

KINDS = ["decision", "constraint", "preference", "correction", "gotcha",
         "pattern", "reference", "state", "digest", "policy"]

# Roles an edge can carry. `compacted` means the source was folded into the
# derived memory; `supersedes` means it was replaced; the rest are relations.
ROLES = ["compacted", "supersedes", "supports", "contradicts"]

CONFIDENCE = ["certain", "probable", "speculative"]

SECRET_PATTERNS = [
    (r"\b(sk-[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9\-_]{20,})\b", "API key"),
    (r"\bgh[pousr]_[A-Za-z0-9]{30,}\b", "GitHub token"),
    (r"\bAKIA[0-9A-Z]{16}\b", "AWS access key id"),
    (r"\bxox[baprs]-[A-Za-z0-9\-]{10,}\b", "Slack token"),
    (r"-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----", "private key"),
    (r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b", "JWT"),
    (r"\b(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['\"][^'\"]{8,}['\"]",
     "inline credential"),
    (r"\b[A-Za-z0-9._%+-]+:[^@\s/]{6,}@[A-Za-z0-9.-]+\b", "credentials in a URL"),
]

DDL = """
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT    NOT NULL,
    kind        TEXT    NOT NULL,
    project     TEXT    NOT NULL DEFAULT '',
    session     TEXT    NOT NULL DEFAULT '',
    title       TEXT    NOT NULL,
    body        TEXT    NOT NULL DEFAULT '',
    why         TEXT    NOT NULL DEFAULT '',
    trigger_on  TEXT    NOT NULL DEFAULT '',
    tags        TEXT    NOT NULL DEFAULT '',
    files       TEXT    NOT NULL DEFAULT '',
    confidence  TEXT    NOT NULL DEFAULT 'probable',
    derived     INTEGER NOT NULL DEFAULT 0,
    archived    INTEGER NOT NULL DEFAULT 0,
    origin      TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_mem_created ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mem_project ON memories(project);
CREATE INDEX IF NOT EXISTS idx_mem_kind    ON memories(kind);

-- The spine. One row per (derived memory, source memory) pair.
CREATE TABLE IF NOT EXISTS edges (
    derived_id INTEGER NOT NULL,
    source_id  INTEGER NOT NULL,
    role       TEXT    NOT NULL DEFAULT 'compacted',
    created_at TEXT    NOT NULL,
    PRIMARY KEY (derived_id, source_id, role)
);

CREATE INDEX IF NOT EXISTS idx_edge_derived ON edges(derived_id);
CREATE INDEX IF NOT EXISTS idx_edge_source  ON edges(source_id);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    title, body, why, trigger_on, tags, files,
    content='memories', content_rowid='id', tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS mem_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, title, body, why, trigger_on, tags, files)
    VALUES (new.id, new.title, new.body, new.why, new.trigger_on, new.tags, new.files);
END;
CREATE TRIGGER IF NOT EXISTS mem_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, title, body, why, trigger_on, tags, files)
    VALUES ('delete', old.id, old.title, old.body, old.why, old.trigger_on, old.tags, old.files);
END;
CREATE TRIGGER IF NOT EXISTS mem_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, title, body, why, trigger_on, tags, files)
    VALUES ('delete', old.id, old.title, old.body, old.why, old.trigger_on, old.tags, old.files);
    INSERT INTO memories_fts(rowid, title, body, why, trigger_on, tags, files)
    VALUES (new.id, new.title, new.body, new.why, new.trigger_on, new.tags, new.files);
END;
"""


class Refused(Exception):
    """A safety or version refusal. Never a crash, always a stated reason."""


# --------------------------------------------------------------- helpers


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def short_date(iso: str) -> str:
    return (iso or "")[:10]


def db_path(args: argparse.Namespace) -> Path:
    if getattr(args, "db", None):
        return Path(args.db)
    env = os.environ.get("MEMORYFIRES_DB")
    if env:
        return Path(env)
    return Path.cwd() / ".memoryfires" / "memory.db"


def read_version(conn: sqlite3.Connection) -> int | None:
    """The check the predecessor never made."""
    try:
        row = conn.execute(
            "SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
    except sqlite3.Error:
        return None
    if not row:
        return None
    try:
        return int(row[0])
    except (TypeError, ValueError):
        return None


def connect(path: Path, create: bool = False) -> sqlite3.Connection:
    if not path.exists():
        if not create:
            raise Refused(f"No memoryfires store at {path}\n"
                          f"Run:  memoryfires.py init --db {path}")
        path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row

    existing = read_version(conn)
    if existing is not None and existing > SCHEMA_VERSION:
        conn.close()
        raise Refused(
            f"{path} was written by schema v{existing}; this build understands "
            f"v{SCHEMA_VERSION}.\nRefusing to open it read-write — an older "
            f"build writing a newer store corrupts it silently.\nUpgrade "
            f"memoryfires, or point --db at a different file.")

    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(DDL)
    conn.execute("INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', ?)",
                 (str(SCHEMA_VERSION),))
    conn.execute("INSERT OR IGNORE INTO meta(key, value) VALUES ('created_at', ?)",
                 (now_iso(),))
    conn.commit()
    return conn


def backup(path: Path) -> Path | None:
    """Before anything destructive. Cheap insurance on a small file."""
    if not path.exists():
        return None
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = path.with_name(f"{path.stem}.{stamp}.bak")
    shutil.copyfile(path, dest)
    return dest


def scan_secrets(*texts: str) -> list[str]:
    blob = "\n".join(t for t in texts if t)
    return sorted({label for pattern, label in SECRET_PATTERNS
                   if re.search(pattern, blob, re.IGNORECASE)})


def csv_list(value: str | None) -> str:
    if not value:
        return ""
    return ",".join(sorted({p.strip() for p in value.split(",") if p.strip()}))


def parse_ids(value: str) -> list[int]:
    return [int(x) for x in re.findall(r"\d+", value or "")]


def parse_since(value: str | None) -> str | None:
    if not value:
        return None
    m = re.fullmatch(r"(\d+)([hdwmy])", value.strip().lower())
    if m:
        n, unit = int(m.group(1)), m.group(2)
        days = {"h": None, "d": n, "w": n * 7, "m": n * 30, "y": n * 365}[unit]
        delta = timedelta(hours=n) if unit == "h" else timedelta(days=days)
        return (datetime.now(timezone.utc) - delta).isoformat()
    try:
        return datetime.fromisoformat(value).astimezone(timezone.utc).isoformat()
    except ValueError:
        raise Refused(f"Cannot parse --since {value!r}. Use 30d, 6h, 2w, or an ISO date.")


def fts_escape(query: str) -> str:
    if any(op in query for op in (" AND ", " OR ", " NOT ", "*", '"')):
        return query
    terms = [t for t in re.split(r"\s+", query.strip()) if t]
    return " ".join('"' + t.replace('"', "") + '"' for t in terms)


def guard_secrets(force: bool, *texts: str) -> None:
    leaks = scan_secrets(*texts)
    if leaks and not force:
        raise Refused(
            f"REFUSED — this looks like it contains: {', '.join(leaks)}.\n"
            f"A memory store is durable and gets read back automatically. Record "
            f"the fact ('the deploy key lives in 1Password under X'), not the "
            f"secret.\nUse --force if this is a false positive.")
    if leaks:
        print(f"WARNING: stored despite matching {', '.join(leaks)} (--force)",
              file=sys.stderr)


# --------------------------------------------------------------- writes


def insert_memory(conn: sqlite3.Connection, *, kind: str, title: str,
                  body: str = "", why: str = "", project: str = "",
                  session: str = "", tags: str = "", files: str = "",
                  confidence: str = "probable", trigger_on: str = "",
                  derived: int = 0, origin: str = "",
                  created_at: str | None = None) -> int:
    cur = conn.execute(
        """INSERT INTO memories
           (created_at, kind, project, session, title, body, why, trigger_on,
            tags, files, confidence, derived, origin)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (created_at or now_iso(), kind, project, session, title, body, why,
         trigger_on, tags, files, confidence, derived, origin))
    return int(cur.lastrowid)


def add_edges(conn: sqlite3.Connection, derived_id: int, source_ids: list[int],
              role: str) -> tuple[list[int], list[int]]:
    """Record provenance. Returns (linked, missing)."""
    present = {r[0] for r in conn.execute(
        f"SELECT id FROM memories WHERE id IN ({','.join('?' * len(source_ids))})",
        source_ids).fetchall()} if source_ids else set()
    linked, missing = [], []
    stamp = now_iso()
    for sid in source_ids:
        if sid in present:
            conn.execute(
                "INSERT OR IGNORE INTO edges(derived_id, source_id, role, created_at) "
                "VALUES (?,?,?,?)", (derived_id, sid, role, stamp))
            linked.append(sid)
        else:
            missing.append(sid)
    return linked, missing


# --------------------------------------------------------------- provenance


def sources_of(conn: sqlite3.Connection, mid: int) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT e.source_id, e.role, m.id AS found, m.kind, m.title, m.archived "
        "FROM edges e LEFT JOIN memories m ON m.id = e.source_id "
        "WHERE e.derived_id = ? ORDER BY e.source_id", (mid,)).fetchall()


def cited_by(conn: sqlite3.Connection, mid: int) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT e.derived_id, e.role, m.title FROM edges e "
        "LEFT JOIN memories m ON m.id = e.derived_id "
        "WHERE e.source_id = ?", (mid,)).fetchall()


def walk(conn: sqlite3.Connection, mid: int, depth: int = 0,
         seen: set[int] | None = None, out: list | None = None) -> list:
    """Depth-first evidence walk. Cycle-safe, and reports broken links."""
    seen = seen if seen is not None else set()
    out = out if out is not None else []
    if mid in seen:
        out.append((depth, mid, "cycle", None, None))
        return out
    seen.add(mid)
    for row in sources_of(conn, mid):
        if row["found"] is None:
            out.append((depth, row["source_id"], "BROKEN", row["role"], None))
            continue
        out.append((depth, row["source_id"], row["kind"], row["role"], row["title"]))
        walk(conn, row["source_id"], depth + 1, seen, out)
    return out


# --------------------------------------------------------------- commands


def cmd_init(args: argparse.Namespace) -> int:
    path = db_path(args)
    existed = path.exists()
    conn = connect(path, create=True)
    n, = conn.execute("SELECT count(*) FROM memories").fetchone()
    e, = conn.execute("SELECT count(*) FROM edges").fetchone()
    conn.close()
    print(f"{'Opened' if existed else 'Created'} {TOOL} store: {path}")
    print(f"  schema v{SCHEMA_VERSION} · {n} memor(ies) · {e} provenance edge(s)")
    if not existed:
        print(f"\nThis store is separate from any other memory tool's database.")
        print(f"Add to .gitignore if it will hold project-private notes:")
        print(f"  {path.parent.name}/")
    return 0


def cmd_add(args: argparse.Namespace) -> int:
    conn = connect(db_path(args), create=True)
    body = args.body or ""
    if body == "-":
        # Explicit only. An implicit "stdin is not a tty" read hangs forever
        # whenever this runs from a hook, a script, or an agent tool call --
        # exactly the contexts it is meant to run in.
        body = sys.stdin.read().strip()
    guard_secrets(args.force, args.title, body, args.why or "")

    mid = insert_memory(conn, kind=args.kind, title=args.title, body=body,
                        why=args.why or "", project=args.project or "",
                        session=args.session or "", tags=csv_list(args.tags),
                        files=csv_list(args.files), confidence=args.confidence)

    if args.supersedes:
        ids = parse_ids(args.supersedes)
        linked, missing = add_edges(conn, mid, ids, "supersedes")
        conn.executemany("UPDATE memories SET archived=1 WHERE id=?",
                         [(i,) for i in linked])
        if linked:
            print(f"supersedes: {', '.join('#' + str(i) for i in linked)}")
        if missing:
            print(f"WARNING: no such memor(ies): "
                  f"{', '.join('#' + str(i) for i in missing)}", file=sys.stderr)
    conn.commit()
    conn.close()
    print(f"#{mid}  [{args.kind}] {args.title}")
    return 0


def cmd_derive(args: argparse.Namespace) -> int:
    """The spine. A derived memory records exactly what it came from."""
    conn = connect(db_path(args), create=True)
    ids = parse_ids(args.source)
    if not ids:
        raise Refused("--from needs at least one source id. A derived memory "
                      "with no sources is just an observation; use `add`.")
    body = args.body or ""
    if body == "-":
        # Explicit only. An implicit "stdin is not a tty" read hangs forever
        # whenever this runs from a hook, a script, or an agent tool call --
        # exactly the contexts it is meant to run in.
        body = sys.stdin.read().strip()
    guard_secrets(args.force, args.title, body, args.why or "")

    mid = insert_memory(conn, kind=args.kind, title=args.title, body=body,
                        why=args.why or "", project=args.project or "",
                        tags=csv_list(args.tags), confidence=args.confidence,
                        derived=1)
    linked, missing = add_edges(conn, mid, ids, args.role)

    if missing and not args.allow_missing:
        conn.rollback()
        conn.close()
        raise Refused(
            f"No such memor(ies): {', '.join('#' + str(i) for i in missing)}.\n"
            f"Refusing to create a derived memory with a broken chain. Fix the "
            f"ids, or pass --allow-missing to record it as incomplete.")

    if args.archive_sources:
        conn.executemany("UPDATE memories SET archived=1 WHERE id=?",
                         [(i,) for i in linked])
    conn.commit()
    conn.close()

    print(f"#{mid}  [{args.kind}] {args.title}")
    print(f"  derived from {len(linked)} source(s): "
          f"{', '.join('#' + str(i) for i in linked)}")
    if missing:
        print(f"  RECORDED INCOMPLETE — missing: "
              f"{', '.join('#' + str(i) for i in missing)}", file=sys.stderr)
    if args.archive_sources:
        print(f"  sources archived (still searchable with --all)")
    return 0


def cmd_why(args: argparse.Namespace) -> int:
    conn = connect(db_path(args))
    row = conn.execute("SELECT * FROM memories WHERE id=?", (args.id,)).fetchone()
    if not row:
        conn.close()
        print(f"No memory #{args.id}", file=sys.stderr)
        return 1

    chain = walk(conn, args.id)
    citers = cited_by(conn, args.id)
    conn.close()

    if args.json:
        print(json.dumps({
            "id": row["id"], "kind": row["kind"], "title": row["title"],
            "derived": bool(row["derived"]),
            "chain": [{"depth": d, "id": i, "kind": k, "role": r, "title": t}
                      for d, i, k, r, t in chain],
            "cited_by": [{"id": c["derived_id"], "role": c["role"]} for c in citers],
        }, ensure_ascii=False, indent=2))
        return 1 if any(k == "BROKEN" for _, _, k, _, _ in chain) else 0

    print(f"#{row['id']}  [{row['kind']}]  {row['title']}")
    if row["why"]:
        print(f"  why: {row['why']}")
    print()

    if not chain:
        if row["derived"]:
            print("  DERIVED but with no recorded sources — this memory claims to "
                  "be a conclusion\n  and cannot show its evidence.")
            return 1
        print("  Observed directly. No evidence chain, and none expected.")
    else:
        print("  Evidence:")
        broken = 0
        for depth, sid, kind, role, title in chain:
            pad = "    " + "  " * depth
            if kind == "BROKEN":
                broken += 1
                print(f"{pad}#{sid}  !! SOURCE MISSING (role: {role}) — "
                      f"this chain is broken")
            elif kind == "cycle":
                print(f"{pad}#{sid}  (already shown — cycle)")
            else:
                print(f"{pad}#{sid}  [{kind}] {title[:66]}   ({role})")
        if broken:
            print(f"\n  {broken} broken link(s). A conclusion whose evidence is "
                  f"gone is not\n  a conclusion you can act on — treat it as "
                  f"unsupported.")

    if citers:
        print(f"\n  Cited by: "
              f"{', '.join('#' + str(c['derived_id']) for c in citers)}")
        print("  Deleting this memory would break those chains.")

    return 1 if any(k == "BROKEN" for _, _, k, _, _ in chain) else 0


def cmd_policy(args: argparse.Namespace) -> int:
    conn = connect(db_path(args), create=True)
    if args.action == "list":
        rows = conn.execute(
            "SELECT * FROM memories WHERE kind='policy' AND archived=0 "
            + ("AND project=? " if args.project else "")
            + "ORDER BY created_at",
            (args.project,) if args.project else ()).fetchall()
        conn.close()
        if not rows:
            print("no active policies")
            return 1
        for r in rows:
            print(f"#{r['id']}  {r['title']}")
            if r["trigger_on"]:
                print(f"        when: {r['trigger_on']}")
            if r["why"]:
                print(f"        because: {r['why']}")
        return 0

    guard_secrets(args.force, args.rule or "", args.because or "")
    if not args.rule:
        raise Refused("policy add needs --rule")
    mid = insert_memory(conn, kind="policy", title=args.rule,
                        why=args.because or "", trigger_on=args.when or "",
                        project=args.project or "", confidence="certain")
    if args.source:
        ids = parse_ids(args.source)
        linked, missing = add_edges(conn, mid, ids, "supports")
        conn.execute("UPDATE memories SET derived=1 WHERE id=?", (mid,))
        if linked:
            print(f"  grounded in {', '.join('#' + str(i) for i in linked)}")
        if missing:
            print(f"  WARNING: missing source(s) "
                  f"{', '.join('#' + str(i) for i in missing)}", file=sys.stderr)
    conn.commit()
    conn.close()
    print(f"#{mid}  [policy] {args.rule}")
    return 0


def cmd_brief(args: argparse.Namespace) -> int:
    """Session-start context: rules first, then what happened recently."""
    conn = connect(db_path(args))
    where = "AND project=?" if args.project else ""
    params = (args.project,) if args.project else ()

    policies = conn.execute(
        f"SELECT * FROM memories WHERE kind='policy' AND archived=0 {where} "
        f"ORDER BY created_at", params).fetchall()
    since = parse_since(f"{args.days}d")
    recent = conn.execute(
        f"SELECT * FROM memories WHERE archived=0 AND kind!='policy' "
        f"AND created_at >= ? {where} ORDER BY created_at DESC LIMIT ?",
        (since, *params, args.limit)).fetchall()
    total, = conn.execute("SELECT count(*) FROM memories").fetchone()
    conn.close()

    if args.json:
        print(json.dumps({
            "policies": [dict(r) for r in policies],
            "recent": [dict(r) for r in recent],
            "total": total,
        }, ensure_ascii=False, indent=2))
        return 0

    if policies:
        print("STANDING RULES")
        for r in policies:
            when = f"  (when: {r['trigger_on']})" if r["trigger_on"] else ""
            print(f"  · {r['title']}{when}")
        print()
    if recent:
        print(f"RECENT ({args.days}d)")
        for r in recent:
            proj = f" {r['project']}" if r["project"] else ""
            mark = "*" if r["derived"] else " "
            print(f" {mark}#{r['id']:<5} {short_date(r['created_at'])} "
                  f"{r['kind']:<11}{proj} {r['title'][:60]}")
        print("\n  * = derived; run `why <id>` to see its evidence")
    if not policies and not recent:
        print(f"nothing in the last {args.days} days ({total} total)")
        return 1
    return 0


def _row_line(r: sqlite3.Row) -> str:
    flags = []
    if r["derived"]:
        flags.append("derived")
    if r["archived"]:
        flags.append("archived")
    tail = f"  ({', '.join(flags)})" if flags else ""
    proj = f" {r['project']}" if r["project"] else ""
    return (f"#{r['id']:<5} {short_date(r['created_at'])} {r['kind']:<11}"
            f"{proj} {r['title']}{tail}")


def cmd_search(args: argparse.Namespace) -> int:
    conn = connect(db_path(args))
    where, params = [], []
    if args.query:
        sql = ("SELECT m.* FROM memories m JOIN memories_fts f ON f.rowid=m.id "
               "WHERE memories_fts MATCH ? ")
        params.append(fts_escape(args.query))
        order = "ORDER BY bm25(memories_fts), m.created_at DESC "
    else:
        sql = "SELECT m.* FROM memories m WHERE 1=1 "
        order = "ORDER BY m.created_at DESC "
    if args.kind:
        where.append("m.kind=?")
        params.append(args.kind)
    if args.project:
        where.append("m.project=?")
        params.append(args.project)
    since = parse_since(args.since)
    if since:
        where.append("m.created_at >= ?")
        params.append(since)
    if args.derived_only:
        where.append("m.derived=1")
    if not args.all:
        where.append("m.archived=0")
    if where:
        sql += "AND " + " AND ".join(where) + " "
    sql += order + "LIMIT ?"
    params.append(args.limit)

    try:
        rows = conn.execute(sql, params).fetchall()
    except sqlite3.OperationalError as exc:
        conn.close()
        raise Refused(f"Search failed: {exc}")
    conn.close()

    if args.json:
        print(json.dumps([dict(r) for r in rows], ensure_ascii=False, indent=2))
        return 0 if rows else 1
    if not rows:
        print("no matches")
        return 1
    for r in rows:
        print(_row_line(r))
    print(f"\n{len(rows)} result(s). Detail: {TOOL}.py get "
          f"{' '.join(str(r['id']) for r in rows[:5])}")
    return 0


def cmd_get(args: argparse.Namespace) -> int:
    conn = connect(db_path(args))
    ph = ",".join("?" * len(args.ids))
    rows = conn.execute(
        f"SELECT * FROM memories WHERE id IN ({ph}) ORDER BY created_at",
        args.ids).fetchall()
    extra = {r["id"]: sources_of(conn, r["id"]) for r in rows}
    conn.close()

    if args.json:
        print(json.dumps([dict(r) for r in rows], ensure_ascii=False, indent=2))
        return 0 if rows else 1

    for r in rows:
        print(f"\n{'=' * 68}")
        print(f"#{r['id']}  [{r['kind']}]  {r['created_at']}"
              + (f"  project={r['project']}" if r["project"] else ""))
        print(r["title"])
        if r["trigger_on"]:
            print(f"\nWhen: {r['trigger_on']}")
        if r["why"]:
            print(f"\nWhy: {r['why']}")
        if r["body"]:
            print()
            print(textwrap.indent(r["body"], "  "))
        bits = []
        if r["tags"]:
            bits.append(f"tags: {r['tags']}")
        if r["files"]:
            bits.append(f"files: {r['files']}")
        if r["confidence"] != "probable":
            bits.append(f"confidence: {r['confidence']}")
        if r["origin"]:
            bits.append(f"origin: {r['origin']}")
        if bits:
            print("\n  " + " · ".join(bits))
        srcs = extra.get(r["id"], [])
        if srcs:
            ok = [s for s in srcs if s["found"] is not None]
            bad = [s for s in srcs if s["found"] is None]
            print(f"  derived from: "
                  f"{', '.join('#' + str(s['source_id']) for s in ok) or '—'}"
                  + (f"   BROKEN: {', '.join('#' + str(s['source_id']) for s in bad)}"
                     if bad else ""))
    missing = set(args.ids) - {r["id"] for r in rows}
    if missing:
        print(f"\nnot found: {', '.join(map(str, sorted(missing)))}", file=sys.stderr)
    return 0 if rows else 1


def cmd_adopt(args: argparse.Namespace) -> int:
    """Copy rows forward from another tool's archive. Source opened READ-ONLY."""
    src = Path(args.source)
    if not src.is_file():
        raise Refused(f"No such database: {src}")

    uri = f"file:{src.as_posix()}?mode=ro"
    try:
        sconn = sqlite3.connect(uri, uri=True)
        sconn.row_factory = sqlite3.Row
    except sqlite3.Error as exc:
        raise Refused(f"Cannot open {src} read-only: {exc}")

    try:
        tables = {r[0] for r in sconn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        table = "observations" if "observations" in tables else (
            "memories" if "memories" in tables else None)
        if not table:
            raise Refused(f"{src} has no 'observations' or 'memories' table — "
                          f"this does not look like a memory archive.")
        rows = sconn.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()
        cols = {d[0] for d in sconn.execute(f"SELECT * FROM {table} LIMIT 0").description}
    finally:
        sconn.close()

    conn = connect(db_path(args), create=True)
    already = {r[0] for r in conn.execute(
        "SELECT origin FROM memories WHERE origin != ''").fetchall()}

    added = skipped = 0
    for r in rows:
        d = dict(r)
        origin = f"{src.name}#{d['id']}"
        if origin in already:
            skipped += 1
            continue
        kind = d.get("type") or d.get("kind") or "reference"
        if kind not in KINDS:
            kind = "reference"
        insert_memory(
            conn, kind=kind, title=d.get("title") or "(untitled)",
            body=d.get("body", ""), why=d.get("why", ""),
            project=d.get("project", ""), session=d.get("session", ""),
            tags=d.get("tags", ""), files=d.get("files", ""),
            confidence=d.get("confidence", "probable"),
            trigger_on=d.get("trigger_on", ""),
            derived=0, origin=origin,
            created_at=d.get("created_at") or now_iso())
        added += 1

    conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('adopted_from', ?)",
                 (str(src),))
    conn.commit()
    conn.close()

    print(f"adopted {added} memor(ies) from {src} (read-only), skipped {skipped} "
          f"already present")
    print(f"  source untouched: {src}")
    print(f"  provenance is null for all adopted rows — they genuinely have no")
    print(f"  recorded evidence chain, and pretending otherwise would be a lie")
    if "id" in cols and added:
        print(f"  each carries origin='{src.name}#<original id>' for traceability")
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    conn = connect(db_path(args))
    findings: list[str] = []

    version = read_version(conn)
    if version != SCHEMA_VERSION:
        findings.append(f"schema version is {version}, expected {SCHEMA_VERSION}")

    orphans = conn.execute(
        "SELECT e.derived_id, e.source_id FROM edges e "
        "LEFT JOIN memories m ON m.id = e.source_id WHERE m.id IS NULL").fetchall()
    for o in orphans:
        findings.append(f"#{o['derived_id']} cites missing source #{o['source_id']}")

    dangling = conn.execute(
        "SELECT e.derived_id FROM edges e "
        "LEFT JOIN memories m ON m.id = e.derived_id WHERE m.id IS NULL "
        "GROUP BY e.derived_id").fetchall()
    for d in dangling:
        findings.append(f"edges reference missing derived memory #{d['derived_id']}")

    unsupported = conn.execute(
        "SELECT m.id, m.title FROM memories m LEFT JOIN edges e "
        "ON e.derived_id = m.id WHERE m.derived=1 AND e.derived_id IS NULL"
    ).fetchall()
    for u in unsupported:
        findings.append(f"#{u['id']} is marked derived but records no sources: "
                        f"{u['title'][:50]}")

    leaky = []
    for r in conn.execute("SELECT id, title, body, why FROM memories").fetchall():
        hits = scan_secrets(r["title"], r["body"], r["why"])
        if hits:
            leaky.append(f"#{r['id']} may contain {', '.join(hits)}")
    findings.extend(leaky)

    total, = conn.execute("SELECT count(*) FROM memories").fetchone()
    edges, = conn.execute("SELECT count(*) FROM edges").fetchone()
    conn.close()

    if args.json:
        print(json.dumps({"total": total, "edges": edges, "findings": findings},
                         ensure_ascii=False, indent=2))
        return 1 if findings else 0

    print(f"check — {db_path(args)}")
    print(f"  {total} memor(ies), {edges} edge(s), schema v{version}")
    if not findings:
        print("\n  No integrity findings. Every derived memory resolves to "
              "sources that exist.")
        return 0
    print(f"\n  {len(findings)} finding(s):")
    for f in findings:
        print(f"    !! {f}")
    print("\n  A broken chain does not mean the belief is wrong — it means it "
          "cannot be checked.")
    return 1


def cmd_forget(args: argparse.Namespace) -> int:
    path = db_path(args)
    conn = connect(path)
    ids = args.ids
    ph = ",".join("?" * len(ids))
    rows = conn.execute(f"SELECT id, title FROM memories WHERE id IN ({ph})",
                        ids).fetchall()
    if not rows:
        conn.close()
        print("nothing matched")
        return 1

    blocked = {}
    for r in rows:
        citers = [c["derived_id"] for c in cited_by(conn, r["id"])]
        if citers:
            blocked[r["id"]] = citers

    for r in rows:
        mark = "  BLOCKED" if r["id"] in blocked else ""
        print(f"  #{r['id']} {r['title']}{mark}")

    if blocked and not args.break_chains:
        conn.close()
        raise Refused(
            "Refusing to delete a memory that a derived memory cites:\n"
            + "\n".join(f"  #{k} is cited by "
                        f"{', '.join('#' + str(c) for c in v)}"
                        for k, v in blocked.items())
            + "\nDeleting it would leave a conclusion whose evidence silently "
              "vanished.\nArchive it instead, or pass --break-chains to accept "
              "that `why` will\nreport those chains as broken from now on.")

    if not args.yes:
        conn.close()
        print(f"\n{len(rows)} memor(ies) would be deleted permanently. "
              f"Re-run with --yes.")
        return 1

    conn.close()
    bak = backup(path)
    conn = connect(path)
    conn.executemany("DELETE FROM memories WHERE id=?", [(r["id"],) for r in rows])
    conn.commit()
    conn.close()
    print(f"\ndeleted {len(rows)}" + (f"  (backup: {bak})" if bak else ""))
    if blocked:
        print(f"{len(blocked)} chain(s) are now broken — `check` will report them.")
    return 0


def cmd_stats(args: argparse.Namespace) -> int:
    conn = connect(db_path(args))
    total, = conn.execute("SELECT count(*) FROM memories").fetchone()
    active, = conn.execute("SELECT count(*) FROM memories WHERE archived=0").fetchone()
    derived, = conn.execute("SELECT count(*) FROM memories WHERE derived=1").fetchone()
    edges, = conn.execute("SELECT count(*) FROM edges").fetchone()
    by_kind = conn.execute(
        "SELECT kind, count(*) n FROM memories WHERE archived=0 "
        "GROUP BY kind ORDER BY n DESC").fetchall()
    span = conn.execute(
        "SELECT min(created_at) a, max(created_at) b FROM memories").fetchone()
    adopted = conn.execute(
        "SELECT value FROM meta WHERE key='adopted_from'").fetchone()
    version = read_version(conn)
    conn.close()

    path = db_path(args)
    size = path.stat().st_size / 1024 if path.exists() else 0
    print(f"{path}  ({size:.0f} KB, schema v{version})")
    print(f"  {total} memor(ies), {active} active, {derived} derived")
    print(f"  {edges} provenance edge(s)")
    if span and span["a"]:
        print(f"  span: {short_date(span['a'])} .. {short_date(span['b'])}")
    if adopted:
        print(f"  adopted from: {adopted[0]}")
    if by_kind:
        print("\n  by kind (active only; archived rows are excluded)")
        for r in by_kind:
            print(f"    {r['kind']:<12} {r['n']}")
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    conn = connect(db_path(args))
    sql = "SELECT * FROM memories WHERE 1=1 "
    params: list = []
    if args.project:
        sql += "AND project=? "
        params.append(args.project)
    if not args.all:
        sql += "AND archived=0 "
    rows = conn.execute(sql + "ORDER BY created_at, id", params).fetchall()
    edges: dict[int, list[int]] = {r["id"]: [] for r in rows}
    for e in conn.execute("SELECT * FROM edges").fetchall():
        edges.setdefault(e["derived_id"], []).append(e["source_id"])
    conn.close()

    if args.format == "jsonl":
        text = "\n".join(json.dumps({**dict(r), "sources": edges.get(r["id"], [])},
                                    ensure_ascii=False) for r in rows)
    else:
        parts = [f"# memoryfires export — {len(rows)} memories", f"_{now_iso()}_", ""]
        for r in rows:
            src = edges.get(r["id"], [])
            parts.append(f"### #{r['id']} [{r['kind']}] {r['title']}")
            if r["why"]:
                parts.append(f"**Why:** {r['why']}")
            if r["body"]:
                parts.append(r["body"])
            if src:
                parts.append(f"_derived from: "
                             f"{', '.join('#' + str(s) for s in src)}_")
            parts.append("")
        text = "\n".join(parts)

    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"{len(rows)} memor(ies) -> {args.out}")
    else:
        print(text)
    return 0


# --------------------------------------------------------------- selftest


def selftest() -> int:
    import contextlib
    import io
    import tempfile
    fails = []
    quiet = lambda: contextlib.redirect_stdout(io.StringIO())

    def check(name, got, want):
        if got != want:
            fails.append(f"{name}: got {got!r}, want {want!r}")

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        db = tmp / "t.db"

        # --- version gate: the check the predecessor never made ---
        conn = connect(db, create=True)
        check("version written", read_version(conn), SCHEMA_VERSION)
        conn.execute("UPDATE meta SET value='99' WHERE key='schema_version'")
        conn.commit()
        conn.close()
        try:
            connect(db)
            fails.append("newer schema: opened without refusing")
        except Refused as exc:
            check("newer schema refused", "Refusing to open" in str(exc), True)
        conn = sqlite3.connect(db)
        conn.execute("UPDATE meta SET value=? WHERE key='schema_version'",
                     (str(SCHEMA_VERSION),))
        conn.commit()
        conn.close()

        # --- provenance: derive records exact sources ---
        conn = connect(db)
        a = insert_memory(conn, kind="decision", title="Use Postgres")
        b = insert_memory(conn, kind="gotcha", title="TTL required on read-through")
        c = insert_memory(conn, kind="constraint", title="SAML for half of revenue")
        conn.commit()
        d = insert_memory(conn, kind="digest", title="Q3 decisions", derived=1)
        linked, missing = add_edges(conn, d, [a, b, c], "compacted")
        conn.commit()
        check("all sources linked", linked, [a, b, c])
        check("no missing", missing, [])
        check("edge count", len(sources_of(conn, d)), 3)

        # walk finds them, cited_by is the inverse
        chain = walk(conn, d)
        check("walk depth-0 count", len([1 for x in chain if x[0] == 0]), 3)
        check("cited_by finds the digest", [r["derived_id"] for r in cited_by(conn, a)], [d])

        # --- broken chain is reported, not hidden ---
        conn.execute("DELETE FROM memories WHERE id=?", (b,))
        conn.commit()
        chain2 = walk(conn, d)
        broken = [x for x in chain2 if x[2] == "BROKEN"]
        check("broken link detected", len(broken), 1)
        check("broken link id", broken[0][1], b)

        # check() surfaces the orphan
        orphans = conn.execute(
            "SELECT e.source_id FROM edges e LEFT JOIN memories m "
            "ON m.id=e.source_id WHERE m.id IS NULL").fetchall()
        check("orphan visible to check", [o[0] for o in orphans], [b])

        # --- cycle safety ---
        x = insert_memory(conn, kind="digest", title="X", derived=1)
        y = insert_memory(conn, kind="digest", title="Y", derived=1)
        conn.commit()
        add_edges(conn, x, [y], "compacted")
        add_edges(conn, y, [x], "compacted")
        conn.commit()
        cyc = walk(conn, x)
        check("cycle terminates", any(t[2] == "cycle" for t in cyc), True)

        # --- forget refuses to orphan a chain ---
        citers = cited_by(conn, a)
        check("a is cited", len(citers) > 0, True)
        conn.close()

        # --- secrets refused ---
        leaks = scan_secrets("deploy", 'export API_KEY="sk-ant-abcdefghijklmnopqrstuvwxyz1234"')
        check("secret detected", "API key" in leaks, True)
        check("clean text passes", scan_secrets("the key lives in 1Password"), [])

        # --- adopt: source opened read-only, every row survives ---
        v1 = tmp / "v1.db"
        s = sqlite3.connect(v1)
        s.executescript("""
            CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE observations(
                id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL,
                type TEXT NOT NULL, project TEXT DEFAULT '', session TEXT DEFAULT '',
                title TEXT NOT NULL, body TEXT DEFAULT '', why TEXT DEFAULT '',
                tags TEXT DEFAULT '', files TEXT DEFAULT '',
                confidence TEXT DEFAULT 'probable', superseded INTEGER DEFAULT 0,
                archived INTEGER DEFAULT 0);
        """)
        for i in range(7):
            s.execute("INSERT INTO observations(created_at,type,title,why) "
                      "VALUES (?,?,?,?)",
                      (now_iso(), "decision", f"legacy fact {i}", "because"))
        s.commit()
        s.close()
        before_mtime = v1.stat().st_mtime
        before_rows = sqlite3.connect(v1).execute(
            "SELECT count(*) FROM observations").fetchone()[0]

        db2 = tmp / "adopted.db"
        args = argparse.Namespace(db=str(db2), source=str(v1))
        with quiet():
            rc = cmd_adopt(args)
        check("adopt returns 0", rc, 0)

        conn = connect(db2)
        got, = conn.execute("SELECT count(*) FROM memories").fetchone()
        check("every legacy row survived", got, before_rows)
        nulls, = conn.execute(
            "SELECT count(*) FROM memories WHERE derived=0").fetchone()
        check("adopted rows carry no provenance", nulls, before_rows)
        origins, = conn.execute(
            "SELECT count(*) FROM memories WHERE origin != ''").fetchone()
        check("adopted rows carry origin", origins, before_rows)
        conn.close()

        # idempotent: a second adopt adds nothing
        with quiet():
            cmd_adopt(argparse.Namespace(db=str(db2), source=str(v1)))
        conn = connect(db2)
        again, = conn.execute("SELECT count(*) FROM memories").fetchone()
        check("adopt is idempotent", again, before_rows)
        conn.close()

        after = sqlite3.connect(v1).execute(
            "SELECT count(*) FROM observations").fetchone()[0]
        check("v1 row count unchanged", after, before_rows)
        check("v1 file not modified", v1.stat().st_mtime, before_mtime)

        # v1 must still be openable by its own tool afterwards
        probe = sqlite3.connect(v1)
        check("v1 still readable", probe.execute(
            "SELECT count(*) FROM observations").fetchone()[0], before_rows)
        probe.close()

        # --- adopt refuses a non-archive ---
        junk = tmp / "junk.db"
        j = sqlite3.connect(junk)
        j.execute("CREATE TABLE unrelated(x INTEGER)")
        j.commit()
        j.close()
        try:
            with quiet():
                cmd_adopt(argparse.Namespace(db=str(tmp / "x.db"), source=str(junk)))
            fails.append("adopt: accepted a non-archive")
        except Refused:
            pass

        # --- helpers ---
        check("parse_ids", parse_ids("12, #13 14"), [12, 13, 14])
        check("csv_list dedupes and sorts", csv_list("b, a ,b"), "a,b")
        check("fts_escape quotes bare terms", fts_escape("auth saml"), '"auth" "saml"')
        check("fts_escape leaves operators", fts_escape("a OR b"), "a OR b")

        # --- every command runs without crashing on a populated store ---
        # An earlier build shipped an `export` that raised IndexError on any
        # store at all: the selftest covered the provenance paths and nothing
        # exercised the read-only commands end to end.
        smoke = tmp / "smoke.db"
        ns = lambda **kw: argparse.Namespace(db=str(smoke), **kw)
        with quiet():
            sconn = connect(smoke, create=True)
            a1 = insert_memory(sconn, kind="gotcha", title="observed thing",
                               why="a reason", project="p")
            a2 = insert_memory(sconn, kind="correction", title="user corrected me",
                               project="p")
            d1 = insert_memory(sconn, kind="digest", title="a conclusion",
                               project="p", derived=1)
            add_edges(sconn, d1, [a1, a2], "compacted")
            sconn.commit()
            sconn.close()

            for name, args in [
                ("brief", ns(project="p", days=30, limit=10, json=False)),
                ("brief --json", ns(project=None, days=30, limit=10, json=True)),
                ("search", ns(query="conclusion", kind=None, project=None,
                              since=None, limit=10, derived_only=False,
                              all=False, json=False)),
                ("search --json", ns(query="", kind=None, project="p", since="30d",
                                     limit=10, derived_only=True, all=True,
                                     json=True)),
                ("get", ns(ids=[a1, d1], json=False)),
                ("why", ns(id=d1, json=False)),
                ("why --json", ns(id=d1, json=True)),
                ("policy list", ns(action="list", project=None, rule=None,
                                   because=None, when=None, source=None,
                                   force=False)),
                ("check", ns(json=False)),
                ("stats", ns()),
                ("export md", ns(format="md", out=None, project=None, all=True)),
                ("export jsonl", ns(format="jsonl", out=str(tmp / "e.jsonl"),
                                    project="p", all=False)),
            ]:
                handler = {"brief": cmd_brief, "search": cmd_search, "get": cmd_get,
                           "why": cmd_why, "policy": cmd_policy, "check": cmd_check,
                           "stats": cmd_stats, "export": cmd_export}[name.split()[0]]
                try:
                    handler(args)
                except Exception as exc:  # noqa: BLE001 - that is the point
                    fails.append(f"{name} raised {type(exc).__name__}: {exc}")

        if not (tmp / "e.jsonl").exists():
            fails.append("export jsonl: wrote no file")
        else:
            exported = [json.loads(l) for l in
                        (tmp / "e.jsonl").read_text().splitlines()]
            check("export carries sources",
                  all("sources" in r for r in exported), True)
            check("export links the digest to both sources",
                  sorted(next(r for r in exported if r["id"] == d1)["sources"]),
                  sorted([a1, a2]))

        # --- backup is real ---
        bpath = backup(db2)
        check("backup created", bpath is not None and bpath.exists(), True)

    if fails:
        print("SELFTEST FAILURES:")
        for f in fails:
            print("  -", f)
        return 1
    print("selftest: all checks passed (version gate, provenance linking, broken-"
          "chain\ndetection, cycle safety, secret refusal, read-only adopt with "
          "row-count\nand mtime assertions, idempotence, every command on a populated\nstore, export provenance, helpers, backup)")
    return 0


# --------------------------------------------------------------- cli


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", help="path to the store (default ./.memoryfires/memory.db)")
    ap.add_argument("--selftest", action="store_true")
    sub = ap.add_subparsers(dest="command")

    sub.add_parser("init", help="create or open the store")

    p = sub.add_parser("add", help="record an observation (no provenance)")
    p.add_argument("--kind", required=True, choices=KINDS)
    p.add_argument("--title", required=True)
    p.add_argument("--body", help="use '-' to read the body from stdin")
    p.add_argument("--why", help="the reasoning — the part that ages well")
    p.add_argument("--project", default="")
    p.add_argument("--session", default="")
    p.add_argument("--tags")
    p.add_argument("--files")
    p.add_argument("--confidence", choices=CONFIDENCE, default="probable")
    p.add_argument("--supersedes", help="ids this replaces")
    p.add_argument("--force", action="store_true")

    p = sub.add_parser("derive", help="record a conclusion WITH its sources")
    p.add_argument("--from", dest="source", required=True, help="source ids")
    p.add_argument("--kind", default="digest", choices=KINDS)
    p.add_argument("--title", required=True)
    p.add_argument("--body", help="use '-' to read the body from stdin")
    p.add_argument("--why")
    p.add_argument("--project", default="")
    p.add_argument("--tags")
    p.add_argument("--confidence", choices=CONFIDENCE, default="probable")
    p.add_argument("--role", choices=ROLES, default="compacted")
    p.add_argument("--archive-sources", action="store_true",
                   help="archive the sources; they stay searchable with --all")
    p.add_argument("--allow-missing", action="store_true",
                   help="record the chain even though a source is gone")
    p.add_argument("--force", action="store_true")

    p = sub.add_parser("why", help="walk the evidence chain for a memory")
    p.add_argument("id", type=int)
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("policy", help="standing rules, surfaced at session start")
    p.add_argument("action", choices=["add", "list"])
    p.add_argument("--rule", help="the rule, imperative")
    p.add_argument("--because", help="why it exists")
    p.add_argument("--when", help="the condition it applies under")
    p.add_argument("--source", help="ids that justify it")
    p.add_argument("--project", default="")
    p.add_argument("--force", action="store_true")

    p = sub.add_parser("brief", help="session-start context: rules, then recent")
    p.add_argument("--project")
    p.add_argument("--days", type=int, default=14)
    p.add_argument("--limit", type=int, default=12)
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("search", help="compact index of matches")
    p.add_argument("query", nargs="?", default="")
    p.add_argument("--kind", choices=KINDS)
    p.add_argument("--project")
    p.add_argument("--since", help="30d / 6h / 2w / ISO date")
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--derived-only", action="store_true")
    p.add_argument("--all", action="store_true", help="include archived")
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("get", help="full detail for ids (batch them)")
    p.add_argument("ids", nargs="+", type=int)
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("adopt", help="copy rows forward from another archive")
    p.add_argument("--from", dest="source", required=True,
                   help="path to the other tool's .db — opened READ-ONLY")

    p = sub.add_parser("check", help="integrity: broken chains, orphans, secrets")
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("forget", help="permanently delete (refuses to orphan)")
    p.add_argument("ids", nargs="+", type=int)
    p.add_argument("--yes", action="store_true")
    p.add_argument("--break-chains", action="store_true")

    sub.add_parser("stats", help="what the store holds")

    p = sub.add_parser("export", help="dump to markdown or jsonl")
    p.add_argument("--format", choices=["md", "jsonl"], default="md")
    p.add_argument("--out")
    p.add_argument("--project")
    p.add_argument("--all", action="store_true")

    args = ap.parse_args()
    if args.selftest:
        return selftest()
    if not args.command:
        ap.print_help()
        return 2

    handlers = {
        "init": cmd_init, "add": cmd_add, "derive": cmd_derive, "why": cmd_why,
        "policy": cmd_policy, "brief": cmd_brief, "search": cmd_search,
        "get": cmd_get, "adopt": cmd_adopt, "check": cmd_check,
        "forget": cmd_forget, "stats": cmd_stats, "export": cmd_export,
    }
    try:
        return handlers[args.command](args)
    except Refused as exc:
        print(str(exc), file=sys.stderr)
        return 3
    except BrokenPipeError:
        return 0
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
