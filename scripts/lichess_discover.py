"""Discover Lichess study authors: scan the study lists of strong players for a keyword regex.

Usage:
  python3 -I scripts/lichess_discover.py out.json "regex" [n_per_board]
      Scans the top players of the classical, rapid and blitz leaderboards (about 300 users, ~5 minutes).
  python3 -I scripts/lichess_discover.py out.json "regex" --teams team-id,team-id [max_members]
      (find team ids with GET /api/team/search?text=...; teams that hide their members are skipped)
      Scans the titled members (GM, IM, FM, WGM, WIM, WFM, CM, NM, LM) of the given teams.
See docs/LICHESS_BRONNEN.md.
"""
import json, re, sys, time, urllib.request

OUT, PATTERN = sys.argv[1], re.compile(sys.argv[2], re.I)
UA = {"User-Agent": "chess-playbook-research", "Accept": "application/vnd.lichess.v3+json"}
TITLES = {"GM", "IM", "FM", "WGM", "WIM", "WFM", "CM", "WCM", "NM", "WNM", "LM"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read().decode()


players = {}
if len(sys.argv) > 3 and sys.argv[3] == "--teams":
    cap = int(sys.argv[5]) if len(sys.argv) > 5 else 5000
    for team in sys.argv[4].split(","):
        url = f"https://lichess.org/api/team/{team}/users"
        req = urllib.request.Request(url, headers={**UA, "Accept": "application/x-ndjson"})
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                for i, line in enumerate(r):
                    if i >= cap:
                        break
                    if line.strip():
                        u = json.loads(line)
                        if u.get("title") in TITLES:
                            players.setdefault(u.get("name") or u.get("username"), u["title"])
        except Exception as e:  # noqa: BLE001  (some teams hide their members)
            print(f"skip team {team}: {e}", flush=True)
        print(f"team {team}: {len(players)} titled players so far", flush=True)
        time.sleep(1)
else:
    n = int(sys.argv[3]) if len(sys.argv) > 3 else 100
    for perf in ("classical", "rapid", "blitz"):
        for u in json.loads(get(f"https://lichess.org/api/player/top/{n}/{perf}"))["users"]:
            players.setdefault(u["username"], u.get("title", ""))
        time.sleep(1)

found = []
for name, title in players.items():
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
