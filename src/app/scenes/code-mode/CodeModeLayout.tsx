import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useLayoutStore } from '../../../stores/app-stores';
import styles from './CodeModeLayout.module.css';

const MIN_SIDEBAR = 200;
const MIN_INSPECTOR = 300;
const MIN_CHAT = 400;

interface Props {
  sidebar?: ReactNode;
  chat: ReactNode;
  inspector?: ReactNode;
}

export function CodeModeLayout({ sidebar, chat, inspector }: Props) {
  const { sidebarWidth, inspectorWidth, setSidebarWidth, setInspectorWidth } =
    useLayoutStore();

  const layoutRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null);

  const showSidebar = sidebar != null;
  const showInspector = inspector != null;

  const onMouseDown = useCallback(
    (edge: 'left' | 'right') => (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(edge);

      const startX = e.clientX;
      const startSidebar = sidebarWidth;
      const startInspector = inspectorWidth;

      const onMove = (ev: MouseEvent) => {
        const container = layoutRef.current;
        if (!container) return;
        const totalW = container.offsetWidth;
        const dx = ev.clientX - startX;

        if (edge === 'left') {
          const next = Math.max(MIN_SIDEBAR, startSidebar + dx);
          const maxSidebar = totalW - MIN_CHAT - inspectorWidth;
          setSidebarWidth(Math.min(next, maxSidebar));
        } else {
          const next = Math.max(MIN_INSPECTOR, startInspector - dx);
          const maxInspector = totalW - MIN_CHAT - sidebarWidth;
          setInspectorWidth(Math.min(next, maxInspector));
        }
      };

      const onUp = () => {
        setDragging(null);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [sidebarWidth, inspectorWidth, setSidebarWidth, setInspectorWidth],
  );

  return (
    <div
      ref={layoutRef}
      className={styles.threePaneLayout}
      style={{ cursor: dragging ? 'col-resize' : undefined }}
    >
      {/* Sidebar — only rendered when non-null content provided */}
      {showSidebar && (
        <div className={styles.sidebar} style={{ width: sidebarWidth }}>
          <div className={styles.sidebarHeader}>Relay Log</div>
          <div className={styles.sidebarContent}>{sidebar}</div>
        </div>
      )}

      {showSidebar && (
        <div
          className={styles.dragHandleLeft}
          style={{ left: sidebarWidth - 3 }}
          onMouseDown={onMouseDown('left')}
        />
      )}

      {/* Main Chat */}
      <div className={styles.mainChat}>
        {chat}
      </div>

      {/* Right drag handle */}
      {showInspector && (
        <div
          className={styles.dragHandleRight}
          style={{ right: inspectorWidth - 3 }}
          onMouseDown={onMouseDown('right')}
        />
      )}

      {/* Inspector — rendered directly, no extra chrome wrapper */}
      {showInspector && (
        <div className={styles.inspector} style={{ width: inspectorWidth }}>
          {inspector}
        </div>
      )}
    </div>
  );
}
