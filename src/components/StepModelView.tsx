import {
  Component,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber/native';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  describePart,
  partMeshProps,
  partRenderMode,
  type ModelPart,
  type StepModel,
} from '@/services/stepModel';

// Renders a StepModel (see src/services/stepModel.ts) as rotatable three.js
// primitives on an expo-gl surface. Thin by design: all mapping logic lives
// in the tested pure module; this file only turns descriptions into meshes.
// Drag rotates; tapping a part identifies it in the caption below (a drag
// travels far, a tap barely moves, so the two never fight). A part naming
// a GLTF model renders that model, with the primitive as fallback while
// it loads or if it fails — the preview must never break over one part.

interface PartViewProps {
  part: ModelPart;
  selected: boolean;
  onSelect: (id: string | null) => void;
}

function useTapSelect(onSelect: (id: string | null) => void, id: string) {
  return (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    // R3F reports drag distance in `delta`; only a near-still tap selects.
    if (event.delta <= 6) onSelect(id);
  };
}

function PartMesh({ part, selected, onSelect }: PartViewProps) {
  const props = partMeshProps(part, { selected });
  const [a, b, c, d] = props.geometryArgs;
  const onClick = useTapSelect(onSelect, part.id);
  return (
    <mesh position={part.position} onClick={onClick}>
      {part.kind === 'box' ? (
        <boxGeometry args={[a, b, c]} />
      ) : part.kind === 'cylinder' ? (
        <cylinderGeometry args={[a, b, c, d]} />
      ) : (
        <sphereGeometry args={[a, b, c]} />
      )}
      <meshStandardMaterial
        color={props.color}
        roughness={props.roughness}
        metalness={props.metalness}
        transparent={props.transparent}
        opacity={props.opacity}
        emissive={props.emissive}
        emissiveIntensity={props.emissiveIntensity}
      />
    </mesh>
  );
}

function GltfPart({ part, selected, onSelect }: PartViewProps) {
  // Keyed by uri so a stale load for a previous model is never rendered.
  const [loaded, setLoaded] = useState<{
    uri: string;
    scene: THREE.Object3D | null;
    failed: boolean;
  }>({ uri: '', scene: null, failed: false });
  const uri = part.modelUri;
  const onClick = useTapSelect(onSelect, part.id);

  useEffect(() => {
    let live = true;
    if (!uri) return;
    new GLTFLoader()
      .loadAsync(uri)
      .then((gltf) => {
        if (!live) return;
        const root = gltf.scene.clone(true);
        // Clone materials once so state styling never mutates the source.
        root.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.material = Array.isArray(mesh.material)
            ? mesh.material.map((m) => m.clone())
            : mesh.material.clone();
        });
        // Scale the model to the part's measured size and rest it on the
        // same ground point as the primitive it replaces.
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        const extent = Math.max(size.x, size.y, size.z) || 1;
        const target = Math.max(...part.size);
        const scale = target / extent;
        root.scale.setScalar(scale);
        root.position.set(
          part.position[0] - center.x * scale,
          -box.min.y * scale,
          part.position[2] - center.z * scale,
        );
        setLoaded({ uri, scene: root, failed: false });
      })
      .catch(() => {
        if (live) setLoaded({ uri, scene: null, failed: true });
      });
    return () => {
      live = false;
    };
  }, [uri, part]);

  const scene = loaded.uri === uri ? loaded.scene : null;
  const failed = loaded.uri === uri && loaded.failed;

  // State styling mutates the cloned materials only — no reload on select.
  useEffect(() => {
    if (!scene) return;
    const ghost = part.state === 'todo' && !selected;
    scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const m of materials as THREE.MeshStandardMaterial[]) {
        m.transparent = ghost;
        m.opacity = ghost ? 0.35 : 1;
        if (m.emissive) {
          m.emissive = new THREE.Color(selected ? '#ff8c1a' : '#000000');
          m.emissiveIntensity = selected ? 0.9 : 0;
        }
      }
    });
  }, [scene, part.state, selected]);

  if (!uri || failed || !scene) {
    return <PartMesh part={part} selected={selected} onSelect={onSelect} />;
  }
  return (
    <group onClick={onClick}>
      <primitive object={scene} />
    </group>
  );
}

function Rig({
  model,
  selectedId,
  onSelect,
}: {
  model: StepModel;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const dragging = useRef(false);
  const lastX = useRef(0);

  useFrame((_, delta) => {
    // Gentle auto-rotate when idle so the model reads as 3D at a glance.
    if (group.current && !dragging.current) {
      group.current.rotation.y += delta * 0.25;
    }
  });

  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    dragging.current = true;
    lastX.current = event.nativeEvent?.pageX ?? 0;
  };
  const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (!dragging.current || !group.current) return;
    const x = event.nativeEvent?.pageX ?? lastX.current;
    group.current.rotation.y += (x - lastX.current) * 0.01;
    lastX.current = x;
  };
  const onPointerUp = () => {
    dragging.current = false;
  };

  return (
    <group
      ref={group}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {model.parts.map((part) =>
        partRenderMode(part) === 'gltf' ? (
          <GltfPart
            key={part.id}
            part={part}
            selected={part.id === selectedId}
            onSelect={onSelect}
          />
        ) : (
          <PartMesh
            key={part.id}
            part={part}
            selected={part.id === selectedId}
            onSelect={onSelect}
          />
        ),
      )}
    </group>
  );
}

/** A failed 3D preview must never take down the Project screen. */
class ModelErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <View style={styles.fallback}>
          <Text style={styles.fallbackText}>
            3D preview unavailable on this device.
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function StepModelView({ model }: { model: StepModel }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const r = model.radius;
  const selectedPart =
    model.parts.find((p) => p.id === selectedId) ?? null;
  return (
    <View>
      <View style={styles.viewport}>
        <ModelErrorBoundary>
          <Canvas
            camera={{ position: [r * 0.9, r * 0.8, r * 1.35], fov: 50 }}
            onCreated={({ gl }) => {
              // Match the viewport behind the scene.
              gl.setClearColor('#141a24');
            }}
          >
            <color attach="background" args={['#141a24']} />
            <ambientLight intensity={0.7} />
            <directionalLight position={[5, 8, 4]} intensity={1.4} />
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, -0.01, 0]}
              onClick={(event: ThreeEvent<MouseEvent>) => {
                if (event.delta <= 6) setSelectedId(null);
              }}
            >
              <planeGeometry args={[r * 5, r * 5]} />
              <meshStandardMaterial color="#1f2632" roughness={1} />
            </mesh>
            <Rig
              model={model}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </Canvas>
        </ModelErrorBoundary>
      </View>
      <Text style={styles.caption}>
        {selectedPart
          ? describePart(selectedPart)
          : 'Drag to rotate · tap a part to identify it'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: {
    height: 220,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#141a24',
  },
  caption: {
    color: '#5b8def',
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  fallbackText: { color: '#9aa3b2', textAlign: 'center' },
});
