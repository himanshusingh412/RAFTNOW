/**
 * Light "river mist" tokens for the sign-in screen. Values were measured from
 * the reference login (app.raftingx.com/login) and match the RaftNow web
 * sign-in (apps/web tailwind.config.js), so web and app look the same.
 */
export const mist = {
  aqua: '#06b6d4',
  aquaLight: '#22d3ee',
  aquaDark: '#0891b2',
  sand: '#e8b547',
  inkStrong: '#061320',
  ink: '#0f2230',
  inkMuted: '#547080',
  line: 'rgba(15, 34, 48, 0.12)',
  navy: '#0e2a4a',
  placeholder: '#9ca3af',
  white: '#ffffff',
  error: '#be123c',
  errorLine: '#fb7185',
} as const;

/** Font family names registered by useFonts() in App.tsx (fall back to the system font until loaded). */
export const font = {
  display800: 'Sora_800ExtraBold',
  display700: 'Sora_700Bold',
  body400: 'Inter_400Regular',
  body500: 'Inter_500Medium',
  body600: 'Inter_600SemiBold',
} as const;

export const radius = { field: 10, cta: 14 } as const;
