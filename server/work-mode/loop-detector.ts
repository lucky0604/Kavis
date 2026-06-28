import type { ToolCall } from '../../shared/types';

interface DetectionState {
  consecutiveCount: number;
  lastToolName: string | null;
  recoveryAttempts: number;
  hasProducedText: boolean;
  toolHistory: string[];
}

const CONSECUTIVE_THRESHOLD = 3;
const MAX_RECOVERY_ATTEMPTS = 3;
const PERIODIC_WINDOW = 6;

export class LoopDetector {
  private state: DetectionState = {
    consecutiveCount: 0,
    lastToolName: null,
    recoveryAttempts: 0,
    hasProducedText: false,
    toolHistory: [],
  };

  get recoveryAttempts(): number {
    return this.state.recoveryAttempts;
  }

  detect(toolCalls: ToolCall[]): { loopDetected: boolean; periodic: boolean } {
    if (toolCalls.length === 0) {
      this.state.consecutiveCount = 0;
      this.state.lastToolName = null;
      return { loopDetected: false, periodic: false };
    }

    const currentNames = toolCalls.map((tc) => tc.name);

    // Check consecutive same tool (A-A-A)
    let consecutiveDetected = false;
    for (const name of currentNames) {
      if (name === this.state.lastToolName) {
        this.state.consecutiveCount++;
      } else {
        this.state.consecutiveCount = 1;
        this.state.lastToolName = name;
      }

      if (this.state.consecutiveCount >= CONSECUTIVE_THRESHOLD) {
        consecutiveDetected = true;
        break;
      }
    }

    // Track tool history for periodic detection
    this.state.toolHistory.push(...currentNames);
    if (this.state.toolHistory.length > PERIODIC_WINDOW * 2) {
      this.state.toolHistory = this.state.toolHistory.slice(-PERIODIC_WINDOW * 2);
    }

    // Check periodic pattern (A-B-A-B)
    let periodicDetected = false;
    if (this.state.toolHistory.length >= PERIODIC_WINDOW) {
      periodicDetected = this.detectPeriodic();
    }

    const detected = consecutiveDetected || periodicDetected;

    if (detected) {
      this.state.recoveryAttempts++;
      this.state.consecutiveCount = 0;
      this.state.lastToolName = null;
    }

    return { loopDetected: detected, periodic: periodicDetected };
  }

  private detectPeriodic(): boolean {
    const history = this.state.toolHistory;
    const len = history.length;

    // Try pattern lengths 2-4
    for (let patternLen = 2; patternLen <= 4; patternLen++) {
      const pattern = history.slice(len - patternLen * 2, len - patternLen);
      const compare = history.slice(len - patternLen);
      if (arraysEqual(pattern, compare)) {
        return true;
      }
    }
    return false;
  }

  resetOnText(): void {
    this.state.hasProducedText = true;
    this.state.consecutiveCount = 0;
  }

  shouldTerminate(): boolean {
    return this.state.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS;
  }

  reset(): void {
    this.state = {
      consecutiveCount: 0,
      lastToolName: null,
      recoveryAttempts: 0,
      hasProducedText: false,
      toolHistory: [],
    };
  }
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
