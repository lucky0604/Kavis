import { useSceneStore } from '../../../stores/app-stores';
import styles from './WelcomeScene.module.css';

export function WelcomeScene() {
  const { navigate } = useSceneStore();

  return (
    <div className={styles.welcome}>
      <div className={styles.hero}>
        <div className={styles.brand}>Janus</div>
        <p className={styles.tagline}>
          An AI workspace that reads, writes, and operates on your local projects.
        </p>
      </div>

      <div className={styles.features}>
        <div className={styles.feature}>
          <span className={styles.featureIcon}>◆</span>
          <div>
            <h3>Analyze codebases</h3>
            <p>Read files, search patterns, understand project structure</p>
          </div>
        </div>
        <div className={styles.feature}>
          <span className={styles.featureIcon}>⚡</span>
          <div>
            <h3>Plan features</h3>
            <p>Design architecture, break down tasks, estimate effort</p>
          </div>
        </div>
        <div className={styles.feature}>
          <span className={styles.featureIcon}>→</span>
          <div>
            <h3>Execute tasks</h3>
            <p>Write files, run commands, check git status</p>
          </div>
        </div>
      </div>

      <button className={styles.cta} onClick={() => navigate('chat')}>
        Start with Work Mode
      </button>
    </div>
  );
}
