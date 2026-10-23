import React from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/**
 * Customer app design system: travel-booking style. Light grey page, white
 * cards with soft shadows, a deep-blue gradient hero header, bright blue
 * actions and gradient pill CTAs. Body text is 15–16px and every control is
 * at least 44px tall (PRD 9 accessibility bar); muted text keeps ≥ 4.5:1
 * contrast on white.
 */
export const c = {
  bg: '#f2f2f2',
  card: '#ffffff',
  line: '#e7e7e7',
  primary: '#008cff',
  primaryDark: '#065af3',
  primaryLight: '#53b2fe',
  primarySoft: '#eaf5ff',
  accent: '#008cff',
  heroFrom: '#051322',
  heroTo: '#15457c',
  text: '#1a1a1a',
  body: '#4a4a4a',
  muted: '#6b6b6b',
  onHero: '#ffffff',
  onHeroMuted: '#c9d8ea',
  warn: '#b45309',
  warnSoft: '#fff5e0',
  error: '#d0021b',
  errorSoft: '#ffeded',
  ok: '#0b7a3b',
  okSoft: '#e6f6ec',
  infoSoft: '#eaf5ff',
} as const;

const shadow = Platform.select({
  ios: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  android: { elevation: 3 },
}) as ViewStyle;

/**
 * Fills its parent with a linear gradient (react-native-svg; no extra native
 * module). The parent is measured first: percentage sizes inside an absolutely
 * positioned Svg resolve against its pre-layout size and leave gaps.
 */
export function GradientFill({ from, to, vertical = false, radius = 0 }: { from: string; to: string; vertical?: boolean; radius?: number }) {
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(null);
  const id = `g${from}${to}${vertical ? 'v' : 'h'}`.replace(/#/g, '');
  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: from, borderRadius: radius }]}
      pointerEvents="none"
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {size && (
        <Svg width={size.w} height={size.h}>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2={vertical ? '0' : '1'} y2={vertical ? '1' : '0'}>
              <Stop offset="0" stopColor={from} />
              <Stop offset="1" stopColor={to} />
            </LinearGradient>
          </Defs>
          <Rect width={size.w} height={size.h} rx={radius} fill={`url(#${id})`} />
        </Svg>
      )}
    </View>
  );
}

// ── Icons (Lucide paths, ISC licence) ───────────────────────────────────────

export type IconName = 'search' | 'ticket' | 'scan' | 'user' | 'back' | 'calendar' | 'users' | 'pin' | 'shield' | 'clock' | 'waves' | 'check';

