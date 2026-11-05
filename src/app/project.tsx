import { CameraView, useCameraPermissions } from 'expo-camera';
import { Directory, File, Paths } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import ScreenBoundary from '@/components/ScreenBoundary';
import Section from '@/components/Section';
import StepModelView from '@/components/StepModelView';
import UIButton from '@/components/UIButton';
import { useThemedStyles, type ThemeTokens } from '@/components/theme';
import VideoPlayer from '@/components/VideoPlayer';
import { eventsSeeing, listEvents } from '@/services/memoryStore';
import {
  applyCheck,
  createSession,
  currentStepOf,
  MANUAL_STEP_CHECK,
  previousStep,
  spokenFeedback,
  stepProgress,
  type ProjectSessionState,
} from '@/services/projectSession';
import { pickPictureSize } from '@/services/config';
import type { ProjectPlan } from '@/services/types';
import { answerWhere, nameMatches } from '@/services/scenarios';
import {
  getSettings,
  loadSettings,
  subscribeSettings,
  type AppSettings,
} from '@/services/settings';
import { buildStepModel } from '@/services/stepModel';
import {
  base64ToBytes,
  createVideoJobs,
  type TimelapseItem,
} from '@/services/videoJobs';
import {
  createProjectVision,
  MockProjectVision,
  type ProjectVision,
} from '@/services/vision/projectVision';
import {
  extractUrl,
  loadOfficialDocument,
} from '@/services/instructionDoc';
import { cloudConfigFromSettings } from '@/services/aiProviders';
import { CloudProjectVision } from '@/services/vision/cloudVision';
import {
  createEyewearMeta,
  createMetaFrameSource,
  ensureMetaBluetoothPermissions,
} from '@/services/eyewear';

function projectVisionForSettings(settings: AppSettings): ProjectVision {
  const cloud = cloudConfigFromSettings(settings);
  if (cloud) return new CloudProjectVision(cloud);
  if (settings.visionSource === 'backend') {
    return createProjectVision({ endpoint: settings.visionApiUrl });
  }
  return createProjectVision({ endpoint: '' });
}

