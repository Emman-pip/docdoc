# Repository Guidelines

## Project Structure & Module Organization

DocDoc Offline is an office application for spreadsheet and word-processing documents, with LAN collaboration using CRDTs and self-hosted document copies. Changes are intended to be shared with selected users.

The repository currently contains only `readme.md`, which describes the project concept. No source, test, or asset directories are established. When introducing implementation code, document the chosen directory layout in the README and keep application code, tests, and assets clearly separated.

## Build, Test, and Development Commands

No build system, dependency manifest, or development commands are currently configured. Do not assume commands such as `npm test` or `make build` are available.

When adding tooling, provide reproducible installation, local development, build, and test commands in `readme.md`. Explain required runtime versions and configuration alongside those commands.

## Coding Style & Naming Conventions

No language, indentation standard, formatter, or linter has been selected. Follow the conventions of the implementation language once chosen, and commit formatter and linter configuration with the first code contribution.

Use descriptive names that distinguish document storage, editing, and collaboration responsibilities. Keep Markdown readable with descriptive headings and fenced command examples.

## Testing Guidelines

No testing framework or coverage threshold is configured. Add tests alongside new behavior and document how to run them. Use descriptive test names that identify the scenario and expected result.

For collaboration features, cover concurrent edits, convergence, disconnection and reconnection, and delivery to selected users. Verify that core editing works without internet access.

## Commit & Pull Request Guidelines

Git history is unavailable in this checkout, so no existing commit convention can be verified. Use concise, imperative subjects, such as `Add document storage interface`.

Pull requests should explain the change, link relevant issues, and record validation performed or why testing was unavailable. Include screenshots for interface changes and describe configuration or dependency additions.
