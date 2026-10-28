import { CameraView, useCameraPermissions } from 'expo-camera';
import { Directory, File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import StepModelView from '@/components/StepModelView';
import VideoPlayer from '@/components/VideoPlayer';
import { eventsSeeing, listEvents } from '@/services/memoryStore';
import {
  applyCheck,
  createSession,
  currentStepOf,
  MANUAL_STEP_CHECK,
  previousStep,
  stepProgress,
  type ProjectSessionState,
} from '@/services/projectSession';
import { answerWhere } from '@/services/scenarios';
import { buildStepModel } from '@/services/stepModel';
import {
  base64ToBytes,
  createVideoJobs,
  type TimelapseItem,
} from '@/services/videoJobs';
import {
  createProjectVision,
  type ProjectVision,
} from '@/services/vision/projectVision';

// Live Project mode: parse an instruction sheet into steps, watch the
// build with the camera (or simulated frames without one), find parts in
// memory, and answer questions about the current step. Session state from
// projectSession.ts is the single source of truth for step position.

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function ProjectScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [pictureSize, setPictureSize] = useState<string | undefined>();

  const [vision] = useState<ProjectVision>(() => createProjectVision());
  const [session, setSession] = useState<ProjectSessionState | null>(null);
  const [status, setStatus] = useState(
    'Loading project. Simulation runs without a camera.',
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
  const [povStatus, setPovStatus] = useState<string | null>(null);
  const povPromiseRef = useRef<Promise<{ uri: string }> | null>(null);

  const sessionRef = useRef<ProjectSessionState | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const busyRef = useRef(false);

  const commitSession = useCallback((next: ProjectSessionState) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const takePhoto = useCallback(async (): Promise<string | null> => {
    if (!permission?.granted || !cameraRef.current) return null;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.35 });
      return photo.uri;
    } catch {
      return null;
    }
  }, [permission?.granted]);

  const stopWatching = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setWatching(false);
  }, []);

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
      const check = await vision.checkStep(photoUri, step);
      const fresh = sessionRef.current;
      // Ignore a verdict for a step the user has already moved away from.
      if (!fresh || fresh.currentStep !== stepIndex || fresh.status === 'done') {
        return;
      }
      const next = applyCheck(fresh, check);
      commitSession(next);
      if (next.status === 'done') stopWatching();
    } catch (error) {
      setStatus(`Watch error: ${errorMessage(error)}`);
      stopWatching();
    } finally {
      busyRef.current = false;
    }
  }, [commitSession, stopWatching, takePhoto, vision]);

  const tickRef = useRef(runWatchTick);
  useEffect(() => {
    tickRef.current = runWatchTick;
  }, [runWatchTick]);

  // On mount: load the plan (null = simulated sheet) and start a session.
  useEffect(() => {
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
  }, [commitSession, vision]);

  // Watching stops on done inside the tick / Next handlers; never leak
  // the interval timer on unmount.
  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
    },
    [],
  );

  const startWatching = () => {
    const state = sessionRef.current;
    if (!state || state.status === 'done' || timerRef.current) return;
    setWatching(true);
    setStatus('Watching your build every 3s…');
    timerRef.current = setInterval(() => {
      void tickRef.current();
    }, 3000);
    void tickRef.current();
  };

  const photographSheet = async () => {
    stopWatching();
    setParsing(true);
    try {
      const photoUri = permission?.granted ? await takePhoto() : null;
      const plan = await vision.parseInstructions(photoUri);
      commitSession(createSession(plan));
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
    const state = sessionRef.current;
    if (!state || state.status === 'done') return;
    const next = applyCheck(state, MANUAL_STEP_CHECK);
    commitSession(next);
    if (next.status === 'done') stopWatching();
  };

  const goPrev = () => {
    const state = sessionRef.current;
    if (!state) return;
    commitSession(previousStep(state));
  };

  const findPart = async () => {
    const part = partQuery.trim();
    if (!part) {
      setPartResult('Not seen yet');
      return;
    }
    try {
      const seen = await eventsSeeing(part);
      const latest = seen[0];
      if (latest) {
        const match = latest.objects.find(
          (o) => o.name.trim().toLowerCase() === part.toLowerCase(),
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
    }
  };

  const askQuestion = async () => {
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
    try {
      setAnswer(await vision.ask(text, step));
    } catch (error) {
      setAnswer(`Could not answer: ${errorMessage(error)}`);
    }
  };

  const togglePovRecord = () => {
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
    const jobs = createVideoJobs();
    if (povClips.length === 0) {
      setPovStatus('Record at least one POV clip first.');
      return;
    }
    if (!jobs) {
      setPovStatus(
        'Slideshow only: no backend configured for timelapse rendering.',
      );
      return;
    }
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

  const step = session ? currentStepOf(session) : null;
  const progress = session ? stepProgress(session) : { done: 0, total: 0 };
  const check = session?.lastCheck ?? null;
  const isDone = session?.status === 'done';
  const model = useMemo(
    () => (session ? buildStepModel(session.plan, session.currentStep) : null),
    [session],
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>
        {session ? session.plan.title : 'IKEA-style guided build'}
      </Text>
      <Text style={styles.sub}>{status}</Text>

      {permission?.granted ? (
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
            No camera yet — Project mode runs in simulation.
          </Text>
          <Button title="Grant camera permission" onPress={requestPermission} />
        </View>
      )}

      <Button
        title="Photograph instruction sheet"
        disabled={parsing}
        onPress={() => void photographSheet()}
      />

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
          {model && model.parts.length > 0 ? (
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
          {model && model.parts.length > 0 ? (
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
          <Text style={styles.bannerTextComplete}>Step complete — nice work.</Text>
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
        <Button
          title="Back"
          disabled={
            watching ||
            !session ||
            (session.currentStep === 0 && !isDone)
          }
          onPress={goPrev}
        />
        <Button
          title={isDone ? 'Done' : 'Next step'}
          disabled={!session || isDone}
          onPress={goNext}
        />
      </View>

      <Pressable
        style={[styles.watchButton, watching && styles.watchButtonStop]}
        disabled={!session || isDone}
        onPress={watching ? stopWatching : startWatching}
      >
        <Text style={styles.watchButtonText}>
          {watching ? 'Stop watching' : 'Watch my build'}
        </Text>
      </Pressable>

      <Text style={styles.label}>Find a part</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.flex]}
          placeholder="e.g. screw, cable tray"
          value={partQuery}
          onChangeText={setPartQuery}
        />
        <Button title="Find" onPress={() => void findPart()} />
      </View>
      {partResult ? <Text style={styles.answer}>{partResult}</Text> : null}

      <Text style={styles.label}>Ask about this step</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Which screw goes here?"
        value={question}
        onChangeText={setQuestion}
      />
      <Pressable style={styles.askButton} onPress={() => void askQuestion()}>
        <Text style={styles.askButtonText}>Ask</Text>
      </Pressable>
      {answer ? <Text style={styles.answer}>{answer}</Text> : null}

      <Text style={styles.label}>POV build recap</Text>
      <Text style={styles.hint}>
        Record POV clips while you build, then stitch clips + today’s
        photos into a timelapse (server) or slideshow.
      </Text>
      <Pressable
        style={[styles.watchButton, povRecording && styles.watchButtonStop]}
        disabled={!session}
        onPress={togglePovRecord}
      >
        <Text style={styles.watchButtonText}>
          {povRecording ? 'Stop POV clip' : 'Record POV clip'}
        </Text>
      </Pressable>
      <Text style={styles.hint}>{povClips.length} POV clips recorded</Text>
      <Button
        title="Build POV timelapse"
        disabled={povClips.length === 0}
        onPress={() => void buildPovTimelapse()}
      />
      {povStatus ? <Text style={styles.answer}>{povStatus}</Text> : null}
      {povVideoUri ? <VideoPlayer uri={povVideoUri} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  heading: { fontSize: 22, fontWeight: '700' },
  sub: { color: '#555' },
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
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: '#e3e3e3',
  },
  stepLabel: { color: '#0a6cff', fontWeight: '700', fontSize: 18 },
  stepTitle: { fontSize: 20, fontWeight: '700' },
  parts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  part: {
    backgroundColor: '#eef3ff',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  instruction: { fontSize: 16, lineHeight: 22 },
  hint: { color: '#666', fontSize: 13 },
  banner: { borderRadius: 8, padding: 10, gap: 4 },
  bannerComplete: { backgroundColor: '#e6f4ea' },
  bannerTextComplete: { color: '#137333', fontWeight: '600' },
  bannerMistake: { backgroundColor: '#ffe9e9' },
  bannerTextMistake: { color: '#8a1010', fontWeight: '600' },
  bannerUnclear: { backgroundColor: '#fff4d6' },
  bannerTextUnclear: { color: '#7a5200', fontWeight: '600' },
  nav: { flexDirection: 'row', justifyContent: 'space-between' },
  watchButton: {
    backgroundColor: '#0a6cff',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  watchButtonStop: { backgroundColor: '#c62828' },
  watchButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  label: { fontWeight: '600', marginTop: 8 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  flex: { flex: 1 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#fff',
  },
  askButton: {
    backgroundColor: '#0a6cff',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  askButtonText: { color: '#fff', fontWeight: '700' },
  answer: { backgroundColor: '#f2f7ff', borderRadius: 8, padding: 10 },
});

