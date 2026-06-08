import { useSceneStore } from '../../stores/app-stores';
import styles from './AppLayout.module.css';
import { NavBar } from './NavBar';
import { SceneArea } from './SceneArea';

export function AppLayout() {
  const { currentScene } = useSceneStore();

  // Welcome scene is fullscreen onboarding — no NavBar
  if (currentScene === 'welcome') {
    return <SceneArea />;
  }

  // All other scenes (chat, agents, settings) show NavBar
  return (
    <div className={styles.layout}>
      <NavBar />
      <div className={styles.sceneContainer}>
        <SceneArea />
      </div>
    </div>
  );
}
