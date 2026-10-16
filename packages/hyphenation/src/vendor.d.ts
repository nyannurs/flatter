// Minimal declarations for the untyped `hyphen` package.
declare module 'hyphen/hyphen.js' {
  const createHyphenator: (
    patterns: unknown,
    options?: { async?: boolean },
  ) => (text: string, options?: { hyphenChar?: string; minWordLength?: number }) => string;
  export default createHyphenator;
}

declare module 'hyphen/patterns/*' {
  const patterns: unknown;
  export default patterns;
}
