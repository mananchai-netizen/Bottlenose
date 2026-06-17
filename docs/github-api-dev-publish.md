# GitHub API Dev Publish Mode

Han supports two publish modes for `dev` tasks.

## Modes

`cli` is the default mode. It uses local command line tools:

```txt
git clone -> git checkout -> git commit -> git push -> gh pr create
```

Use this mode when the machine running `han start` has `git`, `gh`, and GitHub CLI auth already configured.

`github-api` uses the GitHub REST API instead:

```txt
GitHub API read repo -> materialize workspace -> create commit -> update branch -> create PR
```

Use this mode when the runtime should not depend on `git` or `gh`.

## Configuration

You can configure this in `http://localhost:3100/config` under `Dev Publish`.

For CLI mode:

```json
{
  "dev_publish_mode": "cli"
}
```

For GitHub API mode:

```json
{
  "dev_publish_mode": "github-api",
  "github_token": "github_pat_xxx"
}
```

You can also provide the token through the environment:

```txt
GITHUB_TOKEN=github_pat_xxx
```

If both are present, `github_token` in `~/.han/config.json` is used first.

## Token Permissions

For a fine-grained GitHub personal access token, grant access to the target repository and these permissions:

```txt
Metadata: Read
Contents: Read and write
Pull requests: Read and write
```

For private repositories, make sure the token is allowed to access that repository.

## Duplicate PR Behavior

Han uses branch names based on the Notion task id:

```txt
han/<taskId>
```

If a dev task already has `output_url` in Notion, Han skips execution and returns the existing URL.

If `output_url` was removed and the task is approved again:

- If the existing PR for `han/<taskId>` is open, Han reuses that PR URL.
- If the existing PR is closed or merged, Han stops and asks you to create a new Notion task.

This keeps one task id tied to one PR history.

## Current Limits

- GitHub API mode materializes files from the repository tree into a temp workspace.
- Files larger than 1 MB are skipped on initial materialization.
- Generated or modified files larger than 1 MB are blocked during publish.
- Binary files are not specially interpreted; avoid asking dev tasks to generate large binary artifacts.

## Fallback

To return to the original behavior, switch the mode back to:

```json
{
  "dev_publish_mode": "cli"
}
```
