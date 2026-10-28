import { Component, useRef, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber/native';
import * as THREE from 'three';
import {
  partMeshProps,
  type ModelPart,
  type StepModel,
} from '@/services/stepModel';

// Renders a StepModel (see src/services/stepModel.ts) as rotatable three.js
// primitives on an expo-gl surface. Thin by design: all mapping logic lives
// in the tested pure module; this file only turns descriptions into meshes.

function PartMesh({ part }: { part: ModelPart }) {
  const props = partMeshProps(part);
  const [a, b, c, d] = props.geometryArgs;
  return (
    <mesh position={part.position}>
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

function Rig({ model }: { model: StepModel }) {
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
      {model.parts.map((part) => (
        <PartMesh key={part.id} part={part} />
      ))}
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
  const r = model.radius;
  return (
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
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
          <planeGeometry args={[r * 5, r * 5]} />
          <meshStandardMaterial color="#1f2632" roughness={1} />
        </mesh>
        <Rig model={model} />
      </Canvas>
      </ModelErrorBoundary>
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
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  fallbackText: { color: '#9aa3b2', textAlign: 'center' },
});
