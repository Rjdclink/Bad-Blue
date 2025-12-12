/**
 * AIViewportShell - Shared layout for AI assistant viewports
 * 
 * Provides consistent "avatar left / chat right" layout for:
 * - LexaraViewport
 * - SPECTRA
 * - Future AI assistants
 * 
 * Props allow customization of:
 * - Avatar panel content
 * - Chat panel content
 * - Status bar content
 * - Layout ratio (default 40/60)
 */

import React, { memo, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface AIViewportShellProps {
  /** Content for the left avatar panel */
  avatarPanel: ReactNode;
  /** Content for the right chat panel */
  chatPanel: ReactNode;
  /** Optional status bar at top */
  statusBar?: ReactNode;
  /** Optional footer content */
  footer?: ReactNode;
  /** Layout ratio - percentage for avatar panel (default: 40) */
  avatarWidth?: number;
  /** Custom class for the container */
  className?: string;
  /** Whether to show the shell in fullscreen mode */
  fullscreen?: boolean;
  /** Background variant */
  variant?: 'default' | 'dark' | 'gradient';
}

const VARIANT_STYLES = {
  default: 'bg-slate-950',
  dark: 'bg-black',
  gradient: 'bg-gradient-to-br from-slate-950 via-indigo-950/30 to-slate-950',
};

/**
 * AIViewportShell - Two-pane layout for AI assistants
 */
export const AIViewportShell = memo(function AIViewportShell({
  avatarPanel,
  chatPanel,
  statusBar,
  footer,
  avatarWidth = 40,
  className,
  fullscreen = true,
  variant = 'gradient',
}: AIViewportShellProps) {
  const chatWidth = 100 - avatarWidth;

  return (
    <div
      className={cn(
        'flex flex-col text-white',
        VARIANT_STYLES[variant],
        fullscreen && 'min-h-screen',
        className
      )}
    >
      {/* Status Bar */}
      {statusBar && (
        <div className="flex-shrink-0 border-b border-slate-700/30">
          {statusBar}
        </div>
      )}

      {/* Main Content - Two Pane Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Avatar Panel (Left) */}
        <div
          className="flex-shrink-0 border-r border-slate-700/30 overflow-hidden"
          style={{ width: `${avatarWidth}%` }}
        >
          {avatarPanel}
        </div>

        {/* Chat Panel (Right) */}
        <div
          className="flex-1 flex flex-col overflow-hidden"
          style={{ width: `${chatWidth}%` }}
        >
          {chatPanel}
        </div>
      </div>

      {/* Footer */}
      {footer && (
        <div className="flex-shrink-0 border-t border-slate-700/30">
          {footer}
        </div>
      )}
    </div>
  );
});

/**
 * StatusBadge - Common status indicator for AI viewports
 */
export interface StatusBadgeProps {
  label: string;
  status: 'active' | 'inactive' | 'warning' | 'error';
  icon?: ReactNode;
  className?: string;
}

const STATUS_COLORS = {
  active: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  inactive: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  warning: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  error: 'bg-red-500/20 text-red-400 border-red-500/30',
};

export const StatusBadge = memo(function StatusBadge({
  label,
  status,
  icon,
  className,
}: StatusBadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
        STATUS_COLORS[status],
        className
      )}
    >
      {icon}
      <span>{label}</span>
    </div>
  );
});

/**
 * ViewportHeader - Common header for AI viewports
 */
export interface ViewportHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  actions?: ReactNode;
  badges?: ReactNode;
  className?: string;
}

export const ViewportHeader = memo(function ViewportHeader({
  title,
  subtitle,
  onBack,
  actions,
  badges,
  className,
}: ViewportHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between px-4 py-3', className)}>
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            className="p-2 rounded-lg hover:bg-slate-700/50 transition-colors"
            aria-label="Go back"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <div>
          <h1 className="text-lg font-semibold text-white">{title}</h1>
          {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
        </div>
        {badges && <div className="flex items-center gap-2 ml-3">{badges}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
});

export default AIViewportShell;
