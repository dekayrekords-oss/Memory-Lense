import { CameraView, useCameraPermissions } from 'expo-camera';
import { Directory, File, Paths } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenBoundary from '@/components/ScreenBoundary';
import Section from '@/components/Section';
import UIButton from '@/components/UIButton';
import {
  assembleClip,
  byteChangeScore,
  DEFAULT_TRIGGER_CONFIG,
  FrameTrigger,
  selectClipFrames,
} from '@/services/fastCapture';
import {
  FrameStream,
  isStreamUrl,
  RingBuffer,
  type StreamSocket,
} from '@/services/frameStream';
import { deletePhoto } from '@/services/photoFiles';
import type { CaptureSource } from '@/services/types';
import { createClipVision } from '@/services/vision/clipVision';
import { createVisionProvider } from '@/services/vision/provider';

// Fast Capture: watch frames for sudden change and keep only the seconds
// around the event — not the whole stream.
//
// Robot/glasses bridges feed frames two ways, chosen by URL scheme:
// ws:// streams live JPEG frames (one binary message per frame); http://
// polls snapshots (~5/s). Simulation and the phone camera always poll.

const POLL_MS = 200;
const CLIP_PRE_MS = 1500;
const CLIP_POST_MS = 1500;
/** Representative frames uploaded per event clip. */
const CLIP_UPLOAD_MAX = 4;
/** Ring buffer bounds: enough for the clip window at stream rate. */
const RING_MAX_FRAMES = 90;
const RING_MAX_AGE_MS = CLIP_PRE_MS + CLIP_POST_MS + 1000;

interface FastEvent {
  id: number;
  ts: number;
  peak: number;
  framesKept: number;
  thumbUri: string | null;
  caption: string | null;
  /** Whether the caption came from multi-frame clip analysis. */
  analyzed: 'clip' | 'frame';
}

async function saveClipFrame(
  bytes: Uint8Array,
  name: string,
): Promise<string> {
  const dir = new Directory(Paths.cache, 'fast-clips');
  if (!dir.exists) {
    try {
      dir.create();
    } catch {
      // Already present.
    }
  }
  const file = new File(dir, name);
  if (!file.exists) file.create();
  await file.write(bytes);
  return file.uri;
}

// Event rows re-render only when their event changes: the change meter
// above updates several times a second, and must not drag this list
// through reconciliation with it.
const FastEventRow = memo(function FastEventRow({ event }: { event: FastEvent }) {
  return (
    <View style={rowStyles.event}>
      {event.thumbUri ? (
        <Image source={{ uri: event.thumbUri }} style={rowStyles.thumb} />
      ) : null}
      <View style={rowStyles.flex}>
        <Text style={rowStyles.caption}>
          {event.caption ?? 'Sudden change captured'}
        </Text>
        <Text style={rowStyles.meta}>
          {new Date(event.ts).toLocaleTimeString()} · peak{' '}
          {(event.peak * 100).toFixed(0)}% · kept {event.framesKept} frames
          around the event ·{' '}
          {event.analyzed === 'clip' ? 'clip analyzed' : 'single frame'}
        </Text>
      </View>
    </View>
  );
});

const rowStyles = StyleSheet.create({
  event: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e3e3e3',
    borderRadius: 10,
    padding: 10,
  },
  flex: { flex: 1 },
  thumb: { width: 56, height: 56, borderRadius: 8 },
  caption: { fontWeight: '600' },
  meta: { color: '#5f6368', fontSize: 12, marginTop: 2 },
});

