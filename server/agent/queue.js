// server/agent/queue.js — In-memory job queue implementation.
//
// Job model (FR5.1):
//   { id, status, userId, input: { state, instruction, opts }, output?: { transaction },
//     error?, abortController?, createdAt, updatedAt }
//
// Interface behind which any storage (Redis, DB) can be swapped.
// The engine never touches this — only the worker and route handlers do.

import { randomUUID } from 'node:crypto';
import { cleanupState } from './imageStore.js';

/** @type {Map<string, Object>} */
const jobs = new Map();

const STATUS = { QUEUED: 'queued', RUNNING: 'running', DONE: 'done', ERROR: 'error', CANCELLED: 'cancelled' };

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Enqueue a new optimisation job.
 * @param {string} userId
 * @param {Object} state - dehydrated ResumeState
 * @param {string} instruction
 * @param {Object} [opts]
 * @returns {string} jobId
 */
export function enqueue(userId, state, instruction, opts = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  jobs.set(id, {
    id,
    status: STATUS.QUEUED,
    userId,
    input: { state, instruction, opts },
    createdAt: now,
    updatedAt: now
  });
  return id;
}

/**
 * @param {string} jobId
 * @returns {Object|null}
 */
export function getJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  // Return a sanitised copy (no internal fields like abortController)
  const { abortController, ...safe } = job;
  return safe;
}

/**
 * @param {string} userId
 * @param {string} jobId
 * @returns {boolean}
 */
export function canAccess(userId, jobId) {
  const job = jobs.get(jobId);
  return !!job && job.userId === userId;
}

/**
 * Cancel a job. Auth check must be done by caller.
 * @param {string} jobId
 * @returns {boolean}
 */
export function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job || (job.status !== STATUS.QUEUED && job.status !== STATUS.RUNNING)) return false;

  if (job.abortController) {
    try { job.abortController.abort(); } catch (_) {}
  }
  job.status = STATUS.CANCELLED;
  job.updatedAt = new Date().toISOString();
  return true;
}

/**
 * Return the next queued job (FIFO) and mark it running.
 * @returns {Object|null} — job with abortController set, or null
 */
export function dequeueNext() {
  for (const [, job] of jobs) {
    if (job.status === STATUS.QUEUED) {
      job.status = STATUS.RUNNING;
      job.updatedAt = new Date().toISOString();
      job.abortController = new AbortController();
      return job;
    }
  }
  return null;
}

/**
 * Mark a job as done with a transaction result.
 * @param {string} jobId
 * @param {Object} transaction
 */
export function markDone(jobId, transaction) {
  const job = jobs.get(jobId);
  if (!job) return;
  // Don't overwrite a cancelled job — the cancel signal causes the engine to
  // drain with an empty transaction, but the user already chose to discard it.
  if (job.status === STATUS.CANCELLED) return;
  job.status = STATUS.DONE;
  job.output = { transaction };
  job.abortController = undefined;
  job.updatedAt = new Date().toISOString();
}

/**
 * Mark a job as errored.
 * @param {string} jobId
 * @param {string} error
 */
export function markError(jobId, error) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = STATUS.ERROR;
  job.error = error;
  job.abortController = undefined;
  job.updatedAt = new Date().toISOString();
}

/**
 * Purge jobs older than 7 days (called on each poll cycle).
 */
export async function purgeExpired() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, job] of jobs) {
    if (new Date(job.createdAt).getTime() < cutoff) {
      // Clean up any stored images before removing the job
      if (job.input?.state) {
        await cleanupState(job.input.state).catch(() => {});
      }
      jobs.delete(id);
    }
  }
}

export { STATUS };
