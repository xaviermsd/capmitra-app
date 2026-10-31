"use client";
/**
 * Live preview of the voice enhancer: the video's sound goes through the
 * shared voice engine in an AudioWorklet. Nothing is touched until the
 * enhancer is first switched on. `original` plays the untouched sound (A/B).
 */
import { useEffect, useRef } from "react";
import { rnnoiseWasm, VOICE_RATE } from "@/lib/voice/engine";
import { resolveVoice, type VoiceSettings } from "@/lib/voice/presets";

interface Graph { el: HTMLVideoElement; ctx: AudioContext; src: MediaElementAudioSourceNode; node?: AudioWorkletNode; off: () => void }

export function useVoiceEnhancer(videoRef: React.RefObject<HTMLVideoElement | null>, voice: VoiceSettings | undefined, videoKey: string | null, original: boolean) {
  const g = useRef<Graph | null>(null);
  const resolved = resolveVoice(voice);
  const chainKey = resolved ? JSON.stringify(resolved.chain) : "";
  const intensity = resolved?.intensity ?? 1;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const chain = chainKey ? JSON.parse(chainKey) : null;
    if (!chain && (!g.current || g.current.el !== v)) return; // never touch the sound unless asked
    let cancelled = false;
    (async () => {
      if (!g.current || g.current.el !== v) {
        g.current?.off();
        const ctx = new AudioContext({ sampleRate: VOICE_RATE });
        const src = ctx.createMediaElementSource(v);
        src.connect(ctx.destination);
        const resume = () => void ctx.resume();
        v.addEventListener("play", resume);
        g.current = { el: v, ctx, src, off: () => { v.removeEventListener("play", resume); void ctx.close(); } };
        if (!v.paused) resume();
      }
      const s = g.current;
      if (!chain) { s.node?.port.postMessage({ bypass: true }); return; }
      if (!s.node) {
        await s.ctx.audioWorklet.addModule("/voice/voice-worklet.js");
        const wasm = (await rnnoiseWasm()).slice(0);
        if (cancelled || g.current !== s) return;
        s.node = new AudioWorkletNode(s.ctx, "capmitra-voice", {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
          processorOptions: { wasm, params: chain, intensity },
        });
        s.src.disconnect();
        s.src.connect(s.node).connect(s.ctx.destination);
      }
      s.node.port.postMessage({ params: chain, intensity, bypass: original });
    })().catch(() => {
      // if anything fails, keep the original sound playing
      try { const s = g.current; if (s) { s.src.disconnect(); s.src.connect(s.ctx.destination); } } catch { /* ignore */ }
    });
    return () => { cancelled = true; };
  }, [chainKey, intensity, original, videoRef, videoKey]);

  useEffect(() => () => g.current?.off(), []);
}
