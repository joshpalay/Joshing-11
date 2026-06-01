declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}

declare module 'html2canvas' {
  function html2canvas(element: HTMLElement, options?: unknown): Promise<HTMLCanvasElement>;
  export default html2canvas;
}
