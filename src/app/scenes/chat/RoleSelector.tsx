import { useState, useRef, useEffect } from 'react';
import { useAgentStore } from '../../../stores/agent-store';
import type { AgentRoleId } from '../../../../shared/types';
import styles from './RoleSelector.module.css';

const ROLE_LABELS: Record<AgentRoleId, string> = {
  agentic: 'Agentic',
  plan: 'Plan',
  ask: 'Ask',
  debug: 'Debug',
  'kavis-code': 'Kavis Code',
};

export function RoleSelector() {
  const { activeMode, activeRole, setRole, roles } = useAgentStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [open]);

  if (activeMode !== 'code') return null;

  const select = (roleId: AgentRoleId) => {
    setRole(roleId);
    setOpen(false);
  };

  return (
    <div className={styles.wrapper} ref={ref}>
      <button
        className={styles.trigger}
        onClick={() => setOpen((o) => !o)}
        title={`Current role: ${ROLE_LABELS[activeRole]}`}
      >
        <span className={styles.triggerLabel}>{ROLE_LABELS[activeRole]}</span>
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}>▼</span>
      </button>

      {open && (
        <div className={styles.dropdown}>
          {roles.map((role) => (
            <button
              key={role.id}
              className={`${styles.item} ${role.id === activeRole ? styles.itemActive : ''}`}
              onClick={() => select(role.id)}
            >
              <div className={styles.itemBody}>
                <span className={styles.itemName}>{role.name}</span>
                <span className={styles.itemDesc}>{role.description}</span>
              </div>
              {role.id === activeRole && <span className={styles.check}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}