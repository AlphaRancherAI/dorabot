import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

type Props = {
  sessionId: string;
  isActive: boolean;
  isVisible: boolean;
  unread: number;
  activeRun?: boolean;
  updatedAt: string;
  label?: string;
  displayLabel: string;
  isRenaming: boolean;
  channelIcon: ReactNode;
  children: ReactNode; // label button or rename input
  onContextMenu: (e: React.MouseEvent) => void;
};

export function SessionListItem({
  sessionId,
  isActive,
  isVisible,
  unread,
  activeRun,
  updatedAt,
  isRenaming,
  channelIcon,
  children,
  onContextMenu,
}: Props) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `session:${sessionId}`,
    data: { sessionId },
    disabled: isRenaming,
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `session-reorder:${sessionId}`,
    data: { targetSessionId: sessionId },
  });

  const setNodeRef = (el: HTMLDivElement | null) => {
    setDragRef(el);
    setDropRef(el);
  };

  return (
    <div
      ref={setNodeRef}
      {...(isRenaming ? {} : listeners)}
      {...attributes}
      className={cn(
        'flex items-center gap-1.5 w-full px-2.5 py-1 rounded-md text-[10px] transition-colors cursor-grab',
        isDragging && 'opacity-30',
        isOver && !isDragging && 'ring-1 ring-primary',
        isActive
          ? 'bg-secondary text-foreground'
          : isVisible
          ? 'bg-secondary/60 text-foreground/80'
          : 'text-muted-foreground hover:bg-secondary/50',
      )}
      onContextMenu={onContextMenu}
    >
      <span className="w-3 h-3 shrink-0 flex items-center justify-center">{channelIcon}</span>
      {children}
      {!isRenaming && unread > 0 && !activeRun && (
        <span className="text-[9px] bg-primary text-primary-foreground rounded-full px-1.5 min-w-[16px] text-center">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
      {!isRenaming && (activeRun ? (
        <Loader2 className="w-3 h-3 shrink-0 animate-spin text-primary" />
      ) : (
        <span className="text-[9px] text-muted-foreground shrink-0">
          {new Date(updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </span>
      ))}
    </div>
  );
}
