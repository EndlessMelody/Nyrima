/**
 * Thin React wrapper over the Web Speech API (`speechSynthesis`).
 *
 * The reader feeds it the current chapter's paragraphs and a starting index;
 * the hook speaks them in order, reports which paragraph is active (so the page
 * can highlight + auto-scroll), and exposes play/pause/stop + voice/rate
 * controls. Long paragraphs are chunked at sentence boundaries to dodge the
 * well-known Chromium bug where a single long utterance silently stops.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface TtsController {
  supported: boolean;
  speaking: boolean;
  paused: boolean;
  voices: SpeechSynthesisVoice[];
  voiceURI: string | null;
  rate: number;
  setVoiceURI: (uri: string) => void;
  setRate: (rate: number) => void;
  /** Start reading `paragraphs` from `startIndex`; calls `onActive` per para. */
  start: (
    paragraphs: string[],
    startIndex: number,
    onActive: (index: number) => void,
    onDone: () => void,
  ) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

const MAX_CHUNK = 240;

export function useTextToSpeech(): TtsController {
  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState<string | null>(null);
  const [rate, setRate] = useState(1);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);

  // Mutable speaking state lives in refs so the chained onend callbacks always
  // see the latest config without re-binding.
  const rateRef = useRef(rate);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);

  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    const refresh = () => {
      const list = synth.getVoices();
      if (list.length > 0) setVoices(list);
    };
    refresh();
    synth.addEventListener("voiceschanged", refresh);
    return () => synth.removeEventListener("voiceschanged", refresh);
  }, [supported]);

  // Default the voice to the first one matching the document language, else
  // the first available. Only sets when nothing is chosen yet.
  useEffect(() => {
    if (voiceURI || voices.length === 0) return;
    const docLang = (typeof document !== "undefined" && document.documentElement.lang) || "";
    const match =
      voices.find((v) => docLang && v.lang.toLowerCase().startsWith(docLang.toLowerCase().slice(0, 2))) ??
      voices.find((v) => v.default) ??
      voices[0];
    if (match) setVoiceURI(match.voiceURI);
  }, [voices, voiceURI]);

  useEffect(() => {
    voiceRef.current = voices.find((v) => v.voiceURI === voiceURI) ?? null;
  }, [voiceURI, voices]);

  // Always cancel any in-flight speech on unmount.
  useEffect(() => {
    return () => {
      if (supported) {
        cancelRef.current = true;
        window.speechSynthesis.cancel();
      }
    };
  }, [supported]);

  const stop = useCallback(() => {
    if (!supported) return;
    cancelRef.current = true;
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setPaused(false);
  }, [supported]);

  const start = useCallback(
    (
      paragraphs: string[],
      startIndex: number,
      onActive: (index: number) => void,
      onDone: () => void,
    ) => {
      if (!supported) return;
      const synth = window.speechSynthesis;
      synth.cancel();
      cancelRef.current = false;
      setSpeaking(true);
      setPaused(false);

      const para = Math.max(0, startIndex);

      const speakParagraph = (index: number) => {
        if (cancelRef.current) return;
        if (index >= paragraphs.length) {
          setSpeaking(false);
          onDone();
          return;
        }
        const text = paragraphs[index]?.trim() ?? "";
        if (!text) {
          speakParagraph(index + 1);
          return;
        }
        onActive(index);
        const chunks = chunkText(text);
        let chunkPos = 0;

        const speakChunk = () => {
          if (cancelRef.current) return;
          if (chunkPos >= chunks.length) {
            speakParagraph(index + 1);
            return;
          }
          const utter = new SpeechSynthesisUtterance(chunks[chunkPos]!);
          if (voiceRef.current) utter.voice = voiceRef.current;
          utter.rate = rateRef.current;
          utter.onend = () => {
            chunkPos += 1;
            speakChunk();
          };
          utter.onerror = () => {
            chunkPos += 1;
            speakChunk();
          };
          synth.speak(utter);
        };
        speakChunk();
      };

      speakParagraph(para);
      void para;
    },
    [supported],
  );

  const pause = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.pause();
    setPaused(true);
  }, [supported]);

  const resume = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.resume();
    setPaused(false);
  }, [supported]);

  return {
    supported,
    speaking,
    paused,
    voices,
    voiceURI,
    rate,
    setVoiceURI,
    setRate,
    start,
    pause,
    resume,
    stop,
  };
}

function chunkText(text: string): string[] {
  if (text.length <= MAX_CHUNK) return [text];
  // Split on sentence punctuation (latin + CJK), keeping the delimiter.
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    if (current.length + s.length > MAX_CHUNK && current) {
      chunks.push(current.trim());
      current = "";
    }
    current += s;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
