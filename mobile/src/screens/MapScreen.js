import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Linking, ScrollView } from 'react-native';
import * as Location from 'expo-location';
import * as SMS from 'expo-sms';

import { colors, radius, space, type } from '../theme';
import { t } from '../i18n/strings';
import { useApp } from '../state/AppState';
import { say } from '../lib/speech';
import { Card, BigButton } from '../components/ui';

// react-native-maps is not present in every setup. If it is missing we fall
// back to coordinates plus a hand-off to Google Maps, so the screen still works.
let MapView = null;
let Marker = null;
try {
  const maps = require('react-native-maps');
  MapView = maps.default;
  Marker = maps.Marker;
} catch {}

export default function MapScreen() {
  const { settings, uiLang } = useApp();
  const [coords, setCoords] = useState(null);
  const [address, setAddress] = useState(null);
  const [error, setError] = useState(null);

  const locate = async () => {
    setError(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        setError(t(uiLang, 'noLocation'));
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      setCoords(c);
      try {
        const [place] = await Location.reverseGeocodeAsync(c);
        if (place) {
          setAddress(
            [place.name, place.street, place.district, place.city, place.postalCode]
              .filter(Boolean)
              .join(', ')
          );
        }
      } catch {}
    } catch {
      setError(t(uiLang, 'noLocation'));
    }
  };

  useEffect(() => {
    locate();
  }, []);

  const speakLocation = () => {
    if (!coords) return say(t(uiLang, 'noLocation'), { lang: uiLang, rate: settings.speechRate });
    const text = address
      ? uiLang === 'hi'
        ? `आप इस समय ${address} के पास हैं।`
        : `You are near ${address}.`
      : uiLang === 'hi'
      ? `आपकी लोकेशन ${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)} है।`
      : `Your location is ${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}.`;
    say(text, { lang: uiLang, urgency: 'urgent', rate: settings.speechRate });
  };

  const openMaps = () => {
    if (!coords) return;
    Linking.openURL(`https://maps.google.com/?q=${coords.latitude},${coords.longitude}`);
  };

  const shareLocation = async () => {
    if (!coords || !settings.emergencyContact) {
      say(t(uiLang, 'sosNoContact'), { lang: uiLang, rate: settings.speechRate });
      return;
    }
    const link = `https://maps.google.com/?q=${coords.latitude},${coords.longitude}`;
    const body =
      uiLang === 'hi'
        ? `मैं यहाँ हूँ: ${link} — BlindSpot`
        : `Here is where I am: ${link} — BlindSpot`;
    if (await SMS.isAvailableAsync()) {
      SMS.sendSMSAsync([settings.emergencyContact], body);
    }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: space.md, gap: space.sm }}>
      <Text style={[type.title, { color: colors.text }]}>{t(uiLang, 'mapTitle')}</Text>

      <View style={s.mapWrap}>
        {MapView && coords ? (
          <MapView
            style={StyleSheet.absoluteFill}
            region={{ ...coords, latitudeDelta: 0.006, longitudeDelta: 0.006 }}
            showsUserLocation
            showsMyLocationButton={false}
          >
            <Marker coordinate={coords} title={t(uiLang, 'mapTitle')} />
          </MapView>
        ) : (
          <View style={[StyleSheet.absoluteFill, s.mapFallback]}>
            <Text style={[type.body, { color: colors.textMuted, textAlign: 'center' }]}>
              {error || (coords ? `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}` : t(uiLang, 'locating'))}
            </Text>
          </View>
        )}
      </View>

      {address ? (
        <Card>
          <Text style={[type.body, { color: colors.text }]}>{address}</Text>
          {coords && (
            <Text style={[type.caption, { color: colors.textFaint, marginTop: 4 }]}>
              {coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)}
            </Text>
          )}
        </Card>
      ) : null}

      <BigButton label={t(uiLang, 'mapSpeak')} tone="primary" onPress={speakLocation} />
      <BigButton label={t(uiLang, 'mapOpen')} onPress={openMaps} />
      <BigButton label={t(uiLang, 'mapShare')} onPress={shareLocation} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  mapWrap: {
    height: 300,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  mapFallback: { alignItems: 'center', justifyContent: 'center', padding: space.md },
});