export function Icon({ name, size = 20, color = c.text, strokeWidth = 2 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const p = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  const body: Record<IconName, React.ReactNode> = {
    search: [<Circle key="a" cx="11" cy="11" r="8" {...p} />, <Path key="b" d="m21 21-4.3-4.3" {...p} />],
    ticket: [
      <Path key="a" d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" {...p} />,
      <Path key="b" d="M13 5v2M13 17v2M13 11v2" {...p} />,
    ],
    scan: [<Path key="a" d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10" {...p} />],
    user: [<Path key="a" d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" {...p} />, <Circle key="b" cx="12" cy="7" r="4" {...p} />],
    back: [<Path key="a" d="m15 18-6-6 6-6" {...p} />],
    calendar: [<Rect key="a" x="3" y="4" width="18" height="18" rx="2" {...p} />, <Path key="b" d="M16 2v4M8 2v4M3 10h18" {...p} />],
    users: [
      <Path key="a" d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" {...p} />,
      <Circle key="b" cx="9" cy="7" r="4" {...p} />,
    ],
    pin: [<Path key="a" d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" {...p} />, <Circle key="b" cx="12" cy="10" r="3" {...p} />],
    shield: [<Path key="a" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" {...p} />, <Path key="b" d="m9 12 2 2 4-4" {...p} />],
    clock: [<Circle key="a" cx="12" cy="12" r="10" {...p} />, <Path key="b" d="M12 6v6l4 2" {...p} />],
    waves: [
      <Path key="a" d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" {...p} />,
    ],
    check: [<Path key="a" d="M20 6 9 17l-5-5" {...p} />],
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      {body[name]}
    </Svg>
  );
}

// ── Headers ─────────────────────────────────────────────────────────────────

/** Deep-blue gradient header that runs under the status bar. Children sit on the gradient. */
export function HeroHeader({ title, subtitle, children, extraBottom = 0 }: { title?: string; subtitle?: string; children?: React.ReactNode; extraBottom?: number }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 20 + extraBottom, overflow: 'hidden' }}>
      <StatusBar style="light" />
      <GradientFill from={c.heroFrom} to={c.heroTo} />
      {title ? (
        <Text style={ui.heroTitle} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      {subtitle ? <Text style={ui.heroSub}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

/** White app bar with back chevron, used on detail screens. */
export function Header({ title, subtitle, onBack, right }: { title: string; subtitle?: string; onBack?: () => void; right?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[ui.header, { paddingTop: insets.top + 6 }]}>
      <StatusBar style="dark" />
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} onPress={onBack} style={ui.back}>
          <Icon name="back" size={24} color={c.text} />
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={ui.headerTitle} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text style={[ui.meta, { fontSize: 13 }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

// ── Controls ────────────────────────────────────────────────────────────────

export function Button({
  label,
  onPress,
  tone = 'primary',
  busy,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'ghost' | 'danger';
  busy?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const inactive = !!busy || !!disabled;
  const primary = tone === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: !!busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [ui.btn, ui[tone], { opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }, style]}
    >
      {primary && <GradientFill from={c.primaryLight} to={c.primaryDark} radius={24} />}
      {busy && <ActivityIndicator size="small" color={primary ? '#fff' : c.primary} style={{ marginRight: 8 }} />}
      <Text style={[ui.btnText, primary ? { color: '#fff' } : tone === 'danger' ? { color: c.error } : { color: c.primary }]}>
        {primary ? label.toUpperCase() : label}
      </Text>
    </Pressable>
  );
}

export function Chip({ label, active, onPress, sub }: { label: string; active: boolean; onPress: () => void; sub?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[ui.chip, active && ui.chipActive]}>
      <Text style={[ui.chipText, active && { color: c.primary }]}>{label}</Text>
      {sub ? <Text style={[ui.chipSub, active && { color: c.primary }]}>{sub}</Text> : null}
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[ui.card, style]}>{children}</View>;
}

export function Banner({ tone, children }: { tone: 'error' | 'warn' | 'ok' | 'info'; children: React.ReactNode }) {
  const [fg, bg] =
    tone === 'error' ? [c.error, c.errorSoft] : tone === 'warn' ? [c.warn, c.warnSoft] : tone === 'ok' ? [c.ok, c.okSoft] : [c.primaryDark, c.infoSoft];
  return (
    <View accessibilityRole="alert" style={[ui.banner, { backgroundColor: bg, borderLeftColor: fg }]}>
      <Text style={{ color: fg, fontSize: 14, lineHeight: 20, fontWeight: '600' }}>{children}</Text>
    </View>
  );
}

export function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <View style={ui.stepper} accessibilityLabel={`${label}: ${value}`}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Fewer ${label}`} disabled={value <= min} onPress={() => onChange(value - 1)} style={ui.stepBtn}>
        <Text style={[ui.stepSign, value <= min && { opacity: 0.3 }]}>−</Text>
      </Pressable>
      <Text style={ui.stepValue}>{value}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`More ${label}`} disabled={value >= max} onPress={() => onChange(value + 1)} style={ui.stepBtn}>
        <Text style={[ui.stepSign, value >= max && { opacity: 0.3 }]}>+</Text>
      </Pressable>
    </View>
  );
}

export function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <View style={ui.kv}>
      <Text style={[ui.k, strong && { color: c.text, fontWeight: '800' }]}>{k}</Text>
      <Text style={[ui.v, strong && { fontSize: 18, fontWeight: '900' }]}>{v}</Text>
    </View>
  );
}

/** Small rounded tag, e.g. "Licensed". */
export function Tag({ label, tone = 'info', icon }: { label: string; tone?: 'info' | 'ok' | 'warn' | 'neutral'; icon?: IconName }) {
  const [fg, bg] = tone === 'ok' ? [c.ok, c.okSoft] : tone === 'warn' ? [c.warn, c.warnSoft] : tone === 'neutral' ? [c.body, '#f0f0f0'] : [c.primaryDark, c.primarySoft];
  return (
    <View style={[ui.tag, { backgroundColor: bg }]}>
      {icon && <Icon name={icon} size={12} color={fg} strokeWidth={2.5} />}
      <Text style={[ui.tagText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  pad: { paddingHorizontal: 16, paddingBottom: 32 },
  heroTitle: { color: c.onHero, fontSize: 24, fontWeight: '900', letterSpacing: -0.3 },
  heroSub: { color: c.onHeroMuted, fontSize: 14, marginTop: 2 },
  h1: { color: c.text, fontSize: 22, fontWeight: '900', marginTop: 8 },
  h2: { color: c.text, fontSize: 17, fontWeight: '800', marginBottom: 8 },
  body: { color: c.body, fontSize: 16, lineHeight: 22 },
  meta: { color: c.muted, fontSize: 14, lineHeight: 20 },
  label: { color: c.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 16, marginBottom: 8 },
  card: { backgroundColor: c.card, borderRadius: 12, padding: 16, marginBottom: 12, ...shadow },
  btn: { minHeight: 48, borderRadius: 24, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 12, overflow: 'hidden' },
  primary: { backgroundColor: c.primary },
  ghost: { backgroundColor: c.card, borderWidth: 1.5, borderColor: c.primary },
  danger: { backgroundColor: c.card, borderWidth: 1.5, borderColor: c.error },
  btnText: { fontSize: 16, fontWeight: '800', letterSpacing: 0.4 },
  chip: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: c.card, borderWidth: 1, borderColor: '#d9d9d9', marginRight: 8, justifyContent: 'center', alignItems: 'center' },
  chipActive: { backgroundColor: c.primarySoft, borderColor: c.primary },
  chipText: { color: c.text, fontWeight: '700', fontSize: 14 },
  chipSub: { color: c.muted, fontSize: 11, fontWeight: '600', marginTop: 1 },
  banner: { borderLeftWidth: 4, borderRadius: 8, padding: 12, marginVertical: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderRadius: 10, borderWidth: 1, borderColor: '#d9d9d9', alignSelf: 'flex-start' },
  stepBtn: { width: 48, height: 46, alignItems: 'center', justifyContent: 'center' },
  stepSign: { color: c.primary, fontSize: 24, fontWeight: '700' },
  stepValue: { color: c.text, fontSize: 18, fontWeight: '900', minWidth: 32, textAlign: 'center' },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  k: { color: c.body, fontSize: 15 },
  v: { color: c.text, fontSize: 15, fontWeight: '700' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 10, gap: 8, minHeight: 52, backgroundColor: c.card, ...shadow },
  back: { minHeight: 44, minWidth: 36, justifyContent: 'center' },
  headerTitle: { color: c.text, fontSize: 18, fontWeight: '800' },
  input: { backgroundColor: c.card, color: c.text, borderRadius: 10, borderWidth: 1, borderColor: '#d9d9d9', paddingHorizontal: 14, minHeight: 48, fontSize: 16 },
  badgeOk: { color: c.ok, fontSize: 12, fontWeight: '800' },
  pill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: c.primarySoft },
  pillText: { color: c.primaryDark, fontSize: 12, fontWeight: '800' },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  tagText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.2 },
});
