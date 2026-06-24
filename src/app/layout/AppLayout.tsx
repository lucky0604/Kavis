import { useSceneStore } from '../../stores/app-stores';
import styles from './AppLayout.module.css';
import { NavBar } from './NavBar';
import { SceneArea } from './SceneArea';

function TitleBar() {
  return (
    <div className={styles.titleBar}>
      <span className={styles.titleBarBrand}>Janus</span>
    </div>
  );
}

export function AppLayout() {
  const { currentScene } = useSceneStore();

  if (currentScene === 'welcome') {
    return (
      <div className={styles.root}>
        <TitleBar />
        <div className={styles.sceneContainer}>
          <SceneArea />
        </div>
      </div>
    );
  }

  if (currentScene === 'code_mode') {
    return (
      <div className={styles.root}>
        <TitleBar />
        <div className={styles.layout}>
          <div className={styles.sceneContainer}>
            <SceneArea />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <TitleBar />
      <div className={styles.layout}>
        <NavBar />
        <div className={styles.sceneContainer}>
          <SceneArea />
        </div>
      </div>
    </div>
  );
}
