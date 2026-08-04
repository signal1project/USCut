import React, { useState } from 'react';
import { Plus, GripVertical } from 'lucide-react';
import { PubStatus } from '@mas/types';
import { StatusTag } from '@mas/ui';
import { Button, Badge } from '@/components/ui';
import { cn } from '@/lib/utils';

interface PipelineItem {
  id: string;
  title: string;
  platform: string;
  stage: PipelineStage;
  scheduledAt?: string;
}

type PipelineStage =
  | 'ideas'
  | 'drafting'
  | 'approval'
  | 'scheduled'
  | 'published';

const STAGES: {
  key: PipelineStage;
  label: string;
  status: PubStatus | null;
  color: string;
}[] = [
  {
    key: 'ideas',
    label: 'Ideas',
    status: null,
    color: 'border-t-ink-subtle/40',
  },
  {
    key: 'drafting',
    label: 'Drafting',
    status: PubStatus.DRAFT,
    color: 'border-t-blue-500/60',
  },
  {
    key: 'approval',
    label: 'Needs Approval',
    status: PubStatus.QUEUED,
    color: 'border-t-warning/60',
  },
  {
    key: 'scheduled',
    label: 'Scheduled',
    status: PubStatus.PUBLISHING,
    color: 'border-t-accent/60',
  },
  {
    key: 'published',
    label: 'Published',
    status: PubStatus.PUBLISHED,
    color: 'border-t-success/60',
  },
];

const SEED_ITEMS: PipelineItem[] = [
  {
    id: '1',
    title: 'Q3 product launch teaser',
    platform: 'instagram',
    stage: 'ideas',
  },
  {
    id: '2',
    title: 'Customer success story #7',
    platform: 'linkedin',
    stage: 'drafting',
  },
  {
    id: '3',
    title: 'Weekly tips thread',
    platform: 'twitter',
    stage: 'approval',
  },
  {
    id: '4',
    title: 'Behind-the-scenes reel',
    platform: 'tiktok',
    stage: 'scheduled',
    scheduledAt: 'Tomorrow 9am',
  },
  {
    id: '5',
    title: 'May newsletter recap',
    platform: 'facebook',
    stage: 'published',
  },
];

let nextId = 100;

/** Content Pipeline — drag-free Kanban for moving posts through stages. */
export default function PipelinePage(): React.ReactElement {
  const [items, setItems] = useState<PipelineItem[]>(SEED_ITEMS);
  const [dragging, setDragging] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<PipelineStage | null>(null);

  const byStage = (stage: PipelineStage) =>
    items.filter((i) => i.stage === stage);

  const moveItem = (id: string, to: PipelineStage) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, stage: to } : i)),
    );
  };

  const addIdea = () => {
    const title = `New idea #${++nextId}`;
    setItems((prev) => [
      ...prev,
      { id: String(nextId), title, platform: 'instagram', stage: 'ideas' },
    ]);
  };

  const handleDragStart = (id: string) => setDragging(id);
  const handleDragEnd = () => {
    if (dragging && overStage) moveItem(dragging, overStage);
    setDragging(null);
    setOverStage(null);
  };
  const handleDragOver = (e: React.DragEvent, stage: PipelineStage) => {
    e.preventDefault();
    setOverStage(stage);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear when leaving the column entirely (not entering a child element)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setOverStage(null);
    }
  };

  return (
    <div className="p-6 h-full flex flex-col gap-4 overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        <h2 className="text-lg font-semibold text-ink-strong">
          Content Pipeline
        </h2>
        <Button size="sm" onClick={addIdea}>
          <Plus size={14} />
          Add idea
        </Button>
      </div>

      {/* Kanban board */}
      <div className="flex gap-3 overflow-x-auto flex-1 pb-2">
        {STAGES.map(({ key, label, status, color }) => {
          const stageItems = byStage(key);
          const isOver = overStage === key;
          return (
            <div
              key={key}
              className={cn(
                'flex flex-col min-w-[220px] w-[220px] rounded-lg border border-border',
                'bg-surface-1 transition-colors shrink-0',
                isOver && 'border-accent/40 bg-surface-2',
              )}
              onDragOver={(e) => handleDragOver(e, key)}
              onDragLeave={handleDragLeave}
              onDrop={handleDragEnd}
            >
              {/* Column header */}
              <div className={cn('rounded-t-lg border-t-2 px-3 py-2.5', color)}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink-base">
                    {label}
                  </span>
                  <Badge
                    variant="secondary"
                    className="text-xs h-5 min-w-[1.25rem] justify-center"
                  >
                    {stageItems.length}
                  </Badge>
                </div>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {stageItems.map((item) => (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={() => handleDragStart(item.id)}
                    onDragEnd={handleDragEnd}
                    className={cn(
                      'rounded-md border border-border bg-surface-2 p-2.5 cursor-grab',
                      'hover:border-accent/30 transition-colors active:cursor-grabbing',
                      dragging === item.id && 'opacity-40',
                    )}
                  >
                    <div className="flex items-start gap-1.5">
                      <GripVertical
                        size={12}
                        className="text-ink-subtle shrink-0 mt-0.5"
                      />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <p className="text-xs font-medium text-ink-base leading-tight">
                          {item.title}
                        </p>
                        <div className="flex items-center flex-wrap gap-1">
                          <span className="text-xs text-ink-muted capitalize">
                            {item.platform}
                          </span>
                          {status && <StatusTag status={status} />}
                        </div>
                        {item.scheduledAt && (
                          <p className="text-xs text-accent">
                            {item.scheduledAt}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Quick-move buttons */}
                    <div className="flex gap-1 mt-2">
                      {STAGES.filter((s) => s.key !== key).map((s) => (
                        <button
                          key={s.key}
                          title={`Move to ${s.label}`}
                          onClick={() => moveItem(item.id, s.key)}
                          className={cn(
                            'flex-1 rounded text-[10px] py-0.5 border border-border',
                            'text-ink-subtle hover:bg-surface-3 hover:text-ink-base transition-colors',
                          )}
                        >
                          {s.label.split(' ')[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                {stageItems.length === 0 && (
                  <p className="text-center text-xs text-ink-subtle py-6">
                    Drop here
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
