import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// `text-quiet` is the theme's 13px font-size register (--text-quiet in
// globals.css). tailwind-merge can't see the Tailwind v4 theme, so without
// this it classifies text-quiet as a text-COLOR and silently drops any real
// color class (e.g. text-[color:var(--brand-link)]) merged alongside it.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": ["text-quiet"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
