import { StyleSheet } from 'react-native';
import { c } from './ui';

/** Operator check-in screen. Same light travel-app palette as ui.tsx. */
export const s = StyleSheet.create({
  content: { paddingHorizontal: 16 },
  card: { backgroundColor: c.card, borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  cardTitle: { color: c.text, fontWeight: '800', fontSize: 17, marginBottom: 6 },
  meta: { color: c.muted, fontSize: 14, marginTop: 2, lineHeight: 20 },
  input: { backgroundColor: c.card, color: c.text, borderRadius: 10, borderWidth: 1, borderColor: '#d9d9d9', paddingHorizontal: 12, paddingVertical: 10 },
  button: { backgroundColor: c.primary, borderRadius: 24, paddingVertical: 13, alignItems: 'center', marginTop: 12 },
  buttonGhost: { backgroundColor: c.card, borderWidth: 1.5, borderColor: c.primary, borderRadius: 24, paddingVertical: 11, paddingHorizontal: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#ffffff', fontWeight: '800', letterSpacing: 0.4 },
  buttonGhostText: { color: c.primary, fontWeight: '800' },
  code: { color: c.primary, fontWeight: '900', fontSize: 20, letterSpacing: 2 },
  badge: { color: c.primary, fontSize: 12, fontWeight: '800' },
  error: { color: c.error, fontSize: 14, fontWeight: '700', marginBottom: 6 },
  warn: { color: c.warn, fontSize: 13, marginBottom: 6 },
  ok: { color: c.ok, fontSize: 15, fontWeight: '800' },
  scanner: { height: 320, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000', marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
