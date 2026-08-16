/**
 * server/db.js
 * 
 * Persistent database layer using Node 22's native, built-in node:sqlite module.
 * Stores resumes and their associated chats to survive development server restarts.
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const dbDir = path.resolve(process.cwd(), 'server');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'notionToCV.db');
const db = new DatabaseSync(dbPath);

// Initialize DB schema
db.exec(`
  CREATE TABLE IF NOT EXISTS resumes (
    id TEXT PRIMARY KEY,
    pageTitle TEXT,
    blocks TEXT,
    paddingMm INTEGER,
    templateName TEXT,
    themeColors TEXT,
    updatedAt TEXT
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS chats (
    resumeId TEXT PRIMARY KEY,
    chats TEXT,
    updatedAt TEXT
  );
`);

/**
 * Retrieve all resumes from SQLite.
 * @returns {Array<Object>}
 */
export function getAllResumes() {
  const stmt = db.prepare('SELECT * FROM resumes ORDER BY updatedAt DESC');
  const rows = stmt.all();
  return rows.map(row => ({
    id: row.id,
    pageTitle: row.pageTitle || '',
    blocks: row.blocks ? JSON.parse(row.blocks) : [],
    paddingMm: Number(row.paddingMm ?? 15),
    templateName: row.templateName || 'clean',
    themeColors: row.themeColors ? JSON.parse(row.themeColors) : {},
    updatedAt: row.updatedAt
  }));
}

/**
 * Save/Upsert a resume to SQLite.
 * @param {Object} resume
 */
export function saveResume(resume) {
  const stmt = db.prepare(`
    INSERT INTO resumes (id, pageTitle, blocks, paddingMm, templateName, themeColors, updatedAt)
    VALUES ($id, $pageTitle, $blocks, $paddingMm, $templateName, $themeColors, $updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      pageTitle = excluded.pageTitle,
      blocks = excluded.blocks,
      paddingMm = excluded.paddingMm,
      templateName = excluded.templateName,
      themeColors = excluded.themeColors,
      updatedAt = excluded.updatedAt
  `);
  
  stmt.run({
    $id: resume.id,
    $pageTitle: resume.pageTitle || '',
    $blocks: JSON.stringify(resume.blocks || []),
    $paddingMm: Number(resume.paddingMm ?? 15),
    $templateName: resume.templateName || 'clean',
    $themeColors: JSON.stringify(resume.themeColors || {}),
    $updatedAt: resume.updatedAt || new Date().toISOString()
  });
}

/**
 * Delete a resume from SQLite.
 * @param {string} id
 */
export function deleteResume(id) {
  const stmt = db.prepare('DELETE FROM resumes WHERE id = ?');
  stmt.run(id);
}

/**
 * Retrieve chats list for a resume.
 * @param {string} resumeId
 * @returns {Array<Object>}
 */
export function getChats(resumeId) {
  const stmt = db.prepare('SELECT chats FROM chats WHERE resumeId = ?');
  const row = stmt.get(resumeId);
  if (row && row.chats) {
    try {
      return JSON.parse(row.chats);
    } catch (_) {
      return [];
    }
  }
  return [];
}

/**
 * Save/Upsert chats for a resume.
 * @param {string} resumeId
 * @param {Array<Object>} chats
 */
export function saveChats(resumeId, chats) {
  const stmt = db.prepare(`
    INSERT INTO chats (resumeId, chats, updatedAt)
    VALUES ($resumeId, $chats, $updatedAt)
    ON CONFLICT(resumeId) DO UPDATE SET
      chats = excluded.chats,
      updatedAt = excluded.updatedAt
  `);
  
  stmt.run({
    $resumeId: resumeId,
    $chats: JSON.stringify(chats || []),
    $updatedAt: new Date().toISOString()
  });
}

/**
 * Delete chats for a resume.
 * @param {string} resumeId
 */
export function deleteChats(resumeId) {
  const stmt = db.prepare('DELETE FROM chats WHERE resumeId = ?');
  stmt.run(resumeId);
}
