import React, { useCallback, useMemo, useRef, useState } from 'react';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview/lib/WebViewTypes';
import type { PromotionPiece } from '../types';

const ANALYSIS_DEPTH = 14;
const MULTI_PV = 3;

export interface EngineLine {
  multipv: number; // 1 = best, 2/3 = alternatives — always contiguous from 1
  cp: number | null; // centipawns, White's perspective (null when `mate` is set)
  mate: number | null; // moves to mate, White's perspective, null otherwise
  from: string;
  to: string;
  promotion?: PromotionPiece;
}

// Wraps a hidden WebView running Stockfish 18 NNUE, compiled to ASM.js
// (plain JavaScript, no WebAssembly — see assets/engine/) behind a small
// UCI bridge. The engine can't run in React Native's own JS thread
// (Hermes), so it lives in a real browser-ish JS engine, which is what the
// WebView provides. Communication is plain UCI text lines over the
// WebView's postMessage bridge (assets/engine/index.html forwards them
// to/from a real Worker inside the page).
export function useStockfishEngine() {
  const webviewRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const linesRef = useRef<Map<number, EngineLine>>(new Map());
  const [lines, setLines] = useState<EngineLine[]>([]);
  const sideToMoveRef = useRef<'w' | 'b'>('w');
  // Which FEN `lines` currently describes — a caller re-rendering with a
  // newer FEN should ignore `lines` until this catches up, rather than
  // briefly showing the previous position's arrows/eval on the new one
  // while a slow-to-cancel search is still winding down.
  const [analyzedFen, setAnalyzedFen] = useState<string | null>(null);
  // These single-threaded Stockfish.js builds crash (a native-code memory
  // fault, "memory access out of bounds" / "X is not a function") if a new
  // `position`/`go` is sent while a previous search is still winding down
  // from `stop` — a documented upstream issue, not something a UCI option
  // works around. `searchingRef` tracks whether we're waiting on a
  // `bestmove` for the in-flight search; `pendingRef` holds the latest
  // position a caller asked for while one was in flight, sent for real
  // only once that `bestmove` actually arrives (stale intermediate targets
  // are simply overwritten, never queued up).
  const searchingRef = useRef(false);
  const pendingRef = useRef<{ fen: string; turn: 'w' | 'b' } | null>(null);

  const send = useCallback((cmd: string) => {
    webviewRef.current?.postMessage(cmd);
  }, []);

  const handleLoadEnd = useCallback(() => {
    send('uci');
  }, [send]);

  // Actually issues position+go — only ever called when we know no search
  // is currently in flight (either the first one, or right after a
  // `bestmove` confirms the previous one truly ended).
  const startSearch = useCallback(
    (fen: string, turn: 'w' | 'b') => {
      searchingRef.current = true;
      sideToMoveRef.current = turn;
      linesRef.current = new Map();
      setLines([]);
      setAnalyzedFen(fen);
      send(`position fen ${fen}`);
      send(`go depth ${ANALYSIS_DEPTH}`);
    },
    [send]
  );

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const line = event.nativeEvent.data;
      if (line === 'uciok') {
        send(`setoption name MultiPV value ${MULTI_PV}`);
        send('isready');
        return;
      }
      if (line === 'readyok') {
        setReady(true);
        return;
      }
      // Confirms the engine actually stopped — only now is it safe to
      // start the next search (see searchingRef's comment above: sending
      // position/go any earlier crashes this single-threaded build).
      if (line.startsWith('bestmove')) {
        searchingRef.current = false;
        const next = pendingRef.current;
        pendingRef.current = null;
        if (next) startSearch(next.fen, next.turn);
        return;
      }
      if (!line.startsWith('info ') || !line.includes(' pv ')) return;

      const multipvMatch = line.match(/ multipv (\d+)/);
      const pvMatch = line.match(/ pv (.+)$/);
      if (!multipvMatch || !pvMatch) return;
      const firstMove = pvMatch[1].trim().split(' ')[0];
      if (!firstMove || firstMove.length < 4) return;

      const cpMatch = line.match(/ score cp (-?\d+)/);
      const mateMatch = line.match(/ score mate (-?\d+)/);
      // UCI scores are relative to the side to move, but the eval bar and
      // move list read left-to-right as "White's perspective" like any
      // other chess GUI — flip the sign when it's Black to move.
      const sign = sideToMoveRef.current === 'b' ? -1 : 1;

      const multipv = Number(multipvMatch[1]);
      linesRef.current.set(multipv, {
        multipv,
        cp: cpMatch ? Number(cpMatch[1]) * sign : null,
        mate: mateMatch ? Number(mateMatch[1]) * sign : null,
        from: firstMove.slice(0, 2),
        to: firstMove.slice(2, 4),
        promotion: firstMove.length > 4 ? (firstMove[4].toUpperCase() as PromotionPiece) : undefined
      });
      setLines(Array.from(linesRef.current.values()).sort((a, b) => a.multipv - b.multipv));
    },
    [send, startSearch]
  );

  const evaluate = useCallback(
    (fen: string, turn: 'w' | 'b') => {
      if (searchingRef.current) {
        // A search is already running — remember what we actually want
        // and ask the engine to stop, but don't send position/go until
        // its `bestmove` confirms it's done. Overwriting `pendingRef` on
        // every call also means several rapid position changes collapse
        // into just the final one once the engine catches up.
        pendingRef.current = { fen, turn };
        send('stop');
        return;
      }
      startSearch(fen, turn);
    },
    [send, startSearch]
  );

  const stop = useCallback(() => {
    pendingRef.current = null;
    send('stop');
  }, [send]);

  const element = useMemo(
    () => (
      <WebView
        ref={webviewRef}
        source={{ uri: 'file:///android_asset/engine/index.html' }}
        onMessage={handleMessage}
        onLoadEnd={handleLoadEnd}
        style={{ width: 0, height: 0, opacity: 0 }}
        javaScriptEnabled
        originWhitelist={['*']}
        // Android's WebView blocks a file:// page from loading a Worker
        // (or that Worker fetching its own sibling file, stockfish.wasm)
        // by default — these three together are what actually lift that,
        // not just allowFileAccess on its own.
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        mixedContentMode="always"
      />
    ),
    [handleMessage, handleLoadEnd]
  );

  return { ready, lines, analyzedFen, evaluate, stop, element };
}
