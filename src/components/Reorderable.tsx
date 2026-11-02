// Long-press-and-drag reordering for any list or grid of rows/tiles.
//
// Hold an item for a moment, then drag it: it lifts and follows the finger,
// the slot it would land in gets an outline, and letting go moves it there.
// Works for a plain vertical list and for a wrapping grid alike, because the
// drop target is simply the item whose centre is closest to the dragged
// item's centre. Taps keep working: `guard` swallows the tap that a finished
// drag would otherwise fire on release.
//
// The enclosing ScrollView must stop scrolling while a drag is running, or
// Android hands the finger to it halfway — that's what ScrollLockContext is
// for (see Screen in Common.tsx and CardEditorOverlay).
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { colors, radius } from '../theme';

const LONG_PRESS_MS = 400;
const TAP_GUARD_MS = 400;

export const ScrollLockContext = createContext<(locked: boolean) => void>(() => {});

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Drag {
  index: number;
  dx: number;
  dy: number;
  target: number;
}

function targetFor(rects: (Rect | undefined)[], from: number, dx: number, dy: number): number {
  const r = rects[from];
  if (!r) return from;
  const cx = r.x + r.width / 2 + dx;
  const cy = r.y + r.height / 2 + dy;
  let best = from;
  let bestDist = Infinity;
  rects.forEach((o, i) => {
    if (!o) return;
    const d = (o.x + o.width / 2 - cx) ** 2 + (o.y + o.height / 2 - cy) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

function ReorderableItem({
  index,
  onLayout,
  onStart,
  onMove,
  onEnd,
  style,
  highlight,
  children
}: {
  index: number;
  onLayout: (index: number, rect: Rect) => void;
  onStart: (index: number) => void;
  onMove: (dx: number, dy: number) => void;
  onEnd: () => void;
  style?: StyleProp<ViewStyle>;
  // Outlines the slot the dragged item would land in, drawn on top so the
  // item's own size never changes mid-drag.
  highlight?: boolean;
  children: React.ReactNode;
}) {
  const pan = Gesture.Pan()
    .activateAfterLongPress(LONG_PRESS_MS)
    .runOnJS(true)
    .onStart(() => onStart(index))
    .onUpdate((e) => onMove(e.translationX, e.translationY))
    .onFinalize(() => onEnd());
  return (
    <GestureDetector gesture={pan}>
      <View
        collapsable={false}
        style={style}
        onLayout={(e: LayoutChangeEvent) => onLayout(index, e.nativeEvent.layout)}
      >
        {children}
        {highlight && <View pointerEvents="none" style={styles.target} />}
      </View>
    </GestureDetector>
  );
}

export function Reorderable<T>({
  items,
  keyOf,
  onReorder,
  renderItem,
  itemStyle,
  containerStyle,
  disabled
}: {
  items: T[];
  keyOf: (item: T) => string;
  // The new order, as keys — only called when something actually moved.
  onReorder: (orderedKeys: string[]) => void;
  // `guard` wraps a tap handler so the release at the end of a drag doesn't
  // also count as a tap on the dragged item.
  renderItem: (item: T, index: number, guard: <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => void) => React.ReactNode;
  itemStyle?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  disabled?: boolean;
}) {
  const setScrollLocked = useContext(ScrollLockContext);
  const rects = useRef<(Rect | undefined)[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const lastDragEnd = useRef(0);

  const update = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const guard = useCallback(
    <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        if (dragRef.current || Date.now() - lastDragEnd.current < TAP_GUARD_MS) return;
        fn(...args);
      },
    []
  );

  function handleStart(index: number) {
    if (disabled) return;
    setScrollLocked(true);
    update({ index, dx: 0, dy: 0, target: index });
  }

  function handleMove(dx: number, dy: number) {
    const d = dragRef.current;
    if (!d) return;
    update({ ...d, dx, dy, target: targetFor(rects.current, d.index, dx, dy) });
  }

  function handleEnd() {
    const d = dragRef.current;
    if (!d) return;
    setScrollLocked(false);
    lastDragEnd.current = Date.now();
    update(null);
    if (d.target === d.index) return;
    const keys = items.map(keyOf);
    const [moved] = keys.splice(d.index, 1);
    keys.splice(d.target, 0, moved);
    onReorder(keys);
  }

  rects.current.length = items.length;

  return (
    <View style={containerStyle}>
      {items.map((item, index) => {
        const isDragged = drag?.index === index;
        const isTarget = !!drag && drag.target === index && !isDragged;
        return (
          <ReorderableItem
            key={keyOf(item)}
            index={index}
            onLayout={(i, rect) => {
              rects.current[i] = rect;
            }}
            onStart={handleStart}
            onMove={handleMove}
            onEnd={handleEnd}
            highlight={isTarget}
            style={[
              itemStyle,
              isDragged && drag && [styles.dragged, { transform: [{ translateX: drag.dx }, { translateY: drag.dy }, { scale: 1.03 }] }]
            ]}
          >
            {renderItem(item, index, guard)}
          </ReorderableItem>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  dragged: { zIndex: 10, elevation: 10, opacity: 0.92 },
  target: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.accent, borderStyle: 'dashed' }
});