// Live Project mode: parse an instruction sheet into steps, watch the
// build with the camera (or simulated frames without one), find parts in
// memory, and answer questions about the current step. Session state from
// projectSession.ts is the single source of truth for step position.

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function ProjectScreen() {
  const styles = useThemedStyles(createStyles);

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [pictureSize, setPictureSize] = useState<string | undefined>();

  const [vision, setVision] = useState<ProjectVision>(() =>
    createProjectVision(),
  );
  const [appSettings, setAppSettings] = useState<AppSettings>(() =>
    getSettings(),
  );
  // Until the saved settings land, `vision` is the no-config default
  // (the offline mock). The demo-plan seed below must wait for this, or
  // every cold start with a real provider configured briefly loads the
  // fake demo kit before the real vision arrives.
  const [settingsReady, setSettingsReady] = useState(false);
  useEffect(() => {
    let live = true;
    void loadSettings().then((loaded) => {
      if (!live) return;
      setAppSettings(loaded);
      setVision(projectVisionForSettings(loaded));
      setSettingsReady(true);
    });
    const unsubscribe = subscribeSettings((next) => {
      setAppSettings(next);
      setVision(projectVisionForSettings(next));
      setSettingsReady(true);
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  const [session, setSession] = useState<ProjectSessionState | null>(null);
  const [status, setStatus] = useState(
    'Loading project.',
  );
  const [watching, setWatching] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [partQuery, setPartQuery] = useState('');
  const [partResult, setPartResult] = useState<string | null>(null);
  const [povClips, setPovClips] = useState<{ uri: string; ts: number }[]>([]);
  const [povRecording, setPovRecording] = useState(false);
  const [povVideoUri, setPovVideoUri] = useState<string | null>(null);
  const [slideshow, setSlideshow] = useState<string[] | null>(null);
  const [slideshowIndex, setSlideshowIndex] = useState(0);
  const [povStatus, setPovStatus] = useState<string | null>(null);
  const povPromiseRef = useRef<Promise<{ uri: string }> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tabFocused, setTabFocused] = useState(true);
  const [qrScanning, setQrScanning] = useState(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [qrPendingUrl, setQrPendingUrl] = useState<string | null>(null);
  const [qrPreview, setQrPreview] = useState<{
    plan: ProjectPlan;
    host: string;
  } | null>(null);
  const [pdfPendingUrl, setPdfPendingUrl] = useState<string | null>(null);
  const qrHandledRef = useRef(false);

  const sessionRef = useRef<ProjectSessionState | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const busyRef = useRef(false);

  const commitSession = useCallback((next: ProjectSessionState) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  // Project guidance can look through the phone camera or the wearer's
  // Meta glasses. The glasses feed the same checkStep pipeline: the DAT
  // adapter serves its freshest frame as a photo file.
  const [camSource, setCamSource] = useState<'phone' | 'glasses'>('phone');
  const [glassesOn, setGlassesOn] = useState(false);
  const metaService = useMemo(() => createEyewearMeta(), []);
  const metaAdapter = useMemo(
    () => createMetaFrameSource(metaService),
    [metaService],
  );

  const startGlasses = useCallback(async (): Promise<boolean> => {
    const granted = await ensureMetaBluetoothPermissions();
    if (!granted) {
      setStatus(
        'Bluetooth permission needed: allow "Nearby devices" for Memory Lens so it can reach your Meta glasses, then tap Glasses again.',
      );
      return false;
    }
    try {
      await metaAdapter.start();
      setGlassesOn(true);
      return true;
    } catch (error) {
      setStatus(`Glasses error: ${errorMessage(error)}`);
      return false;
    }
  }, [metaAdapter]);

  const stopGlasses = useCallback(async (): Promise<void> => {
    setGlassesOn(false);
    await metaAdapter.stop().catch(() => {});
  }, [metaAdapter]);

  const takePhoto = useCallback(async (): Promise<string | null> => {
    if (camSource === 'glasses') {
      return metaAdapter.takePhoto();
    }
    if (!permission?.granted || !cameraRef.current) return null;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.35 });
      return photo.uri;
    } catch {
      return null;
    }
  }, [camSource, metaAdapter, permission?.granted]);

  const [voiceOn, setVoiceOn] = useState(true);
  const lastSpokenRef = useRef('');

  const speakFeedback = useCallback((text: string) => {
    try {
      Speech.stop();
      Speech.speak(text);
    } catch {
      // No speech engine on this device/build: the banners still guide.
    }
  }, []);

  const stopWatching = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    deactivateKeepAwake();
    try {
      Speech.stop();
    } catch {
      // Nothing speaking.
    }
    setWatching(false);
  }, []);

  // Tab screens stay mounted when switching tabs: park the 3D render
  // loop while this tab is hidden so it stops burning battery.
  useFocusEffect(
    useCallback(() => {
      setTabFocused(true);
      return () => setTabFocused(false);
    }, []),
  );

  const runWatchTick = useCallback(async () => {
    if (busyRef.current) return;
    const state = sessionRef.current;
    if (!state || state.status === 'done') {
      stopWatching();
      return;
    }
    const step = currentStepOf(state);
    if (!step) {
      stopWatching();
      return;
    }
    const stepIndex = state.currentStep;
    busyRef.current = true;
    try {
      // Null in simulation (no camera / no permission): the mock vision
      // still returns a scripted verdict so the demo flows end to end.
      const photoUri = await takePhoto();
      if (!photoUri && camSource === 'glasses') {
        // Stream still warming up: wait quietly instead of spending the
        // three-strikes error budget on a frame that does not exist yet.
        setStatus('Waiting for a frame from your glasses…');
        return;
      }
      const check = await vision.checkStep(photoUri, step);
      const fresh = sessionRef.current;
      // Ignore a verdict for a step the user has already moved away from.
      if (!fresh || fresh.currentStep !== stepIndex || fresh.status === 'done') {
        return;
      }
      watchErrorsRef.current = 0;
      const next = applyCheck(fresh, check);
      commitSession(next);
      // Live feedback: say the verdict out loud — a wearer mid-fold
      // cannot read the banner. Identical repeat verdicts stay quiet.
      const applied = next.lastCheck;
      if (applied && voiceOn) {
        const key = `${next.currentStep}:${applied.verdict}:${applied.detail}`;
        if (key !== lastSpokenRef.current) {
          lastSpokenRef.current = key;
          speakFeedback(
            spokenFeedback(applied, currentStepOf(next)?.title ?? null),
          );
        }
      }
      if (next.status === 'done') stopWatching();
    } catch (error) {
      watchErrorsRef.current += 1;
      if (watchErrorsRef.current >= 3) {
        setStatus(
          `Watching stopped after repeated errors: ${errorMessage(error)}`,
        );
        stopWatching();
      } else {
        setStatus('That photo could not be checked — trying again…');
      }
    } finally {
      busyRef.current = false;
    }
  }, [
    camSource,
    commitSession,
    speakFeedback,
    stopWatching,
    takePhoto,
    vision,
    voiceOn,
  ]);

  const watchErrorsRef = useRef(0);
  const tickRef = useRef(runWatchTick);
  useEffect(() => {
    tickRef.current = runWatchTick;
  }, [runWatchTick]);

  // On mount: load the demo plan only in simulation. A real provider is
  // never asked to "read" a non-existent photo, and no fake kit appears.
  useEffect(() => {
    if (!settingsReady) return;
    if (!(vision instanceof MockProjectVision)) {
      const timer = setTimeout(
        () =>
          setStatus(
            'Photograph your instruction sheet, or scan its QR code, to begin.',
          ),
        0,
      );
      return () => clearTimeout(timer);
    }
    let cancelled = false;
    void (async () => {
      try {
        const plan = await vision.parseInstructions(null);
        if (cancelled) return;
        commitSession(createSession(plan));
        setStatus('Project loaded. Watch the build or step through manually.');
      } catch (error) {
        if (cancelled) return;
        setStatus(
          `Could not load a project automatically: ${errorMessage(error)} Photograph the instruction sheet to begin.`,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [commitSession, settingsReady, vision]);

  useEffect(() => {
    if (!slideshow || slideshow.length === 0) return;
    const timer = setInterval(
      () => setSlideshowIndex((i) => (i + 1) % slideshow.length),
      2500,
    );
    return () => clearInterval(timer);
  }, [slideshow]);

  // Watching stops on done inside the tick / Next handlers; never leak
  // the interval timer on unmount.
  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      deactivateKeepAwake();
      try {
        Speech.stop();
      } catch {
        // Nothing speaking.
      }
      void metaAdapter.stop().catch(() => {});
    },
    [metaAdapter],
  );

  const beginWatching = () => {
    setWatching(true);
    void activateKeepAwakeAsync().catch(() => {});
    setStatus('Watching your build every 3s…');
    timerRef.current = setInterval(() => {
      void tickRef.current();
    }, 3000);
    void tickRef.current();
  };

  const startWatching = () => {
    if (povRecording) {
      setStatus('Finish the POV clip first — one camera, one job.');
      return;
    }
    const state = sessionRef.current;
    if (!state || state.status === 'done' || timerRef.current) return;
    if (camSource === 'glasses' && !glassesOn) {
      setStatus('Connecting to your glasses…');
      void (async () => {
        if (await startGlasses()) beginWatching();
      })();
      return;
    }
    beginWatching();
  };

  const switchCamSource = async () => {
    if (camSource === 'glasses') {
      setCamSource('phone');
      await stopGlasses();
      setStatus('Using the phone camera.');
      return;
    }
    setCamSource('glasses');
    setStatus('Connecting to your glasses…');
    if (await startGlasses()) {
      setStatus(
        'Looking through your glasses. Photograph the sheet, or tap "Watch my build" and I will check your work as you go.',
      );
    } else {
      setCamSource('phone');
    }
  };

  const handleQrScanned = (data: string) => {
    if (qrHandledRef.current) return;
    qrHandledRef.current = true;
    setQrScanning(false);
    const url = extractUrl(data);
    if (!url) {
      // Never echo QR contents: codes can carry Wi-Fi passwords or secrets.
      setStatus(
        'That QR code is not a document link, so I ignored it. (QR contents are never shown — they can contain passwords.)',
      );
      return;
    }
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      // Keep the raw URL as the label.
    }
    setPdfPendingUrl(null);
    setQrPreview(null);
    setQrPendingUrl(url);
    setStatus(
      `QR code for ${host}. Ask a grown-up first — loading it replaces the build you are working on.`,
    );
  };

  const confirmQrLoad = () => {
    const url = qrPendingUrl;
    if (!url) return;
    setQrPendingUrl(null);
    setStatus('Fetching the instructions…');
    void (async () => {
      try {
        const result = await loadOfficialDocument(url);
        if (result.kind === 'plan') {
          // Preview before committing: a fetched page is not always a
          // manual (store pages and link hubs parse into junk "steps").
          // The build in progress is only replaced after a second,
          // informed confirmation.
          setQrPreview({ plan: result.plan, host: result.host });
          setStatus(
            `Fetched "${result.plan.title}" (${result.plan.steps.length} steps) from ${result.host}. Check the steps look right, then load them — or cancel and keep your build.`,
          );
        } else if (result.kind === 'pdf') {
          setPdfPendingUrl(result.url);
          setStatus(
            'That link is a PDF file. Ask a grown-up before opening it in the browser.',
          );
        } else {
          setStatus(
            'Fetched the linked page, but no instruction steps were found in it. Try photographing the sheet instead.',
          );
        }
      } catch (error) {
        setStatus(`Could not fetch the QR document: ${errorMessage(error)}`);
      }
    })();
  };

  const commitQrPreview = () => {
    if (!qrPreview) return;
    const { plan, host } = qrPreview;
    setQrPreview(null);
    stopWatching();
    commitSession(createSession(plan));
    setAnswer(null);
    setPartResult(null);
    setStatus(
      `Instructions loaded from ${host}: "${plan.title}" (${plan.steps.length} steps). Follow the step below — or tap "Watch my build" and I will check your work as you go.`,
    );
  };

  const cancelQrPreview = () => {
    setQrPreview(null);
    setStatus('Those instructions were not loaded. Your build is unchanged.');
  };

  const toggleQrScanning = () => {
    if (!permission?.granted) {
      setStatus(
        'Camera permission is needed to scan a QR code — tap "Grant camera permission" above first.',
      );
      return;
    }
    if (camSource === 'glasses') {
      // Barcodes are read by the phone camera; the glasses feed has no
      // scanner. Switch back so the sheet's code can be aimed at it.
      setCamSource('phone');
      void stopGlasses();
    }
    qrHandledRef.current = false;
    setQrScanning((prev) => !prev);
    setStatus(
      qrScanning
        ? 'QR scanning off.'
        : 'Point the camera at the QR code on the instruction sheet…',
    );
  };

  const photographSheet = async () => {
    if (camSource === 'glasses') {
      if (!glassesOn) {
        setStatus(
          'Your glasses camera is not on yet — tap "Use my glasses camera" above, then try again.',
        );
        return;
      }
    } else if (!permission?.granted) {
      setStatus(
        'Camera permission is needed to photograph the sheet — tap "Grant camera permission" above, then try again. (No demo sheet was loaded.)',
      );
      return;
    }
    stopWatching();
    setParsing(true);
    try {
      const photoUri = await takePhoto();
      if (!photoUri) {
        setStatus(
          'The camera was not ready, so no photo was taken. Wait a second and tap "Photograph instruction sheet" again.',
        );
        return;
      }
      const plan = await vision.parseInstructions(photoUri);
      commitSession(createSession(plan));
      setQrPreview(null);
      setAnswer(null);
      setPartResult(null);
      setStatus(
        photoUri
          ? 'Instruction sheet read. Follow the steps below.'
          : 'Demo project loaded. Follow the steps below.',
      );
    } catch (error) {
      setStatus(`Could not read the instruction sheet: ${errorMessage(error)}`);
    } finally {
      setParsing(false);
    }
  };

  const goNext = () => {
    if (watching || busy) return;
    const state = sessionRef.current;
    if (!state || state.status === 'done') return;
    const next = applyCheck(state, MANUAL_STEP_CHECK);
    commitSession(next);
    if (voiceOn) {
      lastSpokenRef.current = `${next.currentStep}:manual`;
      speakFeedback(
        spokenFeedback(MANUAL_STEP_CHECK, currentStepOf(next)?.title ?? null),
      );
    }
    if (next.status === 'done') stopWatching();
  };

  const goPrev = () => {
    const state = sessionRef.current;
    if (!state) return;
    commitSession(previousStep(state));
  };

  const findPart = async () => {
    if (busy) return;
    const part = partQuery.trim();
    if (!part) {
      setPartResult('Not seen yet');
      return;
    }
    setBusy('find');
    try {
      const seen = await eventsSeeing(part);
      const latest = seen[0];
      if (latest) {
        const match = latest.objects.find(
          (o) => nameMatches(part, o.name),
        );
        const time = new Date(latest.ts).toLocaleTimeString();
        if (match?.place) {
          setPartResult(`Last seen: ${match.place} at ${time}`);
        } else {
          setPartResult(answerWhere(await listEvents(200), part));
        }
        return;
      }
      const where = answerWhere(await listEvents(200), part);
      setPartResult(where.includes("haven't seen") ? 'Not seen yet' : where);
    } catch {
      setPartResult('Not seen yet');
    } finally {
      setBusy(null);
    }
  };

  const askQuestion = async () => {
    if (busy) return;
    const text = question.trim();
    if (!text) {
      setAnswer('Type a question first.');
      return;
    }
    const state = sessionRef.current;
    const step = state ? currentStepOf(state) : null;
    if (!step) {
      setAnswer('The build is complete — there is no current step.');
      return;
    }
    setBusy('ask-step');
    try {
      const reply = await vision.ask(text, step);
      setAnswer(
        `${reply}

(An idea from the AI, not checked by the app. Ask an adult before using tools, screws, or wires.)`,
      );
    } catch (error) {
      setAnswer(`Could not answer: ${errorMessage(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const togglePovRecord = () => {
    if (camSource === 'glasses') {
      setPovStatus(
        'POV clips use the phone camera — tap "Use phone camera" above first.',
      );
      return;
    }
    if (watching) {
      setPovStatus(
        'Stop watching the build first — the camera can only do one job at a time.',
      );
      return;
    }
    const camera = cameraRef.current;
    if (!camera) {
      setPovStatus('POV clips need camera permission.');
      return;
    }
    if (povRecording) {
      camera.stopRecording();
      return;
    }
    setPovRecording(true);
    setPovStatus('Recording a POV clip (max 8s)… tap again to stop.');
    povPromiseRef.current = camera
      .recordAsync({ maxDuration: 8 })
      .then((result) => {
        setPovRecording(false);
        if (result?.uri) {
          setPovClips((prev) => [...prev, { uri: result.uri, ts: Date.now() }]);
          setPovStatus('POV clip saved.');
        }
        return result as { uri: string };
      })
      .catch((error: unknown) => {
        setPovRecording(false);
        const message = error instanceof Error ? error.message : String(error);
        setPovStatus(`POV recording failed: ${message}`);
        throw error;
      });
  };

  const buildPovTimelapse = async () => {
    if (busy) return;
    const jobs = createVideoJobs(
      appSettings.visionSource === 'backend'
        ? appSettings.visionApiUrl
        : undefined,
    );
    if (povClips.length === 0) {
      setPovStatus('Record at least one POV clip first.');
      return;
    }
    if (!jobs) {
      const memories = await listEvents(200);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const photos = memories
        .filter((e) => e.photoUri !== null && e.ts >= todayStart.getTime())
        .slice(0, 12)
        .map((e) => e.photoUri as string);
      if (photos.length === 0) {
        setPovStatus(
          'No photos from today to show yet — kept photos appear here as a slideshow (the video itself needs the backend).',
        );
        return;
      }
      setSlideshow(photos);
      setSlideshowIndex(0);
      setPovStatus(
        'Showing today’s kept photos as a slideshow. (The timelapse video needs the vision backend.)',
      );
      return;
    }
    setBusy('timelapse');
    try {
      setPovStatus('Building POV timelapse on the server…');
      const items: TimelapseItem[] = [];
      for (const clip of povClips) {
        items.push({
          kind: 'video',
          base64: await new File(clip.uri).base64(),
          ts: clip.ts,
        });
      }
      const memories = await listEvents(200);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const photos = memories
        .filter((e) => e.photoUri !== null && e.ts >= today.getTime())
        .slice(0, 12);
      for (const e of photos) {
        items.push({
          kind: 'image',
          base64: await new File(e.photoUri as string).base64(),
          ts: e.ts,
        });
      }
      const videoBase64 = await jobs.timelapse(items);
      const dir = new Directory(Paths.cache, 'videos');
      if (!dir.exists) {
        try {
          dir.create();
        } catch {
          // Already present.
        }
      }
      const out = new File(dir, `timelapse-${Date.now()}.mp4`);
      if (!out.exists) out.create();
      await out.write(base64ToBytes(videoBase64));
      setPovVideoUri(out.uri);
      setPovStatus('POV timelapse ready.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPovStatus(`Timelapse failed (${message}) — slideshow fallback.`);
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

  const step = session ? currentStepOf(session) : null;
  const progress = session ? stepProgress(session) : { done: 0, total: 0 };
  const check = session?.lastCheck ?? null;
  const isDone = session?.status === 'done';
  const model = useMemo(
    () => (session ? buildStepModel(session.plan, session.currentStep) : null),
    [session],
  );

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
            <Text style={styles.heading}>
              {session ? session.plan.title : 'Let’s build it'}
            </Text>
            <Text style={styles.sub}>{status}</Text>

            {camSource === 'glasses' ? (
              <View style={styles.cameraPlaceholder}>
                <Text style={styles.placeholderText}>
                  {glassesOn
                    ? 'Looking through your glasses — what they see is checked while you build.'
                    : 'Glasses camera is off — it connects when you photograph the sheet or watch your build.'}
                </Text>
              </View>
            ) : permission?.granted ? (
              <CameraView
                ref={cameraRef}
                style={styles.camera}
                facing={facing}
                mute={appSettings.muteCameraSounds}
                pictureSize={pictureSize}
                onCameraReady={onCameraReady}
                barcodeScannerSettings={
                  qrScanning ? { barcodeTypes: ['qr'] } : undefined
                }
                onBarcodeScanned={
                  qrScanning
                    ? (event) => handleQrScanned(event.data)
                    : undefined
                }
              />
            ) : (
              <View style={styles.cameraPlaceholder}>
                <Text style={styles.placeholderText}>
                  No camera yet — Project mode runs in simulation.
                </Text>
                <UIButton
                  title="Grant camera permission"
                  variant="secondary"
                  onPress={() => void requestPermission()}
                />
              </View>
            )}

            <UIButton
              title={
                camSource === 'phone'
                  ? 'Use my glasses camera'
                  : 'Use phone camera'
              }
              variant="secondary"
              disabled={watching || povRecording || parsing}
              onPress={() => void switchCamSource()}
            />
            {camSource === 'phone' && permission?.granted ? (
              <UIButton
                title={
                  facing === 'back'
                    ? 'Flip to front camera'
                    : 'Flip to back camera'
                }
                variant="secondary"
                disabled={watching || povRecording}
                onPress={() => {
                  // Picture sizes differ per lens; re-pick on next ready.
                  setPictureSize(undefined);
                  setFacing((prev) => (prev === 'back' ? 'front' : 'back'));
                }}
              />
            ) : null}
            <UIButton
              title="Photograph instruction sheet"
              loading={parsing}
              disabled={parsing || watching || busy !== null}
              onPress={() => void photographSheet()}
            />
            <UIButton
              title={
                qrScanning
                  ? 'Stop QR scanning'
                  : 'Scan QR code for official instructions'
              }
              variant="secondary"
              disabled={parsing || watching || busy !== null}
              onPress={toggleQrScanning}
            />
            {qrPendingUrl ? (
              <>
                <UIButton
                  title="Load these instructions"
                  onPress={confirmQrLoad}
                />
                <UIButton
                  title="Cancel — keep my build"
                  variant="secondary"
                  onPress={() => {
                    setQrPendingUrl(null);
                    setStatus('QR code ignored. Your build is unchanged.');
                  }}
                />
              </>
            ) : null}
            {pdfPendingUrl ? (
              <>
                <UIButton
                  title="Open the PDF in my browser"
                  onPress={() => {
                    const target = pdfPendingUrl;
                    setPdfPendingUrl(null);
                    if (target) void Linking.openURL(target).catch(() => {});
                  }}
                />
                <UIButton
                  title="Cancel"
                  variant="secondary"
                  onPress={() => {
                    setPdfPendingUrl(null);
                    setStatus('PDF not opened.');
                  }}
                />
              </>
            ) : null}
            {qrPreview ? (
              <View style={styles.card}>
                <Text style={styles.stepLabel}>
                  From {qrPreview.host} — {qrPreview.plan.steps.length} steps
                </Text>
                <Text style={styles.stepTitle}>{qrPreview.plan.title}</Text>
                {qrPreview.plan.steps.slice(0, 10).map((s, i) => (
                  <Text key={`${i}-${s.title}`} style={styles.instruction}>
                    {i + 1}. {s.title}
                  </Text>
                ))}
                {qrPreview.plan.steps.length > 10 ? (
                  <Text style={styles.hint}>
                    …and {qrPreview.plan.steps.length - 10} more steps.
                  </Text>
                ) : null}
                <UIButton
                  title="Load these instructions"
                  onPress={commitQrPreview}
                />
                <UIButton
                  title="Cancel — keep my build"
                  variant="secondary"
                  onPress={cancelQrPreview}
                />
              </View>
            ) : null}

      {session && step ? (
        <View style={styles.card}>
          <Text style={styles.stepLabel}>
            Step {session.currentStep + 1} of {progress.total}
          </Text>
          <Text style={styles.stepTitle}>{step.title}</Text>
          <View style={styles.parts}>
            {step.parts.map((p) => (
              <Text key={p} style={styles.part}>
                {p}
              </Text>
            ))}
          </View>
          <Text style={styles.instruction}>{step.instruction}</Text>
          {tabFocused && model && model.parts.length > 0 ? (
            <StepModelView model={model} />
          ) : null}
          <Text style={styles.hint}>
            Progress: {progress.done} of {progress.total} steps done
          </Text>
        </View>
      ) : session ? (
        <View style={styles.card}>
          <Text style={styles.stepLabel}>Done</Text>
          <Text style={styles.stepTitle}>All steps complete</Text>
          <Text style={styles.instruction}>
            Nice work — the build is finished.
          </Text>
          {tabFocused && model && model.parts.length > 0 ? (
            <StepModelView model={model} />
          ) : null}
          <Text style={styles.hint}>
            Progress: {progress.done} of {progress.total} steps done
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.stepTitle}>Loading project…</Text>
          <Text style={styles.hint}>
            Photograph an instruction sheet if loading does not finish.
          </Text>
        </View>
      )}

      {check?.verdict === 'complete' ? (
        <View style={[styles.banner, styles.bannerComplete]}>
          <Text style={styles.bannerTextComplete}>
            {check.detail.startsWith('Marked done by you')
              ? check.detail
              : 'Step complete — nice work.'}
          </Text>
        </View>
      ) : check?.verdict === 'mistake' ? (
        <View style={[styles.banner, styles.bannerMistake]}>
          <Text style={styles.bannerTextMistake}>
            {check.detail || 'Something looks wrong on this step.'}
          </Text>
        </View>
      ) : check?.verdict === 'unclear' ? (
        <View style={[styles.banner, styles.bannerUnclear]}>
          <Text style={styles.bannerTextUnclear}>
            {check.detail || 'I cannot see this step clearly.'}
          </Text>
          <Text style={styles.bannerTextUnclear}>
            Hold the phone closer — show a close-up of this step.
          </Text>
        </View>
      ) : null}

      <View style={styles.nav}>
        <View style={styles.navButton}>
          <UIButton
            title="Back"
            variant="secondary"
            disabled={
              watching ||
              !session ||
              (session.currentStep === 0 && !isDone)
            }
            onPress={goPrev}
          />
        </View>
        <View style={styles.navButton}>
          <UIButton
            title={isDone ? 'Done' : 'Next step'}
            variant="secondary"
            disabled={!session || isDone || watching || busy !== null}
            onPress={goNext}
          />
        </View>
      </View>

      <UIButton
        title={watching ? 'Stop watching' : 'Watch my build'}
        variant={watching ? 'danger' : 'primary'}
        disabled={!session || isDone}
        onPress={watching ? stopWatching : startWatching}
      />
      <UIButton
        title={voiceOn ? 'Voice feedback: on' : 'Voice feedback: off'}
        variant="secondary"
        onPress={() => {
          if (voiceOn) {
            try {
              Speech.stop();
            } catch {
              // Nothing speaking.
            }
          }
          setVoiceOn((value) => !value);
        }}
      />

      <Section title="Find a part">
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.flex]}
            placeholder="e.g. screw, cable tray"
            value={partQuery}
            onChangeText={setPartQuery}
            returnKeyType="search"
            onSubmitEditing={() => void findPart()}
          />
          <UIButton
            title="Find"
            variant="secondary"
            loading={busy === 'find'}
            disabled={busy !== null}
            onPress={() => void findPart()}
          />
        </View>
        {partResult ? <Text style={styles.answer}>{partResult}</Text> : null}
      </Section>

      <Section title="Ask about this step">
        <TextInput
          style={styles.input}
          placeholder="e.g. Which screw goes here?"
          value={question}
          onChangeText={setQuestion}
          returnKeyType="send"
          onSubmitEditing={() => void askQuestion()}
        />
        <UIButton
          title="Ask"
          loading={busy === 'ask-step'}
          disabled={busy !== null}
          onPress={() => void askQuestion()}
        />
        {answer ? <Text style={styles.answer}>{answer}</Text> : null}
      </Section>

      <Section
        title="POV build recap"
        hint="Record POV clips while you build, then stitch clips + today’s photos into a timelapse (server) or slideshow."
      >
        <UIButton
          title={povRecording ? 'Stop POV clip' : 'Record POV clip'}
          variant={povRecording ? 'danger' : 'primary'}
          disabled={!session}
          onPress={togglePovRecord}
        />
        <Text style={styles.hint}>{povClips.length} POV clips recorded</Text>
        <UIButton
          title="Build POV timelapse"
          variant="secondary"
          loading={busy === 'timelapse'}
          disabled={povClips.length === 0 || busy !== null}
          onPress={() => void buildPovTimelapse()}
        />
        {povStatus ? <Text style={styles.answer}>{povStatus}</Text> : null}
        {povVideoUri ? <VideoPlayer uri={povVideoUri} /> : null}
        {slideshow && slideshow.length > 0 ? (
          <>
            <Image
              source={{ uri: slideshow[slideshowIndex % slideshow.length] }}
              style={styles.slideshowImage}
              accessibilityLabel="Slideshow of today's kept photos"
            />
            <UIButton
              title="Stop slideshow"
              variant="secondary"
              onPress={() => setSlideshow(null)}
            />
          </>
        ) : null}
      </Section>
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
  sub: { color: t.textMuted },
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
  card: {
    backgroundColor: t.card,
    borderRadius: 12,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: t.border,
  },
  stepLabel: { color: t.accent, fontWeight: '700', fontSize: 18 },
  stepTitle: { fontSize: 22, fontWeight: '800', color: t.text },
  parts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  part: {
    backgroundColor: t.accentSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  instruction: { fontSize: 17, lineHeight: 24, color: t.text },
  hint: { color: t.textSub, fontSize: 13 },
  banner: { borderRadius: 8, padding: 10, gap: 4 },
  bannerComplete: { backgroundColor: t.successBg },
  bannerTextComplete: { color: t.successText, fontWeight: '600' },
  bannerMistake: { backgroundColor: t.dangerBg },
  bannerTextMistake: { color: t.dangerText, fontWeight: '600' },
  bannerUnclear: { backgroundColor: t.warnBg },
  bannerTextUnclear: { color: t.warnText, fontWeight: '600' },
  nav: { flexDirection: 'row', gap: 8 },
  navButton: { flex: 1 },
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
  slideshowImage: { width: '100%', height: 240, borderRadius: 16 },
  answer: { backgroundColor: t.infoBg, borderRadius: 12, padding: 12, color: t.text, fontSize: 15, lineHeight: 21 },
});

