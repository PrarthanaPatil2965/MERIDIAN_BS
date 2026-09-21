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
 * Two deliberate steps before anything reaches a real person: a two second
 * hold, then a three second spoken countdown that any tap cancels.
 *
 * Nothing here fails silently. Android will not let an ordinary app send an
 * SMS without the user seeing it, so the composer opens pre-filled; if even
 * that is unavailable the call still goes through and the reason appears on
 * screen rather than being swallowed.
 */
export default function SosButton({ compact = false }) {
  const { settings, uiLang } = useApp();
  const [phase, setPhase] = useState('idle'); // idle | holding | armed | sending
  const [count, setCount] = useState(COUNTDOWN);
  const [status, setStatus] = useState(null);
  const holdTimer = useRef(null);
  const tickTimer = useRef(null);

  const clearAll = () => {
    clearTimeout(holdTimer.current);
    clearInterval(tickTimer.current);
    holdTimer.current = null;
    tickTimer.current = null;
  };

  useEffect(() => clearAll, []);

  const normalise = (n) => (n || '').replace(/[\s()-]/g, '');

  const onPressIn = () => {
    if (phase === 'armed') return cancel();
    if (phase === 'sending') return;
    setStatus(null);
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
    setStatus(null);
    say(uiLang === 'hi' ? 'रद्द किया गया' : 'Cancelled', {
      lang: uiLang,
      rate: settings.speechRate,
    });
  };

  const arm = () => {
    if (!normalise(settings.emergencyContact)) {
      say(t(uiLang, 'sosNoContact'), { lang: uiLang, urgency: 'urgent', rate: settings.speechRate });
      setStatus(t(uiLang, 'sosNoContact'));
      Alert.alert(t(uiLang, 'sos'), t(uiLang, 'sosNoContact'));
      setPhase('idle');
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    setPhase('armed');
    let n = COUNTDOWN;
    setCount(n);
    say(`${t(uiLang, 'sosArmed')} ${n}`, {
      lang: uiLang,
      urgency: 'urgent',
      rate: settings.speechRate,
    });
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

  const placeCall = (number) => {
    // telprompt is iOS-only; tel: is the portable form and works in Expo Go
    // on Android. Neither works on an emulator without a dialler.
    const url = `tel:${number}`;
    Linking.openURL(url).catch((e) =>
      setStatus(`Could not open the dialler: ${e.message}. Call ${number} manually.`)
    );
  };

  const fire = async () => {
    setPhase('sending');
    const number = normalise(settings.emergencyContact);
    say(t(uiLang, 'sosSending'), { lang: uiLang, urgency: 'urgent', rate: settings.speechRate });
    setStatus(uiLang === 'hi' ? 'लोकेशन ली जा रही है…' : 'Getting your location…');

    let lat = null;
    let lng = null;
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) perm = await Location.requestForegroundPermissionsAsync();
      if (perm.granted) {
        const pos = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000)),
        ]);
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      }
    } catch {
      // An emergency must not wait on a GPS fix. Send without it.
    }

    let message =
      uiLang === 'hi'
        ? 'आपातकाल। मुझे तुरंत मदद चाहिए। BlindSpot द्वारा भेजा गया।'
        : 'EMERGENCY. I need help now. Sent by BlindSpot.';
    try {
      const res = await buildSos({
        name: settings.userName,
        contact: number,
        lat,
        lng,
        lang: uiLang,
      });
      message = res.message;
    } catch {
      if (lat && lng) message += ` https://maps.google.com/?q=${lat},${lng}`;
    }

    let smsOk = false;
    try {
      const available = await SMS.isAvailableAsync();
      if (available) {
        setStatus(uiLang === 'hi' ? 'संदेश खुल रहा है…' : 'Opening the message…');
        const result = await SMS.sendSMSAsync([number], message);
        smsOk = result?.result === 'sent' || result?.result === 'unknown';
      } else {
        setStatus(
          'SMS is unavailable on this device (no SIM, or an emulator). Calling instead.'
        );
      }
    } catch (e) {
      setStatus(`Message step failed: ${e.message}. Calling instead.`);
    }

    say(t(uiLang, 'sosCalling'), { lang: uiLang, urgency: 'urgent', rate: settings.speechRate });

    // Give the SMS composer time to close before handing over to the dialler;
    // firing both in the same tick makes Android drop the second intent.
    setTimeout(() => {
      placeCall(number);
      if (smsOk) setStatus(t(uiLang, 'sosDone'));
      setPhase('idle');
      setCount(COUNTDOWN);
    }, 700);
  };

  const label =
    phase === 'armed'
      ? `${t(uiLang, 'sosArmed')} ${count} — ${t(uiLang, 'sosCancel')}`
      : phase === 'sending'
      ? t(uiLang, 'sosSending')
      : t(uiLang, 'sos');

  return (
    <View>
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
          {
            backgroundColor: phase === 'idle' ? colors.urgent : '#B51D22',
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Text style={[compact ? type.bodyStrong : type.title, { color: '#fff' }]}>{label}</Text>
        {phase === 'idle' && !compact && (
          <Text style={[type.caption, { color: '#FFD7D8', marginTop: 2 }]}>
            {t(uiLang, 'sosHold')}
          </Text>
        )}
        {phase === 'holding' && <View style={s.holdBar} />}
      </Pressable>

      {status ? (
        <Text style={s.status} accessibilityLiveRegion="assertive">
          {status}
        </Text>
      ) : null}
    </View>
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
  status: { color: colors.notice, fontSize: 13, marginTop: 6, textAlign: 'center' },
});
