# Sources: finding Lichess studies and authors

Read this before researching an opening to make cards from sources. Jonas's rule: **only Lichess** (studies + opening explorer). No Wikipedia, Chess.com or other sites as sources; no engine to judge moves. Anything a source doesn't confirm is orange (`?`) with the source named on the card.

## Access

- **Lichess token**: a network secret in the cloud environment "Schaakapp" (type Bearer, header `Authorization`, hosts `explorer.lichess.ovh` and `lichess.org`). The proxy adds it; the token is never visible and must never be pasted in the chat. It has no scopes (public data only). Add `study:read` only if Jonas's own private studies must be read.
- **Opening explorer**: `https://explorer.lichess.ovh/masters?play=e2e4,e7e5,...` and `/lichess?play=...&ratings=1800,2000,2200&speeds=rapid,classical` (UCI moves, comma-separated). Needs the token (401 without). Gives moves and game counts, no plans.
- **Studies** (no token needed for public ones):
  - `GET https://lichess.org/api/study/{studyId}.pgn` — whole study with comments and variations.
  - `GET https://lichess.org/api/study/by/{username}` — ndjson list (id, name, dates) of a user's public studies.
  - `POST https://lichess.org/api/users` (comma-separated names) — title, ratings, `disabled`, `tosViolation`.
- **What does not work**: Lichess has **no API to search studies**, and the website pages `/study/search` and `/study/topic/...` sit behind a Cloudflare bot check (403, `cf-mitigated: challenge`). Do not try to get around it. Chess.com has no study or explorer API at all.

## Finding studies

1. **Explorer first**: find which White moves matter (game counts) and where a move transposes. Studies are named after the line it becomes, not the move (4.O-O Nf6 5.d3 = Giuoco Pianissimo, 5.d4 = Max Lange Attack).
2. **Per author** (main route): list the studies of approved authors (below) and filter the names on the line names. Open studies with vague names to check.
3. **Leaderboard scan** (finds new authors): `scripts/lichess_discover.py` takes the top 100 of the classical, rapid and blitz leaderboards (`GET /api/player/top/{n}/{perf}`, ~300 strong players) and searches their study names with a regex. First run (Italian): found GM Michael Roiz's "Giuoco piano as black" Part 1 `ZNpSeoTX` and Part 2 `9neH3F7E` (published by NM ToyTiko, ~1 000 comments), IM likewater, YoungGunners "Giuoco Piano for Black" `755ShIb3`. Check new authors with `lichess_authors.py` before use. With `--teams id,id` it scans the titled members of big teams instead (`GET /api/team/{id}/users`).
4. **Web search** limited to `lichess.org`, on the line name. Finds only part of the studies.
5. **Links from Jonas**: he can search on lichess.org himself and paste links. In a local session on his PC, Claude in Chrome can use the Lichess search in his own browser.

## Asking Jonas about moves

- At most 5 questions per round, numbered at the end of the answer.
- Ask only about big choices: a line with its own name (e.g. Max Lange Attack, Scotch Gambit) or a clearly more aggressive option. No questions about details deep in a line (e.g. move 9).
- Decide small choices yourself: the source's recommendation, otherwise the calmer move. List those decisions in a short table so Jonas can overrule them.

Jonas's choices for the Italian as Black (3...Bc5), 2026-10-25: 4.c3 Nf6 5.d4 exd4 6.cxd4 Bb4+; 4.c3 Nf6 5.O-O d6; 4.d3 Pianissimo setup (...d6, ...a6, ...Ba7, ...O-O); 4.b4 Bxb4 5.c3 Ba5 6.d4 d6; 4.O-O Nf6 5.d4 Bxd4; 4.d4 Bxd4.

## Judging authors

`scripts/lichess_authors.py` measures criteria 1–5 for a list of usernames (`python3 -I scripts/lichess_authors.py out.json name1 name2 ...`; output in a scratch folder, not in the repo).

| # | Criterion | Why |
|---|---|---|
| 1 | Title verified by Lichess (GM/IM/FM/NM) | strongest signal of chess knowledge |
| 2 | Rating (best of classical/rapid/blitz) | for authors without a title |
| 3 | Account in good standing: not `disabled`, no `tosViolation` | reliability; otherwise drop the author |
| 4 | Number of studies about the opening being researched | relevance |
| 5 | Last update | active, recent work |
| 6 | Recommended by Lichess staff or the community ([Staff Picks](https://lichess.org/study/staff-picks), Lichess blog, forum threads) | quality judged by others |

Not measurable through the API: likes and the quality of the comments. Check those by reading the chosen study before using it. Avoid studies that copy a paid course (e.g. chapters "by GM X" taken from Chessable).

## Authors checked (2026-10-25)

| Author | Title / rating | Strong for | Note |
|---|---|---|---|
| Monkey_King | IM, 2472 | 1.e4 e5: Italian, Møller, Max Lange, Evans (1 337 studies) | best source for the Italian |
| EricRosen | IM, 2574 | "How to play vs Evans Gambit", traps | staff pick |
| fuxia | –, 2016 | 1.e4 e5 sidelines (Ponziani, Scotch, Vienna, Evans) | recommended on the forum |
| SalgadoChess | GM, 2795 | 1.e4 e5 2.d4 for Black, Greco history | little on the Italian |
| MasterChessDojo | NM, 2006 | Italian/Evans miniatures | |
| ToyTiko (publishes GM Michael Roiz) | NM | "Giuoco piano as black" Part 1 `ZNpSeoTX` / Part 2 `9neH3F7E`: Pianissimo, Nc3 + d3, Bg5, Be3, b4 plans | best Black-side source for quiet Italian lines; may come from a paid course (Jonas approved its use) |
| YoungGunners, IM likewater, Horobetz (NM) | – / IM / NM | Giuoco Piano for Black, Evans, Max Lange | found by the leaderboard scan, not checked yet |
| JThybo, Craze, RebeccaHarris (Naroditsky) | GM | Berlin, Spanish, Catalan, gambits | nothing on the Italian |

Dropped: disabled accounts (ImaginaryGC, Yeltcki, nsn21, pepellou, Qconstantinee), ToS flag (colt45nine, Zkwong1877), `Lichess` (mostly broadcasts), beginner level (Dabadman, LeninPerez). Extend this table whenever new authors are checked.
