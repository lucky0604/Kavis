import { useSceneStore } from '../../stores/app-stores';
import { ChatPane } from '../scenes/chat/ChatPane';
import { WelcomeScene } from '../scenes/welcome/WelcomeScene';
import { AgentsScene } from '../scenes/agents/AgentsScene';
import { SettingsScene } from '../scenes/settings/SettingsScene';

export function SceneArea() {
  const { currentScene } = useSceneStore();

  switch (currentScene) {
    case 'welcome':
      return <WelcomeScene />;
    case 'chat':
      return <ChatPane />;
    case 'agents':
      return <AgentsScene />;
    case 'settings':
      return <SettingsScene />;
    default:
      return <ChatPane />;
  }
}
