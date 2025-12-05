/**
 * VoiceToggle Component
 * Stage 14: Voice Mode UI Control
 * 
 * Small, elegant, unobtrusive voice activation control for LEXARA
 */

import React from 'react';
import { Mic, MicOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface VoiceToggleProps {
  isEnabled: boolean;
  isListening: boolean;
  isLoading?: boolean;
  onToggle: () => void;
  className?: string;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'inline';
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Voice Mode Toggle Button
 */
export function VoiceToggle({
  isEnabled,
  isListening,
  isLoading = false,
  onToggle,
  className,
  position = 'top-right',
  size = 'md',
}: VoiceToggleProps) {
  
  const positionClasses = {
    'top-right': 'fixed top-4 right-4 z-50',
    'top-left': 'fixed top-4 left-4 z-50',
    'bottom-right': 'fixed bottom-4 right-4 z-50',
    'bottom-left': 'fixed bottom-4 left-4 z-50',
    'inline': '',
  };

  const sizeClasses = {
    'sm': 'h-8 w-8 text-xs',
    'md': 'h-10 w-10 text-sm',
    'lg': 'h-12 w-12 text-base',
  };

  const iconSizes = {
    'sm': 14,
    'md': 16,
    'lg': 20,
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={isEnabled ? 'default' : 'outline'}
            size="icon"
            onClick={onToggle}
            disabled={isLoading}
            className={cn(
              positionClasses[position],
              sizeClasses[size],
              'rounded-full transition-all duration-300',
              isEnabled && 'shadow-lg',
              isListening && 'animate-pulse ring-2 ring-primary ring-offset-2',
              className
            )}
            aria-label={isEnabled ? 'Disable voice mode' : 'Enable voice mode'}
          >
            {isLoading ? (
              <Loader2 className="animate-spin" size={iconSizes[size]} />
            ) : isEnabled ? (
              <Mic 
                size={iconSizes[size]} 
                className={cn(
                  'transition-colors',
                  isListening && 'text-white'
                )}
              />
            ) : (
              <MicOff size={iconSizes[size]} />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-center">
            <p className="font-semibold">
              {isEnabled ? 'Voice Mode Active' : 'Voice Mode'}
            </p>
            <p className="text-xs text-muted-foreground">
              {isEnabled 
                ? isListening 
                  ? 'Listening...' 
                  : 'Click to disable'
                : 'Click to enable'
              }
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Voice Status Indicator
 * Shows current voice mode status with visual feedback
 */
export interface VoiceStatusIndicatorProps {
  isEnabled: boolean;
  isListening: boolean;
  isSpeaking?: boolean;
  transcript?: string;
  className?: string;
}

export function VoiceStatusIndicator({
  isEnabled,
  isListening,
  isSpeaking = false,
  transcript,
  className,
}: VoiceStatusIndicatorProps) {
  if (!isEnabled) {
    return null;
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-lg border bg-card text-card-foreground',
        'transition-all duration-300',
        isListening && 'border-primary bg-primary/5',
        isSpeaking && 'border-blue-500 bg-blue-50 dark:bg-blue-950',
        className
      )}
    >
      {/* Status Icon */}
      <div className="relative">
        {isListening && (
          <span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-75" />
        )}
        {isSpeaking && (
          <span className="absolute inset-0 rounded-full bg-blue-500 animate-pulse opacity-75" />
        )}
        <div
          className={cn(
            'relative h-3 w-3 rounded-full',
            isListening && 'bg-primary',
            isSpeaking && 'bg-blue-500',
            !isListening && !isSpeaking && 'bg-muted'
          )}
        />
      </div>

      {/* Status Text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">
          {isListening && 'Listening...'}
          {isSpeaking && 'LEXARA is speaking...'}
          {!isListening && !isSpeaking && 'Voice mode active'}
        </p>
        {transcript && isListening && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {transcript}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Compact Voice Badge
 * Small badge showing voice mode status
 */
export interface VoiceBadgeProps {
  isEnabled: boolean;
  isListening: boolean;
  className?: string;
}

export function VoiceBadge({ isEnabled, isListening, className }: VoiceBadgeProps) {
  if (!isEnabled) {
    return null;
  }

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium',
        'border transition-all duration-300',
        isListening
          ? 'bg-primary/10 border-primary text-primary'
          : 'bg-muted border-muted-foreground/20 text-muted-foreground',
        className
      )}
    >
      <div
        className={cn(
          'h-2 w-2 rounded-full',
          isListening ? 'bg-primary animate-pulse' : 'bg-muted-foreground/50'
        )}
      />
      <span>VOICE</span>
    </div>
  );
}
