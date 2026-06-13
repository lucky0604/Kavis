import { ModeSelector } from '../chat/ModeSelector';
import styles from './CodeModeHeader.module.css';

export function CodeModeHeader() {
  return (
    <div className={styles.header}>
      <ModeSelector />
    </div>
  );
}
