// In-memory application state. No external database — everything lives here.
import { EventEmitter } from 'node:events';

class Store extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, object>} fileId -> { id, path, raw, error } */
    this.files = new Map();
    /** @type {Map<string, object>} serviceId -> service descriptor */
    this.services = new Map();
    this.lastBuild = null;
  }

  replaceAll(files, services) {
    // Preserve previously observed health status across rebuilds so the UI
    // does not flash "unknown" every time a file changes.
    const previous = this.services;
    this.files = new Map(files.map((f) => [f.id, f]));
    this.services = new Map(
      services.map((s) => {
        const old = previous.get(s.id);
        if (old) {
          s.status = old.status;
          s.statusCode = old.statusCode;
          s.responseTime = old.responseTime;
          s.lastCheck = old.lastCheck;
        }
        return [s.id, s];
      }),
    );
    this.lastBuild = new Date().toISOString();
    this.emit('change');
  }

  listServices() {
    return [...this.services.values()];
  }

  listFiles() {
    return [...this.files.values()];
  }

  getFile(id) {
    return this.files.get(id) || null;
  }

  updateHealth(serviceId, patch) {
    const svc = this.services.get(serviceId);
    if (svc) Object.assign(svc, patch);
  }
}

export const store = new Store();
