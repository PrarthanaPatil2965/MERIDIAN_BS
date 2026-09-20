/**
 * Voice capture using expo-audio.
 */

import {
  AudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';

let recording = null;

export async function requestMicPermission() {
  const result = await requestRecordingPermissionsAsync();
  return !!result.granted;
}

export async function startRecording() {
  await setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
  });

  const rec = new AudioRecorder(RecordingPresets.HIGH_QUALITY);

  await rec.prepareToRecordAsync();
  rec.record();

  recording = rec;
}

export async function stopRecording() {
  if (!recording) return null;

  try {
    recording.stop();

    const uri = recording.uri;

    recording = null;
    return uri;
  } catch (error) {
    console.log('Recording stop error:', error);
    recording = null;
    return null;
  }
}

export const isRecording = () => !!recording;