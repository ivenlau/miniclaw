import { EventEmitter } from 'node:events';

export interface MiniclawEvents {
  'cli:progress': { sessionId: string; output: string };
  'cli:complete': { sessionId: string; output: string; exitCode: number };
  'cli:error': { sessionId: string; error: string };
  'memory:updated': { file: string };
  'schedule:fired': { taskId: string };
}

class TypedEventEmitter {
  private emitter = new EventEmitter();

  on<K extends keyof MiniclawEvents>(event: K, listener: (data: MiniclawEvents[K]) => void) {
    this.emitter.on(event, listener);
    return this;
  }

  off<K extends keyof MiniclawEvents>(event: K, listener: (data: MiniclawEvents[K]) => void) {
    this.emitter.off(event, listener);
    return this;
  }

  emit<K extends keyof MiniclawEvents>(event: K, data: MiniclawEvents[K]) {
    return this.emitter.emit(event, data);
  }

  once<K extends keyof MiniclawEvents>(event: K, listener: (data: MiniclawEvents[K]) => void) {
    this.emitter.once(event, listener);
    return this;
  }
}

export const eventBus = new TypedEventEmitter();
