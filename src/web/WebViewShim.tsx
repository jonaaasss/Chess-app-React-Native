// Web test build only (Claude's tests in a browser, see metro.config.js):
// stands in for react-native-webview, which has no web version. It does just
// what `useStockfishEngine` needs from the engine page: the same Stockfish
// file runs in a Web Worker, UCI lines go in through `postMessage` and come
// back through `onMessage`. The web build serves the engine file at
// /engine/stockfish-18-asm.js. The Android app never loads this file.
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

type Props = {
  onMessage?: (event: { nativeEvent: { data: string } }) => void;
  onLoadEnd?: () => void;
};

type EngineWorker = {
  postMessage(message: string): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
};

const ENGINE_URL = '/engine/stockfish-18-asm.js';

export const WebView = forwardRef<{ postMessage(message: string): void }, Props>(function WebView({ onMessage, onLoadEnd }, ref) {
  const worker = useRef<EngineWorker | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onLoadEndRef = useRef(onLoadEnd);
  onLoadEndRef.current = onLoadEnd;

  useImperativeHandle(ref, () => ({ postMessage: (message: string) => worker.current?.postMessage(message) }), []);

  useEffect(() => {
    const WorkerClass = (globalThis as unknown as { Worker?: new (url: string) => EngineWorker }).Worker;
    if (!WorkerClass) return undefined;
    const w = new WorkerClass(ENGINE_URL);
    worker.current = w;
    w.onmessage = (event) => onMessageRef.current?.({ nativeEvent: { data: typeof event.data === 'string' ? event.data : String(event.data) } });
    // A Worker keeps messages until its script runs, so "uci" can go now.
    onLoadEndRef.current?.();
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, []);

  return null;
});

export default WebView;