export default function FastCaptureScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [sourceKind, setSourceKind] = useState<CaptureSource>('simulation');
  const [frameUrl, setFrameUrl] = useState('http://192.168.1.20:9000/frame.jpg');
  const [armed, setArmed] = useState(false);
  const [status, setStatus] = useState('Not armed. Pick a source and arm the trigger.');
  const [score, setScore] = useState(0);
  const [events, setEvents] = useState<FastEvent[]>([]);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<FrameStream | null>(null);
  const busyRef = useRef(false);
  const prevBytesRef = useRef<Uint8Array | null>(null);
  const ringRef = useRef(
    new RingBuffer<{ bytes: Uint8Array; uri: string | null }>({
      maxFrames: RING_MAX_FRAMES,
      maxAgeMs: RING_MAX_AGE_MS,
    }),
  );
  const triggerRef = useRef(new FrameTrigger(DEFAULT_TRIGGER_CONFIG));
  const pendingRef = useRef<{ ts: number; peak: number; thumbUri: string | null } | null>(null);
  const simTickRef = useRef(0);
  const [vision] = useState(() => createVisionProvider());
  const [clipVision] = useState(() => createClipVision());

  const fetchFrameBytes = useCallback(async (): Promise<{ bytes: Uint8Array; uri: string | null }> => {
    if (sourceKind === 'simulation') {
      simTickRef.current += 1;
      const tick = simTickRef.current;
      // Quiet scene with a sudden change roughly every 4 seconds.
      const spike = tick % 20 >= 18;
      const bytes = new Uint8Array(2048);
      bytes.fill(spike ? 230 : 24 + (tick % 3));
      return { bytes, uri: null };
    }
    if (sourceKind === 'phone') {
      if (!permission?.granted || !cameraRef.current) {
        throw new Error('Phone camera needs permission for Fast Capture.');
      }
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.3 });
      const bytes = await new File(photo.uri).bytes();
      return { bytes, uri: photo.uri };
    }
    const response = await fetch(frameUrl.trim());
    if (!response.ok) throw new Error(`frame source failed: ${response.status}`);
    return { bytes: new Uint8Array(await response.arrayBuffer()), uri: null };
  }, [sourceKind, frameUrl, permission?.granted]);

  const analyzeClip = useCallback(
    async (
      clip: { ts: number; value: { bytes: Uint8Array } }[],
      triggerTs: number,
    ): Promise<{ caption: string | null; analyzed: 'clip' | 'frame' }> => {
    if (!clipVision) return { caption: null, analyzed: 'frame' };
    const selected = selectClipFrames(clip, triggerTs, CLIP_UPLOAD_MAX);
    if (selected.length === 0) return { caption: null, analyzed: 'frame' };
    const firstTs = selected[0].ts;
    const tempUris: string[] = [];
    try {
      const frames = [];
      for (const frame of selected) {
        const uri = await saveClipFrame(
          frame.value.bytes,
          `clip-${triggerTs}-${frame.ts - firstTs}.jpg`,
        );
        tempUris.push(uri);
        frames.push({
          imageBase64: await new File(uri).base64(),
          mimeType: 'image/jpeg',
          tsOffsetMs: frame.ts - firstTs,
        });
      }
      const result = await clipVision.analyzeClip(frames);
      return { caption: result.caption || null, analyzed: 'clip' };
    } catch {
      return { caption: null, analyzed: 'frame' };
    } finally {
      for (const uri of tempUris) deletePhoto(uri);
    }
  },
    [clipVision],
  );

  const finalizePending = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    const now = Date.now();
    const clip = assembleClip(
      ringRef.current.snapshot(now),
      pending.ts,
      CLIP_PRE_MS,
      CLIP_POST_MS,
    );
    let caption: string | null = null;
    let analyzed: 'clip' | 'frame' = 'frame';
    // Synthetic simulation bytes are not photos — single-frame mock analysis
    // covers them; real sources get multi-frame clip analysis when a backend
    // is configured, falling back to one frame without it.
    if (sourceKind !== 'simulation' && clipVision) {
      ({ caption, analyzed } = await analyzeClip(clip, pending.ts));
    }
    if (!caption) {
      try {
        caption = (await vision.analyze(pending.thumbUri)).caption || null;
      } catch {
        caption = null;
      }
    }
    setEvents((prev) => [
      {
        id: pending.ts,
        ts: pending.ts,
        peak: pending.peak,
        framesKept: clip.length,
        thumbUri: pending.thumbUri,
        caption,
        analyzed,
      },
      ...prev,
    ]);
  }, [vision, clipVision, analyzeClip, sourceKind]);

  const disarm = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.stop();
      streamRef.current = null;
    }
    deactivateKeepAwake();
    setArmed(false);
  }, []);

  // One frame through the trigger pipeline, shared by the snapshot-polling
  // and WebSocket-stream paths.
  const processFrame = useCallback(
    async (bytes: Uint8Array, uri: string | null) => {
      const now = Date.now();
      const prev = prevBytesRef.current;
      const change = prev ? byteChangeScore(prev, bytes) : 0;
      prevBytesRef.current = bytes;
      // Rounded so identical readings bail out of re-render: the meter
      // displays whole percent anyway.
      setScore(Math.round(change * 100) / 100);

      ringRef.current.push(now, { bytes, uri });

      if (triggerRef.current.observe(change, now)) {
        let thumbUri: string | null = uri;
        if (!thumbUri && sourceKind !== 'simulation') {
          thumbUri = await saveClipFrame(bytes, `event-${now}.jpg`);
        }
        pendingRef.current = { ts: now, peak: change, thumbUri };
        setStatus(`Event at ${new Date(now).toLocaleTimeString()} — keeping the seconds around it.`);
      } else if (uri && sourceKind === 'phone') {
        // Photo discipline applies here too: untriggered frames are deleted.
        const isTriggerFrame = pendingRef.current?.thumbUri === uri;
        if (!isTriggerFrame) deletePhoto(uri);
      }

      if (pendingRef.current && now - pendingRef.current.ts >= CLIP_POST_MS) {
        await finalizePending();
      }
    },
    [finalizePending, sourceKind],
  );

  const tick = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const { bytes, uri } = await fetchFrameBytes();
      await processFrame(bytes, uri);
    } catch (error) {
      setStatus(`Fast Capture error: ${error instanceof Error ? error.message : String(error)}`);
      disarm();
    } finally {
      busyRef.current = false;
    }
  }, [fetchFrameBytes, processFrame, disarm]);

  const onStreamFrame = useCallback(
    (bytes: Uint8Array) => {
      // Streams run at device rate: drop rather than queue under load.
      if (busyRef.current) return;
      busyRef.current = true;
      void processFrame(bytes, null).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`Fast Capture error: ${message}`);
        disarm();
      }).finally(() => {
        busyRef.current = false;
      });
    },
    [processFrame, disarm],
  );

  const tickRef = useRef(tick);
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const streamFrameRef = useRef(onStreamFrame);
  useEffect(() => {
    streamFrameRef.current = onStreamFrame;
  }, [onStreamFrame]);

  useEffect(() => disarm, [disarm]);

  const toggleArm = () => {
    if (armed) {
      disarm();
      void finalizePending();
      setStatus('Stopped.');
      return;
    }
    prevBytesRef.current = null;
    ringRef.current.clear();
    triggerRef.current.reset();
    pendingRef.current = null;
    setArmed(true);
    void activateKeepAwakeAsync().catch(() => {});
    const streaming =
      (sourceKind === 'robot' || sourceKind === 'glasses') &&
      isStreamUrl(frameUrl);
    if (streaming) {
      const stream = new FrameStream(frameUrl.trim(), {
        // RN's WebSocket satisfies StreamSocket at runtime; its types omit
        // binaryType, hence the boundary cast (see frameStream.ts).
        createSocket: (url) => new WebSocket(url) as unknown as StreamSocket,
        onFrame: (bytes) => streamFrameRef.current(bytes),
        onError: (message) => {
          setStatus(`Fast Capture error: ${message}`);
          disarm();
        },
      });
      streamRef.current = stream;
      stream.start();
      setStatus('Armed — streaming live frames, watching for sudden change.');
      return;
    }
    setStatus(
      sourceKind === 'phone'
        ? 'Armed — polling phone snapshots (~5/s). True millisecond work needs a stream source.'
        : sourceKind === 'simulation'
          ? 'Armed — watching the simulated feed for sudden change.'
          : 'Armed — polling snapshots (~5/s). Use a ws:// URL to stream live.',
    );
    timerRef.current = setInterval(() => {
      void tickRef.current();
    }, POLL_MS);
    void tickRef.current();
  };

  return (
    <ScreenBoundary>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.keyboard}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.heading}>Fast Capture</Text>
            <Text style={styles.status}>{status}</Text>

            <Section title="Frame source">
              <View style={styles.chips}>
                {(
                  [
                    ['simulation', 'Simulation'],
                    ['robot', 'Robot'],
                    ['glasses', 'Glasses'],
                    ['phone', 'Phone'],
                  ] as [CaptureSource, string][]
                ).map(([kind, label]) => (
                  <Pressable
                    key={kind}
                    style={[
                      styles.chip,
                      kind === sourceKind && styles.chipActive,
                    ]}
                    onPress={() => setSourceKind(kind)}
                    accessibilityRole="button"
                    accessibilityLabel={`${label} frame source`}
                    accessibilityState={{ selected: kind === sourceKind }}
                  >
                    <Text
                      style={kind === sourceKind && styles.chipTextActive}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {sourceKind === 'glasses' || sourceKind === 'robot' ? (
                <>
                  <TextInput
                    style={styles.input}
                    value={frameUrl}
                    onChangeText={setFrameUrl}
                    placeholder="ws://192.168.1.20:9000/frames or http://…/frame.jpg"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                  />
                  <Text style={styles.sub}>
                    {isStreamUrl(frameUrl)
                      ? 'Stream mode: one JPEG frame per binary message, analyzed as a clip.'
                      : 'Snapshot mode: polls the URL ~5/s. Switch to ws:// to stream live.'}
                  </Text>
                </>
              ) : null}
            </Section>

            {sourceKind === 'phone' && permission?.granted ? (
              <CameraView ref={cameraRef} style={styles.camera} facing="back" />
            ) : sourceKind === 'phone' ? (
              <View style={styles.cameraPlaceholder}>
                <Text style={styles.placeholderText}>
                  Phone Fast Capture needs camera permission.
                </Text>
                <UIButton
                  title="Grant camera permission"
                  variant="secondary"
                  onPress={() => void requestPermission()}
                />
              </View>
            ) : (
              <View style={styles.cameraPlaceholder}>
                <Text style={styles.placeholderText}>
                  {sourceKind === 'simulation'
                    ? 'Simulation generates a sudden change about every 4 seconds.'
                    : isStreamUrl(frameUrl)
                      ? 'Live stream: frames arrive over the socket as they are sent.'
                      : 'Snapshots are polled from the URL above ~5/s.'}
                </Text>
              </View>
            )}

            <Section title="Change trigger">
              <Text style={styles.sub}>
                Change now: {(score * 100).toFixed(0)}% · trigger at{' '}
                {(DEFAULT_TRIGGER_CONFIG.threshold * 100).toFixed(0)}%
              </Text>
              <View style={styles.meterTrack}>
                <View
                  style={[
                    styles.meterFill,
                    {
                      width: `${Math.min(100, Math.round(score * 100))}%`,
                      backgroundColor:
                        score >= DEFAULT_TRIGGER_CONFIG.threshold
                          ? '#c62828'
                          : '#0a6cff',
                    },
                  ]}
                />
              </View>
              <UIButton
                title={armed ? 'Stop' : 'Arm trigger'}
                variant={armed ? 'danger' : 'primary'}
                onPress={toggleArm}
              />
            </Section>

            <Text style={styles.label}>Events</Text>
            {events.length === 0 ? (
              <Text style={styles.sub}>
                No events yet. Arm the trigger and wait for a spike.
              </Text>
            ) : (
              events.map((e) => <FastEventRow key={e.id} event={e} />)
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ScreenBoundary>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  keyboard: { flex: 1 },
  container: {
    padding: 16,
    gap: 12,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  heading: { fontSize: 22, fontWeight: '700' },
  status: { color: '#555' },
  sub: { color: '#5f6368' },
  label: { fontWeight: '700', marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: '#eef3ff',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
    minHeight: 40,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  chipActive: { backgroundColor: '#0a6cff' },
  chipTextActive: { color: '#fff', fontWeight: '700' },
  camera: { height: 200, borderRadius: 12, overflow: 'hidden' },
  cameraPlaceholder: {
    height: 140,
    borderRadius: 12,
    backgroundColor: '#eef1f6',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 12,
  },
  placeholderText: { color: '#445', textAlign: 'center' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#fff',
  },
  meterTrack: {
    height: 12,
    borderRadius: 6,
    backgroundColor: '#e6ebf2',
    overflow: 'hidden',
  },
  meterFill: { height: 12, borderRadius: 6 },
});
