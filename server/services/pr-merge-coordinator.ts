/**
 * PR Merge Coordinator
 * 
 * Automatically checks repository and branch 'develop' when tasks are completed,
 * resolves all conflicts, and ensures PR is ready for merge.
 * 
 * Features:
 * - Monitors task completion events
 * - Checks current branch against develop
 * - Automatically resolves merge conflicts
 * - Ensures PR readiness
 */

import { EventEmitter } from 'events';
import { execSync } from 'child_process';
import { createLogger } from '../logger';
import { heartlineEvents } from '../core/power/Heartline';

const log = createLogger('PRMergeCoordinator');

export interface MergeStatus {
  hasConflicts: boolean;
  conflicts: string[];
  mergeReady: boolean;
  currentBranch: string;
  developBranch: string;
  lastChecked: Date;
}

export interface ConflictResolution {
  file: string;
  resolution: 'ours' | 'theirs' | 'merged' | 'manual';
  success: boolean;
}

/**
 * PR Merge Coordinator - Ensures PR readiness after task completion
 */
export class PRMergeCoordinator extends EventEmitter {
  private static instance: PRMergeCoordinator;
  private isEnabled: boolean = true;
  private developBranch: string = 'develop';
  private isProcessing: boolean = false;
  private lastMergeStatus: MergeStatus | null = null;

  private constructor() {
    super();
    this.setupTaskCompletionListener();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): PRMergeCoordinator {
    if (!PRMergeCoordinator.instance) {
      PRMergeCoordinator.instance = new PRMergeCoordinator();
    }
    return PRMergeCoordinator.instance;
  }

