// Web test build only (Claude's tests in a browser, see metro.config.js):
// stands in for react-native-webview, which has no web version. It behaves
// like the engine page (assets/engine/index.html) so the web build meets the
// same start-up as the phone: the page "loads" at once (onLoadEnd), then the
// Stockfish file is fetched and started in a Web Worker; until then messages
// are dropped, as the real page does; it reports "page-loaded",
// "worker-created" and "worker-error: …" like the page. UCI lines go in
// through `postMessage` and come back through `onMessage`. The web build
// serves the engine file at /engine/stockfish-18-asm.js. The Android app
// never loads this file.
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

type Props = {
  onMessage?: (event: { nativeEvent: { data: string } }) => void;
  onLoadEnd?: () => void;
};

type EngineWorker = {
  postMessage(message: string): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
};

type WebGlobals = {
  Worker?: new (url: string) => EngineWorker;
  Blob?: new (parts: string[], options: { type: string }) => unknown;
  URL?: { createObjectURL(blob: unknown): string };
  fetch?: (url: string) => Promise<{ text(): Promise<string> }>;
};

const ENGINE_URL = '/engine/stockfish-18-asm.js';

export const WebView = forwardRef<{ postMessage(message: string): void }, Props>(function WebView({ onMessage, onLoadEnd }, ref) {
  const worker = useRef<EngineWorker | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onLoadEndRef = useRef(onLoadEnd);
  onLoadEndRef.current = onLoadEnd;

  // Dropped until the engine runs, like the real page.
  useImperativeHandle(ref, () => ({ postMessage: (message: string) => worker.current?.postMessage(message) }), []);

  useEffect(() => {
    const g = globalThis as unknown as WebGlobals;
    if (!g.Worker || !g.Blob || !g.URL || !g.fetch) return undefined;
    let alive = true;
    const report = (text: string) => onMessageRef.current?.({ nativeEvent: { data: text } });
    report('page-loaded');
    onLoadEndRef.current?.();
    g.fetch(ENGINE_URL)
      .then((r) => r.text())
      .then((source) => {
        if (!alive) return;
        const url = g.URL!.createObjectURL(new g.Blob!([source], { type: 'application/javascript' }));
        const w = new g.Worker!(url);
        worker.current = w;
        w.onmessage = (event) => report(typeof event.data === 'string' ? event.data : String(event.data));
        w.onerror = (event) => report(`worker-error: ${event.message ?? 'worker failed'}`);
        report('worker-created');
      })
      .catch((e: unknown) => alive && report(`load-failed: ${String(e)}`));
    return () => {
      alive = false;
      worker.current?.terminate();
      worker.current = null;
    };
  }, []);

  return null;
});

export default WebView;
