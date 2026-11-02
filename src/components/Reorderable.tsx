// Long-press-and-drag reordering for any list or grid of rows/tiles.
//
// Hold an item for a moment, then drag it: it lifts and follows the finger,
// the slot it would land in gets an outline, and letting go moves it there.
// Works for a plain vertical list and for a wrapping grid alike, because the
// drop target is simply the item whose centre is closest to the dragged
// item's centre. Taps keep working: `guard` swallows the tap that a finished
// drag would otherwise fire on release.
//
// The enclosing ScrollView is a "scroll host" (useScrollHost below, used by
// Screen in Common.tsx and by CardEditorOverlay): it stops scrolling by
// itself while a drag is running — or Android hands the finger to it
// halfway — and instead scrolls along when the finger nears its top or
// bottom edge, so an item can be dragged further than one screen.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
  type StyleProp,
  type ViewStyle
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { colors, radius } from '../theme';

const LONG_PRESS_MS = 400;
const TAP_GUARD_MS = 400;
// Auto-scroll starts this close to the scroll view's top/bottom edge and
// speeds up towards the edge, up to MAX_SPEED pixels per frame.
const EDGE = 80;
const MAX_SPEED = 18;

interface ScrollHost {
  setLocked: (locked: boolean) => void;
  // Scrolls by `dy` (clamped to the content) and returns how far it really moved.
  scrollBy: (dy: number) => number;
  // The scroll view's visible top and bottom on screen, or null if unknown.
  viewport: () => { top: number; bottom: number } | null;
}

const noHost: ScrollHost = { setLocked: () => {}, scrollBy: () => 0, viewport: () => null };
export const ScrollHostContext = createContext<ScrollHost>(noHost);

// Everything a ScrollView needs to act as a scroll host: spread `props` on
// it and wrap its content in <ScrollHostContext.Provider value={host}>.
export function useScrollHost() {
  const ref = useRef<ScrollView>(null);
  const offset = useRef(0);
  const contentHeight = useRef(0);
  const viewHeight = useRef(0);
  const viewTop = useRef<number | null>(null);
  const [locked, setLocked] = useState(false);

  const host = useRef<ScrollHost>({
    setLocked,
    scrollBy: (dy) => {
      const max = Math.max(0, contentHeight.current - viewHeight.current);
      const next = Math.min(max, Math.max(0, offset.current + dy));
      const moved = next - offset.current;
      if (moved !== 0) {
        offset.current = next;
        ref.current?.scrollTo({ y: next, animated: false });
      }
      return moved;
    },
    viewport: () => (viewTop.current === null ? null : { top: viewTop.current, bottom: viewTop.current + viewHeight.current })
  }).current;

  const props = {
    ref,
    scrollEnabled: !locked,
    scrollEventThrottle: 16,
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      offset.current = e.nativeEvent.contentOffset.y;
    },
    onContentSizeChange: (_w: number, h: number) => {
      contentHeight.current = h;
    },
    onLayout: (e: LayoutChangeEvent) => {
      viewHeight.current = e.nativeEvent.layout.height;
      // The native scroll view supports measureInWindow even though its
      // TypeScript class doesn't list it.
      const native = ref.current as unknown as { measureInWindow?: (cb: (x: number, y: number) => void) => void } | null;
      native?.measureInWindow?.((_x, y) => {
        viewTop.current = y;
      });
    }
  };
  return { host, props };
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Drag {
  index: number;
  dx: number;
  dy: number; // finger movement plus how far the list scrolled meanwhile
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
  onMove: (dx: number, dy: number, fingerY: number) => void;
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
    .onUpdate((e) => onMove(e.translationX, e.translationY, e.absoluteY))
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
  const scrollHost = useContext(ScrollHostContext);
  const rects = useRef<(Rect | undefined)[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const lastDragEnd = useRef(0);
  // The finger's own movement and screen position, and how far the list has
  // auto-scrolled since the drag started — kept apart so the dragged item
  // stays under the finger while the content moves beneath it.
  const finger = useRef({ dx: 0, dy: 0, y: 0 });
  const scrolled = useRef(0);
  const frame = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);

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

  function refresh() {
    const d = dragRef.current;
    if (!d) return;
    const dx = finger.current.dx;
    const dy = finger.current.dy + scrolled.current;
    update({ ...d, dx, dy, target: targetFor(rects.current, d.index, dx, dy) });
  }

  function stopAutoScroll() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }

  function autoScrollStep() {
    frame.current = null;
    if (!dragRef.current) return;
    const view = scrollHost.viewport();
    if (!view) return;
    const y = finger.current.y;
    let speed = 0;
    if (y < view.top + EDGE) speed = -MAX_SPEED * Math.min(1, (view.top + EDGE - y) / EDGE);
    else if (y > view.bottom - EDGE) speed = MAX_SPEED * Math.min(1, (y - (view.bottom - EDGE)) / EDGE);
    if (speed === 0) return;
    const moved = scrollHost.scrollBy(speed);
    if (moved === 0) return; // already at the top/bottom
    scrolled.current += moved;
    refresh();
    frame.current = requestAnimationFrame(autoScrollStep);
  }

  useEffect(() => stopAutoScroll, []);

  function handleStart(index: number) {
    if (disabled) return;
    scrollHost.setLocked(true);
    finger.current = { dx: 0, dy: 0, y: 0 };
    scrolled.current = 0;
    update({ index, dx: 0, dy: 0, target: index });
  }

  function handleMove(dx: number, dy: number, fingerY: number) {
    if (!dragRef.current) return;
    finger.current = { dx, dy, y: fingerY };
    refresh();
    if (frame.current === null) frame.current = requestAnimationFrame(autoScrollStep);
  }

  function handleEnd() {
    const d = dragRef.current;
    if (!d) return;
    stopAutoScroll();
    scrollHost.setLocked(false);
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
