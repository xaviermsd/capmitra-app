import type { Word } from "./types";

/** A short Gujarati sample so you can try every template without an API key. */
const SENTENCE =
  "નમસ્તે મિત્રો, આજે આપણે ગુજરાતી કૅપ્શન વિશે વાત કરીશું. આ વિડિયો સંપૂર્ણ રીતે ઓટોમેટિક સબટાઇટલ સાથે બનાવ્યો છે. લાઇક અને શેર કરવાનું ભૂલશો નહીં!";

export function demoWords(duration = 12): Word[] {
  const toks = SENTENCE.split(/\s+/);
  const per = duration / toks.length;
  return toks.map((text, i) => ({
    id: `d${i}`,
    text,
    start: +(i * per + 0.2).toFixed(3),
    end: +((i + 1) * per + 0.1).toFixed(3),
    emphasis: text.startsWith("ઓટોમેટિક"),
  }));
}
