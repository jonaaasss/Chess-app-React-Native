"""Score Lichess study authors with public API data.

Usage: python3 -I scripts/lichess_authors.py out.json name1 name2 ...
See docs/LICHESS_BRONNEN.md for the criteria.
"""
import json, re, sys, time, urllib.request

OUT = sys.argv[1]
NAMES = sys.argv[2:]
UA = {"User-Agent": "chess-playbook-research (jonas)"}

ITALIAN = re.compile(r"italian|giuoco|piano|pianissimo|evans|max lange|bc5|greco|m[oö]e?ller|two knights|fried liver|e4 ?e5|open game", re.I)
OPENING = re.compile(r"opening|repertoire|gambit|defen[cs]e|attack|variation|sicilian|french|caro|ruy|spanish|london|catalan|gambit|e4|d4", re.I)


def get(url, data=None):
    req = urllib.request.Request(url, data=data, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode()


users = {}
raw = get("https://lichess.org/api/users", ",".join(NAMES).encode())
for u in json.loads(raw):
    users[u["id"]] = u

result = []
for name in NAMES:
    u = users.get(name.lower())
    row = {"name": name, "exists": bool(u)}
    if u:
        perfs = u.get("perfs", {})
        best = max((perfs.get(p, {}).get("rating", 0) for p in ("classical", "rapid", "blitz")), default=0)
        row.update(
            username=u["username"],
            title=u.get("title", ""),
            best_rating=best,
            disabled=u.get("disabled", False),
            tos=u.get("tosViolation", False),
            fide=u.get("profile", {}).get("fideRating"),
        )
        time.sleep(1)
        try:
            lines = [json.loads(l) for l in get(f"https://lichess.org/api/study/by/{u['username']}").splitlines() if l.strip()]
        except Exception as e:  # noqa: BLE001
            lines, row["study_error"] = [], str(e)
        row["studies"] = len(lines)
        row["opening_studies"] = sum(1 for s in lines if OPENING.search(s["name"]))
        italian = [s for s in lines if ITALIAN.search(s["name"])]
        row["italian_studies"] = [{"id": s["id"], "name": s["name"]} for s in italian]
        row["last_update"] = time.strftime("%Y-%m-%d", time.gmtime(max((s["updatedAt"] for s in lines), default=0) / 1000))
    result.append(row)

with open(OUT, "w") as f:
    json.dump(result, f, indent=1, ensure_ascii=False)

for r in result:
    if not r["exists"]:
        print(f"{r['name']:<22} NIET GEVONDEN")
        continue
    print(f"{r['username']:<22} {r['title']:<4} {r['best_rating']:>5} fide={r['fide']} studies={r['studies']:>5} opening={r['opening_studies']:>4} italian={len(r['italian_studies']):>3} last={r['last_update']}{' DISABLED' if r['disabled'] else ''}{' TOS' if r['tos'] else ''}")
