import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { View } from 'react-native';
import { GuideCoach } from './components/GuideCoach';
import { TUTORIAL_STEPS, type TutorialStep, type TutorialSurface } from './tutorialContent';

// Things the tutorial needs to remember from what the user just created, so a
// later step can point at it (the new opening's row, say).
interface Memory {
  openingId?: string;
  cardId?: string;
}

interface TutorialContextValue {
  // The step currently being shown (null when the tutorial isn't running).
  step: TutorialStep | null;
  memory: Memory;
  start: () => void;
  stop: () => void;
  // "Got it" on the current step.
  next: () => void;
  // Something the tutorial might be waiting on happened. Ignored unless the
  // current step is waiting for exactly this.
  event: (name: string) => void;
  // Jumps straight to the step with this id.
  goTo: (id: string) => void;
  // Yes/no facts about what the user has done (e.g. typed a description) that
  // a step can require before "Got it" works.
  flags: Record<string, boolean>;
  setFlag: (name: string, value: boolean) => void;
  remember: (patch: Memory) => void;
  // A screen came into view; skips optional steps that belong to screens the
  // flow has already moved past.
  reportSurface: (surface: TutorialSurface) => void;
  registerTarget: (id: string, ref: React.RefObject<View | null>) => () => void;
  getTarget: (id: string) => React.RefObject<View | null> | undefined;
}

const noop = () => {};
const TutorialContext = createContext<TutorialContextValue>({
  step: null,
  memory: {},
  start: noop,
  stop: noop,
  next: noop,
  event: noop,
  goTo: noop,
  flags: {},
  setFlag: noop,
  remember: noop,
  reportSurface: noop,
  registerTarget: () => noop,
  getTarget: () => undefined
});

export function useTutorial() {
  return useContext(TutorialContext);
}

// Wraps the whole app — the navigation stack AND the overlay windows (prompts,
// card editor, board editor), which are separate native Modals — so any of
// them can show the current step and register the controls it points at.
export function TutorialProvider({ children }: { children: React.ReactNode }) {
  const [index, setIndex] = useState<number | null>(null);
  const [memory, setMemory] = useState<Memory>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const targets = useRef(new Map<string, React.RefObject<View | null>>());

  const start = useCallback(() => {
    setMemory({});
    setFlags({});
    setIndex(0);
  }, []);
  const stop = useCallback(() => {
    setIndex(null);
    setMemory({});
    setFlags({});
  }, []);
  const setFlag = useCallback(
    (name: string, value: boolean) => setFlags((f) => (f[name] === value ? f : { ...f, [name]: value })),
    []
  );

  const event = useCallback((name: string) => {
    setIndex((i) => {
      if (i === null) return i;
      const step = TUTORIAL_STEPS[i];
      // Cancelling the name prompt puts the user back on the button that
      // opened it, so they aren't left with no popup to point them onward.
      if (name === 'promptCancel') return step.surface === 'prompt' && i > 0 ? i - 1 : i;
      // Leaving the board editor without saving puts the user back on the
      // "tap the board" step in the card editor.
      if (name === 'boardCancel') {
        if (step.surface !== 'boardEditor') return i;
        for (let j = i - 1; j >= 0; j--) {
          if (TUTORIAL_STEPS[j].advance === 'openBoardEditor') return j;
        }
        return i;
      }
      if (step.advance !== name) return i;
      return i + 1 >= TUTORIAL_STEPS.length ? null : i + 1;
    });
  }, []);

  const next = useCallback(() => event('button'), [event]);
  const goTo = useCallback((id: string) => {
    const j = TUTORIAL_STEPS.findIndex((s) => s.id === id);
    if (j >= 0) setIndex(j);
  }, []);
  const remember = useCallback((patch: Memory) => setMemory((m) => ({ ...m, ...patch })), []);

  const reportSurface = useCallback((surface: TutorialSurface) => {
    setIndex((i) => {
      if (i === null || TUTORIAL_STEPS[i].surface === surface) return i;
      let j = i;
      while (j < TUTORIAL_STEPS.length && TUTORIAL_STEPS[j].surface !== surface) {
        if (!TUTORIAL_STEPS[j].optional) return i;
        j++;
      }
      return j < TUTORIAL_STEPS.length ? j : i;
    });
  }, []);

  const registerTarget = useCallback((id: string, ref: React.RefObject<View | null>) => {
    targets.current.set(id, ref);
    return () => {
      if (targets.current.get(id) === ref) targets.current.delete(id);
    };
  }, []);
  const getTarget = useCallback((id: string) => targets.current.get(id), []);

  const value = useMemo<TutorialContextValue>(
    () => ({
      step: index === null ? null : TUTORIAL_STEPS[index],
      memory,
      start,
      stop,
      next,
      event,
      goTo,
      flags,
      setFlag,
      remember,
      reportSurface,
      registerTarget,
      getTarget
    }),
    [index, memory, flags, setFlag, start, stop, next, event, goTo, remember, reportSurface, registerTarget, getTarget]
  );

  return <TutorialContext.Provider value={value}>{children}</TutorialContext.Provider>;
}

// Returns a ref to attach to a control so the tutorial can spotlight it under
// `id`. Pass undefined to leave it unregistered (e.g. only one row of a list
// is ever a target).
export function useTutorialTarget(id: string | undefined) {
  const ref = useRef<View>(null);
  const { registerTarget } = useTutorial();
  useEffect(() => {
    if (!id) return;
    return registerTarget(id, ref);
  }, [id, registerTarget]);
  return ref;
}

// The tutorial's popup layer for one screen/window. Renders nothing unless the
// current step belongs to this surface.
export function TutorialLayer({ surface, flipped }: { surface: TutorialSurface; flipped?: boolean }) {
  const { step, flags, getTarget, next, stop } = useTutorial();
  if (!step || step.surface !== surface) return null;
  return (
    <GuideCoach
      step={step}
      centered={!step.target}
      flipped={flipped}
      holeOpen={step.holeOpen}
      nextDisabled={Boolean(step.requires && !flags[step.requires])}
      resolveTarget={step.target ? () => getTarget(step.target!) : undefined}
      onNext={next}
      onExit={stop}
    />
  );
}
