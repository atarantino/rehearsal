import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PracticeSession, SessionSummary } from "../shared/types.js";
export class SessionStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string) {}
  private path(id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id))
      throw Object.assign(new Error("Session not found."), { status: 404 });
    return join(this.directory, `${id}.json`);
  }
  private async write(s: PracticeSession) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const tmp = `${this.path(s.id)}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(s), { mode: 0o600 });
    await rename(tmp, this.path(s.id));
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }
  async get(id: string): Promise<PracticeSession> {
    try {
      return JSON.parse(await readFile(this.path(id), "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        throw Object.assign(new Error("Session not found."), { status: 404 });
      throw e;
    }
  }
  create(s: PracticeSession) {
    return this.serial(async () => {
      await this.write(s);
      return s;
    });
  }
  update(id: string, fn: (s: PracticeSession) => void) {
    return this.serial(async () => {
      const s = await this.get(id);
      fn(s);
      await this.write(s);
      return s;
    });
  }
  delete(id: string) {
    return this.serial(async () => {
      await unlink(this.path(id));
    });
  }
  async list(): Promise<SessionSummary[]> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const names = (await readdir(this.directory)).filter((n) =>
      n.endsWith(".json"),
    );
    const all = await Promise.all(names.map((n) => this.get(n.slice(0, -5))));
    return all
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        config: s.config,
        status: s.status,
        question: s.question,
        seconds: s.seconds,
        hasFeedback: !!s.feedback,
      }));
  }
  async recover() {
    for (const s of await this.list())
      if (["active", "connecting"].includes(s.status))
        await this.update(s.id, (r) => {
          r.status = "partial";
          r.endedAt = new Date().toISOString();
          r.closeReason = "server_restarted";
        });
  }
}
