import { useSceneStore, useThemeStore } from '../../stores/app-stores';
import styles from './NavBar.module.css';

const iconMap: Record<string, string> = {
  chat: '💬',
  agents: '◆',
  settings: '⚙',
};

// Minimal SVG icons substitute
function NavIcon({ scene, active }: { scene: string; active: boolean }) {
  return (
    <button
      className={`${styles.navButton} ${active ? styles.navButtonActive : ''}`}
      onClick={() => useSceneStore.getState().navigate(scene as 'chat' | 'agents' | 'settings')}
      title={scene}
    >
      <span className={styles.icon}>{iconMap[scene] || '?'}</span>
    </button>
  );
}

export function NavBar() {
  const { currentScene } = useSceneStore();
  const { theme, toggle } = useThemeStore();

  return (
    <nav className={styles.navbar}>
      <div className={styles.navTop}>
        <NavIcon scene="chat" active={currentScene === 'chat'} />
        <NavIcon scene="agents" active={currentScene === 'agents'} />
      </div>
      <div className={styles.navBottom}>
        <NavIcon scene="settings" active={currentScene === 'settings'} />
        <button className={styles.navButton} onClick={toggle} title="Toggle theme">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
    </nav>
  );
}
