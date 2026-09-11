import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { allSquares, mainLineNodes } from '../chess';
import { legalMovesFrom, makeMove, type GameState } from '../chessEngine';
import type { Arrow, Card, Circle, MoveNode } from '../types';
import { boardStyles, colors, radius } from '../theme';
import { ArrowsSvg, CirclesSvg, PieceGlyph } from '../components/ChessBoard';
import { usePieceAnimation, PieceAnimationGhosts, PIECE_ANIM_DURATION_MS } from '../components/PieceAnimation';

// Opponent auto-play and board-to-board transitions wait long enough for
// the slide animation to fully finish, plus a short pause, before moving
// on — so the animation is always clearly visible, never cut off.
const AUTO_ADVANCE_DELAY_MS = PIECE_ANIM_DURATION_MS + 300;

const BOARD_SIZE = 300;
const CELL = BOARD_SIZE / 8;

function sameArrow(a: Arrow, b: Arrow) {
  return a.from === b.from && a.to === b.to && a.color === b.color;
}
function sameCircle(a: Circle, b: Circle) {
  return a.square === b.square && a.color === b.color;
}

// What's actually visible after `count` moves of the line have been
// played: the board's own (pre-Play) annotations, then each played move's
// added/removed applied in order — same rule the editor uses, so anything
// you drew while recording shows up at the right moment during Study too.
function activeAnnotationsAt(base: { arrows: Arrow[]; circles: Circle[] }, line: MoveNode[], count: number) {
  let arrows = [...base.arrows];
  let circles = [...base.circles];
  for (let i = 0; i < count; i++) {
    const node = line[i];
    arrows = arrows.filter((a) => !node.removedArrows.some((r) => sameArrow(r, a)));
    circles = circles.filter((c) => !node.removedCircles.some((r) => sameCircle(r, c)));
    arrows = [...arrows, ...node.addedArrows];
    circles = [...circles, ...node.addedCircles];
  }
  return { arrows, circles };
}

function formatNotation(sans: string[], firstIsWhite: boolean): string {
  let moveNumber = 1;
  let whiteToMove = firstIsWhite;
  const parts: string[] = [];
  sans.forEach((san, i) => {
    const prefix = whiteToMove ? `${moveNumber}.` : i === 0 ? `${moveNumber}...` : '';
    parts.push(prefix ? `${prefix}${san}` : san);
    if (!whiteToMove) moveNumber += 1;
    whiteToMove = !whiteToMove;
  });
  return parts.join(' ');
}

