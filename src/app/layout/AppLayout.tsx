import { useSceneStore } from '../../stores/app-stores';
import styles from './AppLayout.module.css';
import { NavBar } from './NavBar';
import { SceneArea } from './SceneArea';

export function AppLayout() {
  const { currentScene } = useSceneStore();

  // Phase 1: Chat-only layout (no NavBar)
  if (currentScene === 'chat') {
    return <SceneArea />;
  }

  // Phase 3+: Full layout with NavBar
  return (
    <div className={styles.layout}>
      <NavBar />
      <SceneArea />
    </div>
  );
}
