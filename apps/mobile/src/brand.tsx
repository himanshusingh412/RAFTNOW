import React from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { font, mist, radius } from './theme';

/** RaftNow mark: the teal→cyan tile with the waves glyph used by the web app (lucide "waves", ISC). */
export function RaftNowMark({ size = 64 }: { size?: number }) {
  const glyph = size * 0.56;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.markShadow, { width: size, height: size, borderRadius: size * 0.28 }]}
    >
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id="mark" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor="#14b8a6" />
            <Stop offset="1" stopColor="#22d3ee" />
          </LinearGradient>
        </Defs>
        <Rect width={size} height={size} rx={size * 0.28} fill="url(#mark)" />
        <G transform={`translate(${(size - glyph) / 2} ${(size - glyph) / 2}) scale(${glyph / 24})`}>
          {[6, 12, 18].map((y) => (
            <Path
              key={y}
              d={`M2 ${y}c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1`}
              stroke="#ffffff"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ))}
        </G>
      </Svg>
    </View>
  );
}

/** "RaftNow" wordmark — Sora ExtraBold, "Now" in aqua. */
export function RaftNowWordmark({ size = 32 }: { size?: number }) {
  return (
    <Text accessibilityRole="image" accessibilityLabel="RaftNow" style={[styles.wordmark, { fontSize: size, lineHeight: size * 1.1 }]}>
      Raft<Text style={{ color: mist.aquaDark }}>Now</Text>
    </Text>
  );
}

/** The reference's page background: soft aqua glow at the top, sand glow top-right, misty vertical gradient. */
export function MistBackground() {
  const { width: w, height: h } = useWindowDimensions();
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={w} height={h}>
        <Defs>
          <LinearGradient id="mist" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#f4fafc" />
            <Stop offset="0.6" stopColor="#f0f8fb" />
            <Stop offset="1" stopColor="#e8f3f7" />
          </LinearGradient>
          <RadialGradient id="aquaGlow" cx={w / 2} cy={-200} rx={1200} ry={600} fx={w / 2} fy={-200} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={mist.aqua} stopOpacity={0.1} />
            <Stop offset="0.6" stopColor={mist.aqua} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="sandGlow" cx={w * 0.9} cy={h * 0.2} rx={800} ry={500} fx={w * 0.9} fy={h * 0.2} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={mist.sand} stopOpacity={0.08} />
            <Stop offset="0.6" stopColor={mist.sand} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={w} height={h} fill="url(#mist)" />
        <Rect width={w} height={h} fill="url(#sandGlow)" />
        <Rect width={w} height={h} fill="url(#aquaGlow)" />
      </Svg>
    </View>
  );
}

/** Primary call to action: glossy aqua button (gradient + inner highlight + aqua shadow). */
export function GlossyButton({
  label,
  busyLabel,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  busyLabel: string;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const inactive = !!disabled || !!busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={busy ? busyLabel : label}
      accessibilityState={{ disabled: inactive, busy: !!busy }}
      style={({ pressed }) => [styles.ctaShadow, { opacity: disabled ? 0.5 : busy ? 0.75 : pressed ? 0.9 : 1 }]}
    >
      <View style={styles.cta}>
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 48">
          <Defs>
            <LinearGradient id="ctaBase" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={mist.aquaLight} />
              <Stop offset="0.55" stopColor={mist.aqua} />
              <Stop offset="1" stopColor={mist.aquaDark} />
            </LinearGradient>
            <LinearGradient id="ctaGloss" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#ffffff" stopOpacity={0.28} />
              <Stop offset="0.45" stopColor="#ffffff" stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect width="100" height="48" fill="url(#ctaBase)" />
          <Rect width="100" height="48" fill="url(#ctaGloss)" />
          <Rect width="100" height="1" fill="#ffffff" fillOpacity={0.5} />
          <Rect y="47" width="100" height="1" fill={mist.aquaDark} fillOpacity={0.45} />
        </Svg>
        {busy && <ActivityIndicator color="#ffffff" size="small" style={{ marginRight: 8 }} />}
        <Text style={styles.ctaText}>{busy ? busyLabel : label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  markShadow: {
    backgroundColor: '#14b8a6',
    ...Platform.select({
      ios: { shadowColor: '#14b8a6', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 8 } },
      android: { elevation: 6, shadowColor: '#14b8a6' },
    }),
  },
  wordmark: { fontFamily: font.display800, color: mist.navy, letterSpacing: -0.6 },
  ctaShadow: {
    borderRadius: radius.cta,
    backgroundColor: mist.aqua,
    ...Platform.select({
      ios: { shadowColor: mist.aqua, shadowOpacity: 0.4, shadowRadius: 11, shadowOffset: { width: 0, height: 10 } },
      android: { elevation: 8, shadowColor: mist.aqua },
    }),
  },
  cta: {
    height: 48,
    borderRadius: radius.cta,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { fontFamily: font.display700, fontSize: 16, color: '#ffffff', letterSpacing: -0.4 },
});
