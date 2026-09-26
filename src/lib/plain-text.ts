// Model-written copy is asked for plain text but sometimes carries inline
// markdown anyway, which the app renders literally: "that's the *tool* of
// linear perspective" (QA 2026-09-25, S17). Unwrap the emphasis/code markers
// and keep the words. Only PAIRED markers hugging a word are removed, so a lone
// asterisk ("5 * 3") or a snake_case name stays as written.
const PAIRED_MARKERS = [
  /\*\*(?=\S)([^*]+?)(?<=\S)\*\*/g, // **bold**
  /__(?=\S)([^_]+?)(?<=\S)__/g, // __bold__
  /(?<![\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\w*])/g, // *italic*
  /(?<![\w_])_(?=\S)([^_\n]+?)(?<=\S)_(?![\w_])/g, // _italic_
  /`([^`\n]+)`/g, // `code`
]

export function stripInlineMarkdown(text: string): string {
  return PAIRED_MARKERS.reduce((out, pattern) => out.replace(pattern, '$1'), text)
}