  /**
   * Setup listener for task completion events
   */
  private setupTaskCompletionListener(): void {
    // Listen to Heartline task completion events
    heartlineEvents.on('task-completed', async (task: any) => {
      if (this.isEnabled && !this.isProcessing) {
        log.info('Task completed, checking merge status', {
          taskId: task.taskId || task.id,
          taskType: task.taskType || 'unknown',
        });

        try {
          await this.checkAndResolveConflicts();
        } catch (error) {
          log.error('Failed to check/resolve conflicts after task completion', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });

    log.info('PR Merge Coordinator initialized and listening for task completion events');
  }

  /**
   * Check current branch against develop and resolve conflicts
   */
  async checkAndResolveConflicts(): Promise<MergeStatus> {
    if (this.isProcessing) {
      log.warn('Merge check already in progress, skipping');
      return this.lastMergeStatus || this.getDefaultMergeStatus();
    }

    this.isProcessing = true;

    try {
      const currentBranch = this.getCurrentBranch();
      log.info('Checking merge status', {
        currentBranch,
        developBranch: this.developBranch,
      });

      // Fetch latest from remote
      await this.fetchLatest();

      // Check if develop branch exists
      const developExists = await this.branchExists(this.developBranch);
      if (!developExists) {
        log.warn(`Branch '${this.developBranch}' does not exist, skipping merge check`);
        return this.getDefaultMergeStatus();
      }

      // Check if we're already on develop
      if (currentBranch === this.developBranch) {
        log.info('Already on develop branch, no merge check needed');
        return this.getDefaultMergeStatus();
      }

      // Check for conflicts
      const conflicts = await this.checkForConflicts(currentBranch, this.developBranch);

      if (conflicts.length > 0) {
        log.info('Conflicts detected, resolving', { conflictCount: conflicts.length });
        const resolutions = await this.resolveConflicts(currentBranch, this.developBranch, conflicts);
        
        // Verify all conflicts resolved
        const remainingConflicts = await this.checkForConflicts(currentBranch, this.developBranch);
        
        const status: MergeStatus = {
          hasConflicts: remainingConflicts.length > 0,
          conflicts: remainingConflicts,
          mergeReady: remainingConflicts.length === 0,
          currentBranch,
          developBranch: this.developBranch,
          lastChecked: new Date(),
        };

        this.lastMergeStatus = status;
        this.emit('merge-status-updated', status);

        if (status.mergeReady) {
          log.info('All conflicts resolved, PR is ready for merge');
          this.emit('pr-ready', status);
        } else {
          log.warn('Some conflicts remain unresolved', { remainingConflicts });
          this.emit('conflicts-remaining', status);
        }

        return status;
      } else {
        const status: MergeStatus = {
          hasConflicts: false,
          conflicts: [],
          mergeReady: true,
          currentBranch,
          developBranch: this.developBranch,
          lastChecked: new Date(),
        };

        this.lastMergeStatus = status;
        this.emit('merge-status-updated', status);
        this.emit('pr-ready', status);

        log.info('No conflicts detected, PR is ready for merge');
        return status;
      }
    } catch (error) {
      log.error('Error checking/resolving conflicts', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Get current git branch
   */
  private getCurrentBranch(): string {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return branch;
    } catch (error) {
      log.error('Failed to get current branch', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error('Failed to determine current branch');
    }
  }

  /**
   * Check if branch exists
   */
  private async branchExists(branchName: string): Promise<boolean> {
    try {
      execSync(`git rev-parse --verify ${branchName}`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fetch latest from remote
   */
  private async fetchLatest(): Promise<void> {
    try {
      log.debug('Fetching latest from remote');
      execSync('git fetch origin', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (error) {
      log.warn('Failed to fetch from remote', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue anyway - might be working offline
    }
  }

  /**
   * Check for merge conflicts between current branch and develop
   */
  private async checkForConflicts(currentBranch: string, developBranch: string): Promise<string[]> {
    try {
      // Try to merge develop into current branch (dry run)
      const mergeBase = execSync(
        `git merge-base ${currentBranch} origin/${developBranch}`,
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim();

      // Check what files would conflict
      execSync(
        `git merge-tree ${mergeBase} ${currentBranch} origin/${developBranch}`,
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
      );

      // If merge-tree succeeds, no conflicts
      return [];
    } catch (error) {
      // Parse conflict files from error output
      const errorOutput = error instanceof Error ? error.message : String(error);
      const conflictFiles: string[] = [];

      // Try alternative method: attempt merge and check status
      try {
        // Stash current changes if any
        const hasChanges = this.hasUncommittedChanges();
        if (hasChanges) {
          execSync('git stash push -m "PRMergeCoordinator: temporary stash"', {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
          });
        }

        // Attempt merge
        try {
          execSync(`git merge --no-commit --no-ff origin/${developBranch}`, {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
          });
        } catch (mergeError) {
          // Check for conflicted files
          const statusOutput = execSync('git diff --name-only --diff-filter=U', {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
          }).trim();

          if (statusOutput) {
            conflictFiles.push(...statusOutput.split('\n').filter(Boolean));
          }
        }

        // Abort merge and restore stash
        try {
          execSync('git merge --abort', {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
          });
        } catch {
          // Ignore abort errors
        }

        if (hasChanges) {
          try {
            execSync('git stash pop', {
              encoding: 'utf-8',
              stdio: ['ignore', 'pipe', 'ignore'],
            });
          } catch {
            // Ignore stash pop errors
          }
        }

        return conflictFiles;
      } catch (checkError) {
        log.warn('Could not determine conflicts via merge attempt', {
          error: checkError instanceof Error ? checkError.message : String(checkError),
        });
        return [];
      }
    }
  }

  /**
   * Check if there are uncommitted changes
   */
  private hasUncommittedChanges(): boolean {
    try {
      const status = execSync('git status --porcelain', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return status.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Resolve conflicts automatically
   */
  private async resolveConflicts(
    currentBranch: string,
    developBranch: string,
    conflictFiles: string[]
  ): Promise<ConflictResolution[]> {
    const resolutions: ConflictResolution[] = [];

    log.info('Resolving conflicts', {
      conflictCount: conflictFiles.length,
      files: conflictFiles,
    });

    // Stash any uncommitted changes
    const hasChanges = this.hasUncommittedChanges();
    if (hasChanges) {
      execSync('git stash push -m "PRMergeCoordinator: pre-merge stash"', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    }

    try {
      // Attempt merge
      try {
        execSync(`git merge --no-commit --no-ff origin/${developBranch}`, {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        // No conflicts, merge succeeded
        return conflictFiles.map(file => ({
          file,
          resolution: 'merged',
          success: true,
        }));
      } catch (mergeError) {
        // Conflicts detected, resolve them
        for (const file of conflictFiles) {
          try {
            const resolution = await this.resolveFileConflict(file);
            resolutions.push(resolution);
          } catch (error) {
            log.error('Failed to resolve conflict in file', {
              file,
              error: error instanceof Error ? error.message : String(error),
            });
            resolutions.push({
              file,
              resolution: 'manual',
              success: false,
            });
          }
        }

        // If all conflicts resolved, complete the merge
        if (resolutions.every(r => r.success)) {
          try {
            execSync('git commit --no-edit', {
              encoding: 'utf-8',
              stdio: ['ignore', 'pipe', 'ignore'],
            });
            log.info('Merge completed successfully after conflict resolution');
          } catch (commitError) {
            log.warn('Failed to commit merge', {
              error: commitError instanceof Error ? commitError.message : String(commitError),
            });
          }
        } else {
          // Abort merge if not all conflicts resolved
          try {
            execSync('git merge --abort', {
              encoding: 'utf-8',
              stdio: ['ignore', 'pipe', 'ignore'],
            });
          } catch {
            // Ignore abort errors
          }
        }
      }
    } finally {
      // Restore stashed changes
      if (hasChanges) {
        try {
          execSync('git stash pop', {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
          });
        } catch {
          // Ignore stash pop errors
        }
      }
    }

    return resolutions;
  }

  /**
   * Resolve conflict in a specific file
   */
  private async resolveFileConflict(file: string): Promise<ConflictResolution> {
    try {
      // Read the conflicted file
      const fs = await import('fs/promises');
      const content = await fs.readFile(file, 'utf-8');

      // Check conflict markers
      const conflictMarkers = {
        ours: /^<<<<<<< HEAD/m,
        theirs: /^>>>>>>> /m,
        separator: /^=======$/m,
      };

      if (!conflictMarkers.ours.test(content) || !conflictMarkers.theirs.test(content)) {
        // No conflict markers found, might be resolved already
        return { file, resolution: 'merged', success: true };
      }

      // Strategy: Prefer current branch (ours) for most cases
      // This keeps the agent's work intact
      const lines = content.split('\n');
      const resolved: string[] = [];
      let inConflict = false;
      let conflictStart = -1;
      let conflictSeparator = -1;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (conflictMarkers.ours.test(line)) {
          inConflict = true;
          conflictStart = i;
          continue;
        }

        if (conflictMarkers.separator.test(line)) {
          conflictSeparator = i;
          continue;
        }

        if (conflictMarkers.theirs.test(line)) {
          // End of conflict - keep our version (lines between conflictStart and conflictSeparator)
          if (conflictStart >= 0 && conflictSeparator > conflictStart) {
            // Add our version (between conflictStart and conflictSeparator)
            for (let j = conflictStart + 1; j < conflictSeparator; j++) {
              resolved.push(lines[j]);
            }
          }
          inConflict = false;
          conflictStart = -1;
          conflictSeparator = -1;
          continue;
        }

        if (!inConflict) {
          resolved.push(line);
        }
      }

      // Write resolved content
      await fs.writeFile(file, resolved.join('\n'), 'utf-8');

      // Stage the resolved file
      execSync(`git add "${file}"`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      log.info('Resolved conflict in file', { file, strategy: 'ours' });
      return { file, resolution: 'ours', success: true };
    } catch (error) {
      log.error('Failed to resolve conflict in file', {
        file,
        error: error instanceof Error ? error.message : String(error),
      });
      return { file, resolution: 'manual', success: false };
    }
  }

  /**
   * Get default merge status
   */
  private getDefaultMergeStatus(): MergeStatus {
    return {
      hasConflicts: false,
      conflicts: [],
      mergeReady: true,
      currentBranch: this.getCurrentBranch(),
      developBranch: this.developBranch,
      lastChecked: new Date(),
    };
  }

  /**
   * Get last merge status
   */
  getLastMergeStatus(): MergeStatus | null {
    return this.lastMergeStatus;
  }

  /**
   * Enable/disable the coordinator
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    log.info('PR Merge Coordinator', { enabled });
  }

  /**
   * Set develop branch name
   */
  setDevelopBranch(branchName: string): void {
    this.developBranch = branchName;
    log.info('Develop branch updated', { branch: branchName });
  }

  /**
   * Manually trigger merge check
   */
  async manualCheck(): Promise<MergeStatus> {
    return await this.checkAndResolveConflicts();
  }
}

// Export singleton instance
export const prMergeCoordinator = PRMergeCoordinator.getInstance();

// Export for use in other modules
export default prMergeCoordinator;
