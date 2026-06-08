import { useAgentStore, useSceneStore } from '../../../stores/app-stores';
import type { AgentUI } from '../../../stores/app-stores';
import styles from './AgentsScene.module.css';

function AgentCard({ agent }: { agent: AgentUI }) {
  const { setActiveAgent, activeAgentId } = useAgentStore();
  const { navigate } = useSceneStore();
  const isActive = agent.id === activeAgentId;

  const handleStart = () => {
    if (agent.status !== 'active') return;
    setActiveAgent(agent.id);
    navigate('chat');
  };

  return (
    <div className={`${styles.card} ${isActive ? styles.cardActive : ''} ${agent.status === 'coming_soon' ? styles.cardDisabled : ''}`}>
      <div className={styles.cardIcon}>{agent.iconKey === 'code2' ? '<>' : agent.iconKey === 'folder' ? '◆' : agent.iconKey === 'bug' ? '🐛' : '📋'}</div>
      <div className={styles.cardBody}>
        <h3 className={styles.cardName}>{agent.name}</h3>
        <p className={styles.cardDesc}>{agent.description}</p>
        <div className={styles.caps}>
          {agent.capabilities.map((c: string) => (
            <span key={c} className={styles.cap}>{c}</span>
          ))}
        </div>
      </div>
      {agent.status === 'active' ? (
        <button className={styles.startBtn} onClick={handleStart}>
          {isActive ? 'Active' : 'Start Session'}
        </button>
      ) : (
        <span className={styles.comingSoon}>Coming Soon</span>
      )}
    </div>
  );
}

export function AgentsScene() {
  const { agents } = useAgentStore();

  const coreAgents = agents.filter((a: AgentUI) => ['work'].includes(a.id));
  const otherAgents = agents.filter((a: AgentUI) => !['work'].includes(a.id));

  return (
    <div className={styles.scene}>
      <div className={styles.content}>
        <h2 className={styles.title}>Agents</h2>
        <p className={styles.subtitle}>Choose how Janus works — agents differ by prompt, tools, and operating style.</p>

        {/* Core Zone */}
        <section className={styles.coreZone}>
          <h3 className={styles.zoneTitle}>Core</h3>
          <div className={styles.coreGrid}>
            {coreAgents.map((a) => (
              <AgentCard key={a.id} agent={a} />
            ))}
          </div>
        </section>

        {/* Overview Grid */}
        <section className={styles.overviewZone}>
          <h3 className={styles.zoneTitle}>Specialists</h3>
          <div className={styles.overviewGrid}>
            {otherAgents.map((a) => (
              <AgentCard key={a.id} agent={a} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
