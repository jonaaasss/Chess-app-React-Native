import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Easing } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { FILES, RANKS, flipIndex } from '../chess';
import { NumberedArrowsSvg } from './ChessBoard';
import { arrowColors, colors } from '../theme';
import type { CoachTarget } from '../guideContent';

export type GuideTargets = Record<Exclude<CoachTarget, 'screen'>, React.RefObject<View | null>>;

// What a popup needs to know about a step, whichever flow it comes from (the
// study guide's coach steps or the make-your-own-cards tutorial's).
export interface CoachLikeStep {
  id: string;
  text: string;
  sub?: string;
  // 'button' waits for "Got it"; anything else waits for the user to press the
  // spotlit control itself (its hole is left open).
  advance: string;
  // Animated finger between two squares: dragging by default, or (`tap`)
  // tapping the first square and then the second, with a green arrow between.
  finger?: { from: string; to: string; tap?: boolean };
}

export interface CoachChoice {
  label: string;
  onPress: () => void;
}

interface Layout {
  // Target rectangle, relative to this overlay's own top-left corner (all
  // zero when there's no spotlight).
  x: number;
  y: number;
  w: number;
  h: number;
  // This overlay's own size.
  W: number;
  H: number;
}

const DIM = 'rgba(0,0,0,0.65)';
const FADE_MS = 180;
const BUBBLE_GAP = 14;
// A tap outside the bubble only counts as "Got it" once the popup has been up
// this long, so a tap that was really meant for whatever was underneath an
// instant ago doesn't skip a popup nobody has read yet.
const DISMISS_GUARD_MS = 500;
const POLL_MS = 90;
const MAX_SETTLE_POLLS = 40;
// The target must read the same this many times in a row before the popup
// shows (about 3 x POLL_MS).
const SETTLE_READS = 3;
const NEAR = 1.5;
// The board draws its squares (and its circles/arrows) just inside its 1px
// border, so everything laid over it has to start that far in to line up.
const BOARD_BORDER = 1;

// How often the targets of coming steps are measured in the background, how
// long one must have held still, and how old a sighting can be, for a step
// to be shown the moment it starts instead of waiting to see the target
// hold still all over again.
const TRACK_MS = 120;
const STABLE_MS = 100;
const STALE_MS = 450;
// Extra checks right after a popup appears (then every 400 ms), so a target
// that did move after all is caught within a few frames.
const RECHECK_MS = [60, 150];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const nearRect = (a: Box, b: Box) =>
  Math.abs(a.x - b.x) < NEAR && Math.abs(a.y - b.y) < NEAR && Math.abs(a.w - b.w) < NEAR && Math.abs(a.h - b.h) < NEAR;

const near = (a: Layout, b: Layout) => nearRect(a, b);

// Where each spotlight target was last measured (window coordinates), since
// when it has been in that spot, and when it was last seen.
const sightings = new WeakMap<object, Box & { since: number; seen: number }>();

function noteSighting(view: object, r: Box) {
  const now = Date.now();
  const prev = sightings.get(view);
  sightings.set(view, prev && nearRect(prev, r) ? { ...prev, seen: now } : { ...r, since: now, seen: now });
}

// The target is where it was last seen, and has been there for a while.
function holdsStill(view: object, r: Box) {
  const prev = sightings.get(view);
  const now = Date.now();
  return Boolean(prev && now - prev.seen < STALE_MS && now - prev.since >= STABLE_MS && nearRect(prev, r));
}

// Runs `make()` over and over until cancelled. Deliberately not
// Animated.loop: those started before the animated view is actually on
// screen could stall, so this is only ever started once the target is
// laid out, and restarts itself if it ever ends.
function useRepeatingAnimation(active: boolean, deps: unknown[], make: () => Animated.CompositeAnimation) {
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let current: Animated.CompositeAnimation | null = null;
    const run = () => {
      current = make();
      current.start(({ finished }) => {
        if (finished && !cancelled) run();
      });
    };
    run();
    return () => {
      cancelled = true;
      current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ...deps]);
}

// Just the dimming, no popup: a screen or window the flow has already moved
// away from holds it for a moment so it doesn't flash back to normal before
// the next one has taken over.
export function DimVeil() {
  return <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: DIM }]} />;
}

