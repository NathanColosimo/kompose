import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { extractMeetingLink } from "@kompose/state/meeting";
import type { LucideIcon } from "lucide-react-native";
import { Check, MapPin, Video } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import type { Temporal } from "temporal-polyfill";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { mixColor } from "@/lib/color-mix";
import { useColorScheme } from "@/lib/color-scheme-context";
import { THEME } from "@/lib/theme";

/** Blocks shorter than this show only their title. */
const TITLE_ONLY_MINUTES = 45;
/** Blocks at least this long also list their details. */
const DETAILS_MINUTES = 60;
/** Blocks at least this long let the title wrap to two lines. */
const TWO_LINE_TITLE_MINUTES = 90;
/** Blocks shorter than this center one line with no vertical padding. */
const COMPACT_MINUTES = 30;

export interface BlockDetail {
  icon: LucideIcon;
  label: string;
}

/** A compact time, "9", "9:30", with the meridiem added by the caller. */
function clockTime(zdt: Temporal.ZonedDateTime): string {
  const hour = zdt.hour % 12 || 12;
  return zdt.minute === 0
    ? `${hour}`
    : `${hour}:${zdt.minute.toString().padStart(2, "0")}`;
}

const meridiem = (zdt: Temporal.ZonedDateTime) => (zdt.hour < 12 ? "am" : "pm");

/** "9 – 10:30am", or "11pm – 1am" when the halves of the day differ. */
function formatTimeRange(
  start: Temporal.ZonedDateTime,
  end: Temporal.ZonedDateTime
): string {
  const sameHalf =
    meridiem(start) === meridiem(end) &&
    start.toPlainDate().equals(end.toPlainDate());
  return sameHalf
    ? `${clockTime(start)} – ${clockTime(end)}${meridiem(end)}`
    : `${clockTime(start)}${meridiem(start)} – ${clockTime(end)}${meridiem(end)}`;
}

/** The meeting provider, or else the place, for an event's detail line. */
export function eventDetails(event: GoogleEvent): BlockDetail[] {
  const meeting = extractMeetingLink(event);
  if (meeting) {
    return [{ icon: Video, label: meeting.label }];
  }
  const place = event.location?.trim();
  return place ? [{ icon: MapPin, label: place }] : [];
}

interface BlockPosition {
  columnIndex?: number;
  columnSpan?: number;
  height: number;
  top: number;
  totalColumns?: number;
  zIndex?: number;
}

function positionStyle({
  columnIndex = 0,
  columnSpan = 1,
  height,
  top,
  totalColumns = 1,
  zIndex = 1,
}: BlockPosition) {
  // Shared column-span layout: see packages/state/src/collision-utils.ts.
  const single = 100 / totalColumns;
  return {
    height,
    left: `${columnIndex * single}%` as const,
    top,
    width: `${single * columnSpan}%` as const,
    zIndex,
  };
}

interface BlockTextProps {
  details?: BlockDetail[];
  end: Temporal.ZonedDateTime;
  /** Visible minutes, which set how much text fits. */
  minutes: number;
  start: Temporal.ZonedDateTime;
  struck?: boolean;
  title: string;
}

/** Title, then the time once there's room, then details on long blocks. */
function BlockText({
  details = [],
  end,
  minutes,
  start,
  struck = false,
  title,
}: BlockTextProps) {
  // Secondary text at AA contrast on every Google color in both themes.
  const { isDarkColorScheme } = useColorScheme();
  const meta = isDarkColorScheme ? "text-foreground/70" : "text-foreground/80";
  return (
    <View className="min-w-0 flex-1">
      <Text
        className={`font-sans-medium text-[11px] leading-[14px] ${struck ? "text-muted-foreground line-through" : "text-foreground"}`}
        numberOfLines={minutes >= TWO_LINE_TITLE_MINUTES ? 2 : 1}
      >
        {title}
      </Text>
      {minutes >= TITLE_ONLY_MINUTES ? (
        <Text
          className={`text-[10px] leading-[13px] ${meta}`}
          numberOfLines={1}
        >
          {formatTimeRange(start, end)}
        </Text>
      ) : null}
      {minutes >= DETAILS_MINUTES
        ? details.map(({ icon, label }) => (
            <View className="mt-0.5 flex-row items-center gap-1" key={label}>
              <Icon as={icon} className={meta} size={10} />
              <Text
                className={`flex-1 text-[10px] leading-[13px] ${meta}`}
                numberOfLines={1}
              >
                {label}
              </Text>
            </View>
          ))
        : null}
    </View>
  );
}

