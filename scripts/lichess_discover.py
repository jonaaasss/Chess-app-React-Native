"""Discover Lichess study authors: scan the study lists of leaderboard players for a keyword regex.

Usage: python3 -I scripts/lichess_discover.py out.json "regex" [n_per_board]
Scans the top players of the classical, rapid and blitz leaderboards (about 300 users, ~5 minutes).
See docs/LICHESS_BRONNEN.md.
"""
import json, re, sys, time, urllib.request

OUT, PATTERN = sys.argv[1], re.compile(sys.argv[2], re.I)
N = int(sys.argv[3]) if len(sys.argv) > 3 else 100
UA = {"User-Agent": "chess-playbook-research", "Accept": "application/vnd.lichess.v3+json"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read().decode()


players = {}
for perf in ("classical", "rapid", "blitz"):
    for u in json.loads(get(f"https://lichess.org/api/player/top/{N}/{perf}"))["users"]:
        players.setdefault(u["username"], u.get("title", ""))
    time.sleep(1)

found = []
for i, (name, title) in enumerate(players.items()):
    try:
        lines = [json.loads(l) for l in get(f"https://lichess.org/api/study/by/{name}").splitlines() if l.strip()]
    except Exception as e:  # noqa: BLE001
        print(f"skip {name}: {e}", file=sys.stderr)
        lines = []
    hits = [{"id": s["id"], "name": s["name"]} for s in lines if PATTERN.search(s["name"])]
    if hits:
        found.append({"user": name, "title": title, "studies": len(lines), "hits": hits})
        print(f"{title:<3} {name:<22} studies={len(lines):<5} " + " | ".join(f"{h['id']} {h['name']}" for h in hits[:6]), flush=True)
    time.sleep(1)

json.dump({"scanned": len(players), "found": found}, open(OUT, "w"), indent=1, ensure_ascii=False)
print(f"scanned {len(players)} players, {len(found)} with matching studies")
