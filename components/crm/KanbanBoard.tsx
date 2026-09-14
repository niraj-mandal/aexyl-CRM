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
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { SortableDealCard } from "./SortableDealCard";
import { DealCard } from "./DealCard";
import { CreateDealButton } from "./CreateDealButton";
import { updateDealStageAction } from "@/app/actions/crm.actions";
import { cn } from "@/lib/utils";

const STAGES = ["QUALIFIED", "CALL_BOOKED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"];

export function KanbanBoard({
  initialDeals,
  companyOptions = [],
}: {
  initialDeals: any[];
  companyOptions?: { id: string; name: string }[];
}) {
  const [deals, setDeals] = useState(initialDeals);
  const [activeId, setActiveId] = useState<string | null>(null);
  const snapshotRef = useRef<typeof deals | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const columns = STAGES.map((stage) => {
    const stageDeals = deals.filter((d) => d.stage === stage);
    const value = stageDeals.reduce((sum, d) => sum + Number(d.value || 0), 0);
    return { id: stage, title: stage.replace("_", " "), deals: stageDeals, value };
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
          <div key={col.id} className="flex-shrink-0 w-80 snap-start flex flex-col">
            {/* Column Header */}
            <div className="mb-4 px-2">
              <h3 className="text-sm font-semibold tracking-wider text-text-muted uppercase flex justify-between items-center">
                <span>{col.title} ({col.deals.length})</span>
                <span>${col.value.toLocaleString()}</span>
              </h3>
            </div>

            {/* Column Body */}
            <div className="glass-panel flex-1 bg-surface-glass/30 border-dashed min-h-[500px] p-3 flex flex-col space-y-3">
              <SortableContext items={col.deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
                {col.deals.map((deal) => (
                  <SortableDealCard key={deal.id} deal={deal} />
                ))}
              </SortableContext>
              {companyOptions.length > 0 && (
                <CreateDealButton companies={companyOptions} defaultStage={col.id} compact />
              )}
            </div>
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
          const newDeals = [...deals];
          newDeals[activeIndex].stage = deals[overIndex].stage;
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
        const newDeals = [...deals];
        newDeals[activeIndex].stage = overId as string;
        return arrayMove(newDeals, activeIndex, activeIndex);
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
