import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as SMS from 'expo-sms';
import * as Haptics from 'expo-haptics';

import { colors, radius, space, type } from '../theme';
import { t } from '../i18n/strings';
import { useApp } from '../state/AppState';
import { buildSos } from '../api/client';
import { say, stopSpeaking } from '../lib/speech';

const HOLD_MS = 2000;
const COUNTDOWN = 3;

/**
 * Two deliberate steps before anything is sent: a two second hold, then a
 * three second spoken countdown that any tap cancels. Accidental pocket
 * presses do not reach a real person.
 */
export default function SosButton({ compact = false }) {
  const { settings, uiLang } = useApp();
  const [phase, setPhase] = useState('idle'); // idle | holding | armed | sending
  const [count, setCount] = useState(COUNTDOWN);
  const holdTimer = useRef(null);
  const tickTimer = useRef(null);

  const clearAll = () => {
    clearTimeout(holdTimer.current);
    clearInterval(tickTimer.current);
    holdTimer.current = null;
    tickTimer.current = null;
  };

  useEffect(() => clearAll, []);

  const onPressIn = () => {
    if (phase === 'armed') return cancel();
    setPhase('holding');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    holdTimer.current = setTimeout(arm, HOLD_MS);
  };

  const onPressOut = () => {
    if (phase === 'holding') {
      clearAll();
      setPhase('idle');
    }
  };

  const cancel = () => {
    clearAll();
    stopSpeaking();
    setPhase('idle');
    setCount(COUNTDOWN);
    say(uiLang === 'hi' ? 'रद्द किया गया' : 'Cancelled', { lang: uiLang, rate: settings.speechRate });
  };

  const arm = () => {
    if (!settings.emergencyContact) {
      say(t(uiLang, 'sosNoContact'), { lang: uiLang, urgency: 'urgent', rate: settings.speechRate });
      Alert.alert(t(uiLang, 'sos'), t(uiLang, 'sosNoContact'));
      setPhase('idle');
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    setPhase('armed');
    let n = COUNTDOWN;
    setCount(n);
    say(`${t(uiLang, 'sosArmed')} ${n}`, { lang: uiLang, urgency: 'urgent', rate: settings.speechRate });
    tickTimer.current = setInterval(() => {
      n -= 1;
      setCount(n);
      if (n <= 0) {
        clearAll();
        fire();
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      }
    }, 1000);
  };

  const fire = async () => {
    setPhase('sending');
    say(t(uiLang, 'sosSending'), { lang: uiLang, urgency: 'urgent', rate: settings.speechRate });

    let lat = null;
    let lng = null;
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.granted || (await Location.requestForegroundPermissionsAsync()).granted) {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      }
    } catch {}

    let message =
      uiLang === 'hi'
        ? `आपातकाल। मुझे तुरंत मदद चाहिए। BlindSpot द्वारा भेजा गया।`
        : `EMERGENCY. I need help now. Sent by BlindSpot.`;
    try {
      const res = await buildSos({
        name: settings.userName,
        contact: settings.emergencyContact,
        lat,
        lng,
        lang: uiLang,
      });
      message = res.message;
    } catch {
      if (lat && lng) message += ` https://maps.google.com/?q=${lat},${lng}`;
    }

    try {
      const available = await SMS.isAvailableAsync();
      if (available) {
        await SMS.sendSMSAsync([settings.emergencyContact], message);
      }
    } catch {}

    say(t(uiLang, 'sosCalling'), { lang: uiLang, urgency: 'urgent', rate: settings.speechRate });
    const tel = Platform.OS === 'android' ? `tel:${settings.emergencyContact}` : `telprompt:${settings.emergencyContact}`;
    Linking.openURL(tel).catch(() => Linking.openURL(`tel:${settings.emergencyContact}`).catch(() => {}));

    setPhase('idle');
    setCount(COUNTDOWN);
  };

  const label =
    phase === 'armed'
      ? `${t(uiLang, 'sosArmed')} ${count} — ${t(uiLang, 'sosCancel')}`
      : phase === 'sending'
      ? t(uiLang, 'sosSending')
      : t(uiLang, 'sos');

  return (
    <Pressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={phase === 'armed' ? cancel : undefined}
      accessibilityRole="button"
      accessibilityLabel={t(uiLang, 'sos')}
      accessibilityHint={t(uiLang, 'sosHold')}
      style={({ pressed }) => [
        s.wrap,
        compact && s.compact,
        { backgroundColor: phase === 'idle' ? colors.urgent : '#B51D22', opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Text style={[compact ? type.bodyStrong : type.title, { color: '#fff' }]}>{label}</Text>
      {phase === 'idle' && !compact && (
        <Text style={[type.caption, { color: '#FFD7D8', marginTop: 2 }]}>{t(uiLang, 'sosHold')}</Text>
      )}
      {phase === 'holding' && <View style={s.holdBar} />}
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: {
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 76,
  },
  compact: { minHeight: 56, paddingVertical: space.sm },
  holdBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: '#fff',
    opacity: 0.6,
  },
});
