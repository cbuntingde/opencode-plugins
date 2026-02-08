# Knowledge Graph Plugin for OpenCode

Maintains project context and knowledge across sessions. Creates a persistent knowledge base using SQLite.

## Features

- **Session Memory**: Remembers project context, key decisions, and summaries between sessions
- **Knowledge Entities**: Track architecture, decisions, patterns, components, and concepts
- **Relationship Graph**: Connect entities to show how things relate (depends_on, implements, contains, related_to)
- **Search**: Find information across all tracked knowledge
- **Q&A**: Ask questions about the project and get relevant context

## Installation

Clone this repository and install the plugin:

```bash
# Clone to local plugins directory
mkdir -p ~/.config/opencode/plugins/
git clone https://github.com/your-org/opencode-plugins ~/.config/opencode/plugins/opencode-plugins

# Or for project-level (copy just this plugin)
mkdir -p .opencode/plugins/knowledge-graph
cp -r knowledge-graph/* .opencode/plugins/knowledge-graph/
```

## Custom Tools

The plugin adds these tools:

### knowledge_search
Search the knowledge base for information.
```
/knowledge_search query="authentication flow" type="decision" limit=10
```

### knowledge_add_entity
Add a new entity to the knowledge graph.
```
/knowledge_add_entity name="UserService" type="component" content="Handles user authentication and profile management" metadata='{"layer": "service"}'
```

### knowledge_connect
Create relationships between entities.
```
/knowledge_connect source="UserService" target="Database" relationship="depends_on"
```

### knowledge_graph
Get the graph as nodes and edges for visualization.
```
/knowledge_graph entityType="component" depth=2
```

### knowledge_sessions
View past session history with summaries.
```
/knowledge_sessions limit=10
```

### knowledge_record_decision
Record architectural or design decisions.
```
/knowledge_record_decision decision="Using PostgreSQL for user data" rationale="Need ACID compliance for transactions" alternatives="MongoDB (denormalized), DynamoDB (expensive at scale)"
```

### knowledge_summarize_session
Store a session summary for future reference.
```
/knowledge_summarize_session summary="Implemented user authentication with JWT tokens" decisions="1. JWT for stateless auth 2. bcrypt for password hashing" files='["auth.ts", "middleware.ts"]'
```

### knowledge_ask
Ask questions about the project context.
```
/knowledge_ask question="How is authentication handled in this project?"
```

## Entity Types

- `architecture` - System architecture and design
- `decision` - Architectural decisions with rationale
- `pattern` - Design patterns used
- `component` - Code components and modules
- `concept` - Domain concepts and terminology
- `documentation` - Documentation sections
- `typescript` / `javascript` / `config` / `file` - Auto-tracked file types

## Relationship Types

- `depends_on` - Dependency relationship
- `implements` - Interface/class implementation
- `contains` - Container relationship
- `related_to` - General relationship

## Database

Creates a SQLite database at `knowledge-graph/knowledge.db` with tables:
- `entities` - Knowledge entities
- `relationships` - Entity relationships
- `sessions` - Session history
- `queries` - Query history

## Usage Example

```javascript
// Record an architectural decision
/knowledge_record_decision decision="Event-driven architecture for user updates" rationale="Decouples services and enables scalability" alternatives="Direct API calls (tight coupling), Webhooks (external dependency)"

// Connect components
/knowledge_connect source="UserService" target="EventBus" relationship="publishes_to"
/knowledge_connect source="EmailService" target="EventBus" relationship="subscribes_to"

// Later, search for context
/knowledge_search query="event driven" type="decision"
```

## Auto-Tracking

The plugin automatically:
- Tracks files as you read them
- Records git-related commands (log, diff, status, show) as potential decisions
- Captures README/ARCHITECTURE.md sections as documentation
- Maintains session context for day/week+ gaps between work