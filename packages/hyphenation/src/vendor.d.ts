// Minimal declarations for untyped development dependencies.
declare module 'hyphen/*' {
  const lang: { hyphenateSync(text: string, options?: { hyphenChar?: string; minWordLength?: number }): string };
  export default lang;
}
