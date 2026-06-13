import { useSceneStore } from '../../stores/app-stores';
import styles from './AppLayout.module.css';
import { NavBar } from './NavBar';
import { SceneArea } from './SceneArea';

export function AppLayout() {
  const { currentScene } = useSceneStore();

  if (currentScene === 'welcome') {
    return <SceneArea />;
  }

  if (currentScene === 'code_mode') {
    return (
      <div className={styles.layout}>
        <div className={styles.sceneContainer}>
          <SceneArea />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.layout}>
      <NavBar />
      <div className={styles.sceneContainer}>
        <SceneArea />
      </div>
    </div>
  );
}