// Interactive Reactions study: no flip. The opponent's recorded moves play
// themselves; on your turn you must find the recorded move. A wrong move
// shows a message (not a board mark) and resets your selection. Hint rings
// the piece to move; Show solution plays the recorded move for you.
// (Move animation and the numbered-arrow variation walkthrough are still
// to come.)
export function ReactionStudy({
  card,
  yourColor,
  onResult
}: {
  card: Card;
  yourColor: 'w' | 'b';
  onResult: (correct: boolean) => void;
}) {
  const boards = useMemo(() => [...card.boards].sort((a, b) => a.order - b.order), [card]);
  const [boardIdx, setBoardIdx] = useState(0);
  const [ply, setPly] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [wrongMove, setWrongMove] = useState(false);
  const [hintOn, setHintOn] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const [allDone, setAllDone] = useState(false);

  const board = boards[boardIdx];
  const line = useMemo(() => (board ? mainLineNodes(board.recording) : []), [board]);

  const engineState: GameState = useMemo(() => {
    if (!board) return { pieces: {}, turn: 'w', castling: { wK: false, wQ: false, bK: false, bQ: false }, enPassant: null };
    let st: GameState = { pieces: board.pieces, turn: board.turn, castling: board.castling, enPassant: board.enPassant };
    for (let i = 0; i < ply && i < line.length; i++) {
      st = makeMove(st, line[i].from, line[i].to, line[i].promotion).next;
    }
    return st;
  }, [board, line, ply]);

  const { arrows: visibleArrows, circles: visibleCircles } = useMemo(
    () => (board ? activeAnnotationsAt(board, line, ply) : { arrows: [], circles: [] }),
    [board, line, ply]
  );

  const nextMove = line[ply];
  const nextMoveColor = nextMove ? (nextMove.turnAfter === 'w' ? 'b' : 'w') : null;
  const isYourTurn = nextMoveColor === yourColor;
  const lineDone = !board || ply >= line.length;

  const legalTargets = useMemo(
    () => (selected ? legalMovesFrom(engineState, selected) : []),
    [engineState, selected]
  );

  const { hiddenSquares, ghosts } = usePieceAnimation(engineState.pieces, CELL);

  // Auto-play the opponent's recorded moves.
  useEffect(() => {
    if (lineDone || isYourTurn) return;
    const t = setTimeout(() => {
      setPly((p) => p + 1);
      setSelected(null);
      setHintOn(false);
    }, AUTO_ADVANCE_DELAY_MS);
    return () => clearTimeout(t);
  }, [ply, isYourTurn, lineDone]);

  // Board finished → next board, or the whole card is done.
  useEffect(() => {
    if (!lineDone) return;
    if (boardIdx < boards.length - 1) {
      const t = setTimeout(() => {
        setBoardIdx((i) => i + 1);
        setPly(0);
        setSelected(null);
        setHintOn(false);
      }, AUTO_ADVANCE_DELAY_MS);
      return () => clearTimeout(t);
    }
    setAllDone(true);
  }, [lineDone, boardIdx, boards.length]);

  function handleSquareTap(sq: string) {
    if (!isYourTurn || lineDone || wrongMove) return;
    if (!selected) {
      const p = engineState.pieces[sq];
      if (p && p[0] === engineState.turn) setSelected(sq);
      return;
    }
    if (sq === selected) {
      setSelected(null);
      return;
    }
    if (legalTargets.includes(sq)) {
      if (selected === nextMove.from && sq === nextMove.to) {
        setPly((p) => p + 1);
        setSelected(null);
        setHintOn(false);
      } else {
        setWrongMove(true);
        setMistakes((m) => m + 1);
        setTimeout(() => {
          setWrongMove(false);
          setSelected(null);
        }, 900);
      }
      return;
    }
    const p = engineState.pieces[sq];
    setSelected(p && p[0] === engineState.turn ? sq : null);
  }

  function showSolution() {
    if (!isYourTurn || lineDone) return;
    setPly((p) => p + 1);
    setSelected(null);
    setHintOn(false);
    setMistakes((m) => m + 1);
  }

  if (!board) {
    return <Text style={{ color: colors.textDim }}>This card has no boards to study.</Text>;
  }

  const styleSet = boardStyles[board.style] ?? boardStyles[0];
  const hintCircles = hintOn && isYourTurn && nextMove ? [{ square: nextMove.from, color: 'green' as const }] : [];
  const playedSans = line.slice(0, ply).map((n) => n.san);
  const notation = playedSans.length > 0 ? formatNotation(playedSans, line[0].turnAfter === 'b') : '';

  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <Text style={styles.status}>
        {boards.length > 1 ? `Board ${boardIdx + 1} / ${boards.length} — ` : ''}
        {lineDone ? 'Line complete' : isYourTurn ? 'Your move' : "Opponent's move…"}
      </Text>

      <View style={[styles.board, { width: BOARD_SIZE, height: BOARD_SIZE }]}>
        <View style={{ width: BOARD_SIZE, height: BOARD_SIZE, flexDirection: 'row', flexWrap: 'wrap' }}>
          {allSquares().map((sq, i) => {
            const file = i % 8;
            const rank = Math.floor(i / 8);
            const isLight = (file + rank) % 2 === 0;
            const piece = engineState.pieces[sq];
            const isSel = sq === selected;
            const isTarget = legalTargets.includes(sq);
            const isCapture = isTarget && (Boolean(piece) || (selected && engineState.pieces[selected]?.[1] === 'P' && sq === engineState.enPassant));
            return (
              <Pressable
                key={sq}
                onPress={() => handleSquareTap(sq)}
                style={{ width: CELL, height: CELL, backgroundColor: isLight ? styleSet.light : styleSet.dark, alignItems: 'center', justifyContent: 'center' }}
              >
                {piece && !hiddenSquares.has(sq) && <PieceGlyph code={piece} cell={CELL} />}
                {isSel && <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.selHighlight]} />}
                {isTarget && !isCapture && <View pointerEvents="none" style={styles.moveDot} />}
                {isCapture && <View pointerEvents="none" style={styles.captureRing} />}
              </Pressable>
            );
          })}
        </View>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <ArrowsSvg arrows={visibleArrows} size={BOARD_SIZE} />
          <CirclesSvg circles={[...visibleCircles, ...hintCircles]} size={BOARD_SIZE} />
          <PieceAnimationGhosts ghosts={ghosts} cell={CELL} />
        </View>
      </View>

      {notation ? <Text style={styles.notation}>{notation}</Text> : null}

      {!allDone ? (
        <>
          <View style={styles.actionRow}>
            <Pressable
              onPress={() => setHintOn(true)}
              disabled={!isYourTurn || lineDone}
              style={[styles.actionBtn, styles.hintBtn, (!isYourTurn || lineDone) && styles.actionDisabled]}
            >
              <Text style={styles.hintText}>Hint</Text>
            </Pressable>
            <Pressable
              onPress={showSolution}
              disabled={!isYourTurn || lineDone}
              style={[styles.actionBtn, styles.solutionBtn, (!isYourTurn || lineDone) && styles.actionDisabled]}
            >
              <Text style={styles.solutionText}>Show solution</Text>
            </Pressable>
          </View>
          <Text style={[styles.wrongText, !wrongMove && styles.wrongTextHidden]}>Wrong move. Try again.</Text>
        </>
      ) : (
        <Pressable onPress={() => onResult(mistakes === 0)} style={styles.continueBtn}>
          <Text style={styles.continueText}>{mistakes === 0 ? '✓ Perfect — continue' : `Continue (${mistakes} slip${mistakes === 1 ? '' : 's'})`}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  status: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  board: { borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  selHighlight: { backgroundColor: 'rgba(21,128,61,0.35)' },
  moveDot: { position: 'absolute', width: CELL * 0.28, height: CELL * 0.28, borderRadius: (CELL * 0.28) / 2, backgroundColor: 'rgba(21,128,61,0.55)' },
  captureRing: { position: 'absolute', width: CELL - 6, height: CELL - 6, borderRadius: (CELL - 6) / 2, borderWidth: 3, borderColor: 'rgba(220,38,38,0.85)' },
  notation: { color: colors.textDim, fontSize: 13, textAlign: 'center', paddingHorizontal: 12 },
  wrongText: { color: colors.danger, fontSize: 13, fontWeight: '700' },
  wrongTextHidden: { opacity: 0 },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.pill },
  hintBtn: { backgroundColor: colors.gold },
  hintText: { color: colors.onGold, fontSize: 13, fontWeight: '700' },
  solutionBtn: { backgroundColor: colors.primary },
  solutionText: { color: colors.onPrimary, fontSize: 13, fontWeight: '700' },
  actionDisabled: { opacity: 0.4 },
  continueBtn: { marginTop: 4, paddingVertical: 12, paddingHorizontal: 20, borderRadius: radius.pill, backgroundColor: colors.primary },
  continueText: { color: colors.onPrimary, fontSize: 14, fontWeight: '700' }
});
