import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Directory, File, Paths } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
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
  formatInterval,
  INTERVAL_PRESETS_SECONDS,
} from '@/services/config';
import VideoPlayer from '@/components/VideoPlayer';
import { CaptureEngine } from '@/services/captureEngine';
import {
  createEyewearMeta,
  createMetaFrameSource,
  profileForUrl,
} from '@/services/eyewear';
import { MicSession, type MicRecorderAdapter } from '@/services/micCapture';
import {
  deleteEventsByIds,
  insertEvent,
  listEvents,
} from '@/services/memoryStore';
import { notifyAlert } from '@/services/notifications';
import {
  DEFAULT_MAX_KEPT_PHOTOS,
  deletePhoto,
  enforcePhotoQuota,
  pruneExpiredPhotos,
  removeKeptPhotos,
} from '@/services/photoFiles';
import {
  exportMemoriesAsText,
  keptPhotoRefs,
  wipeDaySelection,
} from '@/services/retention';
import { createRecap, type Recap, type RecapPeriod } from '@/services/recap';
import {
  answerWhere,
  checklistProgress,
  scenarioDisplayName,
} from '@/services/scenarios';
import { createTranscriber } from '@/services/transcribe';
import { base64ToBytes, createVideoJobs } from '@/services/videoJobs';
import {
  captureSourceLabel,
  createHttpFrameSource,
  createPhoneSource,
  createSimulationSource,
  type CaptureSourceAdapter,
} from '@/services/captureSources';
import type {
  CaptureSource,
  MemoryEvent,
  Scenario,
  ScenarioAlert,
} from '@/services/types';
import { createVisionProvider } from '@/services/vision/provider';

async function saveVideoBytes(
  videoBase64: string,
  prefix: string,
): Promise<string> {
  const dir = new Directory(Paths.cache, 'videos');
  if (!dir.exists) {
    try {
      dir.create();
    } catch {
      // Already present.
    }
  }
  const file = new File(dir, `${prefix}-${Date.now()}.mp4`);
  if (!file.exists) file.create();
  await file.write(base64ToBytes(videoBase64));
  return file.uri;
}

let scenarioSeq = 0;
function nextId(prefix: string): string {
  scenarioSeq += 1;
  return `${prefix}-${scenarioSeq}`;
}

const DEFAULT_SCENARIOS: Scenario[] = [
  {
    id: 'remember-keys',
    kind: 'remember-object',
    object: 'keys',
    label: 'Track my keys',
  },
  {
    id: 'exit-keys',
    kind: 'exit-check',
    object: 'keys',
    label: "Don't let me leave without my keys",
    windowMinutes: 60,
  },
];

