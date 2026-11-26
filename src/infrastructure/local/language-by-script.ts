/**
 * The language of what Whisper heard, by its letters where they tell Japanese
 * and Korean apart: Korean when it has more hangul than kana, Japanese when it
 * has more kana than hangul, and otherwise the language Whisper heard. Text in
 * kanji alone may be Japanese or Chinese, so it is left to Whisper.
 *
 * Whisper often names another language for a short utterance, and the
 * language decides what it is translated from and into.
 */
export function languageByScript(text: string, heard: string | null): string | null {
  const hangul = countOf(/\p{Script=Hangul}/gu, text);
  const kana = countOf(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu, text);
  if (hangul > kana) return 'ko';
  if (kana > hangul) return 'ja';
  return heard;
}

function countOf(pattern: RegExp, text: string): number {
  return text.match(pattern)?.length ?? 0;
}
