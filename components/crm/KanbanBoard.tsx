"use client";

import { useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { SortableDealCard } from "./SortableDealCard";
import { DealCard, type DealCardData } from "./DealCard";
import { CreateDealButton } from "./CreateDealButton";
import { updateDealStageAction } from "@/app/actions/crm.actions";
import { DEAL_STAGES, rupees } from "@/lib/stages";
import { useIsSales } from "@/components/providers/role-provider";

const STAGES = DEAL_STAGES.map((s) => s.key);

export function KanbanBoard({
  initialDeals,
  companyOptions = [],
}: {
  initialDeals: DealCardData[];
  companyOptions?: { id: string; name: string }[];
}) {
  const [deals, setDeals] = useState(initialDeals);
  const isSales = useIsSales();
  const [activeId, setActiveId] = useState<string | null>(null);
  const snapshotRef = useRef<typeof deals | null>(null);

  /** Optimistically drop a deleted deal from the board (server action has
   *  already persisted + audited the delete by the time this runs). */
  const removeDeal = (dealId: string) => {
    setDeals((prev) => prev.filter((d) => d.id !== dealId));
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const columns = DEAL_STAGES.map((stage) => {
    const stageDeals = deals.filter((d) => d.stage === stage.key);
    const value = stageDeals.reduce((sum, d) => sum + Number(d.value || 0), 0);
    return { id: stage.key, title: stage.label, color: stage.color, deals: stageDeals, value };
  });

  return (
    <div className="flex h-full w-full overflow-x-auto pb-4 space-x-6 snap-x snap-mandatory">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {columns.map((col) => (
          <div key={col.id} className="flex-shrink-0 w-72 snap-start flex flex-col">
            {/* Column Header */}
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: col.color }} />
                {col.title}
                <span className="num rounded-full bg-surface-high px-1.5 py-0.5 text-[11px] font-normal text-text-muted">{col.deals.length}</span>
              </span>
              {!isSales && <span className="num text-xs text-text-muted">{rupees(col.value)}</span>}
            </div>

            {/* Column Body */}
            <DroppableColumn id={col.id} color={col.color}>
              {col.deals.length === 0 && (
                <p className="rounded-lg border border-dashed border-border-subtle px-3 py-6 text-center text-xs text-text-muted">
                  No deals in {col.title.toLowerCase()}
                </p>
              )}
              <SortableContext items={col.deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
                {col.deals.map((deal) => (
                  <SortableDealCard key={deal.id} deal={deal} onDeleted={isSales ? undefined : removeDeal} />
                ))}
              </SortableContext>
              {companyOptions.length > 0 && (
                <CreateDealButton companies={companyOptions} defaultStage={col.id} compact />
              )}
            </DroppableColumn>
          </div>
        ))}

        <DragOverlay>
          {activeId ? <DealCard deal={deals.find((d) => d.id === activeId)!} isOverlay /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
    // Snapshot state so we can restore it if the server action fails
    snapshotRef.current = deals;
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    if (activeId === overId) return;

    const isActiveDeal = active.data.current?.type === "Deal";
    const isOverDeal = over.data.current?.type === "Deal";

    if (!isActiveDeal) return;

    // Moving Deal to Deal
    if (isActiveDeal && isOverDeal) {
      setDeals((deals) => {
        const activeIndex = deals.findIndex((t) => t.id === activeId);
        const overIndex = deals.findIndex((t) => t.id === overId);
        
        if (deals[activeIndex].stage !== deals[overIndex].stage) {
          // Copy, don't mutate: the drag-start snapshot must keep the old stage for rollback.
          const newDeals = [...deals];
          newDeals[activeIndex] = { ...deals[activeIndex], stage: deals[overIndex].stage };
          return arrayMove(newDeals, activeIndex, overIndex);
        }

        return arrayMove(deals, activeIndex, overIndex);
      });
    }

    // Moving Deal to Empty Column
    const isOverColumn = STAGES.includes(overId as string);
    if (isActiveDeal && isOverColumn) {
      setDeals((deals) => {
        const activeIndex = deals.findIndex((t) => t.id === activeId);
        if (deals[activeIndex].stage === overId) return deals;
        const newDeals = [...deals];
        newDeals[activeIndex] = { ...deals[activeIndex], stage: overId as string };
        return newDeals;
      });
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const dealId = active.id as string;
    const activeDeal = deals.find(d => d.id === dealId);
    if (!activeDeal) return;

    // Fire the server action to persist to PostgreSQL
    try {
      await updateDealStageAction(dealId, activeDeal.stage);
    } catch (e) {
      console.error("Failed to update deal stage — reverting board", e);
      // Roll back the optimistic UI update so the board matches the database
      if (snapshotRef.current) {
        setDeals(snapshotRef.current);
      }
    } finally {
      snapshotRef.current = null;
    }
  }
}

/** Registers the column as a drop target so deals can land in an empty stage. */
function DroppableColumn({ id, color, children }: { id: string; color: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[420px] flex-1 flex-col space-y-3 rounded-xl border p-3 transition-colors ${
        isOver ? "border-border-strong bg-surface-high/50" : "border-border-subtle bg-surface-lowest/40"
      }`}
      style={{ borderTop: `2px solid ${color}` }}
    >
      {children}
    </div>
  );
}
