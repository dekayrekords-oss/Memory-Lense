import {
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioPlayer,
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
import { useThemedStyles, type ThemeTokens } from '@/components/theme';
import {
  formatInterval,
  INTERVAL_PRESETS_SECONDS,
  pickPictureSize,
} from '@/services/config';
import VideoPlayer from '@/components/VideoPlayer';
import { CaptureEngine } from '@/services/captureEngine';
import {
  createEyewearMeta,
  createMetaFrameSource,
  ensureMetaBluetoothPermissions,
  eyewearPreviewState,
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
  persistTrainingPhoto,
  removeKeptPhotos,
} from '@/services/photoFiles';
import {
  exportMemoriesAsText,
  dayStartMs,
  keptPhotoRefs,
  wipeDaySelection,
} from '@/services/retention';
import { createRecap, type Recap, type RecapPeriod } from '@/services/recap';
import {
  answerWhere,
  checklistProgress,
  scenarioDisplayName,
} from '@/services/scenarios';
import {
  getSettings,
  loadSettings,
  subscribeSettings,
  type AppSettings,
} from '@/services/settings';
import { createTranscriber } from '@/services/transcribe';
import { base64ToBytes, createVideoJobs } from '@/services/videoJobs';
import {
  captureSourceLabel,
  createHttpFrameSource,
  createPhoneSource,
  createSimulationSource,
  watchPreflightNote,
  type CaptureSourceAdapter,
} from '@/services/captureSources';
import type {
  CaptureSource,
  MemoryEvent,
  Scenario,
  ScenarioAlert,
} from '@/services/types';
import { visionProviderForSettings } from '@/services/vision/provider';
import { maybeCheckLocalModelUpdate } from '@/services/localModel';
import { MockVisionProvider } from '@/services/vision/mockProvider';
import {
  addTrainedPhoto,
  listTrainedObjects,
  loadAlerts,
  loadWatchItems,
  removeTrainedObject,
  saveAlerts,
  saveWatchItems,
  type TrainedObject,
} from '@/services/listStore';

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
  // Timestamped so ids never collide with ones persisted before a restart
  // (a reused id would delete two chips at once and mute a needed alert).
  return `${prefix}-${Date.now().toString(36)}-${scenarioSeq}`;
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
  const styles = useThemedStyles(createStyles);

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [pictureSize, setPictureSize] = useState<string | undefined>();

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Ready.');
  // Latest glasses/bridge frame shown as the live view, so the wearer
  // can SEE the feed works instead of trusting a status line. Tagged
  // with its source so switching cameras never flashes a stale frame.
  const [glassesPreview, setGlassesPreview] = useState<{
    source: CaptureSource;
    uri: string;
    at: number;
  } | null>(null);
  const [previewNow, setPreviewNow] = useState(() => Date.now());
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
  const [trained, setTrained] = useState<TrainedObject[]>([]);
  const [trainName, setTrainName] = useState('');
  const [trainDraft, setTrainDraft] = useState<string[]>([]);
  const watchLoadedRef = useRef(false);
  const [micRecording, setMicRecording] = useState(false);
  const voicePlayerRef = useRef<AudioPlayer | null>(null);
  const [slideshow, setSlideshow] = useState<string[] | null>(null);
  const [slideshowIndex, setSlideshowIndex] = useState(0);

  const playVoiceNote = (uri: string) => {
    try {
      voicePlayerRef.current?.pause();
      const player = createAudioPlayer(uri);
      voicePlayerRef.current = player;
      player.play();
    } catch {
      setMicStatus('That voice note could not be played.');
    }
  };

  useEffect(() => {
    if (!slideshow || slideshow.length === 0) return;
    const timer = setInterval(
      () => setSlideshowIndex((i) => (i + 1) % slideshow.length),
      2500,
    );
    return () => clearInterval(timer);
  }, [slideshow]);
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
  const adapterRef = useRef<CaptureSourceAdapter | null>(null);

  const [appSettings, setAppSettings] = useState<AppSettings>(() =>
    getSettings(),
  );
  useEffect(() => {
    let live = true;
    // On-device model update check — at most once a day on app open.
    void maybeCheckLocalModelUpdate();
    void loadSettings().then((loaded) => {
      if (!live) return;
      setAppSettings(loaded);
      setIntervalSeconds(loaded.captureIntervalSeconds);
    });
    const unsubscribe = subscribeSettings(setAppSettings);
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  const visionEndpoint = appSettings.visionApiUrl;
  const visionProvider = useMemo(
    () => visionProviderForSettings(appSettings),
    [appSettings],
  );
  const demoVision = visionProvider instanceof MockVisionProvider;
  const watchNote = watchPreflightNote({ sourceKind, demoVision });
  const activePreview =
    glassesPreview?.source === sourceKind ? glassesPreview : null;
  const previewState = eyewearPreviewState(
    activePreview !== null,
    activePreview ? previewNow - activePreview.at : null,
  );

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
  const transcriber = useMemo(
    () => createTranscriber(visionEndpoint),
    [visionEndpoint],
  );
  const recapService = useMemo(
    () => createRecap(visionEndpoint),
    [visionEndpoint],
  );
  const videoJobs = useMemo(
    () => createVideoJobs(visionEndpoint),
    [visionEndpoint],
  );

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
    adapterRef.current = adapter;
    if (adapter.start) {
      void (async () => {
        if (sourceKind === 'meta') {
          // DAT detects the glasses over BLE itself; without the
          // Nearby devices permission its detection never starts and
          // the session fails as "no glasses" even when they are on.
          const granted = await ensureMetaBluetoothPermissions();
          if (!granted) {
            setStatus(
              'Bluetooth permission needed: allow "Nearby devices" for ' +
                'Memory Lens so it can reach your Meta glasses, then ' +
                'tap Meta again.',
            );
            return;
          }
        }
        await adapter.start?.();
      })().catch((error: unknown) => {
        setStatus(
          `Eyewear error: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
    const engine = new CaptureEngine({
      simulated: sourceKind === 'simulation',
      vision: visionProvider,
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
        onPrivacySkip: (reason) => {
          setStatus(
            `Still watching — skipped a frame (${reason}); its photo was deleted.`,
          );
        },
        onStopped: (reason, detail) => {
          setRunning(false);
          deactivateKeepAwake();
          if (reason === 'privacy') {
            setStatus(
              `Stopped: private scene detected (${detail ?? 'privacy tag'}). ` +
                'Point the camera elsewhere, then Start watching.',
            );
          } else if (reason === 'unanalyzed') {
            setStatus(detail ?? 'Stopped: photos could not be checked.');
          } else if (reason === 'error') {
            setStatus(`Stopped after an error: ${detail ?? 'unknown'}`);
          } else {
            setStatus('Stopped.');
          }
        },
        onError: (message) => setStatus(`Error: ${message}`),
        onNoFrame: () =>
          setStatus(
            'Waiting for a photo from the camera… if this stays, check the camera is not covered and permission is on.',
          ),
      },
    });
    engineRef.current = engine;
    void listEvents(100).then(setEvents);
    return () => {
      engine.stop();
      deactivateKeepAwake();
      if (adapterRef.current === adapter) adapterRef.current = null;
      void adapter.stop?.().catch(() => {});
    };
  }, [sourceKind, engineFrameUrl, takePhoto, metaService, visionProvider]);

  // Live view for glasses/bridge feeds: poll the adapter for its
  // freshest frame so the wearer can SEE the feed arriving. Without
  // this the glasses "work" invisibly and look broken.
  useEffect(() => {
    if (sourceKind === 'phone' || sourceKind === 'simulation') return;
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const uri = await adapterRef.current?.takePhoto();
        if (!cancelled && uri) {
          setGlassesPreview({ source: sourceKind, uri, at: Date.now() });
        }
      } catch {
        // Feed not ready; the waiting/stale caption covers it.
      } finally {
        inFlight = false;
        if (!cancelled) setPreviewNow(Date.now());
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sourceKind]);

  const toggleCapture = () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (running) {
      engine.stop();
      deactivateKeepAwake();
    } else {
      // Real camera + demo vision can only start and instantly stop
      // (first photo unanalyzed). Say so here instead of flip-flopping
      // the button and stranding the reason at the top of the page.
      if (watchNote) {
        setStatus(watchNote);
        return;
      }
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
    if (!object) {
      setStatus('Type what to watch for first, then tap Track or Watch.');
      return;
    }
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
    if (!requirement) {
      setStatus('Type what must happen before leaving first.');
      return;
    }
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
    setStatus(`Added to your watch list: Don't let me leave before ${requirement}.`);
  };

  const addChecklist = (title: string, rawItems: string) => {
    const name = title.trim();
    const items = rawItems
      .split(',')
      .map((i) => i.trim().toLowerCase())
      .filter((i) => i.length > 0);
    if (!name || items.length === 0) {
      setStatus('Give the list a name AND comma-separated items — both are needed.');
      return;
    }
    setScenarios((prev) => [
      ...prev,
      { id: nextId('list'), kind: 'checklist', title: name, items, label: name },
    ]);
    setStatus(`Added list "${name}" with ${items.length} item(s). Tap a chip below to remove.`);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await loadWatchItems();
        if (!cancelled && stored) setScenarios(stored);
        if (!cancelled) setAlerts(await loadAlerts());
        if (!cancelled) setTrained(await listTrainedObjects());
      } catch {
        // First run or unavailable storage: keep the built-in defaults.
      } finally {
        watchLoadedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!watchLoadedRef.current) return;
    void saveWatchItems(scenarios).catch(() => {});
  }, [scenarios]);

  useEffect(() => {
    if (!watchLoadedRef.current) return;
    void saveAlerts(alerts.slice(0, 30)).catch(() => {});
  }, [alerts]);

  const takeTrainingPhoto = async () => {
    if (sourceKind !== 'phone') {
      setStatus('Training uses the phone camera - switch Camera source to Phone first.');
      return;
    }
    if (!permission?.granted) {
      setStatus('Camera permission needed for training photos.');
      return;
    }
    if (busy) return;
    setBusy('train');
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.6 });
      if (photo?.uri) {
        const uri = await persistTrainingPhoto(photo.uri, Date.now());
        setTrainDraft((prev) => [...prev, uri]);
        setStatus(`Training photo ${trainDraft.length + 1} saved. Take 2-3 from different angles.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Training photo failed: ${message}`);
    } finally {
      setBusy(null);
    }
  };

  const saveTrainedObject = async () => {
    if (busy) return;
    const name = trainName.trim().toLowerCase();
    if (!name || trainDraft.length === 0) {
      setStatus('Name the object and take at least one training photo first.');
      return;
    }
    const count = trainDraft.length;
    const ts = Date.now();
    for (let i = 0; i < trainDraft.length; i += 1) {
      await addTrainedPhoto(name, trainDraft[i], ts + i);
    }
    setTrainName('');
    setTrainDraft([]);
    setTrained(await listTrainedObjects());
    addScenario('remember-object', name);
    setStatus(
      'Visual memory saved for "' + name + '" (' + count + ' photo(s)). Tracking by name; reference photos stay on this phone.',
    );
  };

  const deleteTrainedObject = async (name: string) => {
    const uris = await removeTrainedObject(name);
    for (const uri of uris) deletePhoto(uri);
    setTrained(await listTrainedObjects());
    setScenarios((prev) =>
      prev.filter(
        (sc) => !(sc.kind === 'remember-object' && sc.object === name),
      ),
    );
    setStatus('Removed visual memory for "' + name + '".');
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
      for (const uri of selection.audioUris) deletePhoto(uri);
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
      const modeNote = status.reason ? ` ${status.reason}` : '';
      await metaService.configure();
      const devices = await metaService.listDevices();
      const state = await metaService.getDeviceState();
      const names = devices.map((d) => d.name).join(', ') || 'no devices yet';
      setMetaInfo(
        `DAT ready — modules: ${status.modules.join(', ')} (experimental: ${status.experimental.join(', ')}). ` +
          `Devices: ${names}. Battery: ${state.batteryPercent ?? '—'}%, connected: ${state.connected ? 'yes' : 'no'}.` +
          (devices.length > 0
            ? ' Glasses found — press Start to stream.'
            : ' No glasses registered yet: in the Meta AI app go to Settings > App Info, tap the app version 5 times, turn Developer Mode ON, then tap Register app below.' + modeNote),
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
        } catch (error) {
          // Never claim to be listening when nothing is recording.
          setAmbientOn(false);
          const message =
            error instanceof Error ? error.message : String(error);
          setMicStatus(
            `Ambient listening stopped: ${message}. Check microphone permission, then turn it on again.`,
          );
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
      setSlideshow(photos.map((e) => e.photoUri as string));
      setSlideshowIndex(0);
      setMontageStatus(
        'Showing your kept photos as a slideshow. (The cartoon video needs the vision backend.)',
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
      // Lowest resolution that still lets the model read text/detail.
      setPictureSize(pickPictureSize(sizes));
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
            <Text style={styles.heading}>Memory Lens</Text>
            <Text style={styles.heroSub}>
              I keep an eye on your things, so you don&apos;t have to.
            </Text>
            <Text style={styles.status}>{status}</Text>

            {alerts.map((a) => (
              <View key={a.id} style={styles.alert}>
                <Text style={styles.alertText}>{a.message}</Text>
              </View>
            ))}

            <Section title="Where should I look?" hint="Pick a camera: this phone, your glasses, or a practice simulation.">
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
                      style={[styles.chipText, kind === sourceKind && styles.chipTextActive]}
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
                    Meta Wearables DAT works only with Ray-Ban Meta glasses
                    registered to this app. No app ID is needed while
                    testing: in the Meta AI app go to Settings &gt; App
                    Info, tap the app version 5 times, and turn Developer
                    Mode ON, then reopen Memory Lens. (A Developer Center
                    app ID is only needed for production builds.) For other
                    smart glasses that can serve JPEG frames, use the
                    Glasses camera source above with a frame URL.
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

      {demoVision ? (
        <Text style={styles.sub}>
          Offline demo vision — real photos are not analyzed. In the
          Settings tab, add a cloud API key (free options are listed there)
          or connect a backend for find/watch, exit alerts, and privacy
          screening. (Simulation always runs the demo.)
        </Text>
      ) : null}
      {sourceKind === 'phone' && permission?.granted ? (
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing="back"
          mute={appSettings.muteCameraSounds}
          pictureSize={pictureSize}
          onCameraReady={onCameraReady}
        />
      ) : sourceKind !== 'phone' && sourceKind !== 'simulation' ? (
        <>
          {activePreview ? (
            <Image
              source={{ uri: activePreview.uri }}
              style={styles.camera}
              resizeMode="cover"
              accessibilityLabel={`Live view from ${captureSourceLabel(sourceKind)}`}
            />
          ) : (
            <View style={styles.cameraPlaceholder}>
              <Text style={styles.placeholderText}>
                {sourceKind === 'robot'
                  ? 'Waiting for a photo from the robot camera…'
                  : 'Waiting for a photo from your glasses… they must be on, worn, and connected.'}
              </Text>
            </View>
          )}
          <Text style={styles.sub}>
            {previewState === 'live'
              ? `Live from your ${sourceKind === 'robot' ? 'robot camera' : 'glasses'} — this is what I can see right now.`
              : previewState === 'stale'
                ? 'That photo is getting old — the feed looks paused. Check the glasses are on and connected.'
                : 'No photo yet from this camera.'}
          </Text>
        </>
      ) : (
        <View style={styles.cameraPlaceholder}>
          <Text style={styles.placeholderText}>
            {sourceKind === 'phone'
              ? 'No camera yet — Memory mode runs in simulation.'
              : 'Simulation runs the practice demo — no camera needed.'}
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
        title="Start watching"
        hint="Tap the big button and I will take a photo on a timer and remember what I see. Longer times between photos save battery."
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
              <Text style={[styles.chipText, s === intervalSeconds && styles.chipTextActive]}>
                {formatInterval(s)}
              </Text>
            </Pressable>
          ))}
        </View>
        {watchNote ? <Text style={styles.sub}>{watchNote}</Text> : null}
        <UIButton
          title={running ? 'Stop watching' : 'Start watching'}
          variant={running ? 'danger' : 'primary'}
          onPress={toggleCapture}
        />
      </Section>

      <Section
        title="Find my things"
        hint="Ask where something is — or tell me to watch for it and warn you before you leave without it. Tap a watch below to remove it."
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
                Alert.alert(
                  'Stop watching for this?',
                  `"${scenarioDisplayName(s)}" will be removed. You can add it again any time.`,
                  [
                    { text: 'Keep it', style: 'cancel' },
                    {
                      text: 'Remove',
                      style: 'destructive',
                      onPress: () => {
                        setScenarios((prev) =>
                          prev.filter((x) => x.id !== s.id),
                        );
                        setStatus(
                          `Removed: ${scenarioDisplayName(s)}. It is saved on this phone.`,
                        );
                      },
                    },
                  ],
                )
              }
              accessibilityRole="button"
              accessibilityLabel={`Remove watch: ${scenarioDisplayName(s)}`}
            >
              <Text style={styles.chipText}>
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
              {checklistProgress(events, s, dayStartMs(events[0]?.ts ?? 0)).map((p) => (
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
        title="Teach me an object"
        hint="Take a couple of photos of an object from different angles. The photos stay on this phone as your reference, and the app tracks the object by name whenever it is seen."
      >
        <TextInput
          style={styles.input}
          value={trainName}
          onChangeText={setTrainName}
          placeholder="Object name, e.g. blue mug"
          returnKeyType="done"
        />
        {trainDraft.length > 0 ? (
          <Text style={styles.sub}>
            {trainDraft.length} training photo(s) ready. Take 2-3 total for a
            good visual memory.
          </Text>
        ) : null}
        <View style={styles.row}>
          <View style={styles.flex}>
            <UIButton
              title={trainDraft.length > 0 ? 'Take another photo' : 'Take training photo'}
              variant="secondary"
              loading={busy === 'train'}
              disabled={busy !== null}
              onPress={() => void takeTrainingPhoto()}
            />
          </View>
          <View style={styles.flex}>
            <UIButton
              title="Save visual memory"
              variant="primary"
              disabled={busy !== null || trainDraft.length === 0}
              onPress={() => void saveTrainedObject()}
            />
          </View>
        </View>
        {trained.map((t) => (
          <View key={t.name} style={styles.row}>
            {t.photoUris.slice(0, 3).map((uri) => (
              <Image
                key={uri}
                source={{ uri }}
                style={styles.thumb}
                accessibilityLabel={`Training photo of ${t.name}`}
              />
            ))}
            <Text style={styles.flex}>
              {t.name} · {t.photoUris.length} reference photo(s)
            </Text>
            <UIButton
              title="Remove"
              variant="danger"
              onPress={() => void deleteTrainedObject(t.name)}
            />
          </View>
        ))}
        {trained.length === 0 ? (
          <Text style={styles.sub}>
            No trained objects yet. Trained objects are also added to the
            track list above.
          </Text>
        ) : null}
      </Section>

      <Section
        title="Just listen (no camera)"
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
        {slideshow && slideshow.length > 0 ? (
          <>
            <Image
              source={{ uri: slideshow[slideshowIndex % slideshow.length] }}
              style={styles.slideshowImage}
              accessibilityLabel="Slideshow of your kept photos"
            />
            <UIButton
              title="Stop slideshow"
              variant="secondary"
              onPress={() => setSlideshow(null)}
            />
          </>
        ) : null}
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
              {item.audioUri ? (
                <Pressable
                  style={styles.deletePhoto}
                  onPress={() => playVoiceNote(item.audioUri as string)}
                  accessibilityRole="button"
                  accessibilityLabel={`Play voice note: ${item.caption}`}
                >
                  <Text style={styles.playText}>▶ Play voice note</Text>
                </Pressable>
              ) : null}
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

const createStyles = (t: ThemeTokens) =>
  StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.bg },
  keyboard: { flex: 1 },
  container: {
    padding: 16,
    gap: 12,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  heading: { fontSize: 28, fontWeight: '800', color: t.text, letterSpacing: 0.2 },
  heroSub: { color: t.textSub, fontSize: 16, lineHeight: 22 },
  status: { color: t.textMuted, fontSize: 14, lineHeight: 20 },
  sub: { color: t.textSub },
  alert: { backgroundColor: t.dangerBg, borderRadius: 8, padding: 10 },
  alertText: { color: t.dangerText, fontWeight: '600' },
  camera: { height: 240, borderRadius: 12, overflow: 'hidden' },
  cameraPlaceholder: {
    height: 160,
    borderRadius: 12,
    backgroundColor: t.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 12,
  },
  placeholderText: { color: t.textMuted, textAlign: 'center' },
  label: { fontWeight: '700', marginTop: 6, color: t.text, fontSize: 15 },
  fieldLabel: { fontWeight: '700', fontSize: 15, color: t.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: t.accentSoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
    minHeight: 48,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  chipActive: { backgroundColor: t.accent },
  chipText: { color: t.text, fontWeight: '600', fontSize: 15 },
  chipTextActive: { color: t.onAccent, fontWeight: '800' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  flex: { flex: 1 },
  input: {
    color: t.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: t.borderStrong,
    borderRadius: 8,
    padding: 10,
    backgroundColor: t.card,
  },
  answer: { backgroundColor: t.infoBg, borderRadius: 12, padding: 12, color: t.text, fontSize: 15, lineHeight: 21 },
  checklist: {
    backgroundColor: t.successBg,
    borderWidth: 1,
    borderColor: t.successBorder,
    borderRadius: 10,
    padding: 10,
    gap: 2,
  },
  checklistTitle: { fontWeight: '800', color: t.text, fontSize: 16 },
  progressState: { fontWeight: '800', color: t.accentText },
  exportBox: {
    backgroundColor: t.surfaceAlt,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 8,
    padding: 10,
    maxHeight: 240,
  },
  deletePhoto: { marginTop: 6, alignSelf: 'flex-start' },
  deletePhotoText: { color: t.danger, fontSize: 12, fontWeight: '600' },
  playText: { color: t.accentText, fontSize: 14, fontWeight: '700' },
  slideshowImage: { width: '100%', height: 260, borderRadius: 16 },
  event: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  thumb: { width: 56, height: 56, borderRadius: 8 },
  caption: { fontWeight: '700', color: t.text, fontSize: 15 },
  meta: { color: t.textSub, fontSize: 12, marginTop: 2 },
});
