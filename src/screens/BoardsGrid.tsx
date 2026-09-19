import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { newReactionBoard, cloneReactionBoard } from '../chess';
import { uid } from '../storage';
import { ChessBoardView } from '../components/ChessBoard';
import { CloseCircleButton } from '../overlay';
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
    onChange(renumber(boards.filter((b) => b.id !== board.id)));
  }

  async function handleOpen(board: ReactionBoard) {
    // All three modes share the same editor (forced move order, circles,
    // numbered arrows) — "Others"/"Plan" just never get offered the Play
    // button, so `recording` stays empty for them.
    const updated = await openReactionBoardEditor(board, mode, yourColor, boardStyle);
    if (!updated) return;
    onChange(boards.map((b) => (b.id === board.id ? updated : b)));
  }

  return (
    <View>
      {mode === 'reactions' && (
        <View style={styles.hint}>
          <Text style={styles.hintIcon}>ⓘ</Text>
          <Text style={styles.hintText}>
            {'1) Set up your starting position.\n2) Press "Play" and play out the moves you want to study (you can practice multiple variations by going back to a move and playing a different move).\n3) While studying, the opponent\'s moves will be played automatically and you have to find the move you recorded.'}
          </Text>
        </View>
      )}
      {mode === 'others' && (
        <View style={styles.hint}>
          <Text style={styles.hintIcon}>ⓘ</Text>
          <Text style={styles.hintText}>
            {'1) Set up your position on the front side.\n2) Flip to back and make some moves and/or draw arrows.\n3) While studying, you will see the front side. Once you tap the card, it will flip to the back and you mark whether you were correct or not.'}
          </Text>
        </View>
      )}
      {mode === 'plan' && (
        <View style={styles.hint}>
          <Text style={styles.hintIcon}>ⓘ</Text>
          <Text style={styles.hintText}>
            {'1) Set up your position.\n2) Draw arrows which is the general plan in the position.\n3) While studying, you will find the exact position but without arrows which you will have to draw yourself.'}
          </Text>
        </View>
      )}

      <View style={styles.grid}>
        {sorted.map((board) => {
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
            <Pressable onPress={() => handleOpen(board)}>
              <ChessBoardView board={previewBoard} size={PREVIEW_SIZE} flipped={yourColor === 'b'} />
            </Pressable>
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

      {boards.length < MAX_BOARDS && (
        <Pressable onPress={handleAdd} style={styles.addBoardBtn}>
          <Text style={styles.addBoardText}>+ Add board</Text>
        </Pressable>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { width: '50%', padding: spacing.xs, alignItems: 'center' },
  tileActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: PREVIEW_SIZE,
    marginTop: 6
  },
  duplicateBtn: { paddingVertical: 4, paddingHorizontal: 6 },
  duplicateText: { color: colors.textDim, fontSize: 12.5, fontWeight: '600' },
  duplicateTextDisabled: { opacity: 0.4 },
  deleteBtn: { transform: [{ scale: 0.85 }] },
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
  addBoardText: { color: colors.textDim, fontSize: 14 },
  hint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12
  },
  hintIcon: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  hintText: { color: colors.text, fontSize: 12.5, fontWeight: '500', flex: 1, lineHeight: 17 }
});