export default function MemoryScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [pictureSize, setPictureSize] = useState<string | undefined>();

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Ready. Simulation runs without a camera.');
  const [intervalSeconds, setIntervalSeconds] = useState(5);
  const [sourceKind, setSourceKind] = useState<CaptureSource>('phone');
  const [frameUrl, setFrameUrl] = useState('http://192.168.1.20:9000/frame.jpg');
  // What the engine actually uses: committed on blur/submit so typing
  // never rebuilds the capture engine mid-keystroke.
  const [engineFrameUrl, setEngineFrameUrl] = useState(
    'http://192.168.1.20:9000/frame.jpg',
  );
  const [events, setEvents] = useState<MemoryEvent[]>([]);
  const [alerts, setAlerts] = useState<ScenarioAlert[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>(DEFAULT_SCENARIOS);
  const [trackInput, setTrackInput] = useState('');
  const [exitInput, setExitInput] = useState('');
  const [requirementInput, setRequirementInput] = useState('');
  const [checklistTitle, setChecklistTitle] = useState('');
  const [checklistItems, setChecklistItems] = useState('');
  const [query, setQuery] = useState('keys');
  const [answer, setAnswer] = useState<string | null>(null);
  const [exportText, setExportText] = useState<string | null>(null);
  const [retentionStatus, setRetentionStatus] = useState<string | null>(null);
  const [metaInfo, setMetaInfo] = useState<string | null>(null);
  const [micRecording, setMicRecording] = useState(false);
  const [ambientOn, setAmbientOn] = useState(false);
  const [micStatus, setMicStatus] = useState<string | null>(null);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [montageUri, setMontageUri] = useState<string | null>(null);
  const [montageStatus, setMontageStatus] = useState<string | null>(null);
  const [showAllMemories, setShowAllMemories] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const scenariosRef = useRef(scenarios);
  useEffect(() => {
    scenariosRef.current = scenarios;
  }, [scenarios]);
  const engineRef = useRef<CaptureEngine | null>(null);

  const takePhoto = useCallback(async (): Promise<string | null> => {
    if (!permission?.granted || !cameraRef.current) return null;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.35 });
      return photo.uri;
    } catch {
      return null;
    }
  }, [permission?.granted]);

  const metaService = useMemo(() => createEyewearMeta(), []);
  const transcriber = useMemo(() => createTranscriber(), []);
  const recapService = useMemo(() => createRecap(), []);
  const videoJobs = useMemo(() => createVideoJobs(), []);

  useEffect(() => {
    // Built in an effect: the phone adapter wraps a ref-reading callback,
    // which must not be wired up during render.
    let adapter: CaptureSourceAdapter;
    switch (sourceKind) {
      case 'meta':
        adapter = createMetaFrameSource(metaService);
        break;
      case 'glasses':
        adapter = createHttpFrameSource('glasses', engineFrameUrl.trim());
        break;
      case 'robot':
        adapter = createHttpFrameSource('robot', engineFrameUrl.trim());
        break;
      case 'simulation':
        adapter = createSimulationSource();
        break;
      default:
        adapter = createPhoneSource(takePhoto);
    }
    if (adapter.start) {
      void adapter.start().catch((error: unknown) => {
        setStatus(
          `Eyewear error: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
    const engine = new CaptureEngine({
      vision: createVisionProvider(),
      takePhoto: adapter.takePhoto,
      getScenarios: () => scenariosRef.current,
      callbacks: {
        onEvent: (event) => setEvents((prev) => [event, ...prev]),
        onAlert: (alert) => {
          setAlerts((prev) => [alert, ...prev]);
          void notifyAlert(alert);
          // Mirror onto the glasses display when Meta is the source.
          void metaService.showText([alert.message]).catch(() => {});
        },
        onStopped: (reason, detail) => {
          setRunning(false);
          deactivateKeepAwake();
          if (reason === 'privacy') {
            setStatus('Stopped: private scene detected. Capture is off.');
          } else if (reason === 'error') {
            setStatus(`Stopped after an error: ${detail ?? 'unknown'}`);
          } else {
            setStatus('Stopped.');
          }
        },
        onError: (message) => setStatus(`Error: ${message}`),
      },
    });
    engineRef.current = engine;
    void listEvents(100).then(setEvents);
    return () => {
      engine.stop();
      deactivateKeepAwake();
      void adapter.stop?.().catch(() => {});
    };
  }, [sourceKind, engineFrameUrl, takePhoto, metaService]);

  const toggleCapture = () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (running) {
      engine.stop();
      deactivateKeepAwake();
    } else {
      engine.start(intervalSeconds);
      setRunning(true);
      void activateKeepAwakeAsync().catch(() => {});
      setStatus(
        `Watching via ${captureSourceLabel(sourceKind)} every ${formatInterval(intervalSeconds)}.`,
      );
    }
  };

  const pickInterval = (seconds: number) => {
    setIntervalSeconds(seconds);
    engineRef.current?.setIntervalSeconds(seconds);
  };

  const addScenario = (kind: 'remember-object' | 'exit-check', raw: string) => {
    const object = raw.trim().toLowerCase();
    if (!object) return;
    const scenario: Scenario =
      kind === 'remember-object'
        ? {
            id: nextId('remember'),
            kind,
            object,
            label: `Track my ${object}`,
          }
        : {
            id: nextId('exit'),
            kind,
            object,
            label: `Don't let me leave without my ${object}`,
            windowMinutes: 60,
          };
    setScenarios((prev) => [...prev, scenario]);
  };

  const addRequirement = (raw: string) => {
    const requirement = raw.trim().toLowerCase();
    if (!requirement) return;
    setScenarios((prev) => [
      ...prev,
      {
        id: nextId('req'),
        kind: 'requirement',
        requirement,
        label: `Don't let me leave before ${requirement}`,
        windowMinutes: 120,
      },
    ]);
  };

  const addChecklist = (title: string, rawItems: string) => {
    const name = title.trim();
    const items = rawItems
      .split(',')
      .map((i) => i.trim().toLowerCase())
      .filter((i) => i.length > 0);
    if (!name || items.length === 0) return;
    setScenarios((prev) => [
      ...prev,
      { id: nextId('list'), kind: 'checklist', title: name, items, label: name },
    ]);
  };

  const refreshEvents = useCallback(async () => {
    setEvents(await listEvents(100));
  }, []);

  const deleteKeptPhoto = async (item: MemoryEvent) => {
    if (!item.photoUri) return;
    await removeKeptPhotos([item.photoUri]);
    await refreshEvents();
  };

  const handleExport = async () => {
    if (busy) return;
    setBusy('export');
    try {
      const all = await listEvents(5000);
      setExportText(exportMemoriesAsText(all));
    } finally {
      setBusy(null);
    }
  };

  const handleCleanup = async () => {
    if (busy) return;
    setBusy('cleanup');
    try {
      const evicted = await enforcePhotoQuota();
      const pruned = await pruneExpiredPhotos();
      const removed = new Set([...evicted, ...pruned]).size;
      setRetentionStatus(
        removed === 0
          ? `Nothing to clean — ${keptPhotoRefs(events).length} kept photos.`
          : `Cleaned ${removed} photo${removed === 1 ? '' : 's'} (memories kept as text).`,
      );
      await refreshEvents();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRetentionStatus(`Cleanup failed: ${message}`);
    } finally {
      setBusy(null);
    }
  };

  const handleWipeToday = () => {
    Alert.alert(
      'Wipe today’s memories?',
      'This deletes today’s memories and their photos. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Wipe',
          style: 'destructive',
          onPress: () => void wipeToday(),
        },
      ],
    );
  };

  const wipeToday = async () => {
    if (busy) return;
    setBusy('wipe');
    try {
      const all = await listEvents(5000);
      const selection = wipeDaySelection(all, Date.now());
      await removeKeptPhotos(selection.photoUris);
      const deleted = await deleteEventsByIds(selection.ids);
      setRetentionStatus(
        deleted === 0
          ? 'No memories from today to wipe.'
          : `Wiped ${deleted} memor${deleted === 1 ? 'y' : 'ies'} from today.`,
      );
      await refreshEvents();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRetentionStatus(`Wipe failed: ${message}`);
    } finally {
      setBusy(null);
    }
  };

  const askWhere = async () => {
    if (busy) return;
    setBusy('ask');
    try {
      const all = await listEvents(200);
      setAnswer(answerWhere(all, query.trim() || 'keys'));
    } finally {
      setBusy(null);
    }
  };

  const probeMeta = async () => {
    if (busy) return;
    setBusy('meta');
    try {
      const status = await metaService.status();
      if (!status.available) {
        setMetaInfo(status.reason ?? 'Meta unavailable.');
        return;
      }
      await metaService.configure();
      const devices = await metaService.listDevices();
      const state = await metaService.getDeviceState();
      const names = devices.map((d) => d.name).join(', ') || 'no devices yet';
      setMetaInfo(
        `DAT ready — modules: ${status.modules.join(', ')} (experimental: ${status.experimental.join(', ')}). ` +
          `Devices: ${names}. Battery: ${state.batteryPercent ?? '—'}%, connected: ${state.connected ? 'yes' : 'no'}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMetaInfo(`Meta error: ${message}`);
    } finally {
      setBusy(null);
    }
  };

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const micSessionRef = useRef<MicSession | null>(null);
  const getMicSession = (): MicSession => {
    if (!micSessionRef.current) {
      let startedAt = 0;
      const adapter: MicRecorderAdapter = {
        start: async () => {
          await setAudioModeAsync({
            allowsRecording: true,
            playsInSilentMode: true,
          });
          await audioRecorder.prepareToRecordAsync();
          startedAt = Date.now();
          audioRecorder.record();
        },
        stop: async () => {
          await audioRecorder.stop();
          const uri = audioRecorder.uri ?? '';
          const durationMs = Date.now() - startedAt;
          return { uri, durationMs };
        },
      };
      micSessionRef.current = new MicSession({
        recorder: adapter,
        transcribe: async (uri) => {
          if (!transcriber) return '';
          return transcriber.transcribeFile(uri);
        },
        store: insertEvent,
        deleteAudio: deletePhoto,
      });
    }
    return micSessionRef.current;
  };

  const toggleMicNote = async () => {
    if (busy) return;
    setBusy('mic');
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setMicStatus('Microphone permission denied.');
        return;
      }
      const session = getMicSession();
      if (micRecording) {
        const event = await session.stopNote();
        setMicRecording(false);
        if (event) {
          setEvents((prev) => [event, ...prev]);
          setMicStatus(`Voice memory saved: “${event.caption}”`);
        }
      } else {
        await session.startNote();
        setMicRecording(true);
        setMicStatus('Recording a voice note… tap again to save.');
      }
    } catch (error) {
      setMicRecording(false);
      const message = error instanceof Error ? error.message : String(error);
      setMicStatus(`Mic error: ${message}`);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (!ambientOn) return;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const event = await getMicSession().sampleAmbientOnce(8000);
          if (event) setEvents((prev) => [event, ...prev]);
        } catch {
          // Sampling is best-effort; the next tick retries.
        }
      })();
    }, 14000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambientOn]);

  const runRecap = async (period: RecapPeriod) => {
    if (busy) return;
    setBusy(`recap-${period}`);
    try {
      const all = await listEvents(500);
      const result = await recapService.summarize(all, period);
      setRecap(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRecap({ title: 'Recap failed', summary: message, highlights: [] });
    } finally {
      setBusy(null);
    }
  };

  const runMontage = async () => {
    if (busy) return;
    const photos = events.filter((e) => e.photoUri !== null).slice(0, 12);
    if (photos.length === 0) {
      setMontageStatus('No kept photos yet — the montage needs event images.');
      return;
    }
    if (!videoJobs) {
      setMontageStatus(
        'Slideshow only: no vision backend configured for cartoon rendering.',
      );
      return;
    }
    setBusy('montage');
    try {
      setMontageStatus('Rendering cartoon montage on the server…');
      const frames: string[] = [];
      for (const e of photos) {
        frames.push(await new File(e.photoUri as string).base64());
      }
      const videoBase64 = await videoJobs.cartoonMontage(frames);
      const uri = await saveVideoBytes(videoBase64, 'montage');
      setMontageUri(uri);
      setMontageStatus('Cartoon montage ready.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMontageStatus(`Montage failed (${message}) — slideshow fallback.`);
    } finally {
      setBusy(null);
    }
  };

  const onCameraReady = async () => {
    try {
      const sizes = await cameraRef.current?.getAvailablePictureSizesAsync();
      if (!sizes || sizes.length === 0) return;
      // Lowest resolution that still carries detail — smallest pixel count.
      const smallest = [...sizes].sort((a, b) => {
        const pa = a.split('x').reduce((n, v) => n * (parseInt(v, 10) || 0), 1);
        const pb = b.split('x').reduce((n, v) => n * (parseInt(v, 10) || 0), 1);
        return pa - pb;
      })[0];
      setPictureSize(smallest);
    } catch {
      // Keep the default picture size.
    }
  };

  const visibleEvents = showAllMemories ? events : events.slice(0, 20);

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
            <Text style={styles.heading}>Memory mode</Text>
            <Text style={styles.status}>{status}</Text>

            {alerts.map((a) => (
              <View key={a.id} style={styles.alert}>
                <Text style={styles.alertText}>{a.message}</Text>
              </View>
            ))}

            <Section title="Camera source">
              <View style={styles.chips}>
                {(
                  [
                    ['phone', 'Phone'],
                    ['meta', 'Meta'],
                    ['glasses', 'Glasses'],
                    ['robot', 'Robot'],
                    ['simulation', 'Simulation'],
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
                    accessibilityLabel={`${label} camera source`}
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
                    onBlur={() => setEngineFrameUrl(frameUrl)}
                    onSubmitEditing={() => setEngineFrameUrl(frameUrl)}
                    placeholder="ws://…/frames or http://…/frame.jpg (any smart glasses bridge)"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                  />
                  <Text style={styles.sub}>
                    {profileForUrl(frameUrl).label} — standard generic
                    glasses: any camera that can serve JPEG frames works.
                  </Text>
                </>
              ) : null}
              {sourceKind === 'meta' ? (
                <>
                  <Text style={styles.sub}>
                    Native Wearables DAT stream (dev build + Meta console
                    app ID). Alerts mirror to the lens display.
                  </Text>
                  <View style={styles.row}>
                    <View style={styles.flex}>
                      <UIButton
                        title="Check Meta"
                        variant="secondary"
                        loading={busy === 'meta'}
                        disabled={busy !== null}
                        onPress={() => void probeMeta()}
                      />
                    </View>
                    <View style={styles.flex}>
                      <UIButton
                        title="Register app"
                        variant="secondary"
                        disabled={busy !== null}
                        onPress={() =>
                          void metaService.register().catch(() => {})
                        }
                      />
                    </View>
                  </View>
                  {metaInfo ? (
                    <Text style={styles.answer}>{metaInfo}</Text>
                  ) : null}
                </>
              ) : null}
            </Section>

      {sourceKind === 'phone' && permission?.granted ? (
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing="back"
          pictureSize={pictureSize}
          onCameraReady={onCameraReady}
        />
      ) : (
        <View style={styles.cameraPlaceholder}>
          <Text style={styles.placeholderText}>
            {sourceKind === 'phone'
              ? 'No camera yet — Memory mode runs in simulation.'
              : sourceKind === 'meta'
                ? 'Meta glasses (DAT): frames stream natively in a dev build.'
                : `${captureSourceLabel(sourceKind)}: frames come from the URL above.`}
          </Text>
          {sourceKind === 'phone' ? (
            <UIButton
              title="Grant camera permission"
              variant="secondary"
              onPress={() => void requestPermission()}
            />
          ) : null}
        </View>
      )}

      <Section
        title="Watching"
        hint="A photo on a timer. Raise the interval to save battery."
      >
        <View style={styles.chips}>
          {INTERVAL_PRESETS_SECONDS.map((s) => (
            <Pressable
              key={s}
              style={[styles.chip, s === intervalSeconds && styles.chipActive]}
              onPress={() => pickInterval(s)}
              accessibilityRole="button"
              accessibilityLabel={`Photo every ${formatInterval(s)}`}
              accessibilityState={{ selected: s === intervalSeconds }}
            >
              <Text style={s === intervalSeconds && styles.chipTextActive}>
                {formatInterval(s)}
              </Text>
            </Pressable>
          ))}
        </View>
        <UIButton
          title={running ? 'Stop watching' : 'Start watching'}
          variant={running ? 'danger' : 'primary'}
          onPress={toggleCapture}
        />
      </Section>

      <Section
        title="Find & watch for"
        hint="Ask where things are, or set alerts for leaving without them. Tap a watch below to remove it."
      >
        <Text style={styles.fieldLabel}>Where is my…</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.flex]}
            value={query}
            onChangeText={setQuery}
            placeholder="keys"
            returnKeyType="search"
            onSubmitEditing={() => void askWhere()}
          />
          <UIButton
            title="Ask"
            variant="secondary"
            loading={busy === 'ask'}
            disabled={busy !== null}
            onPress={() => void askWhere()}
          />
        </View>
        {answer ? <Text style={styles.answer}>{answer}</Text> : null}

        <Text style={styles.fieldLabel}>Track an object</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.flex]}
            value={trackInput}
            onChangeText={setTrackInput}
            placeholder="e.g. wallet, glasses, guitar"
            returnKeyType="done"
          />
          <UIButton
            title="Track"
            variant="secondary"
            onPress={() => {
              addScenario('remember-object', trackInput);
              setTrackInput('');
            }}
          />
        </View>

        <Text style={styles.fieldLabel}>{"Don't let me leave without…"}</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.flex]}
            value={exitInput}
            onChangeText={setExitInput}
            placeholder="e.g. keys, phone"
            returnKeyType="done"
          />
          <UIButton
            title="Watch"
            variant="secondary"
            onPress={() => {
              addScenario('exit-check', exitInput);
              setExitInput('');
            }}
          />
        </View>

        <Text style={styles.fieldLabel}>{"Don't let me leave before…"}</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.flex]}
            value={requirementInput}
            onChangeText={setRequirementInput}
            placeholder="e.g. brushed teeth, took meds"
            returnKeyType="done"
          />
          <UIButton
            title="Require"
            variant="secondary"
            onPress={() => {
              addRequirement(requirementInput);
              setRequirementInput('');
            }}
          />
        </View>

        <Text style={styles.fieldLabel}>Checklist (gig kit, groceries…)</Text>
        <TextInput
          style={styles.input}
          value={checklistTitle}
          onChangeText={setChecklistTitle}
          placeholder="List name, e.g. Gig kit"
          returnKeyType="next"
        />
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.flex]}
            value={checklistItems}
            onChangeText={setChecklistItems}
            placeholder="Items, comma separated: guitar, cable, picks"
            returnKeyType="done"
          />
          <UIButton
            title="Add list"
            variant="secondary"
            onPress={() => {
              addChecklist(checklistTitle, checklistItems);
              setChecklistTitle('');
              setChecklistItems('');
            }}
          />
        </View>

        <View style={styles.chips}>
          {scenarios.map((s) => (
            <Pressable
              key={s.id}
              style={styles.chip}
              onPress={() =>
                setScenarios((prev) => prev.filter((x) => x.id !== s.id))
              }
              accessibilityRole="button"
              accessibilityLabel={`Remove watch: ${scenarioDisplayName(s)}`}
            >
              <Text>
                {scenarioDisplayName(s)} ✕
              </Text>
            </Pressable>
          ))}
        </View>

        {scenarios
          .filter(
            (s): s is Extract<Scenario, { kind: 'checklist' }> =>
              s.kind === 'checklist',
          )
          .map((s) => (
            <View key={s.id} style={styles.checklist}>
              <Text style={styles.checklistTitle}>{s.title}</Text>
              {checklistProgress(events, s).map((p) => (
                <Text key={p.item} style={styles.sub}>
                  <Text style={styles.progressState}>
                    {p.held ? 'Packed' : p.seen ? 'Seen' : 'Todo'}
                  </Text>
                  {'  ·  '}
                  {p.item}
                </Text>
              ))}
            </View>
          ))}
      </Section>

      <Section
        title="Mic only (no camera)"
        hint="Voice notes keep their audio; ambient samples become text memories and the audio is deleted."
      >
        <View style={styles.row}>
          <View style={styles.flex}>
            <UIButton
              title={micRecording ? 'Save voice note' : 'Record voice note'}
              variant={micRecording ? 'danger' : 'primary'}
              loading={busy === 'mic'}
              disabled={busy !== null}
              onPress={() => void toggleMicNote()}
            />
          </View>
          <View style={styles.flex}>
            <UIButton
              title={ambientOn ? 'Ambient: on' : 'Ambient: off'}
              variant="secondary"
              onPress={() => {
                const next = !ambientOn;
                setAmbientOn(next);
                if (next) {
                  setMicStatus(
                    'Mic ambient on — short samples become text memories.',
                  );
                }
              }}
            />
          </View>
        </View>
        {micStatus ? <Text style={styles.answer}>{micStatus}</Text> : null}
      </Section>

      <Section title="Recaps">
        <View style={styles.row}>
          <View style={styles.flex}>
            <UIButton
              title="End of day"
              variant="secondary"
              loading={busy === 'recap-day'}
              disabled={busy !== null}
              onPress={() => void runRecap('day')}
            />
          </View>
          <View style={styles.flex}>
            <UIButton
              title="End of week"
              variant="secondary"
              loading={busy === 'recap-week'}
              disabled={busy !== null}
              onPress={() => void runRecap('week')}
            />
          </View>
        </View>
        {recap ? (
          <View style={styles.checklist}>
            <Text style={styles.checklistTitle}>{recap.title}</Text>
            <Text selectable>{recap.summary}</Text>
            {recap.highlights.map((h) => (
              <Text key={h} style={styles.sub}>
                • {h}
              </Text>
            ))}
          </View>
        ) : null}
      </Section>

      <Section
        title="Cartoon montage"
        hint="Saved event photos become a cartoon video (server) or slideshow."
      >
        <UIButton
          title="Make cartoon montage"
          variant="secondary"
          loading={busy === 'montage'}
          disabled={busy !== null}
          onPress={() => void runMontage()}
        />
        {montageStatus ? (
          <Text style={styles.answer}>{montageStatus}</Text>
        ) : null}
        {montageUri ? <VideoPlayer uri={montageUri} /> : null}
      </Section>

      <Section
        title="Storage & retention"
        hint={`${keptPhotoRefs(events).length} kept photos (cap ${DEFAULT_MAX_KEPT_PHOTOS}, auto-pruned after 30 days).`}
      >
        <View style={styles.row}>
          <View style={styles.flex}>
            <UIButton
              title="Clean up old photos"
              variant="secondary"
              loading={busy === 'cleanup'}
              disabled={busy !== null}
              onPress={() => void handleCleanup()}
            />
          </View>
          <View style={styles.flex}>
            <UIButton
              title="Export memories"
              variant="secondary"
              loading={busy === 'export'}
              disabled={busy !== null}
              onPress={() => void handleExport()}
            />
          </View>
        </View>
        <UIButton
          title="Wipe today’s memories"
          variant="danger"
          loading={busy === 'wipe'}
          disabled={busy !== null}
          onPress={handleWipeToday}
        />
        {retentionStatus ? (
          <Text style={styles.answer}>{retentionStatus}</Text>
        ) : null}
        {exportText ? (
          <Text style={styles.exportBox} selectable>
            {exportText}
          </Text>
        ) : null}
      </Section>

      <Text style={styles.label}>Memories</Text>
      <FlatList
        data={visibleEvents}
        scrollEnabled={false}
        keyExtractor={(e) => String(e.id)}
        ListEmptyComponent={<Text style={styles.sub}>No memories yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.event}>
            {item.photoUri ? (
              <Image source={{ uri: item.photoUri }} style={styles.thumb} />
            ) : null}
            <View style={styles.flex}>
              <Text style={styles.caption}>{item.caption}</Text>
              <Text style={styles.meta}>
                {new Date(item.ts).toLocaleTimeString()} ·{' '}
                {item.kind === 'privacy-stop'
                  ? 'privacy stop — no photo kept'
                  : item.kind === 'audio'
                    ? item.audioUri
                      ? 'voice note — audio kept'
                      : 'heard — audio deleted'
                    : item.photoUri
                      ? 'photo kept'
                      : 'text memory — photo deleted'}
              </Text>
              {item.photoUri ? (
                <Pressable
                  style={styles.deletePhoto}
                  onPress={() => void deleteKeptPhoto(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete photo for ${item.caption}`}
                >
                  <Text style={styles.deletePhotoText}>
                    Delete photo (keep text)
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        )}
      />
      {!showAllMemories && events.length > 20 ? (
        <UIButton
          title={`Show all ${events.length} memories`}
          variant="secondary"
          onPress={() => setShowAllMemories(true)}
        />
      ) : null}
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
  alert: { backgroundColor: '#ffe9e9', borderRadius: 8, padding: 10 },
  alertText: { color: '#8a1010', fontWeight: '600' },
  camera: { height: 240, borderRadius: 12, overflow: 'hidden' },
  cameraPlaceholder: {
    height: 160,
    borderRadius: 12,
    backgroundColor: '#eef1f6',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 12,
  },
  placeholderText: { color: '#445', textAlign: 'center' },
  label: { fontWeight: '700', marginTop: 6 },
  fieldLabel: { fontWeight: '600', fontSize: 14 },
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
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  flex: { flex: 1 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#fff',
  },
  answer: { backgroundColor: '#f2f7ff', borderRadius: 8, padding: 10 },
  checklist: {
    backgroundColor: '#f6faf3',
    borderWidth: 1,
    borderColor: '#d8e8cf',
    borderRadius: 10,
    padding: 10,
    gap: 2,
  },
  checklistTitle: { fontWeight: '700' },
  progressState: { fontWeight: '700' },
  exportBox: {
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 10,
    maxHeight: 240,
  },
  deletePhoto: { marginTop: 6, alignSelf: 'flex-start' },
  deletePhotoText: { color: '#c62828', fontSize: 12, fontWeight: '600' },
  event: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e3e3e3',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  thumb: { width: 56, height: 56, borderRadius: 8 },
  caption: { fontWeight: '600' },
  meta: { color: '#5f6368', fontSize: 12, marginTop: 2 },
});
