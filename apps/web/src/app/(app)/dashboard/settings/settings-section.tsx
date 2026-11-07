import type { ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** A titled group of settings rows. */
export function SettingsSection({
  action,
  children,
  description,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  description: ReactNode;
  title: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-medium text-base">{title}</h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        {action}
      </div>
      <div className="divide-y rounded-lg border bg-card">{children}</div>
    </section>
  );
}

/** One linked account or app, with its action on the right. */
export function SettingsRow({
  action,
  detail,
  image,
  name,
}: {
  action: ReactNode;
  detail: string;
  image?: string | null;
  name: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Avatar className="size-8">
        {image ? <AvatarImage alt="" src={image} /> : null}
        <AvatarFallback className="text-xs">{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{name}</p>
        <p className="truncate text-muted-foreground text-xs">{detail}</p>
      </div>
      {action}
    </div>
  );
}

/** Same frame as SettingsRow, so nothing shifts when data arrives. */
export function SettingsRowSkeleton() {
  return (
    <div aria-hidden className="flex items-center gap-3 px-4 py-3">
      <Skeleton className="size-8 rounded-full" />
      <div className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-3 w-44" />
      </div>
    </div>
  );
}

export function SettingsEmpty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-3 text-muted-foreground text-sm">{children}</p>;
}
