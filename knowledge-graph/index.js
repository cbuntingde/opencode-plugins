import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'knowledge.db');

let db;

function initDatabase() {
  db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      content TEXT,
      metadata TEXT,
      project_path TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS relationships (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relationship_type TEXT NOT NULL,
      metadata TEXT,
      project_path TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (source_id) REFERENCES entities(id),
      FOREIGN KEY (target_id) REFERENCES entities(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      start_time TEXT DEFAULT (datetime('now')),
      end_time TEXT,
      summary TEXT,
      key_decisions TEXT,
      files_modified TEXT,
      context TEXT
    );

    CREATE TABLE IF NOT EXISTS queries (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      query_text TEXT NOT NULL,
      result_summary TEXT,
      timestamp TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
    CREATE INDEX IF NOT EXISTS idx_entities_project ON entities(project_path);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
    CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_id);
    CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_id);
  `);
}

function getProjectPath(worktree, directory) {
  if (worktree) return worktree;
  return directory || process.cwd();
}

export const KnowledgeGraphPlugin = async ({ project, client, $, directory, worktree }) => {
  initDatabase();
  const projectPath = getProjectPath(worktree, directory);
  let currentSessionId = null;

  return {
    "session.created": async (input, output) => {
      currentSessionId = uuidv4();

      const recentSessions = db.prepare(`
        SELECT * FROM sessions
        WHERE project_path = ?
        ORDER BY start_time DESC
        LIMIT 5
      `).all(projectPath);

      let contextMessage = `Project: ${projectPath}`;

      if (recentSessions.length > 0) {
        const lastSession = recentSessions[0];
        const daysAgo = Math.floor(
          (Date.now() - new Date(lastSession.start_time).getTime()) / (1000 * 60 * 60 * 24)
        );

        contextMessage += `\n\nLast session: ${daysAgo} day(s) ago`;

        if (lastSession.summary) {
          contextMessage += `\nLast summary: ${lastSession.summary}`;
        }
        if (lastSession.key_decisions) {
          contextMessage += `\nKey decisions made: ${lastSession.key_decisions}`;
        }

        const recentEntities = db.prepare(`
          SELECT * FROM entities
          WHERE project_path = ?
          ORDER BY updated_at DESC
          LIMIT 10
        `).all(projectPath);

        if (recentEntities.length > 0) {
          contextMessage += `\n\nRecent entities tracked:`;
          recentEntities.forEach(e => {
            contextMessage += `\n  - [${e.type}] ${e.name}`;
          });
        }
      }

      output.context.push(`## Project Knowledge Context\n${contextMessage}`);
    },

    "session.compacted": async (input, output) => {
      const session = db.prepare(`
        SELECT * FROM sessions WHERE id = ?
      `).get(currentSessionId);

      if (session) {
        output.context.push(`## Previous Session Summary\n${session.summary || 'No summary available'}`);
        output.context.push(`## Key Decisions\n${session.key_decisions || 'No decisions recorded'}`);
      }
    },

    "session.deleted": async (input, output) => {
      if (currentSessionId) {
        db.prepare(`
          UPDATE sessions SET end_time = datetime('now') WHERE id = ?
        `).run(currentSessionId);

        const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(currentSessionId);
        if (session && session.context) {
          try {
            const context = JSON.parse(session.context);
            output.summary = context.summary;
            output.decisions = context.decisions;
          } catch (e) {}
        }
      }
    },

    "file.edited": async (input, output) => {
      const { filePath, changes } = input;
      const normalizedPath = path.normalize(filePath);

      const existingEntity = db.prepare(`
        SELECT * FROM entities
        WHERE project_path = ? AND name = ?
      `).get(projectPath, normalizedPath);

      if (existingEntity) {
        db.prepare(`
          UPDATE entities SET updated_at = datetime('now') WHERE id = ?
        `).run(existingEntity.id);
      }
    },

    "tool.execute.after": async (input, output) => {
      if (input.tool === 'read' && output.result) {
        const filePath = input.args?.filePath;
        if (filePath) {
          const normalizedPath = path.normalize(filePath);

          const existing = db.prepare(`
            SELECT * FROM entities WHERE project_path = ? AND name = ?
          `).get(projectPath, normalizedPath);

          if (!existing) {
            const type = filePath.endsWith('.ts') || filePath.endsWith('.tsx') ? 'typescript' :
                        filePath.endsWith('.js') || filePath.endsWith('.jsx') ? 'javascript' :
                        filePath.endsWith('.json') ? 'config' : 'file';

            db.prepare(`
              INSERT INTO entities (id, type, name, content, project_path)
              VALUES (?, ?, ?, ?, ?)
            `).run(uuidv4(), type, normalizedPath, output.result.substring(0, 1000), projectPath);
          }
        }
      }

      if (input.tool === 'bash' && output.result) {
        const command = input.args?.command || '';
        const gitCommands = ['git log', 'git diff', 'git status', 'git show'];

        if (gitCommands.some(c => command.includes(c))) {
          const entities = db.prepare(`
            SELECT * FROM entities WHERE project_path = ? ORDER BY updated_at DESC LIMIT 5
          `).all(projectPath);

          entities.forEach(entity => {
            if (entity.content && entity.content.includes('decision:')) {
              const lines = entity.content.split('\n');
              lines.forEach((line, i) => {
                if (line.includes('decision:')) {
                  const decisionId = uuidv4();
                  const decisionContent = lines.slice(Math.max(0, i - 2), i + 3).join('\n');

                  db.prepare(`
                    INSERT OR IGNORE INTO entities (id, type, name, content, project_path)
                    VALUES (?, 'decision', ?, ?, ?)
                  `).run(decisionId, `decision-${Date.now()}`, decisionContent, projectPath);
                }
              });
            }
              if (entity.name.endsWith('README.md') || entity.name.endsWith('ARCHITECTURE.md')) {
                const lines = entity.content.split('\n');
                lines.forEach((line, i) => {
                  if (line.startsWith('## ')) {
                    const sectionId = uuidv4();
                    const sectionContent = lines.slice(i, Math.min(lines.length, i + 10)).join('\n');

                    db.prepare(`
                      INSERT OR IGNORE INTO entities (id, type, name, content, project_path)
                      VALUES (?, 'documentation', ?, ?, ?)
                    `).run(sectionId, line.replace('## ', '').trim(), sectionContent, projectPath);
                  }
                });
              }
            }
          });
        }
      }
    },

    tool: {
      knowledge_search: {
        description: "Search the project knowledge base for information",
        args: {
          query: { type: "string", description: "Search query" },
          type: { type: "string", description: "Filter by entity type (optional)" },
          limit: { type: "number", description: "Max results (default: 10)" }
        },
        async execute({ query, type, limit = 10 }, { directory, worktree }) {
          const projPath = getProjectPath(worktree, directory);
          let sql = `SELECT * FROM entities WHERE project_path = ? AND (name LIKE ? OR content LIKE ?)`;
          const params = [projPath, `%${query}%`, `%${query}%`];

          if (type) {
            sql += ` AND type = ?`;
            params.push(type);
          }

          sql += ` ORDER BY updated_at DESC LIMIT ?`;
          params.push(limit);

          const results = db.prepare(sql).all(...params);

          return {
            query,
            count: results.length,
            results: results.map(r => ({
              id: r.id,
              type: r.type,
              name: r.name,
              content: r.content?.substring(0, 500),
              updated: r.updated_at
            }))
          };
        }
      },

      knowledge_add_entity: {
        description: "Add a new entity to the knowledge graph",
        args: {
          name: { type: "string", description: "Entity name" },
          type: { type: "string", description: "Entity type (architecture, decision, pattern, component, concept)" },
          content: { type: "string", description: "Entity content/details" },
          metadata: { type: "string", description: "JSON metadata (optional)" }
        },
        async execute({ name, type, content, metadata }, { directory, worktree }) {
          const projPath = getProjectPath(worktree, directory);
          const id = uuidv4();

          db.prepare(`
            INSERT INTO entities (id, type, name, content, metadata, project_path)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(id, type, name, content, metadata || null, projPath);

          return { success: true, entityId: id, name, type };
        }
      },

      knowledge_connect: {
        description: "Create a relationship between two entities",
        args: {
          source: { type: "string", description: "Source entity ID or name" },
          target: { type: "string", description: "Target entity ID or name" },
          relationship: { type: "string", description: "Relationship type (depends_on, implements, contains, related_to)" }
        },
        async execute({ source, target, relationship }, { directory, worktree }) {
          const projPath = getProjectPath(worktree, directory);

          let sourceEntity = db.prepare(`SELECT id FROM entities WHERE project_path = ? AND (id = ? OR name = ?)`)
            .get(projPath, source, `%${source}%`);

          let targetEntity = db.prepare(`SELECT id FROM entities WHERE project_path = ? AND (id = ? OR name = ?)`)
            .get(projPath, target, `%${target}%`);

          if (!sourceEntity || !targetEntity) {
            throw new Error(`Could not find entities: ${!sourceEntity ? source : ''} ${!targetEntity ? target : ''}`);
          }

          const id = uuidv4();
          db.prepare(`
            INSERT INTO relationships (id, source_id, target_id, relationship_type, project_path)
            VALUES (?, ?, ?, ?, ?)
          `).run(id, sourceEntity.id, targetEntity.id, relationship, projPath);

          return { success: true, relationshipId: id, from: source, to: target, type: relationship };
        }
      },

      knowledge_graph: {
        description: "Get the knowledge graph as nodes and edges for visualization",
        args: {
          entityType: { type: "string", description: "Filter by entity type (optional)" },
          depth: { type: "number", description: "Relationship depth (default: 1)" }
        },
        async execute({ entityType, depth = 1 }, { directory, worktree }) {
          const projPath = getProjectPath(worktree, directory);

          let entitiesSql = `SELECT * FROM entities WHERE project_path = ?`;
          const entitiesParams = [projPath];

          if (entityType) {
            entitiesSql += ` AND type = ?`;
            entitiesParams.push(entityType);
          }

          const entities = db.prepare(entitiesSql).all(...entitiesParams);

          const relationships = db.prepare(`
            SELECT r.*, s.name as source_name, t.name as target_name
            FROM relationships r
            JOIN entities s ON r.source_id = s.id
            JOIN entities t ON r.target_id = t.id
            WHERE r.project_path = ?
          `).all(projPath);

          return {
            nodes: entities.map(e => ({
              id: e.id,
              label: e.name,
              type: e.type,
              metadata: e.metadata
            })),
            edges: relationships.map(r => ({
              id: r.id,
              source: r.source_name,
              target: r.target_name,
              type: r.relationship_type
            }))
          };
        }
      },

      knowledge_sessions: {
        description: "Get past session history with summaries",
        args: {
          limit: { type: "number", description: "Number of sessions (default: 10)" }
        },
        async execute({ limit = 10 }, { directory, worktree }) {
          const projPath = getProjectPath(worktree, directory);

          const sessions = db.prepare(`
            SELECT * FROM sessions
            WHERE project_path = ?
            ORDER BY start_time DESC
            LIMIT ?
          `).all(projPath, limit);

          return {
            count: sessions.length,
            sessions: sessions.map(s => ({
              id: s.id,
              startTime: s.start_time,
              endTime: s.end_time,
              summary: s.summary,
              keyDecisions: s.key_decisions,
              filesModified: s.files_modified ? JSON.parse(s.files_modified) : []
            }))
          };
        }
      },

      knowledge_record_decision: {
        description: "Record a key architectural or design decision",
        args: {
          decision: { type: "string", description: "The decision made" },
          rationale: { type: "string", description: "Why this decision was made" },
          alternatives: { type: "string", description: "Alternatives considered (optional)" }
        },
        async execute({ decision, rationale, alternatives }, { directory, worktree }) {
          const projPath = getProjectPath(worktree, directory);
          const id = uuidv4();

          const content = JSON.stringify({
            decision,
            rationale,
            alternatives,
            recordedAt: new Date().toISOString()
          });

          db.prepare(`
            INSERT INTO entities (id, type, name, content, project_path)
            VALUES (?, 'decision', ?, ?, ?)
          `).run(id, `decision-${Date.now()}`, content, projPath);

          return { success: true, decisionId: id, decision: decision.substring(0, 100) };
        }
      },

      knowledge_summarize_session: {
        description: "Generate and store a summary of the current session",
        args: {
          summary: { type: "string", description: "Session summary" },
          decisions: { type: "string", description: "Key decisions made" },
          files: { type: "string", description: "JSON array of files modified" }
        },
        async execute({ summary, decisions, files }, { directory, worktree }) {
          if (!currentSessionId) {
            currentSessionId = uuidv4();
          }

          const projPath = getProjectPath(worktree, directory);

          db.prepare(`
            INSERT INTO sessions (id, project_path, summary, key_decisions, files_modified, context)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              summary = excluded.summary,
              key_decisions = excluded.key_decisions,
              files_modified = excluded.files_modified
          `).run(
            currentSessionId,
            projPath,
            summary,
            decisions,
            files,
            JSON.stringify({ summary, decisions })
          );

          return { success: true, sessionId: currentSessionId };
        }
      },

      knowledge_ask: {
        description: "Ask a question about the project and get relevant context",
        args: {
          question: { type: "string", description: "Question about the project" }
        },
        async execute({ question }, { directory, worktree }) {
          const projPath = getProjectPath(worktree, directory);

          db.prepare(`
            INSERT INTO queries (id, project_path, query_text)
            VALUES (?, ?, ?)
          `).run(uuidv4(), projPath, question);

          const decisions = db.prepare(`
            SELECT content FROM entities
            WHERE project_path = ? AND type = 'decision'
            ORDER BY updated_at DESC LIMIT 5
          `).all(projPath);

          const docs = db.prepare(`
            SELECT name, content FROM entities
            WHERE project_path = ? AND type = 'documentation'
            ORDER BY updated_at DESC LIMIT 5
          `).all(projPath);

          const recent = db.prepare(`
            SELECT name, content FROM entities
            WHERE project_path = ?
            ORDER BY updated_at DESC LIMIT 10
          `).all(projPath);

          let relevantContent = [];

          if (decisions.length > 0) {
            relevantContent.push('## Architectural Decisions');
            decisions.forEach(d => {
              try {
                const parsed = JSON.parse(d.content);
                relevantContent.push(`- ${parsed.decision}: ${parsed.rationale}`);
              } catch (e) {
                relevantContent.push(`- ${d.content}`);
              }
            });
          }

          if (docs.length > 0) {
            relevantContent.push('## Documentation');
            docs.forEach(d => {
              relevantContent.push(`### ${d.name}`);
              relevantContent.push(d.content.substring(0, 500));
            });
          }

          return {
            question,
            relevantContext: relevantContent.join('\n'),
            searchQuery: question,
            timestamp: new Date().toISOString()
          };
        }
      }
    }
  };
};