import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';

/**
 * Building blocks for the signed-in customer screens. Same navy palette as
 * styles.ts; body text is 15–16px and every control is at least 44px tall
 * (PRD 9 accessibility bar).
 */
export const c = {
  bg: '#0a192f',
  card: '#112240',
  line: '#233554',
  teal: '#14b8a6',
  aqua: '#64ffda',
  text: '#e6f1ff',
  muted: '#8892b0',
  warn: '#fcd34d',
  error: '#fda4af',
  ok: '#6ee7b7',
} as const;

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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: !!busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [ui.btn, ui[tone], { opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }, style]}
    >
      {busy && <ActivityIndicator size="small" color={tone === 'primary' ? c.bg : c.text} style={{ marginRight: 8 }} />}
      <Text style={[ui.btnText, tone === 'primary' ? { color: c.bg } : tone === 'danger' ? { color: c.error } : { color: c.text }]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, active, onPress, sub }: { label: string; active: boolean; onPress: () => void; sub?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[ui.chip, active && ui.chipActive]}
    >
      <Text style={[ui.chipText, active && { color: c.bg }]}>{label}</Text>
      {sub ? <Text style={[ui.chipSub, active && { color: c.bg }]}>{sub}</Text> : null}
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[ui.card, style]}>{children}</View>;
}

export function Banner({ tone, children }: { tone: 'error' | 'warn' | 'ok' | 'info'; children: React.ReactNode }) {
  const color = tone === 'error' ? c.error : tone === 'warn' ? c.warn : tone === 'ok' ? c.ok : c.aqua;
  return (
    <View accessibilityRole="alert" style={[ui.banner, { borderColor: color }]}>
      <Text style={{ color, fontSize: 14, lineHeight: 20 }}>{children}</Text>
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

export function Header({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <View style={ui.header}>
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} onPress={onBack} style={ui.back}>
          <Text style={{ color: c.aqua, fontSize: 16, fontWeight: '700' }}>‹ Back</Text>
        </Pressable>
      ) : null}
      <Text style={ui.headerTitle} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      {right}
    </View>
  );
}

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  pad: { paddingHorizontal: 16, paddingBottom: 32 },
  h1: { color: '#fff', fontSize: 24, fontWeight: '900', marginTop: 8 },
  h2: { color: '#fff', fontSize: 17, fontWeight: '800', marginBottom: 8 },
  body: { color: c.text, fontSize: 16, lineHeight: 22 },
  meta: { color: c.muted, fontSize: 14, lineHeight: 20 },
  label: { color: c.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 16, marginBottom: 8 },
  card: { backgroundColor: c.card, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: c.line },
  btn: { minHeight: 48, borderRadius: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  primary: { backgroundColor: c.teal },
  ghost: { backgroundColor: c.line },
  danger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: c.error },
  btnText: { fontSize: 16, fontWeight: '800' },
  chip: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, marginRight: 8, justifyContent: 'center', alignItems: 'center' },
  chipActive: { backgroundColor: c.teal, borderColor: c.teal },
  chipText: { color: c.text, fontWeight: '700', fontSize: 14 },
  chipSub: { color: c.muted, fontSize: 11, fontWeight: '600', marginTop: 1 },
  banner: { borderWidth: 1, borderRadius: 12, padding: 12, marginVertical: 8, backgroundColor: 'rgba(17,34,64,0.6)' },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.line, alignSelf: 'flex-start' },
  stepBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  stepSign: { color: c.aqua, fontSize: 24, fontWeight: '700' },
  stepValue: { color: '#fff', fontSize: 18, fontWeight: '900', minWidth: 32, textAlign: 'center' },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  k: { color: c.muted, fontSize: 15 },
  v: { color: c.text, fontSize: 15, fontWeight: '700' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12, minHeight: 52 },
  back: { minHeight: 44, justifyContent: 'center' },
  headerTitle: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '800' },
  input: { backgroundColor: c.bg, color: '#fff', borderRadius: 12, borderWidth: 1, borderColor: c.line, paddingHorizontal: 14, minHeight: 48, fontSize: 16 },
  badgeOk: { color: c.ok, fontSize: 12, fontWeight: '800' },
  pill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: c.line },
  pillText: { color: c.aqua, fontSize: 12, fontWeight: '800' },
});
