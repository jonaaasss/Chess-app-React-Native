# Status (update at the end of every chat)

Last updated: 2026-10-25.

## Code

- Branch `account-backup`, last commit `4c982c6` "Card optimilization".
- Not committed: `SummaryText.tsx` (first column no-wrap), `pieceArt.tsx` (white filler in the white rook, problem on d1), `StudySessionOverlay.tsx` (one board in the Cards list) and a few more files. **Not confirmed on the phone.**
- Apps on the OnePlus 6T: "Chess Playbook" (permanent) and "Chess Playbook DEV". The latest rebuild of the permanent app failed at `:app:packageRelease` (phone showed "unauthorized"); outcome unknown. Fix: re-authorize USB debugging, `.\gradlew.bat --stop`, then `npm run android:permanent`.

## Open: opening content

- **Anti Scandinavian**: cards and PGN-from-cards are done. Open: "Reaction: !Bg4 / !Bb4 / !Be4" still have the old style with follow-up boards (convert to the situation-board style? ask); `?Bc4` or `!Bf5`; the text of RFM board 4 ("castled => Ne5" on a position without castling).
- **Vienna Game**: import JSON and PGN made, with three Bg4 situations: `!Bc5` without Bf4: Na4, then c3; `!Bc5` with Bf4: Qd2, then O-O-O; no `!Bc5` (e.g. 4...Be7): h3. To verify with Jonas: "Na5" in his overview was read as Na4; the meaning of "h3 Qxf3 Qf2". The cards "No bishop developped" and "Complete plan" are missing from his export.
- **Italian Game as Black (3...Bc5)** — plan: Jonas gives no PGN; Claude searches the web for sources, Jonas picks at each decision point, then Claude makes the cards. Don't use an engine to judge moves.
  - His choices: vs 4.c3: 4...Nf6 5.d4 exd4 6.cxd4 Bb4+ (main line). vs 4.d3: ...Nf6, ...d6, ...a6 or ...a5, ...Ba7, ...O-O. vs 4.b4 (Evans): 4...Bxb4 5.c3 Ba5 (critical).
  - He wants every White continuation, main plans only (not too deep). Still to add: 4.O-O (4...Nf6), 4.Nc3 (4...Nf6), maybe 4.d4.
  - Sources read: Wikipedia Giuoco Piano; Lichess study Niemann–Caruana 2023 (Giuoco Pianissimo); thechessworld.com on the Evans Gambit. Gaps: 7.Bd2 / 7.Nc3 / 7.Nbd2 / 7.Kf1 after 6...Bb4+ (only Wikipedia and the Chessigma guide), details of 4.O-O and 4.Nc3, and 4.d4. Anything unconfirmed is orange (`?`), with the source named per card.
  - Proposed cards, **waiting for his approval**: "Reactions: first move" (4.c3, 4.d3, 4.O-O, 4.Nc3, 4.b4), "Key: 4.c3 Nf6", "Key: 4.d3 Nf6", "Key: 4.b4 Bxb4", plus a Reaction card per White continuation.
- Copy pages (claude.ai artifacts): Vienna import https://claude.ai/artifact/ALVaiUnLmqrVcKoYscAYCk ; AI prompt for making cards https://claude.ai/artifact/AqLQgVnKh4DpnbaSHjCooS (version 6, 15 921 characters, with the rules on own moves only and the same circles).

## Open: technical

- Email + password as a second sign-in method (not built).
- Gemini key in `aiImport.ts` is typed on the phone: move the calls to a server before others get the app. Also adopt the newer card prompt in `aiImport.ts`.
- Play Store: own signing key (SHA-1 into Firebase), `versionCode` per upload, privacy policy, a web page for account deletion requests, Data Safety form, closed test with 12 testers for 14 consecutive days (they must really use the app).
- Ideas, not approved: a local Lichess MCP (study as PGN, opening explorer by FEN, study search; needs a Lichess API token on this PC). A Chessigma MCP is connected: opening guides (from White's side), `identify_opening`, `analyze_position` (legal moves, no evaluations).
