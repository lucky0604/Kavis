import { useState } from 'react';
import { useChatStore } from '../../../stores/chat-store';
import styles from './SettingsScene.module.css';

export function SettingsScene() {
  const { apiKey, baseUrl, modelName, setApiKey, setBaseUrl, setModelName } = useChatStore();
  const [localKey, setLocalKey] = useState(apiKey);
  const [localBaseUrl, setLocalBaseUrl] = useState(baseUrl);
  const [localModel, setLocalModel] = useState(modelName);
  const [workspace, setWorkspace] = useState('');

  return (
    <div className={styles.scene}>
      <div className={styles.content}>
        <h2 className={styles.title}>Settings</h2>

        <div className={styles.section}>
          <label className={styles.label}>API Base URL</label>
          <input
            type="text"
            className={styles.input}
            value={localBaseUrl}
            onChange={(e) => setLocalBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
          />
          <span className={styles.hint}>Custom provider endpoint (OpenAI, DeepSeek, Ollama, etc.)</span>
          <div className={styles.actions}>
            <button className={styles.btn} onClick={() => setBaseUrl(localBaseUrl)}>Save</button>
          </div>
        </div>

        <div className={styles.section}>
          <label className={styles.label}>API Key</label>
          <input
            type="password"
            className={styles.input}
            value={localKey}
            onChange={(e) => setLocalKey(e.target.value)}
            placeholder="sk-..."
          />
          <div className={styles.actions}>
            <button className={styles.btn} onClick={() => setApiKey(localKey)}>Save</button>
          </div>
        </div>

        <div className={styles.section}>
          <label className={styles.label}>Model Name</label>
          <input
            type="text"
            className={styles.input}
            value={localModel}
            onChange={(e) => setLocalModel(e.target.value)}
            placeholder="gpt-4o"
          />
          <span className={styles.hint}>Model identifier (gpt-4o, deepseek-chat, qwen-plus, etc.)</span>
          <div className={styles.actions}>
            <button className={styles.btn} onClick={() => setModelName(localModel)}>Save</button>
          </div>
        </div>

        <div className={styles.section}>
          <label className={styles.label}>Workspace Path</label>
          <input
            type="text"
            className={styles.input}
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
            placeholder="/path/to/your/project"
          />
          <span className={styles.hint}>Local project directory for file operations</span>
        </div>
      </div>
    </div>
  );
}
