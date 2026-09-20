import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { newReactionBoard, cloneReactionBoard } from '../chess';
import { uid } from '../storage';
import { ChessBoardView } from '../components/ChessBoard';
import { ModeTip } from '../components/ModeTip';
import { useTutorial, useTutorialTarget } from '../tutorial';
import { CloseCircleButton, dismissSnackbar, showSnackbar } from '../overlay';
import type { CardMode, ReactionBoard } from '../types';
import { colors, radius, spacing } from '../theme';
import { openReactionBoardEditor } from './ReactionBoardEditorOverlay';

const MAX_BOARDS = 6;
const PREVIEW_SIZE = 148;

// The card's board section for all three modes: up to 6 boards in 2
// columns, filled row-major (board 1,3,5 in column 1; 2,4,6 in column 2).
// Each tile opens the editor for that mode on tap; a mode-specific hint
// above the grid explains whatever isn't obvious from the boards alone.
export function BoardsGrid({
  mode,
  boards,
  yourColor,
  boardStyle,
  onChange
}: {
  mode: CardMode;
  boards: ReactionBoard[];
  yourColor: 'w' | 'b';
  boardStyle: number;
  onChange: (boards: ReactionBoard[]) => void;
}) {
  const sorted = [...boards].sort((a, b) => a.order - b.order);
  const tutorial = useTutorial();
  const firstBoardRef = useTutorialTarget('cardEditor.board');
  // The latest boards, for an Undo that comes a few seconds after the delete.
  const boardsRef = useRef(boards);
  boardsRef.current = boards;
  const undoSnackbar = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (undoSnackbar.current !== null) dismissSnackbar(undoSnackbar.current);
    },
    []
  );

  function renumber(list: ReactionBoard[]): ReactionBoard[] {
    return list.map((b, i) => ({ ...b, order: i }));
  }

  function handleAdd() {
    if (boards.length >= MAX_BOARDS) return;
    onChange([...boards, newReactionBoard(uid(), boards.length)]);
  }

  function handleDuplicate(board: ReactionBoard) {
    if (boards.length >= MAX_BOARDS) return;
    onChange(renumber([...boards, cloneReactionBoard(board, uid())]));
  }

  function handleDelete(board: ReactionBoard) {
    // A card always needs at least one board — study text and position now
    // live on the board itself, so there's nowhere left for a boardless
    // card to keep anything.
    if (boards.length <= 1) return;
    const index = sorted.findIndex((b) => b.id === board.id);
    onChange(renumber(boards.filter((b) => b.id !== board.id)));
    undoSnackbar.current = showSnackbar({
      message: 'Board deleted',
      actionLabel: 'Undo',
      onAction: () => {
        const current = [...boardsRef.current].sort((a, b) => a.order - b.order);
        if (current.length >= MAX_BOARDS || current.some((b) => b.id === board.id)) return;
        current.splice(Math.min(index, current.length), 0, board);
        onChange(renumber(current));
      }
    });
  }

  async function handleOpen(board: ReactionBoard) {
    // All three modes share the same editor (forced move order, circles,
    // numbered arrows) — "Others"/"Plan" just never get offered the Play
    // button, so `recording` stays empty for them.
    tutorial.event('openBoardEditor');
    const updated = await openReactionBoardEditor(board, mode, yourColor, boardStyle);
    if (!updated) return;
    onChange(boards.map((b) => (b.id === board.id ? updated : b)));
  }

  return (
    <View>
      <ModeTip mode={mode} />

      <View style={styles.grid}>
        {sorted.map((board, tileIdx) => {
          // The grid preview is a management view, not Study — it always
          // shows the full position with its arrows, never hides anything:
          // Reactions' own fields, Others' front, or Plan's single face
          // (`back`, where its position/arrows actually live).
          const previewFace = mode === 'plan' ? board.back : board.front;
          const previewBoard =
            mode === 'reactions'
              ? { pieces: board.pieces, style: boardStyle, arrows: board.arrows, circles: board.circles }
              : { pieces: previewFace.pieces, style: boardStyle, arrows: previewFace.arrows, circles: previewFace.circles };
          return (
          <View key={board.id} style={styles.tile}>
            <Pressable
              ref={tileIdx === 0 ? firstBoardRef : undefined}
              collapsable={false}
              onPress={() => handleOpen(board)}
            >
              <ChessBoardView board={previewBoard} size={PREVIEW_SIZE} flipped={yourColor === 'b'} />
            </Pressable>
            <Text style={styles.tileCaption}>Board {tileIdx + 1} · tap to edit</Text>
            <View style={styles.tileActions}>
              <Pressable
                onPress={() => handleDuplicate(board)}
                disabled={boards.length >= MAX_BOARDS}
                style={styles.duplicateBtn}
              >
                <Text style={[styles.duplicateText, boards.length >= MAX_BOARDS && styles.duplicateTextDisabled]}>
                  ⧉ Duplicate
                </Text>
              </Pressable>
              {boards.length > 1 && (
                <View style={styles.deleteBtn}>
                  <CloseCircleButton onPress={() => handleDelete(board)} />
                </View>
              )}
            </View>
          </View>
          );
        })}
      </View>

      {boards.length < MAX_BOARDS ? (
        <Pressable onPress={handleAdd} style={styles.addBoardBtn}>
          <Text style={styles.addBoardText}>+ Add board</Text>
        </Pressable>
      ) : (
        // The limit stays visible instead of the button silently vanishing.
        <View style={[styles.addBoardBtn, styles.addBoardBtnFull]}>
          <Text style={styles.addBoardText}>
            {MAX_BOARDS} / {MAX_BOARDS} boards
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { width: '50%', padding: spacing.xs, alignItems: 'center' },
  tileCaption: { color: colors.textDim, fontSize: 12, marginTop: 6, width: PREVIEW_SIZE },
  tileActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: PREVIEW_SIZE,
    marginTop: 6
  },
  duplicateBtn: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 6 },
  duplicateText: { color: colors.textDim, fontSize: 12.5, fontWeight: '600' },
  duplicateTextDisabled: { opacity: 0.4 },
  deleteBtn: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  addBoardBtn: {
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignSelf: 'flex-start',
    marginTop: 8
  },
  addBoardBtnFull: { opacity: 0.6, borderStyle: 'solid' },
  addBoardText: { color: colors.textDim, fontSize: 14 },
});
