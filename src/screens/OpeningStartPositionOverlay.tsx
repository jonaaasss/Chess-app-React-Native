// Shown once, right after naming a brand-new opening (see OpeningsScreen's
// handleAddOpening) — a small, deliberately bare board editor whose only job
// is picking the position every new card's board in this opening will start
// from (see types.ts's OpeningStartPosition). There's no later "change the
// default" option, so this is the only place it's ever set.
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { allSquares, flipIndex, squareFromIndex, startingPosition } from '../chess';
import { createGameState, legalMovesFrom, makeMove, isPromotionMove, type GameState } from '../chessEngine';
import { PieceGlyph } from '../components/ChessBoard';
import { BackCircleButton } from '../components/Common';
import { boardStyles, colors, radius, spacing, touchTarget, type } from '../theme';
import { confirmDialog, showOverlay, useOverlayBack } from '../overlay';
import type { BoardMove, OpeningStartPosition, PieceCode, PromotionPiece } from '../types';

const BOARD_SIZE = 320;
const CELL = BOARD_SIZE / 8;
const PROMOTION_PIECES: PromotionPiece[] = ['Q', 'R', 'B', 'N'];

function OpeningStartPositionOverlay({
  openingName,
  yourColor,
  boardStyle,
  close
}: {
  openingName: string;
  yourColor: 'w' | 'b';
  boardStyle: number;
  close: (result: OpeningStartPosition | null) => void;
}) {
  const flipped = yourColor === 'b';
  const [history, setHistory] = useState<BoardMove[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(null);

  const engineState: GameState = useMemo(() => {
    if (history.length === 0) return createGameState(startingPosition(), 'w');
    const last = history[history.length - 1];
    return { pieces: last.piecesAfter, turn: last.turnAfter, castling: last.castlingAfter, enPassant: last.enPassantAfter };
  }, [history]);

  const legalTargets = useMemo(() => (selected ? legalMovesFrom(engineState, selected) : []), [engineState, selected]);

  function finishMove(from: string, to: string, promotion?: PromotionPiece) {
    const result = makeMove(engineState, from, to, promotion);
    const move: BoardMove = {
      from,
      to,
      promotion,
      piecesAfter: result.next.pieces,
      turnAfter: result.next.turn,
      castlingAfter: result.next.castling,
      enPassantAfter: result.next.enPassant,
      arrowsAfter: [],
      circlesAfter: []
    };
    setHistory((prev) => [...prev, move]);
    setSelected(null);
  }

  function handleSquareTap(sq: string) {
    if (!selected) {
      const piece = engineState.pieces[sq];
      if (piece && piece[0] === engineState.turn) setSelected(sq);
      return;
    }
    if (sq === selected) {
      setSelected(null);
      return;
    }
    if (legalTargets.includes(sq)) {
      if (isPromotionMove(engineState, selected, sq)) {
        setPendingPromotion({ from: selected, to: sq });
      } else {
        finishMove(selected, sq);
      }
      return;
    }
    const piece = engineState.pieces[sq];
    setSelected(piece && piece[0] === engineState.turn ? sq : null);
  }

  function choosePromotion(piece: PromotionPiece) {
    if (!pendingPromotion) return;
    finishMove(pendingPromotion.from, pendingPromotion.to, piece);
    setPendingPromotion(null);
  }

  function handleBack() {
    setSelected(null);
    setPendingPromotion(null);
    setHistory((prev) => prev.slice(0, -1));
  }

  function handleReset() {
    setSelected(null);
    setPendingPromotion(null);
    setHistory([]);
  }

  async function handleCancel() {
    if (history.length > 0) {
      const ok = await confirmDialog('Discard this starting position? The opening itself is not created either.', {
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing'
      });
      if (!ok) return;
    }
    close(null);
  }
  useOverlayBack(handleCancel);

  function handleSave() {
    close({
      pieces: engineState.pieces,
      turn: engineState.turn,
      castling: engineState.castling,
      enPassant: engineState.enPassant,
      setupMoves: history
    });
  }

  const styleSet = boardStyles[boardStyle] ?? boardStyles[0];

  return (
    <SafeAreaView style={styles.overlay}>
      <View style={styles.header}>
        <BackCircleButton onPress={handleCancel} />
        <Text style={styles.title} numberOfLines={1}>
          Starting position
        </Text>
        <View style={{ width: 40 }} />
      </View>
      <Text style={styles.hint}>
        Every new card you add to "{openingName}" will start from this position — play the opening's moves here first,
        or just save as-is for the normal starting position.
      </Text>

      <View style={[styles.board, { width: BOARD_SIZE, height: BOARD_SIZE }]}>
        <View style={{ width: BOARD_SIZE, height: BOARD_SIZE, flexDirection: 'row', flexWrap: 'wrap' }}>
          {(flipped ? [...allSquares()].reverse() : allSquares()).map((sq, i) => {
            const file = i % 8;
            const rank = Math.floor(i / 8);
            const isLight = (file + rank) % 2 === 0;
            const piece = engineState.pieces[sq];
            const isSelected = sq === selected;
            const isTarget = legalTargets.includes(sq);
            const selPiece = selected ? engineState.pieces[selected] : undefined;
            const isCapture = isTarget && (Boolean(piece) || (selPiece?.[1] === 'P' && sq === engineState.enPassant));
            return (
              <Pressable
                key={sq}
                onPress={() => handleSquareTap(sq)}
                style={{
                  width: CELL,
                  height: CELL,
                  backgroundColor: isLight ? styleSet.light : styleSet.dark,
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                {piece && <PieceGlyph code={piece} cell={CELL} />}
                {isSelected && <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.selectedHighlight]} />}
                {isTarget && !isCapture && <View pointerEvents="none" style={styles.moveDot} />}
                {isCapture && <View pointerEvents="none" style={styles.captureRing} />}
              </Pressable>
            );
          })}
        </View>
      </View>

      {pendingPromotion ? (
        <View style={styles.promoRow}>
          <Text style={styles.promoLabel}>Promote to:</Text>
          {PROMOTION_PIECES.map((p) => (
            <Pressable key={p} onPress={() => choosePromotion(p)} style={styles.promoBtn}>
              <PieceGlyph code={`${engineState.turn}${p}` as PieceCode} cell={36} />
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={styles.controlRow}>
          <Pressable
            onPress={handleBack}
            disabled={history.length === 0}
            style={[styles.stepBtn, history.length === 0 && styles.stepBtnDisabled]}
          >
            <Text style={styles.stepBtnText}>‹ Back</Text>
          </Pressable>
          <Pressable
            onPress={handleReset}
            disabled={history.length === 0}
            style={[styles.stepBtn, styles.resetBtn, history.length === 0 && styles.stepBtnDisabled]}
          >
            <Text style={[styles.stepBtnText, styles.resetBtnText]}>Reset</Text>
          </Pressable>
        </View>
      )}

      <View style={{ flex: 1 }} />

      <Pressable onPress={handleSave} style={styles.saveBtn}>
        <Text style={styles.saveBtnText}>{history.length === 0 ? 'Save (standard starting position)' : 'Save starting position'}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

export function openOpeningStartPositionPicker(
  openingName: string,
  yourColor: 'w' | 'b',
  boardStyle: number
): Promise<OpeningStartPosition | null> {
  return showOverlay<OpeningStartPosition | null>((close) => (
    <OpeningStartPositionOverlay openingName={openingName} yourColor={yourColor} boardStyle={boardStyle} close={close} />
  ));
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, marginBottom: 10 },
  title: { color: colors.text, ...type.h1, flex: 1, textAlign: 'center' },
  hint: { color: colors.textDim, ...type.caption, marginBottom: 14, lineHeight: 18 },
  board: { alignSelf: 'center', borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  selectedHighlight: { backgroundColor: 'rgba(21,128,61,0.35)' },
  moveDot: {
    position: 'absolute',
    width: CELL * 0.28,
    height: CELL * 0.28,
    borderRadius: (CELL * 0.28) / 2,
    backgroundColor: 'rgba(21,128,61,0.55)'
  },
  captureRing: {
    position: 'absolute',
    width: CELL - 6,
    height: CELL - 6,
    borderRadius: (CELL - 6) / 2,
    borderWidth: 3,
    borderColor: 'rgba(220,38,38,0.85)'
  },
  promoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, alignSelf: 'center' },
  promoLabel: { color: colors.textDim, fontSize: 13, marginRight: 4 },
  promoBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center'
  },
  controlRow: { flexDirection: 'row', gap: 10, marginTop: 14, alignSelf: 'center' },
  stepBtn: {
    minWidth: 90,
    minHeight: touchTarget,
    borderRadius: radius.pill,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg
  },
  stepBtnDisabled: { opacity: 0.4 },
  resetBtn: { backgroundColor: colors.danger, borderColor: colors.danger },
  resetBtnText: { color: '#fff' },
  stepBtnText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  saveBtn: {
    minHeight: touchTarget,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    marginBottom: 4
  },
  saveBtnText: { color: colors.onPrimary, fontSize: 15, fontWeight: '700' }
});
