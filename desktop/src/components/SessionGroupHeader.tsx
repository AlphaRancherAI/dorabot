import { useDraggable, useDroppable } from '@dnd-kit/core';
import { ChevronRight, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  groupId: string;
  name: string;
  isCollapsed: boolean;
  sessionCount: number;
  isRenaming: boolean;
  renameValue: string;
  onToggle: () => void;
  onRenameChange: (v: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
};

export function SessionGroupHeader({
  groupId, name, isCollapsed, sessionCount, isRenaming,
  renameValue, onToggle, onRenameChange, onRenameSubmit, onRenameCancel, onContextMenu,
}: Props) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `group:${groupId}`,
    data: { groupId },
    disabled: isRenaming,
  });

  const { setNodeRef: setDropSessionRef, isOver: isOverSession } = useDroppable({
    id: `group-header:${groupId}`,
    data: { groupId },
  });

  const { setNodeRef: setDropReorderRef, isOver: isOverReorder } = useDroppable({
    id: `group-reorder:${groupId}`,
    data: { targetGroupId: groupId },
  });

  const setRef = (el: HTMLDivElement | null) => {
    setDragRef(el);
    setDropSessionRef(el);
    setDropReorderRef(el);
  };

  return (
    <div
      ref={setRef}
      className={cn(
        'flex items-center gap-1 w-full px-1.5 py-1 rounded-md text-[10px] transition-colors group/gh mt-1',
        isDragging && 'opacity-30',
        isOverSession && !isDragging && 'ring-1 ring-primary bg-secondary/40',
        isOverReorder && !isDragging && 'ring-1 ring-primary/40',
        'text-muted-foreground hover:bg-secondary/30',
      )}
      onContextMenu={onContextMenu}
    >
      <span
        {...listeners}
        {...attributes}
        className="cursor-grab opacity-0 group-hover/gh:opacity-40 hover:!opacity-80 shrink-0 touch-none"
        onClick={e => e.stopPropagation()}
      >
        <GripVertical className="w-3 h-3" />
      </span>
      <button
        className="flex items-center gap-1 flex-1 min-w-0 text-left"
        onClick={onToggle}
      >
        <ChevronRight className={cn('w-3 h-3 shrink-0 transition-transform duration-150', !isCollapsed && 'rotate-90')} />
        {isRenaming ? (
          <input
            autoFocus
            className="flex-1 min-w-0 bg-transparent border-b border-border text-[10px] outline-none py-0 font-medium uppercase tracking-wider"
            value={renameValue}
            onChange={e => onRenameChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onRenameSubmit();
              else if (e.key === 'Escape') onRenameCancel();
            }}
            onBlur={onRenameSubmit}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span
            className="truncate font-medium uppercase tracking-wider text-[9px] hover:text-foreground transition-colors"
            onDoubleClick={e => { e.stopPropagation(); onRenameSubmit(); }}
          >
            {name}
          </span>
        )}
        {!isRenaming && (
          <span className="ml-1 text-[9px] opacity-50 shrink-0">{sessionCount}</span>
        )}
      </button>
    </div>
  );
}