/** Surface colors for an event: a tint of its color, with the full color as a bar. */
function useEventSurface(color: string | undefined) {
  const { isDarkColorScheme } = useColorScheme();
  const theme = isDarkColorScheme ? THEME.dark : THEME.light;
  const base = color ?? theme.foreground;
  return {
    bar: isDarkColorScheme ? base : mixColor(base, theme.foreground, 0.8),
    border: mixColor(base, theme.background, isDarkColorScheme ? 0.32 : 0.55),
    fill: mixColor(base, theme.background, isDarkColorScheme ? 0.24 : 0.4),
  };
}

function Surface({
  children,
  compact = false,
  surface,
}: {
  children: ReactNode;
  /** Center one line vertically, for short blocks and the all-day row. */
  compact?: boolean;
  surface: ReturnType<typeof useEventSurface>;
}) {
  return (
    <View
      className="h-full flex-row overflow-hidden rounded-[5px]"
      style={{
        backgroundColor: surface.fill,
        borderColor: surface.border,
        borderWidth: 1,
      }}
    >
      <View style={{ backgroundColor: surface.bar, width: 3 }} />
      <View
        className={`min-w-0 flex-1 px-1.5 ${compact ? "justify-center" : "py-1"}`}
      >
        {children}
      </View>
    </View>
  );
}

interface EventBlockProps
  extends BlockPosition,
    Omit<BlockTextProps, "struck"> {
  color: string | undefined;
  /** Opens the editor. Without it, taps still don't fall through to the grid. */
  onPress?: () => void;
}

/** A timed Google event, or a workout, on the grid. */
export function EventBlock({
  color,
  details,
  end,
  minutes,
  onPress,
  start,
  title,
  ...position
}: EventBlockProps) {
  const surface = useEventSurface(color);
  return (
    <Pressable
      accessibilityLabel={`${title}, ${formatTimeRange(start, end)}`}
      accessibilityRole={onPress ? "button" : undefined}
      className={`absolute p-px ${onPress ? "active:opacity-80" : ""}`}
      onPress={(event) => {
        event.stopPropagation();
        onPress?.();
      }}
      style={positionStyle(position)}
    >
      <Surface compact={minutes < COMPACT_MINUTES} surface={surface}>
        <BlockText
          details={details}
          end={end}
          minutes={minutes}
          start={start}
          title={title}
        />
      </Surface>
    </Pressable>
  );
}

interface TaskBlockProps extends BlockPosition, BlockTextProps {
  done: boolean;
  onPress: () => void;
  onToggleDone: () => void;
}

/** A scheduled task: a plain card with a checkbox, so only events carry color. */
export function TaskBlock({
  details,
  done,
  end,
  minutes,
  onPress,
  onToggleDone,
  start,
  title,
  ...position
}: TaskBlockProps) {
  return (
    <Pressable
      accessibilityLabel={`${title}, ${formatTimeRange(start, end)}`}
      accessibilityRole="button"
      className={`absolute p-px active:opacity-80 ${done ? "opacity-60" : ""}`}
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}
      style={positionStyle(position)}
    >
      <View
        className={`h-full flex-row gap-1 overflow-hidden rounded-[5px] border border-foreground/20 bg-card px-1 ${minutes < COMPACT_MINUTES ? "items-center" : "py-1"}`}
      >
        <Pressable
          accessibilityLabel={done ? "Mark as not done" : "Mark as done"}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          hitSlop={8}
          onPress={(event) => {
            event.stopPropagation();
            onToggleDone();
          }}
        >
          <View
            className={`size-3 items-center justify-center rounded-[3px] border ${minutes < COMPACT_MINUTES ? "" : "mt-px"} ${done ? "border-primary bg-primary" : "border-foreground/60"}`}
          >
            {done ? (
              <Icon as={Check} className="text-primary-foreground" size={9} />
            ) : null}
          </View>
        </Pressable>
        <BlockText
          details={details}
          end={end}
          minutes={minutes}
          start={start}
          struck={done}
          title={title}
        />
      </View>
    </Pressable>
  );
}

/** An all-day event in the row above the grid. */
export function AllDayBlock({
  color,
  onPress,
  title,
}: {
  color: string | undefined;
  onPress: () => void;
  title: string;
}) {
  const surface = useEventSurface(color);
  return (
    <Pressable
      accessibilityLabel={`${title}, all day`}
      accessibilityRole="button"
      className="h-5 active:opacity-80"
      onPress={onPress}
    >
      <Surface compact surface={surface}>
        <Text
          className="font-sans-medium text-[10px] text-foreground leading-[13px]"
          numberOfLines={1}
        >
          {title}
        </Text>
      </Surface>
    </Pressable>
  );
}
