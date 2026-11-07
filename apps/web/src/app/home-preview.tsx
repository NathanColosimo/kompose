import { cn } from "@/lib/utils";

/** Hour rows in the preview, 9 AM to 2 PM. */
const HOURS = ["9 AM", "10 AM", "11 AM", "12 PM", "1 PM", "2 PM"];
const ROW = 44;

interface Block {
  day: number;
  end: number;
  kind: "event-blue" | "event-green" | "task";
  start: number;
  title: string;
}

/** Start and end are hours after 9 AM. */
const BLOCKS: Block[] = [
  { day: 0, end: 0.5, kind: "event-blue", start: 0, title: "Design sync" },
  { day: 0, end: 2.5, kind: "task", start: 1, title: "Draft Q4 roadmap" },
  { day: 0, end: 4, kind: "event-green", start: 3, title: "Lunch with Sam" },
  { day: 1, end: 1, kind: "event-green", start: 0, title: "Sprint planning" },
  { day: 1, end: 4.5, kind: "event-blue", start: 2.5, title: "Focus block" },
  { day: 2, end: 0.5, kind: "event-blue", start: 0, title: "Design sync" },
  { day: 2, end: 3, kind: "event-green", start: 2, title: "Customer call" },
];

const blockStyles: Record<Block["kind"], string> = {
  "event-blue": "border-black/10 bg-[#b3bbe9] text-black/80",
  "event-green": "border-black/10 bg-[#ace6cc] text-black/80",
  task: "border-foreground/15 bg-card text-card-foreground shadow-[inset_2px_0_0_var(--foreground)]",
};

const DAY_WIDTH = "calc(100% / var(--days) - 6px)";

const INBOX = ["Review PR", "Book flights for Lisbon"];

/**
 * A static picture of the dashboard: an inbox beside a few days, with one
 * task mid-drag that eases in once on load. Decorative, so it is hidden
 * from assistive tech.
 */
export function HomePreview() {
  return (
    <div
      aria-hidden
      className="pointer-events-none w-full select-none overflow-hidden rounded-xl border bg-background shadow-[0_24px_60px_-24px_rgb(0_0_0/0.25)]"
    >
      {/* Two days on phones, three from sm up; --days drives the block math. */}
      <div className="flex text-[11px] [--days:2] sm:[--days:3]">
        <div className="flex w-28 shrink-0 flex-col border-r bg-sidebar sm:w-40">
          <div className="flex h-9 items-center border-b px-3 font-medium text-xs">
            Inbox
          </div>
          <div className="flex flex-col gap-0.5 p-1.5">
            {INBOX.map((title, index) => (
              <div
                className={cn(
                  "flex items-start gap-2 rounded-md px-1.5 py-1.5",
                  index === 0 ? "opacity-40" : ""
                )}
                key={title}
              >
                <span className="mt-px size-3 shrink-0 rounded-full border border-muted-foreground/50" />
                <span className="leading-snug">{title}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative min-w-0 flex-1">
          <div className="flex h-9 border-b pl-10">
            {["Fri 6", "Sat 7", "Sun 8"].map((label, index) => (
              <div
                className={cn(
                  "flex flex-1 items-center justify-center border-r last:border-r-0",
                  index === 0 ? "font-medium" : "text-muted-foreground",
                  index === 2 ? "hidden sm:flex" : ""
                )}
                key={label}
              >
                {label}
              </div>
            ))}
          </div>
          <div className="relative flex">
            <div className="w-10 shrink-0">
              {HOURS.map((hour) => (
                <div
                  className="pr-1.5 text-right text-[10px] text-muted-foreground"
                  key={hour}
                  style={{ height: ROW }}
                >
                  <span className="relative -top-1.5">{hour}</span>
                </div>
              ))}
            </div>
            <div className="relative flex flex-1">
              {[0, 1, 2].map((day) => (
                <div
                  className={cn(
                    "flex-1 border-r last:border-r-0",
                    day === 2 ? "hidden sm:block" : ""
                  )}
                  key={day}
                >
                  {HOURS.map((hour) => (
                    <div
                      className="border-border/60 border-t"
                      key={hour}
                      style={{ height: ROW }}
                    />
                  ))}
                </div>
              ))}
              {BLOCKS.map((block) => (
                <div
                  className={cn(
                    "absolute overflow-hidden truncate rounded-[5px] border px-1.5 py-1 font-medium leading-tight",
                    blockStyles[block.kind],
                    block.day === 2 ? "hidden sm:block" : ""
                  )}
                  key={`${block.day}-${block.title}`}
                  style={{
                    height: (block.end - block.start) * ROW - 3,
                    left: `calc(${block.day} * 100% / var(--days) + 3px)`,
                    top: block.start * ROW + 1,
                    width: DAY_WIDTH,
                  }}
                >
                  {block.title}
                </div>
              ))}
              {/* The task being dragged in from the inbox. */}
              <div
                className="absolute rounded-[5px] border border-foreground/40 border-dashed"
                style={{
                  height: ROW * 0.75 - 3,
                  left: "calc(100% / var(--days) + 3px)",
                  top: ROW * 1.25 + 1,
                  width: DAY_WIDTH,
                }}
              />
              <div
                className="absolute rotate-[-2deg] truncate rounded-[5px] border border-foreground/15 bg-card px-1.5 py-1 font-medium leading-tight shadow-[inset_2px_0_0_var(--foreground),0_10px_20px_-6px_rgb(0_0_0/0.25)] motion-safe:animate-[preview-drop_600ms_cubic-bezier(0.23,1,0.32,1)_300ms_both]"
                style={{
                  height: ROW * 0.75 - 3,
                  left: "calc(100% / var(--days) + 9px)",
                  top: ROW * 1.25 + 8,
                  width: "calc(100% / var(--days) - 14px)",
                }}
              >
                Review PR
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