// A coach popup: dims everything except the one real control it's about (a
// pulsing gold ring marks it), with a speech bubble beside it and, where
// useful, an animated finger showing the gesture. For "Got it" steps the
// spotlit area is blocked too and a tap anywhere outside the bubble counts as
// "Got it"; for steps that wait for the user to press the spotlit control
// itself, that hole is left open so the touch goes straight to the real
// button. With `centered` (or when the target never turns up) there's no
// spotlight: just a centered bubble over a fully dimmed screen.
//
// Nothing is shown until the target's position has stopped moving and the
// bubble has been measured, so it appears once, in the right place, instead
// of jumping there from wherever it first landed. A target that was already
// seen holding still in that same spot (see `watch`) counts as settled at
// once, so a step that follows another one needn't wait.
export function GuideCoach({
  step,
  resolveTarget,
  centered,
  flipped = false,
  choices,
  holeOpen,
  nextDisabled,
  startDimmed,
  watch,
  onShown,
  onNext,
  onExit
}: {
  step: CoachLikeStep | null;
  resolveTarget?: () => React.RefObject<View | null> | null | undefined;
  centered?: boolean;
  flipped?: boolean;
  // Keeps the spotlit control touchable on a "Got it" step (a field to type in).
  holeOpen?: boolean;
  // "Got it" shows but doesn't work yet.
  nextDisabled?: boolean;
  // Replaces "Got it" (and outside-tap dismissal) with these buttons.
  choices?: CoachChoice[];
  // This popup takes over from one that was already up elsewhere: dim from the
  // very first frame instead of fading the dimming in.
  startDimmed?: boolean;
  // Targets of steps still to come. They're measured in the background, so
  // that when their step starts the popup can appear right away.
  watch?: () => Array<React.RefObject<View | null> | undefined>;
  // Called whenever the popup has appeared (or changed to a new step).
  onShown?: () => void;
  onNext: () => void;
  // Shows a small ✕ that abandons the whole flow.
  onExit?: () => void;
}) {
  const rootRef = useRef<View>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [bubbleH, setBubbleH] = useState(0);
  const pulse = useRef(new Animated.Value(0)).current;
  const finger = useRef(new Animated.Value(0)).current;
  const shownAt = useRef(0);
  const ready = layout !== null;
  const visible = ready && bubbleH > 0;
  // Mirrors of state for the step-change effect below, which must know what
  // was on screen for the previous step without re-running on every change.
  const layoutRef = useRef<Layout | null>(null);
  layoutRef.current = layout;
  const lastTargetRef = useRef<React.RefObject<View | null> | null>(null);
  // Once a popup has been up, the screen stays dimmed (and blocked) even in
  // the gaps between steps, instead of flashing back to normal.
  const [everShown, setEverShown] = useState(Boolean(startDimmed));
  useEffect(() => {
    if (visible) setEverShown(true);
  }, [visible]);

  // The very first popup of a flow fades in, dimming and all. After that the
  // dimming stays put and each new popup simply takes over from the one
  // before it, with no fade to wait for.
  const appear = useRef(new Animated.Value(0)).current;
  const dimIn = useRef(new Animated.Value(startDimmed ? 1 : 0)).current;
  const cutIn = useRef(Boolean(startDimmed));
  useEffect(() => {
    if (!visible) {
      appear.setValue(0);
      return;
    }
    if (cutIn.current) return;
    const fades = Animated.parallel([
      Animated.timing(appear, { toValue: 1, duration: FADE_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(dimIn, { toValue: 1, duration: FADE_MS, easing: Easing.out(Easing.quad), useNativeDriver: true })
    ]);
    fades.start(({ finished }) => {
      if (finished) cutIn.current = true;
    });
    return () => fades.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, step?.id]);

  // Keeps the coming targets' positions up to date, whether or not a popup is
  // up right now.
  const watchRef = useRef(watch);
  watchRef.current = watch;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const sweep = () => {
      for (const ref of watchRef.current?.() ?? []) {
        const view = ref?.current;
        view?.measureInWindow((x, y, w, h) => {
          if (!cancelled && w > 0 && h > 0) noteSighting(view, { x, y, w, h });
        });
      }
      timer = setTimeout(sweep, TRACK_MS);
    };
    sweep();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (visible) onShown?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, step?.id]);

  // Polls the target's position (window coordinates, re-based on this
  // overlay's own origin) until several consecutive reads agree, then shows
  // it — and keeps checking gently afterwards: if the target moves (a
  // keyboard opening, a list settling) the popup hides and shows again at the
  // new spot instead of visibly jumping. If the target never appears, falls
  // back to a centered bubble rather than showing nothing.
  // A layout effect, so that when the step changes to one with a different
  // target the old spotlight is cleared before anything is painted, instead of
  // showing the new text at the old spot for a frame.
  useLayoutEffect(() => {
    if (!step) {
      lastTargetRef.current = null;
      setLayout(null);
      setBubbleH(0);
      return;
    }
    // Same spotlight target as the step before (the board, across a run of
    // moves): keep the popup exactly where it is and just swap what it says,
    // rather than clearing it and settling all over again.
    const target = centered ? null : resolveTarget?.() ?? null;
    const keep = Boolean(target) && target === lastTargetRef.current && layoutRef.current !== null;
    lastTargetRef.current = target;
    if (!keep) {
      setLayout(null);
      setBubbleH(0);
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last: Layout | null = keep ? layoutRef.current : null;
    let agree = keep ? SETTLE_READS : 0;
    let settled = keep;
    let shown: Layout | null = keep ? layoutRef.current : null;
    let polls = 0;
    // Checks right after the popup appears come sooner than later ones.
    let rechecks = keep ? RECHECK_MS.length : 0;
    const nextCheck = () => RECHECK_MS[rechecks++] ?? 400;
    const schedule = (ms: number) => {
      timer = setTimeout(tick, ms);
    };
    // Measures this overlay and the target side by side.
    const read = (done: (root: Box | null, tgt: Box | null, view: View | null) => void) => {
      const view = centered ? null : resolveTarget?.()?.current ?? null;
      let root: Box | null = null;
      let tgt: Box | null = null;
      let pending = view ? 2 : 1;
      const finish = () => {
        if (--pending === 0) done(root, tgt, view);
      };
      if (rootRef.current) {
        rootRef.current.measureInWindow((x, y, w, h) => {
          root = { x, y, w, h };
          finish();
        });
      } else {
        finish();
      }
      view?.measureInWindow((x, y, w, h) => {
        tgt = w > 0 && h > 0 ? { x, y, w, h } : null;
        finish();
      });
    };
    const tick = () => {
      if (cancelled) return;
      polls++;
      read((root, tgt, view) => {
        if (cancelled) return;
        if (!root) {
          schedule(POLL_MS);
          return;
        }
        const W = root.w;
        const H = root.h;
        if (centered) {
          setLayout({ x: 0, y: 0, w: 0, h: 0, W, H });
          return;
        }
        // Read before this sighting is noted: was the target already known to
        // be holding still where it is now?
        const knownStill = Boolean(view && tgt && holdsStill(view, tgt));
        if (view && tgt) noteSighting(view, tgt);
        const cur: Layout | null = tgt ? { x: tgt.x - root.x, y: tgt.y - root.y, w: tgt.w, h: tgt.h, W, H } : null;
        if (!cur) {
          if (!settled && polls >= MAX_SETTLE_POLLS) {
            settled = true;
            setLayout({ x: 0, y: 0, w: 0, h: 0, W, H });
            return;
          }
          schedule(settled ? 400 : POLL_MS);
          return;
        }
        if (settled) {
          // Already showing. If the target has since moved, hide the popup
          // and settle again at the new spot rather than visibly jumping.
          if (shown && !near(shown, cur)) {
            settled = false;
            agree = 1;
            last = cur;
            shown = null;
            setLayout(null);
            schedule(POLL_MS);
            return;
          }
          schedule(nextCheck());
          return;
        }
        if (knownStill) agree = SETTLE_READS;
        else if (last && near(last, cur)) agree++;
        else {
          agree = 1;
          last = cur;
        }
        if (agree >= SETTLE_READS) {
          settled = true;
          shown = cur;
          rechecks = 0;
          setLayout(cur);
          schedule(nextCheck());
        } else {
          schedule(POLL_MS);
        }
      });
    };
    // A step that changes the target starts measuring at once, not after a
    // pause.
    if (keep) schedule(POLL_MS);
    else tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.id]);

  useEffect(() => {
    if (visible) shownAt.current = Date.now();
  }, [step?.id, visible]);

  useRepeatingAnimation(Boolean(step) && visible, [step?.id], () => {
    pulse.setValue(0);
    return Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true })
    ]);
  });

  // Keeps going for as long as the popup is up: press, drag, release, pause,
  // and around again.
  useRepeatingAnimation(Boolean(step?.finger) && visible, [step?.id], () => {
    finger.setValue(0);
    return Animated.sequence([
      Animated.delay(500),
      Animated.timing(finger, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      Animated.delay(600)
    ]);
  });

  if (!step) return null;

  const waitsForTarget = step.advance !== 'button' || Boolean(holeOpen);
  // No spotlight: asked for, or the target never showed up (zero-size rect).
  const noSpot = Boolean(centered) || !layout || (layout.w === 0 && layout.h === 0);

  function dismiss() {
    if (Date.now() - shownAt.current < DISMISS_GUARD_MS) return;
    onNext();
  }
  // Undefined on steps that wait for the real control (or offer choices):
  // those panels still swallow the touch, they just don't dismiss anything.
  const onOutsidePress = waitsForTarget || choices ? undefined : dismiss;

  let bubbleTop = 0;
  let caretLeft = 0;
  let above = false;
  if (layout) {
    if (noSpot) {
      bubbleTop = Math.max(8, (layout.H - bubbleH) / 2);
    } else {
      above = layout.y + layout.h / 2 > layout.H / 2;
      bubbleTop = above ? layout.y - BUBBLE_GAP - bubbleH : layout.y + layout.h + BUBBLE_GAP;
      bubbleTop = Math.max(8, Math.min(layout.H - bubbleH - 8, bubbleTop));
      caretLeft = Math.max(28, Math.min(layout.W - 44, layout.x + layout.w / 2 - 7));
    }
  }

  // Center of a square inside the spotlit board, honoring board flip.
  function squareCenter(sq: string) {
    const fi = flipIndex(FILES.indexOf(sq[0]), flipped);
    const ri = flipIndex(RANKS.indexOf(sq[1]), flipped);
    const cell = layout!.w / 8;
    return {
      x: layout!.x + BOARD_BORDER + (fi + 0.5) * cell,
      y: layout!.y + BOARD_BORDER + (ri + 0.5) * cell
    };
  }

  return (
    <View
      ref={rootRef}
      collapsable={false}
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
    >
      {!visible && (
        // Between steps / while the target settles and the bubble is measured:
        // nothing underneath can be tapped, and once a popup has been up the
        // dimming stays too. It goes away in the same frame the spotlight
        // version below appears, so the screen never flashes back to normal.
        <Pressable style={[StyleSheet.absoluteFill, everShown && { backgroundColor: DIM }]} />
      )}
      {layout && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: visible ? dimIn : 0 }]} pointerEvents="box-none">
          {noSpot ? (
            <Pressable onPress={onOutsidePress} style={[styles.dim, { left: 0, top: 0, width: layout.W, height: layout.H }]} />
          ) : (
            <>
              {/* Four dim panels around the spotlit rectangle — the hole
                  between them stays touch-transparent unless it's covered
                  below. */}
              <Pressable onPress={onOutsidePress} style={[styles.dim, { left: 0, top: 0, width: layout.W, height: layout.y }]} />
              <Pressable
                onPress={onOutsidePress}
                style={[styles.dim, { left: 0, top: layout.y + layout.h, width: layout.W, height: Math.max(0, layout.H - layout.y - layout.h) }]}
              />
              <Pressable onPress={onOutsidePress} style={[styles.dim, { left: 0, top: layout.y, width: layout.x, height: layout.h }]} />
              <Pressable
                onPress={onOutsidePress}
                style={[styles.dim, { left: layout.x + layout.w, top: layout.y, width: Math.max(0, layout.W - layout.x - layout.w), height: layout.h }]}
              />
              {!waitsForTarget && (
                <Pressable
                  onPress={onOutsidePress}
                  style={{ position: 'absolute', left: layout.x, top: layout.y, width: layout.w, height: layout.h }}
                />
              )}
            </>
          )}

          {/* Everything that fades in with each new popup: ring, finger, bubble. */}
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: cutIn.current ? 1 : appear }]} pointerEvents="box-none">
            {!noSpot && (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.ring,
                  {
                    left: layout.x - 4,
                    top: layout.y - 4,
                    width: layout.w + 8,
                    height: layout.h + 8,
                    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }),
                    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] }) }]
                  }
                ]}
              />
            )}

            {step.finger && !noSpot && (() => {
              const from = squareCenter(step.finger.from);
              const to = squareCenter(step.finger.to);
              const tap = Boolean(step.finger.tap);
              return (
                <>
                  {/* A green arrow from the piece's square to where it goes, drawn
                      by the same arrow component (and in the same place) as the
                      board editor's own arrows. */}
                  {tap && (
                    <View
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        left: layout.x + BOARD_BORDER,
                        top: layout.y + BOARD_BORDER,
                        width: layout.w,
                        height: layout.w
                      }}
                    >
                      <NumberedArrowsSvg
                        arrows={[{ id: 'guide-move', from: step.finger.from, to: step.finger.to, color: arrowColors.green }]}
                        size={layout.w}
                        flipped={flipped}
                      />
                    </View>
                  )}
                  <Animated.View
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      // The fingertip sits at (14, 3) inside the 28x40 hand.
                      left: from.x - 14,
                      top: from.y - 3,
                      opacity: finger.interpolate({ inputRange: [0, 0.08, 0.92, 1], outputRange: [0, 1, 1, 0] }),
                      transform: [
                        { translateX: finger.interpolate({ inputRange: [0, 1], outputRange: [0, to.x - from.x] }) },
                        { translateY: finger.interpolate({ inputRange: [0, 1], outputRange: [0, to.y - from.y] }) },
                        // A tap presses down on each square it lands on.
                        {
                          scale: tap
                            ? finger.interpolate({
                                inputRange: [0, 0.1, 0.2, 0.8, 0.9, 1],
                                outputRange: [1, 0.82, 1, 1, 0.82, 1]
                              })
                            : 1
                        }
                      ]
                    }}
                  >
                    <FingerIcon />
                  </Animated.View>
                </>
              );
            })()}

            <Pressable
              onPress={onOutsidePress}
              onLayout={(e) => setBubbleH(e.nativeEvent.layout.height)}
              style={[styles.bubble, { top: bubbleTop }]}
            >
              <Text style={[styles.bubbleText, onExit ? styles.bubbleTextWithExit : null]}>{step.text}</Text>
              {step.sub ? <Text style={styles.bubbleSub}>{step.sub}</Text> : null}
              {choices ? (
                <View style={styles.choices}>
                  {choices.map((c, i) => (
                    <Pressable
                      key={c.label}
                      onPress={c.onPress}
                      style={[styles.choice, i === choices.length - 1 ? styles.choicePrimary : styles.choiceSecondary]}
                    >
                      <Text style={[styles.choiceText, i === choices.length - 1 ? styles.choiceTextPrimary : styles.choiceTextSecondary]}>
                        {c.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : step.advance === 'button' ? (
                <Pressable
                  onPress={nextDisabled ? undefined : onNext}
                  disabled={nextDisabled}
                  style={[styles.gotIt, nextDisabled && styles.gotItDisabled]}
                >
                  <Text style={styles.gotItText}>Got it</Text>
                </Pressable>
              ) : null}
              {onExit && (
                <Pressable onPress={onExit} hitSlop={10} style={styles.exit}>
                  <Svg width={12} height={12} viewBox="0 0 24 24">
                    <Path d="M6 6l12 12M18 6L6 18" stroke={colors.onGold} strokeWidth={3.5} strokeLinecap="round" />
                  </Svg>
                </Pressable>
              )}
              {!noSpot && <View style={[styles.caret, { left: caretLeft - 16 }, above ? { bottom: -7 } : { top: -7 }]} />}
            </Pressable>
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}

// A pointing hand drawn as plain shapes (per the app's "draw icons, don't
// trust glyphs" rule): an index finger over a rounded palm. Its fingertip is
// at the top-center.
function FingerIcon() {
  return (
    <Svg width={28} height={40} viewBox="0 0 28 40">
      <Rect x={9} y={1.5} width={10} height={24} rx={5} fill="#ffffff" stroke="#111827" strokeWidth={2} />
      <Rect x={2.5} y={17} width={23} height={20} rx={8} fill="#ffffff" stroke="#111827" strokeWidth={2} />
      <Rect x={10} y={2.5} width={8} height={12} rx={4} fill="#ffffff" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  dim: { position: 'absolute', backgroundColor: DIM },
  ring: { position: 'absolute', borderWidth: 3, borderColor: colors.gold, borderRadius: 12 },
  bubble: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: colors.gold,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 6
  },
  bubbleText: { color: colors.onGold, fontSize: 15, fontWeight: '700', lineHeight: 20 },
  bubbleTextWithExit: { paddingRight: 22 },
  bubbleSub: { color: colors.onGold, fontSize: 12.5, lineHeight: 17, opacity: 0.85 },
  gotIt: { alignSelf: 'flex-end', backgroundColor: 'rgba(0,0,0,0.85)', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 18, marginTop: 4 },
  gotItText: { color: colors.gold, fontSize: 13, fontWeight: '700' },
  gotItDisabled: { opacity: 0.35 },
  choices: { flexDirection: 'row', gap: 10, marginTop: 6 },
  choice: { flex: 1, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  choicePrimary: { backgroundColor: 'rgba(0,0,0,0.85)' },
  choiceSecondary: { borderWidth: 2, borderColor: 'rgba(0,0,0,0.85)' },
  choiceText: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  choiceTextPrimary: { color: colors.gold },
  choiceTextSecondary: { color: colors.onGold },
  exit: { position: 'absolute', top: 10, right: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  caret: { position: 'absolute', width: 14, height: 14, backgroundColor: colors.gold, transform: [{ rotate: '45deg' }] }
});
