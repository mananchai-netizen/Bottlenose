# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-05-08

### Added

- **Worker loop** — persistent agent worker that polls and processes tasks continuously
- **Redis claim** — distributed task claiming via Redis to prevent duplicate execution across workers
- **Notion integration** — read/write tasks and context from Notion databases
- **CLI commands** — `init`, `start`, `status`, `ui` commands for managing the agent from the terminal
- **Next.js config UI** — web-based configuration dashboard with status display, machine config, and project management
- **Phase 3 brain router** — routes incoming tasks to the appropriate brain (claude-cli, etc.) based on task type
- **Phase 4 dev-executor** — full dev pipeline: clone repo → create branch → run Claude CLI → open PR
