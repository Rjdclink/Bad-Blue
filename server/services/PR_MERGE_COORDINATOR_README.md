# PR Merge Coordinator

## Overview

The PR Merge Coordinator automatically checks the repository and branch `develop` when tasks are completed, resolves all conflicts, and ensures the PR is ready for merge.

## Features

- **Automatic Conflict Detection**: Monitors task completion events and checks for merge conflicts with `develop`
- **Conflict Resolution**: Automatically resolves conflicts by preferring the current branch's changes (keeping agent work intact)
- **PR Readiness Verification**: Ensures the PR can be merged without conflicts
- **Event-Driven**: Listens to Heartline task completion events automatically

## How It Works

1. **Task Completion Monitoring**: The coordinator listens to `task-completed` events from the Heartline system
2. **Conflict Detection**: When a task completes, it:
   - Fetches the latest changes from the remote repository
   - Checks if the current branch conflicts with `develop`
   - Identifies conflicted files
3. **Conflict Resolution**: 
   - Automatically resolves conflicts by preferring the current branch's version (keeps agent work)
   - Stages resolved files
   - Completes the merge if all conflicts are resolved
4. **PR Readiness**: Emits events indicating whether the PR is ready for merge

## Usage

The coordinator is automatically initialized when the server starts. No manual configuration is required.

### Manual Trigger

You can manually trigger a merge check:

```typescript
import { prMergeCoordinator } from './services/pr-merge-coordinator';

// Check and resolve conflicts manually
const status = await prMergeCoordinator.manualCheck();
console.log('Merge ready:', status.mergeReady);
```

### Configuration

```typescript
import { prMergeCoordinator } from './services/pr-merge-coordinator';

// Change the develop branch name (default: 'develop')
prMergeCoordinator.setDevelopBranch('main');

// Enable/disable automatic checking
prMergeCoordinator.setEnabled(false);
```

### Events

The coordinator emits the following events:

- `merge-status-updated`: Emitted when merge status is checked
- `pr-ready`: Emitted when PR is ready for merge (no conflicts)
- `conflicts-remaining`: Emitted when conflicts remain unresolved

```typescript
prMergeCoordinator.on('pr-ready', (status: MergeStatus) => {
  console.log('PR is ready for merge!', status);
});

prMergeCoordinator.on('conflicts-remaining', (status: MergeStatus) => {
  console.log('Conflicts remain:', status.conflicts);
});
```

## Conflict Resolution Strategy

The coordinator uses an "ours" strategy, meaning:
- When conflicts occur, it keeps the current branch's version
- This preserves agent work and changes
- The resolved files are automatically staged

## Safety Features

- **Stash Management**: Automatically stashes uncommitted changes before merge operations
- **Merge Abort**: Aborts merge if conflicts cannot be automatically resolved
- **Error Handling**: Gracefully handles git errors and continues operation
- **Processing Lock**: Prevents concurrent merge checks

## Integration

The coordinator is integrated into the server startup process in `server/index.ts`:

```typescript
// Initialize PR Merge Coordinator for automatic conflict resolution
const { prMergeCoordinator } = await import('./services/pr-merge-coordinator');
// Coordinator auto-initializes on import and listens to task completion events
```

## Requirements

- Git must be installed and available in PATH
- Repository must have a `develop` branch (or configured branch name)
- Sufficient permissions to perform git operations

## Notes

- The coordinator only runs when tasks are completed (via Heartline events)
- It skips checking if already on the `develop` branch
- It handles offline scenarios gracefully (continues if fetch fails)
- Merge operations are performed in a safe manner with automatic cleanup
