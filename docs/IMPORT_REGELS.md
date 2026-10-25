# Import rules: opening import JSON and card-making rules

Read this before creating, importing or reviewing opening cards. The app checks every move and arrow itself (`src/importOpening.ts`), so a separate legality script isn't needed to guard against broken boards; the rules below are about content quality.

## Format `chess-playbook-import`, version 1

```json
{
  "format": "chess-playbook-import", "version": 1,
  "opening": { "name": "...", "summary": "..." },
  "cards": [
    { "name": "...", "mode": "plan", "fastRevision": true,
      "boards": [
        { "moves": "e4 d5 exd5", "text": "...",
          "arrows": [ { "from": "d2", "to": "d4", "color": "green",
                        "notes": { "reason": "...", "next": "...",
                                   "responses": [ { "trigger": "!Nf6", "text": "...", "kind": "reaction" } ] } } ],
          "circles": [ { "square": "e5", "color": "red" } ] } ] } ]
}
```

- `moves`: SAN from the standard start position, space-separated. Check marks, `!`/`?` and `0-0` vs `O-O` are tolerated; every move must be legal.
- `color`: `green`, `orange`, `red`, `blue`. `notes` are optional (`reason`, `next`, `responses`; `kind` is `reaction` or `exception`).
- Limits: at most 60 cards, 6 boards per card, 40 arrows per board.

## Opening summary syntax (`opening.summary`)

- Tables use pipes. The header row starts with `#`. Put a blank line between tables. A new line inside a cell is `\n` (in JSON: `\\n`).
- Move colors: a plain move = green (always played), `?Move` = orange (depends on the opponent), `!Move` = red (the opponent plays it).
- Table kinds:
  - **Start**
  - **Reply**: `# Reply | Moves | Except`
  - **Piece**: `# Piece | Move | If`, with the pieces NQ (queenside knight), NK (kingside knight), BB (dark-squared bishop), BW (light-squared bishop), Q, R, K, P, and the suffix "later" for a piece's second move or later.

## Card styles (as in "Anti Scandinavian")

- **"Reactions: first move"** (`fastRevision`): one board per trigger, a red circle on the triggering piece, one green arrow, text "If !X => Y". Only for real threats: positions where one exact move is needed and anything else leaves Jonas clearly worse (e.g. a gambit pawn, a centre break, a pin). Quiet developing moves are not reactions.
- **"Key: !..."** (`fastRevision`): board 1 holds the plan (green = now, orange = the plan moves, red = second choice, blue = later/optional). The opponent's reactions are `responses` on the arrow.
- Cards describe **general plans**, not every White option at move 4 and every option at move 5. One plan card can cover several White moves that lead to the same kind of position.
- A Key board shows the whole plan with several arrows. A board with a single arrow is a rare exception and never true for all boards of a card. Don't fuss over the exact move order inside a plan.
- An arrow's `reason` says **why** the move is played (e.g. a6: "Room for Ba7, so the bishop survives !Na4"). Never write counters like "Plan (3/5)", and leave out obvious conditions (e.g. "after !cxd4" for ...Bb4+).
- Every `responses` trigger that refers to a piece or square needs the matching arrow on the board (e.g. "!Bxe6" only on the arrow that puts a piece on e6).
- **"Reaction: !X"** (not fast): the boards are the position right after the trigger in different situations; no follow-up boards. Continuations go in the text or in `responses`.

## Arrow rules

- Arrows must be playable in the order shown: free paths, pawn rules, never landing on your own piece.
- Castling only when the squares between king and rook are empty (so Nf3 comes before O-O).
- Color order: green, orange, red, blue. Don't skip a color.
- No duplicate trigger plus answer on "Reactions: first move".
- Texts only contain moves Jonas plays: never "do not ...", and no obvious resumptions (not "Qxf3" after Bxf3).
- On "Reactions: first move" use the same circles as on the matching board in the "Reaction" card.

## Lichess PGN

Arrows are `[%cal Gd2d4,Yg1f3,...]` (G/Y/R/B; orange is written Y) and circles are `[%csl Rg4]`.
