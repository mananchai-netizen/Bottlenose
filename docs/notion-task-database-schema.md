# Notion Task Database Schema

This database is the task queue for Han AI workers. Property names are case-sensitive
and must match the names below because the worker reads and writes them directly via
the Notion API.

## Database

Recommended database name: `Han Tasks`

## Required Properties

| Property | Notion type | Options / format | Used by |
| --- | --- | --- | --- |
| `title` | Title | Free text | Human, worker |
| `type` | Select | `dev`, `doc`, `sheet`, `slide` | Worker query/filter |
| `status` | Select | `New`, `Approve`, `In-Progress`, `Done`, `Failed` | Worker query/update |
| `priority` | Number | Integer, lower number means higher priority | Worker sort |
| `assigned_to` | Select | Machine ID, optional. Empty means any machine can claim it. | Worker filter |
| `retry_count` | Number | Integer. Default `0`. Worker skips tasks at `3`. | Worker retry guard |

## Worker-Managed Properties

| Property | Notion type | Written when |
| --- | --- | --- |
| `claimed_by` | Select | A worker claims the task |
| `claimed_at` | Date | A worker claims the task |
| `heartbeat_at` | Date | A worker heartbeat updates the task |
| `output_url` | URL | Task completes successfully |
| `error_log` | Rich text | Task execution fails |
| `brain_used` | Select | Task completes with an LLM brain |

## Optional Properties

| Property | Notion type | Purpose |
| --- | --- | --- |
| `project_id` | Select | Connect task to a project config entry |
| `context` | Rich text | Extra prompt/context for the worker |

## Select Options

### `status`

| Name | Suggested color |
| --- | --- |
| `New` | Gray |
| `Approve` | Yellow |
| `In-Progress` | Blue |
| `Done` | Green |
| `Failed` | Red |

### `type`

| Name | Suggested color |
| --- | --- |
| `dev` | Blue |
| `doc` | Green |
| `sheet` | Yellow |
| `slide` | Purple |

### `brain_used`

Initial options:

- `claude-cli`
- `claude-sonnet-4-6`
- `claude-opus-4-7`
- `gemini-2.5-pro`
- `gemini-2.0-flash`
- `llm-server`

### `assigned_to` and `claimed_by`

Add machine IDs after running `han init`, for example:

- `tum-pc`
- `han-mac`
- `office-pc`

The worker can write a new select option automatically if the integration has edit
access to the database.

## Recommended Views

| View | Type | Filter | Sort |
| --- | --- | --- | --- |
| `Board` | Board | None | Group by `status` |
| `Approved Queue` | Table | `status` is `Approve` | `priority` ascending |
| `In Progress` | Table | `status` is `In-Progress` | `claimed_at` ascending |
| `Failed` | Table | `status` is `Failed` | `priority` ascending |
| `Done` | Table | `status` is `Done` | `claimed_at` descending |

## Minimal Task Example

| title | type | status | priority | assigned_to | retry_count | context |
| --- | --- | --- | --- | --- | --- | --- |
| Add login page | dev | Approve | 1 |  | 0 | Build a Next.js login page and open a PR. |

## Notion API Create Database Payload

Use this payload with `POST https://api.notion.com/v1/databases`.
Replace `PARENT_PAGE_ID` before sending.

```json
{
  "parent": {
    "type": "page_id",
    "page_id": "PARENT_PAGE_ID"
  },
  "title": [
    {
      "type": "text",
      "text": {
        "content": "Han Tasks"
      }
    }
  ],
  "properties": {
    "title": {
      "title": {}
    },
    "type": {
      "select": {
        "options": [
          { "name": "dev", "color": "blue" },
          { "name": "doc", "color": "green" },
          { "name": "sheet", "color": "yellow" },
          { "name": "slide", "color": "purple" }
        ]
      }
    },
    "status": {
      "select": {
        "options": [
          { "name": "New", "color": "gray" },
          { "name": "Approve", "color": "yellow" },
          { "name": "In-Progress", "color": "blue" },
          { "name": "Done", "color": "green" },
          { "name": "Failed", "color": "red" }
        ]
      }
    },
    "priority": {
      "number": {
        "format": "number"
      }
    },
    "assigned_to": {
      "select": {
        "options": []
      }
    },
    "claimed_by": {
      "select": {
        "options": []
      }
    },
    "claimed_at": {
      "date": {}
    },
    "heartbeat_at": {
      "date": {}
    },
    "output_url": {
      "url": {}
    },
    "error_log": {
      "rich_text": {}
    },
    "retry_count": {
      "number": {
        "format": "number"
      }
    },
    "brain_used": {
      "select": {
        "options": [
          { "name": "claude-cli", "color": "gray" },
          { "name": "claude-sonnet-4-6", "color": "blue" },
          { "name": "claude-opus-4-7", "color": "purple" },
          { "name": "gemini-2.5-pro", "color": "green" },
          { "name": "gemini-2.0-flash", "color": "yellow" },
          { "name": "llm-server", "color": "orange" }
        ]
      }
    },
    "project_id": {
      "select": {
        "options": []
      }
    },
    "context": {
      "rich_text": {}
    }
  }
}
```

After creating the database, share it with the Notion integration and save the
database ID in the Han project config as `notion_db_id`.
